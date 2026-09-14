import { clamp01, getTransformationPhase } from "./timeline";

export const TRANSFORMATION_FRAME_COUNT = 121;
export const TRANSFORMATION_FRAME_CACHE_SIZE = 8;
export const TRANSFORMATION_FRAME_FETCH_CONCURRENCY = 4;

export type TransformationFrameVariant = "desktop" | "mobile";

export const TRANSFORMATION_FRAME_ROOTS = {
  desktop: "/marketing/transformation/frames/desktop",
  mobile: "/marketing/transformation/frames/mobile",
} as const;

export interface DecodedTransformationFrame {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

export interface FrameSequenceMetrics {
  requestCount: number;
  compressedBytes: number;
  cachePeakFrames: number;
}

interface QueueItem {
  index: number;
  resolve: (frame: DecodedTransformationFrame) => void;
  reject: (error: unknown) => void;
}

export function getTransformationFrameIndex(progress: number): number {
  return Math.round(clamp01(progress) * (TRANSFORMATION_FRAME_COUNT - 1));
}

export function getTransformationFrameProgress(index: number): number {
  return clamp01(index / Math.max(1, TRANSFORMATION_FRAME_COUNT - 1));
}

export function getTransformationFrameUrl(index: number, variant: TransformationFrameVariant): string {
  const safeIndex = Math.min(TRANSFORMATION_FRAME_COUNT - 1, Math.max(0, Math.round(index)));
  return `${TRANSFORMATION_FRAME_ROOTS[variant]}/frame-${String(safeIndex).padStart(3, "0")}.webp`;
}

export function getTransformationFrameFocusX(
  index: number,
  variant: TransformationFrameVariant,
  viewportWidth: number,
): number {
  if (variant === "mobile") {
    switch (getTransformationPhase(getTransformationFrameProgress(index))) {
      case "reminder": return 0.70;
      case "friction": return 0.63;
      case "sweep": return 0.56;
      case "pricing": return 0.67;
    }
  }

  if (viewportWidth <= 980) {
    return 0.62;
  }

  return 0.5;
}

async function decodeWithImageElement(blob: Blob): Promise<DecodedTransformationFrame> {
  const objectUrl = URL.createObjectURL(blob);
  const image = new Image();
  image.decoding = "async";

  try {
    if (typeof image.decode === "function") {
      image.src = objectUrl;
      await image.decode();
    } else {
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("Transformation frame image decode failed."));
        image.src = objectUrl;
      });
    }

    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => {
        image.removeAttribute("src");
      },
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function decodeFrame(blob: Blob): Promise<DecodedTransformationFrame> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close(),
    };
  }

  return decodeWithImageElement(blob);
}

export class TransformationFrameLoader {
  private readonly variant: TransformationFrameVariant;
  private readonly cacheLimit: number;
  private readonly concurrency: number;
  private readonly cache = new Map<number, DecodedTransformationFrame>();
  private readonly pending = new Map<number, Promise<DecodedTransformationFrame>>();
  private readonly queue: QueueItem[] = [];
  private readonly controllers = new Set<AbortController>();
  private active = 0;
  private disposed = false;
  private metrics: FrameSequenceMetrics = {
    requestCount: 0,
    compressedBytes: 0,
    cachePeakFrames: 0,
  };

  constructor(
    variant: TransformationFrameVariant,
    options: { cacheLimit?: number; concurrency?: number } = {},
  ) {
    this.variant = variant;
    this.cacheLimit = Math.max(2, options.cacheLimit ?? TRANSFORMATION_FRAME_CACHE_SIZE);
    this.concurrency = Math.max(1, options.concurrency ?? TRANSFORMATION_FRAME_FETCH_CONCURRENCY);
  }

  getMetrics(): FrameSequenceMetrics {
    return { ...this.metrics };
  }

  getCached(index: number): DecodedTransformationFrame | null {
    const frame = this.cache.get(index);
    if (!frame) return null;

    this.cache.delete(index);
    this.cache.set(index, frame);
    return frame;
  }

