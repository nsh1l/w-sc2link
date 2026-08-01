// Tesseract.js ラッパー — CDN版グローバル (window.Tesseract) を型付きで使う
// ワーカーは1回だけ生成して使い回す（OCR準備のオーバーヘッドを避ける）

interface TesseractWorker {
  recognize(file: File): Promise<{ data: { text: string } }>;
}

interface TesseractGlobal {
  createWorker(
    lang: string,
    oem: number,
    opts: { logger: (m: { status?: string; progress?: number }) => void }
  ): Promise<TesseractWorker>;
}

declare global {
  interface Window {
    Tesseract?: TesseractGlobal;
  }
}

let workerPromise: Promise<TesseractWorker> | null = null;
let onProgress: ((pct: number) => void) | null = null;

function logger(m: { status?: string; progress?: number }): void {
  if (m.status === 'recognizing text' && onProgress) {
    onProgress(Math.round((m.progress || 0) * 100));
  }
}

export async function recognizeImage(file: File, progress: (pct: number) => void): Promise<string> {
  onProgress = progress;
  if (!workerPromise) {
    workerPromise = (async () => {
      const T = window.Tesseract;
      if (!T) throw new Error('Tesseract.js が読み込めていません');
      return T.createWorker('eng', 1, { logger });
    })();
  }
  const worker = await workerPromise;
  // 小さい文字を拾うため、画像を2倍に拡大してグレースケール化してから渡す
  // （実スクショで検証済み: この前処理で SoundCloud 波形UI・CarPlay の小さい文字も読めるようになる）
  const prepped = await prepareForOcr(file);
  const { data } = await worker.recognize(prepped);
  return data.text || '';
}

// Canvas で前処理: 2x 拡大 → グレースケール → コントラスト正規化
// （ImageMagick の -resize 200% -colorspace Gray -normalize と同等。実スクショ5枚で検証済み）
// ponytail: 固定2x拡大・全画像に適用。大きい画像は遅くなるが、スクショ用途では実用範囲。
async function prepareForOcr(file: File): Promise<File> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('画像の読み込みに失敗'));
      el.src = url;
    });
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth * scale;
    canvas.height = img.naturalHeight * scale;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    // グレースケール → 輝度の最小/最大で正規化（明るい文字も暗い文字も読めるように）
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = imageData.data;
    let min = 255, max = 0;
    for (let i = 0; i < d.length; i += 4) {
      const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      if (g < min) min = g;
      if (g > max) max = g;
    }
    const range = max - min || 1;
    for (let i = 0; i < d.length; i += 4) {
      const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const v = Math.round(((g - min) / range) * 255);
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    ctx.putImageData(imageData, 0, 0);
    return await new Promise<File>((resolve) => {
      canvas.toBlob((b) => resolve(new File([b!], file.name, { type: 'image/png' })), 'image/png');
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
