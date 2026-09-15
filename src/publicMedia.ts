const MAX_INPUT_BYTES = 5 * 1024 * 1024;
const MAX_EDGE = 2000;
const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export type PreparedPublicMedia = {
  blob: Blob;
  width: number;
  height: number;
};

function canvasBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
}

export async function preparePublicMedia(file: File): Promise<PreparedPublicMedia> {
  if (!ACCEPTED_TYPES.has(file.type)) {
    throw new Error('Fotoğraf JPG, PNG veya WebP biçiminde olmalı.');
  }
  if (file.size < 1 || file.size > MAX_INPUT_BYTES) {
    throw new Error('Fotoğraf en fazla 5 MB olabilir.');
  }

  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width < 1 || bitmap.height < 1) throw new Error('Fotoğraf boyutları okunamadı.');
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Fotoğraf hazırlanamadı.');
    context.drawImage(bitmap, 0, 0, width, height);

    for (const quality of [0.88, 0.8, 0.72, 0.64]) {
      const blob = await canvasBlob(canvas, quality);
      if (blob && blob.size > 0 && blob.size <= MAX_INPUT_BYTES) {
        return { blob, width, height };
      }
    }
    throw new Error('Fotoğraf 5 MB sınırına indirilemedi. Daha küçük bir fotoğraf seçin.');
  } finally {
    bitmap.close();
  }
}
