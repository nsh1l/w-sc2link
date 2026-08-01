<script lang="ts">
  import { parseOcrText, relScore } from './lib/parse';
  import { recognizeImage } from './lib/ocr';
  import ResultCard from './lib/ResultCard.svelte';
  import type { FallbackLink, SearchResult } from './lib/types';

  // ---------- state ----------
  let file: File | null = $state(null);
  let previewUrl = $state('');
  let status = $state('');
  let busy = $state(false);
  let ocrText = $state('');
  let title = $state('');
  let artist = $state('');
  let elapsed = $state('');
  let episode = $state('');
  let results: SearchResult[] = $state([]);
  let resultsShown = $state(false);
  let searching = $state(false);
  let searchError = $state('');
  let dragOver = $state(false);

  // ---------- derived ----------
  // 正解度が高い順に並べ替え（同じURLは先頭のみ残す）＋ http(s) スキームだけ許可
  const sortedResults = $derived.by<SearchResult[]>(() => {
    const httpOnly = (u: string) => /^https?:\/\//i.test(u || '');
    const seen = new Set<string>();
    const out: SearchResult[] = [];
    const sorted = [...results].sort(
      (a, b) => relScore(b, title, artist) - relScore(a, title, artist)
    );
    for (const r of sorted) {
      if (!httpOnly(r.url) || seen.has(r.url)) continue;
      seen.add(r.url);
      out.push({ ...r, thumb: r.thumb && httpOnly(r.thumb) ? r.thumb : '' });
    }
    return out;
  });

  const fallbackLinks = $derived.by<FallbackLink[]>(() => {
    const q = encodeURIComponent(`${title} ${artist}`.trim());
    return [
      { name: 'Bandcamp で検索', url: `https://bandcamp.com/search?q=${q}&item_type=t` },
      { name: 'YouTube で検索', url: `https://www.youtube.com/results?search_query=${q}` },
      { name: 'Google で検索', url: `https://www.google.com/search?q=${q}` },
    ];
  });

  // ---------- actions ----------
  function setStatus(msg: string, b = false) {
    status = msg;
    busy = b;
  }

  function handleFile(f: File | null) {
    if (!f || !f.type.startsWith('image/')) {
      setStatus('画像ファイルじゃないみたい… (＞人＜)');
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    file = f;
    previewUrl = URL.createObjectURL(f);
    results = [];
    resultsShown = false;
    searchError = '';
    setStatus('');
    void runOcr(f);
  }

  async function runOcr(f: File) {
    setStatus('OCR 準備中…', true);
    try {
      const text = await recognizeImage(f, (pct) => setStatus(`OCR 解析中… ${pct}%`, true));
      ocrText = text.trim() || '（テキストを読み取れなかったよ…）';
      const parsed = parseOcrText(text);
      title = parsed.title;
      artist = parsed.artist;
      elapsed = parsed.elapsed;
      episode = parsed.episode;
      setStatus(
        parsed.title
          ? '✅ 読み取れたよ、確認して検索ボタン押してね'
          : '⚠️ 読み取れなかった…手で入力してね'
      );
    } catch (err) {
      console.error(err);
      setStatus('OCR エラー…手で入力してね');
    }
  }

  // 検索クエリ用クリーナー: OCRノイズ（括弧書き・末尾の短い英字）を除去してヒット率を上げる
  function cleanTerm(s: string): string {
    return String(s)
      .replace(/\s*\([^)]*\)\s*/g, ' ')
      .replace(/\s+[A-Za-z]{1,3}$/, '')
      .replace(/[\s_]+$/, '')
      .trim();
  }

  async function doSearch() {
    const ct = cleanTerm(title);
    const ca = cleanTerm(artist);
    if (!ct && !ca) return;
    const qs = new URLSearchParams({ title: ct, artist: ca, q: `${ct} ${ca}`.trim() }).toString();
    searching = true;
    searchError = '';
    results = [];
    resultsShown = true;
    try {
      const res = await fetch('/api/search?' + qs);
      if (!res.ok) throw new Error('API error ' + res.status);
      const data = await res.json();
      results = data.results || [];
    } catch (err) {
      console.error(err);
      searchError = '検索に失敗したよ… 時間をおいて再試行してね';
    } finally {
      searching = false;
    }
  }

  function onFileChange(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    handleFile(input.files?.[0] ?? null);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    handleFile(e.dataTransfer?.files?.[0] ?? null);
  }

  function onPaste(e: ClipboardEvent) {
    const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
    if (item) handleFile(item.getAsFile());
  }
