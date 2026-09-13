// AYP TrackID 抽出ロジック（純関数・DOM非依存）— parse.js の TypeScript 移植
import type { ParsedOcr } from './types';

// 先頭の記号ノイズ（"| " など）を除去した正規化行
function norm(l: string): string {
  return l.replace(/^[^a-zA-Z0-9ぁ-んァ-ヶ一-龯]+/, '').trim();
}

const timePattern = '\\d{1,2}:\\d{2}(?::\\d{2})?';
const scrubberSignPattern = '[-–—−~]';

function elapsedOnlyValue(l: string): string {
  const m = l
    .trim()
    .match(new RegExp(`^(${timePattern})\\s*[^a-zA-Z0-9ぁ-んァ-ヶ一-龯]*$`));
  return m?.[1] || '';
}

function isElapsedOnlyLine(l: string): boolean {
  return Boolean(elapsedOnlyValue(l));
}

function isRemainingTimeLine(l: string): boolean {
  return new RegExp(`^${scrubberSignPattern}\\s*${timePattern}\\s*$`).test(l.trim());
}

// スクラバー行: 「経過 … -残り」(例: 1:08:03 GEE -53:25 / 41:37 -1:19:26)
// 経過側がOCRで化けた場合（例: 002 -1:17:01）も「-残り」を含む行として判定する
// OCRはダッシュを em/enダッシュ、Unicodeマイナス、チルダ（~）で読むことがあるため、時刻の前だけ扱う
function isScrubberLine(l: string): boolean {
  const n = norm(l);
  return (
    new RegExp(`^${timePattern}.*${scrubberSignPattern}\\s*${timePattern}`).test(n) ||
    isRemainingTimeLine(l) ||
    new RegExp(`^\\d{1,3}\\s*${scrubberSignPattern}\\s*${timePattern}\\s*$`).test(l.trim())
  );
}

function findScrubberIndex(lines: string[]): number {
  for (let i = 0; i + 1 < lines.length; i += 1) {
    if (isElapsedOnlyLine(lines[i]) && isRemainingTimeLine(lines[i + 1])) return i;
  }
  const scrubberIdx = lines.findIndex(isScrubberLine);
  if (scrubberIdx >= 0) return scrubberIdx;

  // 残り時間が消えた場合も、後半の単独時刻の前に有力な2行があるときだけ境界にする
  // ponytail: 行位置ヒューリスティックの上限は、将来OCR bounding boxでUI領域を分離して解消する
  return findStandaloneElapsed(lines)?.index ?? -1;
}

function findStandaloneElapsed(lines: string[]): { index: number; elapsed: string } | null {
  for (let i = lines.length - 1; i >= Math.ceil(lines.length / 2); i -= 1) {
    const elapsed = elapsedOnlyValue(lines[i]);
    if (!elapsed) continue;
    const candidates = lines
      .slice(0, i)
      .filter(keepLine)
      .map(norm)
      .filter((line) => plausibleText(line, 3));
    if (candidates.length >= 2) return { index: i, elapsed };
  }
  return null;
}

// ウィジェット候補のゆるい妥当性判定: 文字が十分ある＆数字より文字が多いだけ。
// 本物の曲名には記号（' . ( "）や数字（12" Mix）が普通に含まれるため、純テキスト判定はしない。
function plausibleText(l: string, minLetters: number): boolean {
  const n = l.trim();
  const letters = (n.match(/[a-zA-Zぁ-んァ-ヶ一-龯]/g) || []).length;
  const digits = (n.match(/[0-9]/g) || []).length;
  return letters >= minLetters && letters > digits && n.length >= 4;
}

