// LINE webhook の署名検証と Workers AI 出力境界の実行可能チェック
import assert from 'node:assert/strict';
// @ts-ignore The Worker entrypoint intentionally remains JavaScript and is exercised by Bun.
import worker, { parseLineTrack, parseWorkerTrack, verifyLineSignature } from './src/worker.js';

const secret = 'line-test-secret';
const body = new TextEncoder().encode('{"events":[]}');
const key = await crypto.subtle.importKey(
  'raw',
  new TextEncoder().encode(secret),
  { name: 'HMAC', hash: 'SHA-256' },
  false,
  ['sign']
);
const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, body));
const signature = btoa(String.fromCharCode(...digest));

assert.equal(await verifyLineSignature(body.buffer, signature, secret), true);
assert.equal(await verifyLineSignature(new TextEncoder().encode('{"events":[1]}').buffer, signature, secret), false);
const tamperedSignature = (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1);
assert.equal(await verifyLineSignature(body.buffer, tamperedSignature, secret), false);

assert.deepEqual(
  parseLineTrack({ response: '```json\n{"title":"EXCHANGE","artist":"prodbyswayze"}\n```' }),
  { title: 'EXCHANGE', artist: 'prodbyswayze' }
);
assert.deepEqual(
  parseLineTrack({ response: { title: 'Home Menu', artist: 'Kazumi Totaka' } }),
  { title: 'Home Menu', artist: 'Kazumi Totaka' }
);
assert.deepEqual(
  parseLineTrack({ response: 'TITLE: Moving Day\nARTIST: Samara Cyn' }),
  { title: 'Moving Day', artist: 'Samara Cyn' }
);
assert.deepEqual(parseLineTrack({ response: 'I found a link: https://example.com' }), { title: '', artist: '' });
assert.deepEqual(
  parseWorkerTrack({ response: '```json\n{"title":"Home Menu","artist":"Kazumi Totaka","elapsed":"0:03"}\n```' }),
  { title: 'Home Menu', artist: 'Kazumi Totaka', elapsed: '0:03' }
);

const event = {
  type: 'message',
  mode: 'active',
  webhookEventId: 'test-line-event-1',
  replyToken: 'test-reply-token',
  source: { type: 'user', userId: 'test-user' },
  message: { type: 'image', id: 'test-image-id', contentProvider: { type: 'line' } },
};
const eventBody = JSON.stringify({ destination: 'test-bot', events: [event] });
const eventBytes = new TextEncoder().encode(eventBody);
const eventDigest = new Uint8Array(await crypto.subtle.sign('HMAC', key, eventBytes));
const eventSignature = btoa(String.fromCharCode(...eventDigest));
const calls: string[] = [];
const rateKeys: string[] = [];
let aiCalls = 0;
let replyPayload: { messages: Array<{ text: string }> } | undefined;
const originalFetch = globalThis.fetch;

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = String(input);
  calls.push(url);
  if (url.startsWith('https://api-data.line.me/')) {
    return new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { 'content-type': 'image/jpeg', 'content-length': '3' },
    });
  }
  if (url === 'https://api.line.me/v2/bot/message/reply') {
    replyPayload = JSON.parse(String(init?.body));
    return new Response(null, { status: 200 });
  }
  if (url === 'https://soundcloud.com') return new Response('<html></html>', { status: 200 });
  if (url.startsWith('https://api-v2.soundcloud.com/')) {
    return Response.json({ collection: [{ title: 'Home Menu', user: { username: 'Kazumi Totaka' }, permalink_url: 'https://soundcloud.com/test/home-menu', artwork_url: '' }] });
  }
  if (url.startsWith('https://api.deezer.com/')) return Response.json({ data: [] });
  if (url.startsWith('https://itunes.apple.com/')) return Response.json({ results: [] });
  if (url.startsWith('https://www.youtube.com/')) return Response.json({ contents: {} });
  throw new Error(`unexpected fetch: ${url}`);
};

