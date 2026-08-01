// AYP TrackID 抽出ロジック（純関数・DOM非依存）— parse.js の TypeScript 移植
import type { ParsedOcr } from './types';

// 先頭の記号ノイズ（"| " など）を除去した正規化行
function norm(l: string): string {
  return l.replace(/^[^a-zA-Z0-9ぁ-んァ-ヶ一-龯]+/, '').trim();
}

// スクラバー行: 「経過 … -残り」(例: 1:08:03 GEE -53:25 / 41:37 -1:19:26)
function isScrubberLine(l: string): boolean {
  return /^\d{1,2}:\d{2}(?::\d{2})?.*-\s*\d{1,2}:\d{2}(?::\d{2})?/.test(norm(l));
}

// ウィジェット候補のゆるい妥当性判定: 文字が十分ある＆数字より文字が多いだけ。
// 本物の曲名には記号（' . ( "）や数字（12" Mix）が普通に含まれるため、純テキスト判定はしない。
function plausibleText(l: string, minLetters: number): boolean {
  const n = l.trim();
  const letters = (n.match(/[a-zA-Zぁ-んァ-ヶ一-龯]/g) || []).length;
  const digits = (n.match(/[0-9]/g) || []).length;
  return letters >= minLetters && letters > digits && n.length >= 4;
}

// 表示用クリーニング: 末尾のOCRノイズ（"LL" / " nl)" 等）と先頭の小文字ゴミ（"fr " 等）を除去
function cleanTitle(s: string): string {
  return String(s)
    .replace(/\s+[A-Za-z]{2,3}$/, '') // 末尾の2-3文字ノイズ（例: " LL"）— 実タイトルの " (12\" Mix)" は4文字以上で対象外
    .replace(/\s+[a-z]{1,3}\)$/, '') // 末尾の小文字+閉じ括弧ノイズ（例: " nl)"）
    .replace(/^[a-z]{1,3}\s+(?=[A-Z])/, '') // 先頭の小文字ゴミ（例: "fr "）
    .trim();
}

export function parseOcrText(text: string): ParsedOcr {
  const lines = (text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const elapsed = extractElapsed(text);
  const episode = extractEpisode(text);
  // スクラバー行は keepLine で除外される前に生の lines から位置を特定する
  const scrubIdx = lines.findIndex(isScrubberLine);
  const clean = lines
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => keepLine(l))
    // ステータスバー行（先頭が時刻始まり）は弾く
    .filter(({ l, i }) => !(i === 0 && /^\d{1,2}:\d{2}/.test(l)));
  // スクラバーより上（=ウィジェット/アートワーク領域）の行だけを候補に
  const pool = scrubIdx >= 0 ? clean.filter(({ i }) => i < scrubIdx) : clean;
  const poolLines = pool.map(({ l }) => l);
  let title = '';
  let artist = '';

  // iOSロック画面パターン: スクラバーの直上がアーティスト、その上がタイトル（ウィジェット構造）
  if (scrubIdx >= 2 && poolLines.length >= 2) {
    const a = poolLines[poolLines.length - 1];
    const t = poolLines[poolLines.length - 2];
    if (plausibleText(t, 4) && plausibleText(a, 3) && t.length >= a.length) {
      title = cleanTitle(t);
      artist = a.trim();
      return { title, artist, elapsed, episode };
    }
  }

  // DJミックス等のフォールバック: 最長行をタイトル、次の行をアーティストに
  if (poolLines.length >= 1) {
    let titleIdx = 0;
    poolLines.forEach((l, i) => {
      if (l.length > poolLines[titleIdx].length) titleIdx = i;
    });
    title = cleanTitle(poolLines[titleIdx]);
    if (poolLines[titleIdx + 1]) artist = poolLines[titleIdx + 1].trim();
  }
  return { title, artist, elapsed, episode };
}

export function extractElapsed(text: string): string {
  // スクラバー行（「経過 - 残り」、残りは MM:SS または H:MM:SS）を優先
  const m = text.match(/(\d{1,2}:\d{2}(?::\d{2})?)[^\n]*?-\s*\d{1,2}:\d{2}(?::\d{2})?/);
  if (m) return m[1];
  // フォールバック: 最後に出てくる単独の時刻（ステータスバーの時計より再生位置が後にあることが多い）
  const all = [...text.matchAll(/\d{1,2}:\d{2}(?::\d{2})?/g)];
  return all.length ? all[all.length - 1][0] : '';
}

export function extractEpisode(text: string): string {
  // 誤検知防止: 「#」付き or SHOW/EPISODE/RADIO 直後の数字だけ拾う（時刻の数字と区別するため）
  const m = text.match(/(?:SHOW|EPISODE|RADIO)\s*#?\s*(\d{2,3})|#\s*(\d{2,3})/i);
  return m ? `#${m[1] || m[2]}` : '';
}

export function keepLine(l: string): boolean {
  const n = norm(l);
  if (n.length < 3) return false;
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(n)) return false; // 時刻だけ
  if (isScrubberLine(n)) return false; // 経過+残り
  if (/^mvh/i.test(n)) return false; // 再生デバイス名
  if (/^[0-9]+$/.test(n)) return false; // 数字だけ（エピソード番号など）
  const alnum = (n.match(/[a-zA-Z0-9ぁ-んァ-ヶ一-龯]/g) || []).length;
  if (alnum / n.length < 0.4) return false; // 記号ばかり
  return true;
}

// 検索結果の正解度スコア: クエリの曲名/アーティスト単語が結果にどれだけ含まれるか (0〜1.85程度)
// タイトル重み0.6 + アーティスト重み0.4 + 完全一致ボーナス。結果カードの並び替えに使う。
export function relScore(
  r: { title?: string; artist?: string },
  title: string,
  artist: string
): number {
  const tok = (s: string): string[] =>
    String(s)
      .toLowerCase()
      .split(/[^a-z0-9ぁ-んァ-ヶ一-龯]+/)
      .filter((w) => w.length >= 2);
  const qT = tok(title);
  const qA = tok(artist);
  if (!qT.length && !qA.length) return 0;
  const rt = String(r.title || '').toLowerCase();
  const ra = String(r.artist || '').toLowerCase();
  const norm = (s: string | null | undefined): string =>
    String(s ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9ぁ-んァ-ヶ一-龯]+/g, ' ')
      .trim();
  let s = 0;
  if (qT.length) {
    const hits = qT.filter((w) => rt.includes(w)).length;
    s += (hits / qT.length) * 0.6;
    if (norm(r.title) === norm(title)) s += 0.3; // タイトル完全一致ボーナス
  }
  if (qA.length) {
    // アーティスト名は「アーティスト欄」だけでなく「曲名欄」にも出ることがある（例: George Benson - ...）
    const hay = rt + ' ' + ra;
    const hits = qA.filter((w) => hay.includes(w)).length;
    s += (hits / qA.length) * 0.4;
    if (norm(r.artist) === norm(artist)) s += 0.15; // アーティスト完全一致ボーナス
  }
  return s;
}