// 表示用クリーニング: OCRノイズ除去。
// 注意: 実タイトルの短い単語（"Moving Day" の "Day"、"tv off (Sade mix)" の "mix)"）は壊さないこと。
// 大文字2-3字の末尾除去はやめた: "On & On" の "On"、"Let It Go" の "Go" を破壊するため
// （OCRの " LL" ノイズは絵文字残骸・飾り線ルールでカバーされる）
function cleanTitle(s: string): string {
  return String(s)
    .replace(/\)\s+[A-Z]{2,3}$/, ')') // 閉じ括弧の直後の大文字ノイズ（例: "(RsCNHOO01) LL" → "(RsCNHOO01)"）
    .replace(/\s+[a-z]{1,2}\)$/, '') // 末尾の小文字+閉じ括弧ノイズ（例: " nl)"）— " mix)" は3文字で対象外
    .replace(/\s+[=—_][=—_\-–—\s:]*$/, '') // 飾り線（例: " = —"、" _ ————— :"）
    .replace(/\s+[a-z]{1,3}[)）]{2,}.*$/, '') // 絵文字残骸（例: " q))) (Ry"）
    .replace(/\[[A-Za-z]{1,3}$/, '') // 切れかけ括弧（例: " [Sy"）— "[Edit]" は閉じ括弧があるので対象外
    .replace(/^[a-z]{1,3}\s+(?=[A-Z])/, '') // 先頭の小文字ゴミ（例: "fr "）
    .trim();
}

// アーティスト用クリーニング: SoundCloud の「アーティスト | 再生数」ノイズと飾り線を除去
function cleanArtist(s: string): string {
  return String(s)
    .replace(/\s*\|\s*\d.*$/, '') // "jireh! | 9 sessuialll" → "jireh!"（右辺が数字始まりのみ）
    .replace(/\s+[=—_][=—_\-–—\s:]*$/, '')
    .trim();
}

// OCRノイズ行かどうか（絵文字残骸・切れかけ括弧・飾り線）。
// ノイズを含む行はUIヘッダ（プレイリスト名等）の可能性が高く、タイトル/アーティスト判定の参考にする
function hasNoise(l: string): boolean {
  const n = l.trim();
  return (
    /[a-z]{1,3}[)）]{2,}/.test(n) ||
    /\[[A-Za-z]{1,3}$/.test(n) ||
    /[=—_][=—_\-–—\s:]*$/.test(n)
  );
}

// 飾り線行かどうか（波形UIのゴミ: "CGEEEEESS———" 等）。
// 行末にダッシュ/アンダースコア/イコールが2連続以上ある行は、タイトル候補から外す
function isDecorationLine(l: string): boolean {
  return /[-–—_=]{2,}\s*$/.test(l.trim());
}

export function parseOcrText(text: string): ParsedOcr {
  const lines = (text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const elapsed = extractElapsed(text);
  const episode = extractEpisode(text);
  // スクラバー行は keepLine で除外される前に生の lines から位置を特定する
  const scrubIdx = findScrubberIndex(lines);
  const clean = lines
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => keepLine(l))
    // ステータスバー行（先頭が時刻始まり）は弾く
    .filter(({ l, i }) => !(i === 0 && /^\d{1,2}:\d{2}/.test(l)));
  // スクラバーより上（=ウィジェット/アートワーク領域）の行だけを候補に
  const pool = scrubIdx >= 0 ? clean.filter(({ i }) => i < scrubIdx) : clean;
  const poolLines = pool.map(({ l }) => norm(l));
  let title = '';
  let artist = '';

  // iOSロック画面パターン: スクラバーの直上がアーティスト、その上がタイトル（ウィジェット構造）
  // 注: 長さ比較（t.length >= a.length）はしない。短いタイトル+長いアーティスト
  // （"Let It Go" / "Idina Menzel" 等）を取りこぼすため
  if (scrubIdx >= 2 && poolLines.length >= 2) {
    let a = poolLines[poolLines.length - 1];
    let t = poolLines[poolLines.length - 2];
    // 直上が飾り線（波形UIのゴミ）なら、さらに上の行を候補に（例: BCHNN _ / CGEEEEESS———）
    if (isDecorationLine(a) && poolLines.length >= 3) {
      a = poolLines[poolLines.length - 2];
      t = poolLines[poolLines.length - 3];
    }
    if (plausibleText(t, 4) && plausibleText(a, 3)) {
      // 上の行にノイズ（絵文字残骸等）があり下がクリーンなら「UIヘッダ + 曲名」の可能性が高い。
      // 例: "MAKE FOR U q))) (Ry" / "My Reason" → タイトルは My Reason
      if (hasNoise(t) && !hasNoise(a)) {
        title = cleanTitle(a);
        artist = '';
      } else {
        title = cleanTitle(t);
        artist = cleanArtist(a);
      }
      return { title, artist, elapsed, episode };
    }
  }

  // スクラバーなし（SoundCloud系など）: 先頭から順に plausible な2行をタイトル/アーティストに。
  // アプリUIのヘッダは「タイトル→アーティスト」の順で並ぶため、最長行方式より確実。
  if (scrubIdx < 0 && poolLines.length >= 1) {
    const idxs: number[] = [];
    poolLines.forEach((l, i) => {
      if (plausibleText(l, 4)) idxs.push(i); // 4文字以上（"pq a" 等の3文字ゴミを弾く）
    });
    if (idxs.length >= 2) {
      const t = poolLines[idxs[0]];
      const a = poolLines[idxs[1]];
      if (t.length >= 3) {
        title = cleanTitle(t);
        artist = cleanArtist(a);
        return { title, artist, elapsed, episode };
      }
    }
  }

  // DJミックス等のフォールバック: 最長行をタイトル、次の行をアーティストに
  if (poolLines.length >= 1) {
    let titleIdx = 0;
    poolLines.forEach((l, i) => {
      if (l.length > poolLines[titleIdx].length) titleIdx = i;
    });
    title = cleanTitle(poolLines[titleIdx]);
    if (poolLines[titleIdx + 1]) artist = cleanArtist(poolLines[titleIdx + 1]);
  }
  return { title, artist, elapsed, episode };
}

