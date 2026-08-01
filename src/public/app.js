/* Shot→Track クライアント: アップロード → OCR → 抽出 → /api/search */
'use strict';

const $ = (id) => document.getElementById(id);
const dropzone = $('dropzone');
const fileInput = $('file-input');
const dzStatus = $('dz-status');
const extractCard = $('extract-card');
const resultsCard = $('results-card');
const preview = $('preview');
const fTitle = $('f-title');
const fArtist = $('f-artist');
const chips = $('chips');
const btnSearch = $('btn-search');
const btnLabel = $('btn-search').querySelector('.btn-label');
const btnLoading = $('btn-search').querySelector('.btn-loading');
const rawText = $('raw-text');
const resultsEl = $('results');
const resultsCount = $('results-count');
const resultsNone = $('results-none');
const fallbackLinks = $('fallback-links');

let currentFile = null;
let ocrWorkerPromise = null;

/* ---------- ファイル取得 ---------- */

function setStatus(msg, busy = false) {
  dzStatus.textContent = msg;
  dzStatus.classList.toggle('busy', busy);
}

function handleFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    setStatus('画像ファイルじゃないみたい… (＞人＜)');
    return;
  }
  currentFile = file;
  preview.src = URL.createObjectURL(file);
  extractCard.classList.remove('hidden');
  resultsCard.classList.add('hidden');
  setStatus('');
  runOcr(file);
}

fileInput.addEventListener('change', () => handleFile(fileInput.files[0]));

['dragenter', 'dragover'].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.add('dragging');
  })
);
['dragleave', 'drop'].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragging');
  })
);
dropzone.addEventListener('drop', (e) => handleFile(e.dataTransfer.files[0]));
dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});
document.addEventListener('paste', (e) => {
  const item = [...e.clipboardData.items].find((i) => i.type.startsWith('image/'));
  if (item) handleFile(item.getAsFile());
});

/* ---------- OCR ---------- */

function getWorker() {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = Tesseract.createWorker('eng', 1, {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          setStatus(`OCR 解析中… ${Math.round(m.progress * 100)}%`);
        }
      },
    });
  }
  return ocrWorkerPromise;
}

async function runOcr(file) {
  setStatus('OCR 準備中…', true);
  try {
    const worker = await getWorker();
    setStatus('OCR 解析中…', true);
    const { data } = await worker.recognize(file);
    const text = data.text || '';
    rawText.textContent = text.trim() || '（テキストを読み取れなかったよ…）';
    const parsed = ShotParse.parseOcrText(text);
    fTitle.value = parsed.title;
    fArtist.value = parsed.artist;
    chips.innerHTML = '';
    if (parsed.elapsed) chips.appendChild(chip(`⏱ 再生位置 ${parsed.elapsed}`));
    if (parsed.episode) chips.appendChild(chip(`📻 ${parsed.episode}`));
    setStatus(parsed.title ? '✅ 読み取れたよ、確認して検索ボタン押してね' : '⚠️ 読み取れなかった…手で入力してね');
  } catch (err) {
    console.error(err);
    setStatus('OCR エラー…手で入力してね');
  }
}

function chip(text) {
  const s = document.createElement('span');
  s.className = 'chip';
  s.textContent = text;
  return s;
}

/* ---------- 検索 ---------- */

/* 検索クエリ用クリーナー: OCRノイズ（括弧書き・末尾の短い英字）を除去してヒット率を上げる */
function cleanTerm(s) {
  return String(s)
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+[A-Za-z]{1,3}$/, '')
    .replace(/[\s_]+$/, '')
    .trim();
}

function searchQuery() {
  const title = cleanTerm(fTitle.value);
  const artist = cleanTerm(fArtist.value);
  if (!title && !artist) return null;
  const qs = new URLSearchParams({ title, artist, q: `${title} ${artist}`.trim() }).toString();
  return { title, artist, qs };
}

async function doSearch() {
  const sq = searchQuery();
  if (!sq) {
    fTitle.focus();
    return;
  }
  btnSearch.disabled = true;
  btnLabel.classList.add('hidden');
  btnLoading.classList.remove('hidden');
  resultsCard.classList.remove('hidden');
  resultsEl.innerHTML = '';
  resultsCount.textContent = '';
  resultsNone.classList.add('hidden');
  try {
    const res = await fetch('/api/search?' + sq.qs);
    if (!res.ok) throw new Error('API error ' + res.status);
    const data = await res.json();
    renderResults(data.results || [], sq.title, sq.artist);
  } catch (err) {
    console.error(err);
    resultsEl.innerHTML = '<p class="error">検索に失敗したよ… 時間をおいて再試行してね</p>';
  } finally {
    btnSearch.disabled = false;
    btnLabel.classList.remove('hidden');
    btnLoading.classList.add('hidden');
  }
}

const PLATFORMS = {
  soundcloud: { name: 'SoundCloud', color: '#ff5500' },
  deezer: { name: 'Deezer', color: '#a238ff' },
  apple: { name: 'Apple Music', color: '#fa243c' },
  youtube: { name: 'YouTube', color: '#ff0033' },
};

function renderResults(results, title, artist) {
  // 正解度が高い順に並べ替え（同じURLは先頭のみ残す）
  const unique = [];
  const seen = new Set();
  const httpOnly = (u) => /^https?:\/\//i.test(u || '');
  const sorted = results
    .map((r) => ({ r, s: ShotParse.relScore(r, title, artist) }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.r);
  for (const r of sorted) {
    // 信頼境界: 外部API由来のURL/画像は http(s) スキームだけ許可
    if (!httpOnly(r.url) || seen.has(r.url)) continue;
    if (r.thumb && !httpOnly(r.thumb)) r.thumb = '';
    seen.add(r.url);
    unique.push(r);
  }
  resultsCount.textContent = unique.length ? `${unique.length}件` : '';
  if (!unique.length) {
    resultsNone.classList.remove('hidden');
  }
  unique.forEach((r) => {
    const p = PLATFORMS[r.platform] || { name: r.platform, color: '#888' };
    const card = document.createElement('a');
    card.className = 'result-card';
    card.href = r.url;
    card.target = '_blank';
    card.rel = 'noopener noreferrer';
    card.innerHTML = `
      <div class="thumb-wrap">
        ${r.thumb ? `<img src="${r.thumb}" alt="" loading="lazy">` : '<div class="thumb-ph">♪</div>'}
      </div>
      <div class="result-body">
        <span class="badge" style="--pc:${p.color}">${p.name}</span>
        <span class="result-title">${esc(r.title)}</span>
        <span class="result-artist">${esc(r.artist)}</span>
      </div>
      <span class="go">↗</span>`;
    resultsEl.appendChild(card);
  });
  renderFallback(title, artist);
}

function renderFallback(title, artist) {
  fallbackLinks.innerHTML = '';
  const q = encodeURIComponent(`${title} ${artist}`.trim());
  const links = [
    { name: 'Bandcamp で検索', url: `https://bandcamp.com/search?q=${q}&item_type=t` },
    { name: 'YouTube で検索', url: `https://www.youtube.com/results?search_query=${q}` },
    { name: 'Google で検索', url: `https://www.google.com/search?q=${q}` },
  ];
  links.forEach((l) => {
    const a = document.createElement('a');
    a.className = 'fb-link';
    a.href = l.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = l.name;
    fallbackLinks.appendChild(a);
  });
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

btnSearch.addEventListener('click', doSearch);
[fTitle, fArtist].forEach((el) =>
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSearch();
  })
);