</script>

<svelte:window onpaste={onPaste} />

<div class="bg-deco" aria-hidden="true">
  <div class="glow glow-a"></div>
  <div class="glow glow-b"></div>
  <div class="glow glow-c"></div>
</div>

<header class="site-header">
  <div class="brand">
    <div class="vinyl" aria-hidden="true"><span class="vinyl-hole"></span></div>
    <div class="brand-text">
      <h1>AYP<span class="grad"> </span>TrackID</h1>
      <p class="tagline">DJミックスのスクショから、いま流れてる曲のリンクを探す</p>
    </div>
  </div>
</header>

<main class="wrap">
  <!-- Step 1: スクショを入れる -->
  <section class="card" aria-label="スクショをアップロード">
    <label
      class="dropzone"
      class:dragging={dragOver}
      ondragover={(e) => {
        e.preventDefault();
        dragOver = true;
      }}
      ondragleave={() => (dragOver = false)}
      ondrop={onDrop}
    >
      <input type="file" id="file-input" accept="image/*" class="visually-hidden" onchange={onFileChange} />
      <div class="dz-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>
        </svg>
      </div>
      <p class="dz-main">スクショをドロップ or タップで選択</p>
      <p class="dz-sub">PCなら <kbd>Ctrl</kbd>+<kbd>V</kbd> で貼り付けもOK</p>
      <p class="dz-status" class:busy={busy} role="status" aria-live="polite">{status}</p>
    </label>
  </section>

  <!-- Step 2: 抽出結果の確認 -->
  {#if file}
    <section class="card" aria-label="曲情報">
      <div class="preview-row">
        <img src={previewUrl} alt="アップロードしたスクショ" class="preview">
        <div class="fields">
          <p class="step-label">📖 スクショから自動抽出（誤字は直接直せるよ）</p>
          <label class="field">
            <span>曲名 / Track</span>
            <input
              type="text"
              placeholder="例: Nukennin2.wav (RsCNHO01)"
              autocomplete="off"
              bind:value={title}
              onkeydown={(e) => {
                if (e.key === 'Enter') void doSearch();
              }}
            >
          </label>
          <label class="field">
            <span>アーティスト / Artist</span>
            <input
              type="text"
              placeholder="例: BCHNN _"
              autocomplete="off"
              bind:value={artist}
              onkeydown={(e) => {
                if (e.key === 'Enter') void doSearch();
              }}
            >
          </label>
          {#if elapsed || episode}
            <div class="chips">
              {#if elapsed}<span class="chip">⏱ 再生位置 {elapsed}</span>{/if}
              {#if episode}<span class="chip">📻 {episode}</span>{/if}
            </div>
          {/if}
          <button class="btn-search" onclick={() => void doSearch()} disabled={searching}>
            {#if searching}検索中…{:else}🔍 曲のリンクを探す{/if}
          </button>
        </div>
      </div>
      <details class="raw">
        <summary>OCRで読んだ全文（確認用）</summary>
        <pre>{ocrText}</pre>
      </details>
    </section>
  {/if}

  <!-- Step 3: 結果 -->
  {#if resultsShown}
    <section class="card" aria-label="検索結果">
      <h2 class="results-title">見つかったリンク {#if sortedResults.length}<span id="results-count">{sortedResults.length}件</span>{/if}</h2>
      <div class="results">
        {#each sortedResults as r (r.url)}
          <ResultCard result={r} />
        {/each}
      </div>
      {#if searchError}
        <p class="error">{searchError}</p>
      {:else if !searching && sortedResults.length === 0}
        <p class="results-none">見つからなかったにゃ… キーワードを変えてみてね</p>
      {/if}
      <div class="fallback">
        <p class="fallback-label">プラットフォーム内で探す</p>
        <div class="fallback-links">
          {#each fallbackLinks as l (l.url)}
            <a class="fb-link" href={l.url} target="_blank" rel="noopener noreferrer">{l.name}</a>
          {/each}
        </div>
      </div>
    </section>
  {/if}

  <p class="foot-note">曲情報はスクショのOCRで抽出しています。検索は SoundCloud / Deezer / Apple Music / YouTube をキーなしAPIで横断 🐾</p>
</main>