  load(index: number, priority = false): Promise<DecodedTransformationFrame> {
    const safeIndex = Math.min(TRANSFORMATION_FRAME_COUNT - 1, Math.max(0, Math.round(index)));
    const cached = this.getCached(safeIndex);
    if (cached) return Promise.resolve(cached);

    const existing = this.pending.get(safeIndex);
    if (existing) return existing;

    if (this.disposed) {
      return Promise.reject(new Error("Transformation frame loader is disposed."));
    }

    let resolveTask!: (frame: DecodedTransformationFrame) => void;
    let rejectTask!: (error: unknown) => void;
    const promise = new Promise<DecodedTransformationFrame>((resolve, reject) => {
      resolveTask = resolve;
      rejectTask = reject;
    });

    this.pending.set(safeIndex, promise);
    const task = { index: safeIndex, resolve: resolveTask, reject: rejectTask };
    if (priority) this.queue.unshift(task);
    else this.queue.push(task);
    this.pump();
    return promise;
  }

  prefetch(indices: readonly number[], onFailure?: (error: unknown) => void): void {
    const unique = [...new Set(indices)]
      .filter((index) => index >= 0 && index < TRANSFORMATION_FRAME_COUNT);

    for (const index of unique) {
      void this.load(index).catch((error) => onFailure?.(error));
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();

    for (const task of this.queue.splice(0)) {
      task.reject(new Error("Transformation frame loader disposed before request started."));
      this.pending.delete(task.index);
    }

    for (const frame of this.cache.values()) frame.close();
    this.cache.clear();
  }

  private pump(): void {
    while (!this.disposed && this.active < this.concurrency && this.queue.length > 0) {
      const task = this.queue.shift();
      if (!task) return;

      this.active += 1;
      void this.fetchAndDecode(task.index)
        .then((frame) => {
          if (this.disposed) {
            frame.close();
            throw new Error("Transformation frame loader disposed during decode.");
          }
          this.remember(task.index, frame);
          task.resolve(frame);
        })
        .catch((error) => task.reject(error))
        .finally(() => {
          this.pending.delete(task.index);
          this.active -= 1;
          this.pump();
        });
    }
  }

  private async fetchAndDecode(index: number): Promise<DecodedTransformationFrame> {
    const controller = new AbortController();
    this.controllers.add(controller);

    try {
      const response = await fetch(getTransformationFrameUrl(index, this.variant), {
        cache: "force-cache",
        signal: controller.signal,
      });
      this.metrics.requestCount += 1;
      if (!response.ok) {
        throw new Error(`Transformation frame ${index} returned HTTP ${response.status}.`);
      }

      const blob = await response.blob();
      this.metrics.compressedBytes += blob.size;
      return await decodeFrame(blob);
    } finally {
      this.controllers.delete(controller);
    }
  }

  private remember(index: number, frame: DecodedTransformationFrame): void {
    const previous = this.cache.get(index);
    if (previous && previous !== frame) previous.close();
    this.cache.delete(index);

    while (this.cache.size >= this.cacheLimit) {
      const oldest = this.cache.entries().next().value as [number, DecodedTransformationFrame] | undefined;
      if (!oldest) break;
      this.cache.delete(oldest[0]);
      oldest[1].close();
    }

    this.cache.set(index, frame);
    this.metrics.cachePeakFrames = Math.max(this.metrics.cachePeakFrames, this.cache.size);
  }
}

export function drawTransformationFrameCover(
  canvas: HTMLCanvasElement,
  frame: DecodedTransformationFrame,
  focusX = 0.5,
): boolean {
  const width = canvas.clientWidth || window.innerWidth;
  const height = canvas.clientHeight || window.innerHeight;
  if (width <= 0 || height <= 0 || frame.width <= 0 || frame.height <= 0) return false;

  const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  const renderWidth = Math.max(1, Math.round(width * dpr));
  const renderHeight = Math.max(1, Math.round(height * dpr));
  if (canvas.width !== renderWidth) canvas.width = renderWidth;
  if (canvas.height !== renderHeight) canvas.height = renderHeight;

  const context = canvas.getContext("2d", { alpha: false });
  if (!context) return false;

  const scale = Math.max(renderWidth / frame.width, renderHeight / frame.height);
  const drawWidth = frame.width * scale;
  const drawHeight = frame.height * scale;
  const boundedFocusX = clamp01(focusX);
  const x = (renderWidth - drawWidth) * boundedFocusX;
  const y = (renderHeight - drawHeight) / 2;

  context.clearRect(0, 0, renderWidth, renderHeight);
  context.drawImage(frame.source, x, y, drawWidth, drawHeight);
  return true;
}
