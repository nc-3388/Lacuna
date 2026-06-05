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

export async function compressImageBlob(
  blob: Blob,
): Promise<{ blob: Blob; width: number; height: number }> {
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
