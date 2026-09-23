import { useEffect, useRef, useState, type RefObject } from "react";

import {
  TRANSFORMATION_FRAME_COUNT,
  TransformationFrameLoader,
  drawTransformationFrameCover,
  getTransformationFrameFocusX,
  getTransformationFrameIndex,
  type TransformationFrameVariant,
} from "./frameSequence";
import {
  clamp01,
  easeTransformationScroll,
  getTransformationScrollPhase,
  getTransformationScrollPhaseProgress,
  type TransformationPhase,
} from "./timeline";

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

function getNeighborFrames(index: number): number[] {
  return [index - 1, index + 1, index - 2, index + 2, index - 4, index + 4]
    .filter((candidate) => candidate >= 0 && candidate < TRANSFORMATION_FRAME_COUNT);
}

export function useFrameSequenceScrollScrub(
  sectionRef: RefObject<HTMLElement | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  disabled = false,
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

    const loader = new TransformationFrameLoader(variant);
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
        getTransformationFrameFocusX(index, variant, window.innerWidth),
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
      loader.prefetch(getNeighborFrames(index), failSequence);
    };

    const startCheckpointPrefetch = () => {
      if (checkpointPrefetchStarted) return;
      checkpointPrefetchStarted = true;
      loader.prefetch([0, 30, 60, 90, TRANSFORMATION_FRAME_COUNT - 1], failSequence);
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

    const schedule = () => {
      const scrollProgress = getScrollProgress();
      const mediaProgress = easeTransformationScroll(scrollProgress);
      const nextIndex = getTransformationFrameIndex(mediaProgress);
      targetIndex = nextIndex;
      writeScrollState(scrollProgress, mediaProgress);

      const near = observerNear || isSynchronouslyNearSection();
      if (!near || sequenceFailed) return;

      markNear();
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
        if (drawnIndex >= 0) {
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
      loader.dispose();
      delete section.dataset.mktRenderer;
    };
  }, [canvasRef, disabled, sectionRef, variant]);

  return { phase, frameReady, failed, variant };
}
