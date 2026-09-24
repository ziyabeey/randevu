import { useEffect, useRef, useState, type RefObject } from "react";

import {
  FrameSupersededError,
  TRANSFORMATION_FRAME_SOURCE,
  TransformationFrameLoader,
  drawTransformationFrameCover,
  getFrameSequenceIndex,
  getTransformationFrameFocusX,
  type FrameSequenceSource,
  type TransformationFrameVariant,
} from "./frameSequence";
import {
  clamp01,
  easeTransformationScroll,
  getTransformationScrollPhase,
  getTransformationScrollPhaseProgress,
  type TransformationPhase,
} from "./timeline";

/** One scroll-scrubbed film: where its frames live, how scroll maps to film time, and where the crop focuses. */
export interface FrameSequenceScrubConfig {
  source: FrameSequenceSource;
  ease: (scrollProgress: number) => number;
  focusX: (index: number, variant: TransformationFrameVariant, viewportWidth: number) => number;
  /** Share of the remaining distance the shown film time covers per animation frame (0 = jump to the scroll target). */
  smoothing?: number;
  /** Cross-fade the two frames around the fractional film position instead of snapping to one. */
  blend?: boolean;
  /** Decoded frames kept in memory. */
  cacheLimit?: number;
  /** Pull every compressed frame into the HTTP cache once the section is near. */
  warm?: boolean;
}

/** The legacy transformation film, the default for every caller. */
export const TRANSFORMATION_SCRUB: FrameSequenceScrubConfig = {
  source: TRANSFORMATION_FRAME_SOURCE,
  ease: easeTransformationScroll,
  focusX: getTransformationFrameFocusX,
};

interface FrameSequenceScrollScrubResult {
  phase: TransformationPhase;
  frameReady: boolean;
  failed: boolean;
  variant: TransformationFrameVariant;
}

function getInitialVariant(): TransformationFrameVariant {
  if (typeof window === "undefined") return "desktop";
  return window.matchMedia("(max-width: 680px)").matches ? "mobile" : "desktop";
}

function useFrameSequenceVariant(): TransformationFrameVariant {
  const [variant, setVariant] = useState<TransformationFrameVariant>(getInitialVariant);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 680px)");
    const sync = () => setVariant(media.matches ? "mobile" : "desktop");
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  return variant;
}

function getNeighborFrames(index: number, count: number): number[] {
  return [index - 1, index + 1, index - 2, index + 2, index - 4, index + 4]
    .filter((candidate) => candidate >= 0 && candidate < count);
}

