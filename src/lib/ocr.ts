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
  const { data } = await worker.recognize(file);
  return data.text || '';
}
