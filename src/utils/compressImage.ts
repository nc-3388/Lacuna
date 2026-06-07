const MAX_DIMENSION = 1280;
const QUALITY = 0.8;

async function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const img = new Image();
    const timeout = window.setTimeout(() => {
      URL.revokeObjectURL(url);
      reject(new Error('That file could not be read as an image.'));
    }, 30000);
    img.onload = () => {
      window.clearTimeout(timeout);
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      window.clearTimeout(timeout);
      URL.revokeObjectURL(url);
      reject(new Error('That file could not be read as an image.'));
    };
    img.src = url;
  });
}

function scaleToFit(w: number, h: number, max: number) {
  if (w <= max && h <= max) return { width: w, height: h };
  const ratio = Math.min(max / w, max / h);
  return { width: Math.round(w * ratio), height: Math.round(h * ratio) };
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Could not process the image.'));
      },
      mimeType,
      QUALITY,
    );
  });
}

/** Whether OffscreenCanvas is available and the compression worker can be used. */
const canUseWorker =
  typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined';

let worker: Worker | null = null;
let workerJobId = 0;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(
      new URL('../workers/compressImage.worker.ts', import.meta.url),
      { type: 'module' },
    );
  }
  return worker;
}

function compressInWorker(blob: Blob): Promise<{ blob: Blob; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const id = `job-${++workerJobId}`;
    const w = getWorker();
    const handler = (event: MessageEvent) => {
      const data = event.data as { id: string; blob?: Blob; width?: number; height?: number; error?: string };
      if (data.id !== id) return;
      w.removeEventListener('message', handler);
      if (data.error) {
        reject(new Error(data.error));
      } else if (data.blob) {
        resolve({ blob: data.blob, width: data.width ?? 0, height: data.height ?? 0 });
      } else {
        reject(new Error('Could not process the image.'));
      }
    };
    w.addEventListener('message', handler);
    w.postMessage({ blob, id });
  });
}

/** Compress an image blob, offloading to a Web Worker when possible. */
export async function compressImageBlob(
  blob: Blob,
): Promise<{ blob: Blob; width: number; height: number }> {
  if (canUseWorker) {
    try {
      return await compressInWorker(blob);
    } catch {
      // Fall through to main-thread path if the worker fails.
    }
  }

  const bitmap = await loadImageFromBlob(blob);
  const { width, height } = scaleToFit(bitmap.width, bitmap.height, MAX_DIMENSION);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not process the image.');
  ctx.drawImage(bitmap, 0, 0, width, height);

  const isPng = blob.type === 'image/png';
  const mimeType = isPng ? 'image/png' : 'image/jpeg';
  const compressed = await canvasToBlob(canvas, mimeType);
  return { blob: compressed, width, height };
}