export function extractElapsed(text: string): string {
  // スクラバー行（「経過 - 残り」、残りは MM:SS または H:MM:SS）を優先
  // OCRは負符号を em/enダッシュ、Unicodeマイナス、チルダで読むことがある
  const m = text.match(new RegExp(`(${timePattern})[^\\n]*?${scrubberSignPattern}\\s*${timePattern}`));
  if (m) return m[1];
  // OCRのレイアウト判定によって「経過」と「残り」が別行になる場合
  const split = text.match(
    new RegExp(
      `(?:^|\\n)(${timePattern})\\s*[^a-zA-Z0-9ぁ-んァ-ヶ一-龯\\n]*\\n\\s*${scrubberSignPattern}\\s*${timePattern}`,
      'm'
    )
  );
  if (split) return split[1];
  const standalone = findStandaloneElapsed(
    (text || '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
  );
  if (standalone) return standalone.elapsed;
  // SoundCloud の「0:03 | 2:04」形式（縦棒区切り）
  const sc = text.match(/(\d{1,2}:\d{2}(?::\d{2})?)\s*\|\s*\d{1,2}:\d{2}(?::\d{2})?/);
  if (sc) return sc[1];
  // フォールバックは使わない: 「最後の時刻」はステータスバーの時計や残り時間を拾いがちで、
  // 誤った「再生位置」を表示するより空のままの方が誠実。
  return '';
}

export function extractEpisode(text: string): string {
  // 誤検知防止: 「#」付き or SHOW/EPISODE/RADIO 直後の数字だけ拾う（時刻の数字と区別するため）
  const m = text.match(/(?:SHOW|EPISODE|RADIO)\s*#?\s*(\d{2,3})|#\s*(\d{2,3})/i);
  return m ? `#${m[1] || m[2]}` : '';
}

export function keepLine(l: string): boolean {
  const n = norm(l);
  const alnum = (n.match(/[a-zA-Z0-9ぁ-んァ-ヶ一-龯]/g) || []).length;
  if (alnum < 3) return false; // 英数字が3文字未満（"I o" 等のゴミを弾く）
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(n)) return false; // 時刻だけ
  if (isScrubberLine(n)) return false; // 経過+残り
  if (/^mvh/i.test(n)) return false; // 再生デバイス名
  if (/^[0-9]+$/.test(n)) return false; // 数字だけ（エピソード番号など）
  // ステータスバー行: キャリア名・天気（iOSロック画面の日付/気温行）
  if (/^(docomo|au|softbank|ntt|vodafone|kddi|mvno|uq(?:\s|$))/i.test(n)) return false;
  if (/°[cCfF]/.test(n)) return false;
  // 音楽アプリUIの固定ラベル（SoundCloud の波形コメントUI等）はタイトル候補から除外
  if (/behind this track/i.test(n)) return false;
  if (/^comment/i.test(n)) return false;
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
