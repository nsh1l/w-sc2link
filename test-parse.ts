// parse.ts の実行可能チェック — 実際のOCR出力サンプルで抽出を検証 (bun run test-parse.ts)
import { parseOcrText, relScore } from './src/lib/parse.ts';
import assert from 'node:assert';

// 本物のスクショ (Soulection Radio #740) の Tesseract OCR 出力
const ocrSample = `13:20 94 wlac@)
SE tia
>
-_—.
Nukennin2.wav (RsCNHOO01) LL
BCHNN _
CGEEEEESS———
41:37 -1:19:26
@ 1 ®
« eoasEE-—————————————————————— of)
(@) PE i=
MVH-5600`;

const p = parseOcrText(ocrSample);
console.log('parsed:', JSON.stringify(p, null, 2));

assert.ok(p.title.startsWith('Nukennin2'), `title がおかしい: ${p.title}`);
assert.ok(!p.title.includes('LL'), `title にOCRノイズが残ってる: ${p.title}`);
assert.ok(p.artist.includes('BCHNN'), `artist がおかしい: ${p.artist}`);
assert.strictEqual(p.elapsed, '41:37', `elapsed がおかしい: ${p.elapsed}`);
assert.ok(!p.title.includes('41:37'), 'title に時刻が混入してる');

// 手入力モードの土台: 空文字・ノイズのみ
const empty = parseOcrText('\n   \n123\n--\n');
assert.strictEqual(empty.title, '');
assert.strictEqual(empty.artist, '');

// 1:02:03 形式（長いミックス）の経過時間
const longMix = parseOcrText('Some Track Title\nSome Artist\n1:02:03 -1:10:00\n');
assert.strictEqual(longMix.elapsed, '1:02:03');
assert.strictEqual(longMix.title, 'Some Track Title');

// iOSロック画面（Soulection Radio #715 / Apple Music ウィジェット）の実OCR出力
const lockSample = `UQ mobile ail 4C @)
1220 5H10H (B)
|| |S Ii = “@Music
ete EADS) . ls
Pd te i no i
ol i 0 as GE |
3 EPR
fr Angels Cried
Aguanote
| 1:08:03 GEE -53:25
Sd NN &®
J
‘a | ® 440iER 7 D
4 4`;

const lock = parseOcrText(lockSample);
console.log('lock parsed:', JSON.stringify(lock, null, 2));
assert.ok(lock.title.includes('Angels'), `lock title がおかしい: ${lock.title}`);
assert.ok(!lock.title.includes('1:08'), 'lock title に時刻が混入してる');
assert.ok(lock.artist.toLowerCase().includes('aguanote'), `lock artist がおかしい: ${lock.artist}`);
assert.strictEqual(lock.elapsed, '1:08:03', `lock elapsed がおかしい: ${lock.elapsed}`);

// iOSロック画面（DJ Spinna / Apple Music ウィジェット）の実OCR出力
// アートワークの文字がゴミ行化して「最長行」でタイトルを汚染するケース
const spinnaSample = `docomo HACE I]
of
16H (££) © 19°C|3°C 40%
®
®
= > 8 pm—— | |
ee 0 eo eo 0 0 0 WF " SII Ket AT WA ed Tei
BOW Lhd
BE bp Ny k ‘ wh \\ | J NNR |
oe A SBP | \\oanes
lian
Baby I'm In Love... (12" Mix) nl)
George Benson
16:01 -1:42:53
@ I & =
f [O]`;

const spinna = parseOcrText(spinnaSample);
console.log('spinna parsed:', JSON.stringify(spinna, null, 2));
assert.ok(spinna.title.includes("Baby I'm In Love"), `spinna title がおかしい: ${spinna.title}`);
assert.ok(spinna.title.includes('12" Mix'), `spinna title が欠けてる: ${spinna.title}`);
assert.ok(!spinna.title.includes('nl)'), `spinna title にOCRノイズが残ってる: ${spinna.title}`);
assert.ok(!spinna.title.includes('ee 0'), 'spinna title にゴミ行が選ばれてる');
assert.strictEqual(spinna.artist, 'George Benson', `spinna artist がおかしい: ${spinna.artist}`);
assert.strictEqual(spinna.elapsed, '16:01', `spinna elapsed がおかしい: ${spinna.elapsed}`);

// 正解度スコア: 正しい曲がノイズ曲より必ず上に来る
const scA = relScore(
  { title: "George Benson - Baby I'm In Love    12\" Mix", artist: 'Broeibak Records' },
  "Baby I'm In Love",
  'George Benson'
);
const scB = relScore({ title: "FUCK BABY I'M IN LOVE", artist: 'LOTTE' }, "Baby I'm In Love", 'George Benson');
const scC = relScore({ title: 'Seven Days (feat. George Benson)', artist: 'Mary J. Blige' }, "Baby I'm In Love", 'George Benson');
console.log('relScore 正解曲:', scA, '| タイトルだけ:', scB, '| アーティストだけ:', scC);
assert.ok(scA > scB, `正解曲よりノイズ曲が上: ${scA} vs ${scB}`);
assert.ok(scA > scC, `正解曲よりアーティスト一致のみが上: ${scA} vs ${scC}`);

// 和名アーティスト: タイトル完全一致で正解が上に来る
const scD = relScore({ title: 'When Angels Cried', artist: 'アクアノート' }, 'When Angels Cried', 'Aguanote');
const scE = relScore({ title: 'Angels Cried', artist: 'The Isley Brothers' }, 'When Angels Cried', 'Aguanote');
console.log('relScore 和名:', scD, 'vs', scE);
assert.ok(scD > scE, `When Angels Cried 正解が上に来ない: ${scD} vs ${scE}`);

console.log('✅ parse.ts 全チェック通過');
