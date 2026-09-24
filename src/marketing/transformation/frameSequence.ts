import { clamp01, getTransformationPhase } from "./timeline.ts";

export const TRANSFORMATION_FRAME_COUNT = 121;
export const TRANSFORMATION_FRAME_CACHE_SIZE = 8;
export const TRANSFORMATION_FRAME_FETCH_CONCURRENCY = 4;

export type TransformationFrameVariant = "desktop" | "mobile";

export const TRANSFORMATION_FRAME_ROOTS = {
  desktop: "/marketing/transformation/frames/desktop",
  mobile: "/marketing/transformation/frames/mobile",
} as const;

/** Where a scroll-scrubbed frame film lives and how its files are named. */
export interface FrameSequenceSource {
  roots: Readonly<Record<TransformationFrameVariant, string>>;
  extension: "webp" | "avif";
  count: number;
}

/** The legacy transformation film: the default source for every loader. */
export const TRANSFORMATION_FRAME_SOURCE: FrameSequenceSource = {
  roots: TRANSFORMATION_FRAME_ROOTS,
  extension: "webp",
  count: TRANSFORMATION_FRAME_COUNT,
};

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

/** A queued decode the reader has scrolled away from; callers ignore it, it never fails the sequence. */
export class FrameSupersededError extends Error {
  constructor(index: number) {
    super(`Frame ${index} was superseded before it started.`);
    this.name = "FrameSupersededError";
  }
}

interface QueueItem {
  index: number;
  resolve: (frame: DecodedTransformationFrame) => void;
  reject: (error: unknown) => void;
}

export function getTransformationFrameIndex(progress: number): number {
  return Math.round(clamp01(progress) * (TRANSFORMATION_FRAME_COUNT - 1));
}

export function getFrameSequenceIndex(progress: number, count: number): number {
  return Math.round(clamp01(progress) * (Math.max(1, count) - 1));
}

export function getFrameSequenceUrl(source: FrameSequenceSource, index: number, variant: TransformationFrameVariant): string {
  const safeIndex = Math.min(source.count - 1, Math.max(0, Math.round(index)));
  return `${source.roots[variant]}/frame-${String(safeIndex).padStart(3, "0")}.${source.extension}`;
}

export function getTransformationFrameProgress(index: number): number {
  return clamp01(index / Math.max(1, TRANSFORMATION_FRAME_COUNT - 1));
}

export function getTransformationFrameUrl(index: number, variant: TransformationFrameVariant): string {
  return getFrameSequenceUrl(TRANSFORMATION_FRAME_SOURCE, index, variant);
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
    try {
      const bitmap = await createImageBitmap(blob);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      };
    } catch {
      return decodeWithImageElement(blob);
    }
  }

  return decodeWithImageElement(blob);
}

export class TransformationFrameLoader {
  private readonly variant: TransformationFrameVariant;
  private readonly source: FrameSequenceSource;
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
    options: { cacheLimit?: number; concurrency?: number; source?: FrameSequenceSource } = {},
  ) {
    this.variant = variant;
    this.source = options.source ?? TRANSFORMATION_FRAME_SOURCE;
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

  /** True when the frame is decoded, without touching the cache order. */
  has(index: number): boolean {
    return this.cache.has(index);
  }

  /** The decoded frame closest to a fractional film position, if any. */
  nearestCached(position: number): { index: number; frame: DecodedTransformationFrame } | null {
    let best: { index: number; frame: DecodedTransformationFrame } | null = null;
    for (const [index, frame] of this.cache) {
      if (!best || Math.abs(index - position) < Math.abs(best.index - position)) best = { index, frame };
    }
    return best;
  }

  /** Drops queued (not yet started) decodes more than `radius` frames away from `center`. */
  retarget(center: number, radius: number): void {
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const task = this.queue[i];
      if (!task || Math.abs(task.index - center) <= radius) continue;
      this.queue.splice(i, 1);
      this.pending.delete(task.index);
      task.reject(new FrameSupersededError(task.index));
    }
  }

  load(index: number, priority = false): Promise<DecodedTransformationFrame> {
    const safeIndex = Math.min(this.source.count - 1, Math.max(0, Math.round(index)));
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

  /**
   * Pulls compressed frames into the HTTP cache ahead of the reader without
   * decoding them, two requests at a time. Best effort: failures are ignored
   * here and surface through load() if the frame is actually needed.
   */
  warm(indices: readonly number[]): void {
    const queue = [...new Set(indices)].filter((index) => index >= 0 && index < this.source.count);
    const worker = async () => {
      while (!this.disposed && queue.length > 0) {
        const index = queue.shift();
        if (index === undefined || this.cache.has(index) || this.pending.has(index)) continue;
        try {
          const response = await fetch(getFrameSequenceUrl(this.source, index, this.variant), { cache: "force-cache" });
          await response.blob();
        } catch {
          // Warming never fails the sequence.
        }
      }
    };
    void worker();
    void worker();
  }

  prefetch(indices: readonly number[], onFailure?: (error: unknown) => void): void {
    const unique = [...new Set(indices)]
      .filter((index) => index >= 0 && index < this.source.count);

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
      const response = await fetch(getFrameSequenceUrl(this.source, index, this.variant), {
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

/**
 * Draws a frame to cover the canvas. With `alpha` below 1 the frame is laid
 * over what is already drawn instead of replacing it, which is how two
 * neighbouring frames cross-fade.
 */
export function drawTransformationFrameCover(
  canvas: HTMLCanvasElement,
  frame: DecodedTransformationFrame,
  focusX = 0.5,
  alpha = 1,
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
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  const scale = Math.max(renderWidth / frame.width, renderHeight / frame.height);
  const drawWidth = frame.width * scale;
  const drawHeight = frame.height * scale;
  const boundedFocusX = clamp01(focusX);
  const x = (renderWidth - drawWidth) * boundedFocusX;
  const y = (renderHeight - drawHeight) / 2;

  if (alpha >= 1) {
    context.clearRect(0, 0, renderWidth, renderHeight);
    context.drawImage(frame.source, x, y, drawWidth, drawHeight);
    return true;
  }

  context.globalAlpha = Math.max(0, alpha);
  context.drawImage(frame.source, x, y, drawWidth, drawHeight);
  context.globalAlpha = 1;
  return true;
}
