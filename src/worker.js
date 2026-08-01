// w-sc2link Worker — スクショから曲のリンクを探す API
// 静的アセット (dist) + /api/search (SoundCloud / Deezer / iTunes / YouTube、全部キー不要)

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// SoundCloud の public client_id は定期的にローテーションする。
// ランタイムで soundcloud.com の JS チャンクから拾い、取れなかったら直近の既知値にフォールバック。
const SC_CLIENT_ID_FALLBACK = 'sUn5toeW5d8MC2jOLpE2yAibTG7RRYsA';
let scClientId = { value: null, at: 0 };

async function fetchSoundCloudClientId() {
  if (scClientId.value && Date.now() - scClientId.at < 3600_000) return scClientId.value;
  try {
    const res = await fetch('https://soundcloud.com', {
      headers: { 'user-agent': UA },
      signal: AbortSignal.timeout(8000),
    });
    const html = await res.text();
    const jsSrcs = [...html.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1]).filter((u) => u.includes('sndcdn'));
    for (let i = 0; i < jsSrcs.length; i += 6) {
      const batch = jsSrcs.slice(i, i + 6);
      const bodies = await Promise.all(
        batch.map(async (u) => {
          try {
            const r = await fetch(u, { signal: AbortSignal.timeout(6000) });
            return await r.text();
          } catch {
            return '';
          }
        })
      );
      for (const body of bodies) {
        const m = body.match(/client_id:"([a-zA-Z0-9]{20,})"/);
        if (m) {
          scClientId = { value: m[1], at: Date.now() };
          return m[1];
        }
      }
    }
  } catch {
    // network error → fallback を使う
  }
  return SC_CLIENT_ID_FALLBACK;
}

async function searchSoundCloud(q) {
  const cid = await fetchSoundCloudClientId();
  const url = `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(q)}&client_id=${cid}&limit=5&filter.access=playable`;
  const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.collection || []).map((t) => ({
    platform: 'soundcloud',
    title: t.title || '',
    artist: t.user?.username || '',
    url: t.permalink_url || '',
    thumb: (t.artwork_url || t.user?.avatar_url || '').replace('large', 't300x300'),
  }));
}

async function searchDeezer(q) {
  const res = await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=5`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.data || []).map((t) => ({
    platform: 'deezer',
    title: t.title || '',
    artist: t.artist?.name || '',
    url: t.link || '',
    thumb: t.album?.cover_medium || '',
  }));
}

async function searchItunes(q) {
  const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=song&limit=5`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.results || []).map((t) => ({
    platform: 'apple',
    title: t.trackName || '',
    artist: t.artistName || '',
    url: t.trackViewUrl || '',
    thumb: t.artworkUrl100 || '',
  }));
}

// YouTube は InnerTube API (youtubei) で検索する。公式サイトのWebクライアントが自前で叩く公開APIで、
// key は youtube.com のページに埋め込まれている公開Webクライアントキー（シークレットではない）。
const YT_WEB_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

async function searchYouTube(q) {
  const res = await fetch(`https://www.youtube.com/youtubei/v1/search?key=${YT_WEB_KEY}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': UA },
    body: JSON.stringify({
      context: {
        client: { hl: 'en', gl: 'US', clientName: 'WEB', clientVersion: '2.20240101.00.00', userAgent: UA },
      },
      query: q,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return [];
  const data = await res.json();
  const items =
    data.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents?.[0]
      ?.itemSectionRenderer?.contents || [];
  return items
    .filter((i) => i.videoRenderer)
    .map(({ videoRenderer: v }) => ({
      platform: 'youtube',
      title: v.title?.runs?.[0]?.text || v.title?.simpleText || '',
      artist: v.ownerText?.runs?.[0]?.text || '',
      url: v.videoId ? `https://www.youtube.com/watch?v=${v.videoId}` : '',
      // サムネURLのクエリ (sqp=...) は期限付き → ? 以降を落として安定URLにする
      thumb: (v.thumbnail?.thumbnails?.at(-1)?.url || '').split('?')[0],
    }))
    .slice(0, 5);
}

// OCRノイズ除去（サーバー側でも実行: 括弧書き・末尾の短い英字）
function cleanTerm(s) {
  return String(s)
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+[A-Za-z]{1,3}$/, '')
    .replace(/[\s_]+$/, '')
    .trim();
}

// 1つのプラットフォームで「曲名+アーティスト」が空なら「曲名だけ」「クリーン済み曲名」の順で再試行
async function searchWithFallback(searchFn, title, artist) {
  let results = await searchFn(cleanTerm(`${title} ${artist}`));
  if (results.length === 0 && title) {
    results = await searchFn(cleanTerm(title));
  }
  return results;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

async function handleSearch(url) {
  const q = (url.searchParams.get('q') || '').trim().slice(0, 200);
  if (q.length < 2) return json({ error: '検索キーワードが短すぎます' }, 400);
  const title = (url.searchParams.get('title') || '').trim().slice(0, 150);
  const artist = (url.searchParams.get('artist') || '').trim().slice(0, 100);
  const query = q;

  const [sc, dz, it, yt] = await Promise.allSettled([
    searchWithFallback(searchSoundCloud, title || query, artist),
    searchWithFallback(searchDeezer, title || query, artist),
    searchWithFallback(searchItunes, title || query, artist),
    searchWithFallback(searchYouTube, title || query, artist),
  ]);
  const results = [sc, dz, it, yt].flatMap((x) => (x.status === 'fulfilled' ? x.value : []));
  return json({ query: q, results });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET' } });
      }
      if (url.pathname === '/api/search') return handleSearch(url);
      return json({ error: 'not found' }, 404);
    }
    // 静的アセットへフォールバック
    try {
      return await env.ASSETS.fetch(request);
    } catch (err) {
      return json({ error: String((err && err.message) || err) }, 500);
    }
  },
};