export function useFrameSequenceScrollScrub(
  sectionRef: RefObject<HTMLElement | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  disabled = false,
  sequence: FrameSequenceScrubConfig = TRANSFORMATION_SCRUB,
): FrameSequenceScrollScrubResult {
  const variant = useFrameSequenceVariant();
  const [phase, setPhase] = useState<TransformationPhase>("reminder");
  const [frameReady, setFrameReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const phaseRef = useRef<TransformationPhase>("reminder");

  useEffect(() => {
    const section = sectionRef.current;
    const canvas = canvasRef.current;
    if (!section || !canvas || disabled) return undefined;

    const loader = new TransformationFrameLoader(variant, { source: sequence.source, cacheLimit: sequence.cacheLimit });
    const frameCount = sequence.source.count;
    const smoothing = Math.min(1, Math.max(0, sequence.smoothing ?? 0));
    const fluid = smoothing > 0 || sequence.blend === true;
    let sectionTop = 0;
    let scrollRange = 1;
    let observerNear = false;
    let disposed = false;
    let geometryFrame: number | null = null;
    let scrollFrame: number | null = null;
    let targetIndex = 0;
    let requestedIndex = -1;
    let drawnIndex = -1;
    let drawSerial = 0;
    let staleFrames = 0;
    let failureCount = 0;
    let firstNearAt: number | null = null;
    let firstDrawMs: number | null = null;
    let sequenceFailed = false;
    let checkpointPrefetchStarted = false;
    let targetMedia = 0;
    let shownMedia = -1;
    let fluidFrame: number | null = null;
    let fluidDirection = 1;

    setFrameReady(false);
    setFailed(false);
    section.dataset.mktRenderer = "frames";

    const updateMetrics = () => {
      const metrics = loader.getMetrics();
      section.dataset.frameRequestCount = String(metrics.requestCount);
      section.dataset.frameCompressedBytes = String(metrics.compressedBytes);
      section.dataset.frameCachePeak = String(metrics.cachePeakFrames);
      section.dataset.frameStaleCount = String(staleFrames);
      section.dataset.frameFailureCount = String(failureCount);
      section.dataset.frameFirstDrawMs = firstDrawMs === null ? "" : firstDrawMs.toFixed(1);
      section.dataset.frameIndex = String(drawnIndex);
    };

    const updateGeometry = () => {
      const rect = section.getBoundingClientRect();
      sectionTop = window.scrollY + rect.top;
      scrollRange = Math.max(1, section.offsetHeight - window.innerHeight);
    };

    const getScrollProgress = () => clamp01((window.scrollY - sectionTop) / scrollRange);
    const isSynchronouslyNearSection = () => {
      const rect = section.getBoundingClientRect();
      const margin = window.innerHeight * 0.75;
      return rect.bottom >= -margin && rect.top <= window.innerHeight + margin;
    };
    const drawFrame = (index: number, frame: Parameters<typeof drawTransformationFrameCover>[1]) => (
      drawTransformationFrameCover(
        canvas,
        frame,
        sequence.focusX(index, variant, window.innerWidth),
      )
    );

    const writeScrollState = (scrollProgress: number, mediaProgress: number) => {
      const nextPhase = getTransformationScrollPhase(scrollProgress);
      const phaseProgress = getTransformationScrollPhaseProgress(scrollProgress, nextPhase);

      section.dataset.phase = nextPhase;
      section.style.setProperty("--mkt-progress", mediaProgress.toFixed(4));
      section.style.setProperty("--mkt-scroll-progress", scrollProgress.toFixed(4));
      section.style.setProperty("--mkt-phase-progress", phaseProgress.toFixed(4));

      if (nextPhase !== phaseRef.current) {
        phaseRef.current = nextPhase;
        setPhase(nextPhase);
      }
    };

    const failSequence = (_error: unknown) => {
      if (sequenceFailed || disposed) return;
      sequenceFailed = true;
      failureCount += 1;
      updateMetrics();
      setFailed(true);
      loader.dispose();
    };

    const prefetchAround = (index: number) => {
      loader.prefetch(getNeighborFrames(index, frameCount), failSequence);
    };

    const startCheckpointPrefetch = () => {
      if (checkpointPrefetchStarted) return;
      checkpointPrefetchStarted = true;
      // Quarter checkpoints: 0, 30, 60, 90 and 120 for the 121-frame film.
      loader.prefetch([0, 0.25, 0.5, 0.75, 1].map((fraction) => Math.round(fraction * (frameCount - 1))), (error) => {
        if (!(error instanceof FrameSupersededError)) failSequence(error);
      });
      if (sequence.warm) loader.warm(Array.from({ length: frameCount }, (_, index) => index));
    };

    const markNear = () => {
      if (firstNearAt === null) firstNearAt = performance.now();
      startCheckpointPrefetch();
    };

    const drawIndex = (index: number) => {
      if (disposed || sequenceFailed || index === drawnIndex || index === requestedIndex) return;
      targetIndex = index;
      requestedIndex = index;
      const serial = ++drawSerial;

      const cached = loader.getCached(index);
      const framePromise = cached ? Promise.resolve(cached) : loader.load(index, true);
      void framePromise
        .then((frame) => {
          if (disposed || sequenceFailed) return;
          if (serial !== drawSerial || index !== targetIndex) {
            staleFrames += 1;
            updateMetrics();
            return;
          }

          if (!drawFrame(index, frame)) {
            failSequence(new Error("Transformation frame canvas draw failed."));
            return;
          }

          drawnIndex = index;
          if (firstDrawMs === null && firstNearAt !== null) {
            firstDrawMs = performance.now() - firstNearAt;
          }
          setFrameReady(true);
          updateMetrics();
          prefetchAround(index);
        })
        .catch(failSequence)
        .finally(() => {
          if (requestedIndex === index) requestedIndex = -1;
        });
    };

    // Fluid path: the shown film time glides toward the scroll target and the
    // two frames around it cross-fade. The canvas never waits: when the exact
    // pair is not decoded yet the nearest decoded frame is shown, decodes the
    // reader has scrolled past are dropped, and frames ahead in the scroll
    // direction are decoded early.
    const ignoreSuperseded = (error: unknown) => {
      if (!(error instanceof FrameSupersededError)) failSequence(error);
    };

    const renderFluid = (media: number) => {
      const position = media * (frameCount - 1);
      const from = sequence.blend ? Math.floor(position) : Math.round(position);
      const to = Math.min(frameCount - 1, from + 1);
      const amount = sequence.blend ? position - from : 0;
      const needed = amount > 0.002 ? [from, to] : [from];

      loader.retarget(from, 10);
      for (const index of needed) {
        if (loader.has(index)) continue;
        void loader.load(index, true).then(() => {
          if (!disposed && !sequenceFailed) requestFluidFrame();
        }).catch(ignoreSuperseded);
      }
      const ahead = [1, 2, 3, 4, 5, 6].map((step) => from + step * fluidDirection);
      for (const index of ahead) {
        if (index >= 0 && index < frameCount && !loader.has(index)) void loader.load(index).catch(ignoreSuperseded);
      }

      const base = loader.has(from) ? loader.getCached(from) : null;
      const over = base && amount > 0.002 && loader.has(to) ? loader.getCached(to) : null;
      const nearest = base ? null : loader.nearestCached(position);
      const shown = base ?? nearest?.frame ?? null;
      if (!shown) return;
      const shownIndex = base ? from : nearest?.index ?? from;
      if (!drawFrame(shownIndex, shown)) {
        failSequence(new Error("Transformation frame canvas draw failed."));
        return;
      }
      if (over) drawTransformationFrameCover(canvas, over, sequence.focusX(to, variant, window.innerWidth), amount);

      drawnIndex = shownIndex;
      if (firstDrawMs === null && firstNearAt !== null) firstDrawMs = performance.now() - firstNearAt;
      setFrameReady(true);
      updateMetrics();
    };

    const fluidTick = () => {
      fluidFrame = null;
      if (disposed || sequenceFailed) return;
      const delta = targetMedia - shownMedia;
      if (Math.abs(delta) > 0.0004) fluidDirection = delta > 0 ? 1 : -1;
      shownMedia = shownMedia < 0 || smoothing === 0 || Math.abs(delta) < 0.0004
        ? targetMedia
        : shownMedia + delta * smoothing;
      section.style.setProperty("--mkt-progress", shownMedia.toFixed(4));
      renderFluid(shownMedia);
      // Keep ticking while the glide runs or the exact frame is still decoding.
      const exact = sequence.blend ? Math.floor(shownMedia * (frameCount - 1)) : Math.round(shownMedia * (frameCount - 1));
      if (shownMedia !== targetMedia || drawnIndex !== exact) requestFluidFrame();
    };

    function requestFluidFrame() {
      if (fluidFrame === null && !disposed) fluidFrame = window.requestAnimationFrame(fluidTick);
    }

    const schedule = () => {
      const scrollProgress = getScrollProgress();
      const mediaProgress = sequence.ease(scrollProgress);
      const nextIndex = getFrameSequenceIndex(mediaProgress, frameCount);
      targetIndex = nextIndex;
      writeScrollState(scrollProgress, mediaProgress);

      const near = observerNear || isSynchronouslyNearSection();
      if (!near || sequenceFailed) return;

      markNear();
      if (fluid) {
        targetMedia = mediaProgress;
        requestFluidFrame();
        return;
      }
      if (nextIndex !== drawnIndex) drawIndex(nextIndex);
    };

    const scheduleScroll = () => {
      if (scrollFrame !== null || disposed) return;
      scrollFrame = window.requestAnimationFrame(() => {
        scrollFrame = null;
        if (!disposed) schedule();
      });
    };

    const scheduleGeometry = () => {
      if (geometryFrame !== null || disposed) return;
      geometryFrame = window.requestAnimationFrame(() => {
        geometryFrame = null;
        if (disposed) return;
        updateGeometry();
        if (fluid && shownMedia >= 0) {
          renderFluid(shownMedia);
        } else if (drawnIndex >= 0) {
          const cached = loader.getCached(drawnIndex);
          if (cached) drawFrame(drawnIndex, cached);
        }
        schedule();
      });
    };

    updateGeometry();
    updateMetrics();
    schedule();

    window.addEventListener("scroll", scheduleScroll, { passive: true });
    window.addEventListener("resize", scheduleGeometry, { passive: true });

    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(scheduleGeometry);
    resizeObserver?.observe(section);
    resizeObserver?.observe(document.body);

    const visualViewport = window.visualViewport;
    visualViewport?.addEventListener("resize", scheduleGeometry, { passive: true });
    window.addEventListener("orientationchange", scheduleGeometry, { passive: true });

    void document.fonts?.ready.then(() => {
      if (!disposed) scheduleGeometry();
    }).catch(() => undefined);

    const intersectionObserver = new IntersectionObserver(
      ([entry]) => {
        observerNear = entry?.isIntersecting ?? false;
        if (!observerNear || sequenceFailed) return;
        markNear();
        schedule();
      },
      { rootMargin: "75% 0px 75% 0px" },
    );
    intersectionObserver.observe(section);

    return () => {
      disposed = true;
      window.removeEventListener("scroll", scheduleScroll);
      window.removeEventListener("resize", scheduleGeometry);
      visualViewport?.removeEventListener("resize", scheduleGeometry);
      window.removeEventListener("orientationchange", scheduleGeometry);
      resizeObserver?.disconnect();
      intersectionObserver.disconnect();
      if (scrollFrame !== null) window.cancelAnimationFrame(scrollFrame);
      if (geometryFrame !== null) window.cancelAnimationFrame(geometryFrame);
      if (fluidFrame !== null) window.cancelAnimationFrame(fluidFrame);
      loader.dispose();
      delete section.dataset.mktRenderer;
    };
  }, [canvasRef, disabled, sectionRef, sequence, variant]);

  return { phase, frameReady, failed, variant };
}