try {
  const env = {
    LINE_CHANNEL_SECRET: secret,
    LINE_CHANNEL_ACCESS_TOKEN: 'test-line-access-token',
    OCR_RATE_LIMITER: {
      limit: async ({ key }: { key: string }) => {
        rateKeys.push(key);
        return { success: true };
      },
    },
    AI: {
      run: async (
        model: string,
        input: { messages: Array<{ content: Array<{ text?: string; image_url?: { url?: string } }> }> }
      ) => {
        aiCalls += 1;
        assert.equal(model, '@cf/mistralai/mistral-small-3.1-24b-instruct');
        assert.match(input.messages[0].content[1].image_url?.url || '', /^data:image\/jpeg;base64,/);
        const prompt = input.messages[0].content[0].text || '';
        assert.doesNotMatch(prompt, /browser's local OCR/);
        if (prompt.includes('elapsed')) assert.match(prompt, /elapsed playback time/);
        return { response: '{"title":"Home Menu","artist":"Kazumi Totaka","elapsed":"0:03"}' };
      },
    },
  };
  const tasks: Promise<unknown>[] = [];
  const ctx = { waitUntil(promise: Promise<unknown>) { tasks.push(promise); }, tasks };
  const invalid = await worker.fetch(
    new Request('https://trackid.example/api/line/webhook', { method: 'POST', body: eventBody, headers: { 'x-line-signature': 'invalid' } }),
    env,
    ctx
  );
  assert.equal(invalid.status, 401);
  assert.equal(calls.length, 0);

  const valid = await worker.fetch(
    new Request('https://trackid.example/api/line/webhook', {
      method: 'POST',
      body: eventBody,
      headers: { 'content-type': 'application/json', 'x-line-signature': eventSignature },
    }),
    env,
    ctx
  );
  assert.equal(valid.status, 200);
  await Promise.all(tasks);
  assert.equal(calls.filter((url) => url === 'https://api.line.me/v2/bot/message/reply').length, 1);
  const sentReply = replyPayload;
  assert.ok(sentReply);
  assert.match(sentReply.messages[0].text, /Home Menu/);
  assert.match(sentReply.messages[0].text, /https:\/\/soundcloud\.com\/test\/home-menu/);
  assert.ok(rateKeys.includes('line:test-user'));

  const invalidOcr = await worker.fetch(
    new Request('https://trackid.example/api/ocr', { method: 'POST', body: 'not an image', headers: { 'content-type': 'text/plain' } }),
    env,
    ctx
  );
  assert.equal(invalidOcr.status, 415);

  const invalidMethod = await worker.fetch(
    new Request('https://trackid.example/api/ocr', { method: 'GET' }),
    env,
    ctx
  );
  assert.equal(invalidMethod.status, 405);

  const oversized = await worker.fetch(
    new Request('https://trackid.example/api/ocr', {
      method: 'POST',
      body: new Uint8Array([1, 2, 3]),
      headers: { 'content-type': 'image/jpeg', 'content-length': String(4 * 1024 * 1024 + 1) },
    }),
    env,
    ctx
  );
  assert.equal(oversized.status, 413);

  const ocr = await worker.fetch(
    new Request('https://trackid.example/api/ocr', {
      method: 'POST',
      body: new Uint8Array([1, 2, 3]),
      headers: {
        'content-type': 'image/jpeg',
        'cf-connecting-ip': '198.51.100.10',
        'x-trackid-client-id': 'test-client-123456',
      },
    }),
    env,
    ctx
  );
  assert.equal(ocr.status, 200);
  assert.deepEqual(await ocr.json(), { title: 'Home Menu', artist: 'Kazumi Totaka', elapsed: '0:03' });
  assert.ok(rateKeys.includes('web-ip:198.51.100.10'));
  assert.ok(rateKeys.includes('web-client:test-client-123456'));

  const blocked = await worker.fetch(
    new Request('https://trackid.example/api/ocr', {
      method: 'POST',
      body: new Uint8Array([1, 2, 3]),
      headers: { 'content-type': 'image/jpeg', 'cf-connecting-ip': '198.51.100.10' },
    }),
    {
      ...env,
      OCR_RATE_LIMITER: { limit: async () => ({ success: false }) },
    },
    ctx
  );
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('retry-after'), '60');
  assert.equal(aiCalls, 2);
} finally {
  globalThis.fetch = originalFetch;
}

console.log('✅ LINE webhook checks passed');
