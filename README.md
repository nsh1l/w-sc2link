# AYP TrackID — スクショから曲のリンクを探す

DJミックスやロック画面の再生スクリーンショットをアップロードすると、OCRで曲名・アーティスト・再生位置を抽出し、各配信プラットフォームの曲リンクを探して表示するWebアプリです。

本番: <https://trackid.alwaysyesterday.party/>

## できること

1. **スクショをアップロード** — ドラッグ&ドロップ or タップで選択、`Ctrl`+`V` 貼り付けにも対応
2. **ブラウザ内OCR** — Tesseract.js が画像を解析し、曲名・アーティスト・経過時間・エピソードを抽出（サーバーOCR不要・無料）
3. **曲リンクを検索** — 抽出結果は編集可能。正解度が高い順に結果を表示

検索プラットフォーム:

| プラットフォーム | 方式 |
| --- | --- |
| SoundCloud | 公開API (client_id はランタイムで取得) |
| Deezer | 公開API |
| Apple Music / iTunes | iTunes Search API |
| YouTube | InnerTube API (公式Webの公開クライアントキー) |
| Bandcamp / Google | 外部検索リンク (フォールバック) |

APIキー不要で動きます。

## 技術スタック

- [Svelte 5](https://svelte.dev/) + [Vite](https://vite.dev/) + TypeScript (strict) — SPA
- [Cloudflare Workers](https://developers.cloudflare.com/workers/) — 静的アセット配信 + `/api/search` API
- [Tesseract.js](https://tesseract.projectnaptha.com/) — ブラウザ内OCR

## ディレクトリ構成

```
src/
  worker.js            # Worker本体 (dist配信 + /api/search)
  main.ts              # Svelteエントリポイント
  App.svelte           # メインUI (アップロード / OCR結果 / 検索)
  app.css              # ダークミュージックアプリ風スタイル
  lib/
    types.ts           # SearchResult / ParsedOcr などの型定義
    platforms.ts       # プラットフォームのメタデータ
    parse.ts           # OCRテキスト解析 (純関数・Nodeでもテスト可)
    ocr.ts             # Tesseract.js ラッパー (CDN版, worker再利用)
    ResultCard.svelte  # 検索結果カード
test-parse.ts          # parse.ts の実行可能チェック (bun)
wrangler.toml          # Cloudflare Workers 設定 (assets = dist)
```

## ローカル開発

```bash
# 依存ツール
bun 1.x / node 22+ / wrangler 4.x

# 依存インストール
bun install

# 型チェック (svelte-check)
bun run check

# ビルド
bun run build

# ローカル実行 (ビルド後の dist + Worker API)
wrangler dev --port 8787

# パーサーの実行可能チェック
bun run test

# デプロイ
bun run build && wrangler deploy
```

## 仕組みのメモ

- OCRはブラウザ側で実行するため、画像はサーバーに送信されません。
- SoundCloud の公開 `client_id` は定期的にローテーションするため、ランタイムで `soundcloud.com` のJSチャンクから取得し、失敗時は既知値にフォールバックします。
- 検索結果は「曲名・アーティストの単語一致 + 完全一致ボーナス」でスコアリングし、正解度が高い順にソートされます。
