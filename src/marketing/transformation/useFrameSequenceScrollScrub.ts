import { useEffect, useRef, useState, type RefObject } from "react";

import {
  TRANSFORMATION_FRAME_COUNT,
  TransformationFrameLoader,
  drawTransformationFrameCover,
  getTransformationFrameIndex,
  getTransformationFrameProgress,
  type TransformationFrameVariant,
} from "./frameSequence";
import {
  clamp01,
  getTransformationPhase,
  getTransformationPhaseProgress,
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
    let visible = false;
    let disposed = false;
    let geometryFrame: number | null = null;
    let targetIndex = 0;
    let drawnIndex = -1;
    let drawSerial = 0;
    let staleFrames = 0;
    let failureCount = 0;
    let firstNearAt: number | null = null;
    let firstDrawMs: number | null = null;
    let sequenceFailed = false;

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

    const getProgress = () => clamp01((window.scrollY - sectionTop) / scrollRange);

    const writePhase = (index: number) => {
      const normalized = getTransformationFrameProgress(index);
      const nextPhase = getTransformationPhase(normalized);
      const phaseProgress = getTransformationPhaseProgress(normalized, nextPhase);

      section.dataset.phase = nextPhase;
      section.style.setProperty("--mkt-progress", normalized.toFixed(4));
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

    const drawIndex = (index: number) => {
      if (disposed || sequenceFailed) return;
      targetIndex = index;
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

          if (!drawTransformationFrameCover(canvas, frame)) {
            failSequence(new Error("Transformation frame canvas draw failed."));
            return;
          }

          drawnIndex = index;
          writePhase(index);
          if (firstDrawMs === null && firstNearAt !== null) {
            firstDrawMs = performance.now() - firstNearAt;
          }
          setFrameReady(true);
          updateMetrics();
          prefetchAround(index);
        })
        .catch(failSequence);
    };

    const schedule = () => {
      const nextIndex = getTransformationFrameIndex(getProgress());
      targetIndex = nextIndex;
      if (visible && nextIndex !== drawnIndex) drawIndex(nextIndex);
    };

    const scheduleGeometry = () => {
      if (geometryFrame !== null || disposed) return;
      geometryFrame = window.requestAnimationFrame(() => {
        geometryFrame = null;
        if (disposed) return;
        updateGeometry();
        if (drawnIndex >= 0) {
          const cached = loader.getCached(drawnIndex);
          if (cached) drawTransformationFrameCover(canvas, cached);
        }
        schedule();
      });
    };

    updateGeometry();
    updateMetrics();

    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", scheduleGeometry, { passive: true });

    const resizeObserver = new ResizeObserver(scheduleGeometry);
    resizeObserver.observe(section);
    resizeObserver.observe(document.body);

    void document.fonts?.ready.then(() => {
      if (!disposed) scheduleGeometry();
    }).catch(() => undefined);

    const intersectionObserver = new IntersectionObserver(
      ([entry]) => {
        visible = entry?.isIntersecting ?? false;
        if (!visible || sequenceFailed) return;

        if (firstNearAt === null) firstNearAt = performance.now();
        const nextIndex = getTransformationFrameIndex(getProgress());
        drawIndex(nextIndex);
        loader.prefetch([0, 30, 60, 90, TRANSFORMATION_FRAME_COUNT - 1], failSequence);
      },
      { rootMargin: "75% 0px 75% 0px" },
    );
    intersectionObserver.observe(section);

    return () => {
      disposed = true;
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", scheduleGeometry);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      if (geometryFrame !== null) window.cancelAnimationFrame(geometryFrame);
      loader.dispose();
      delete section.dataset.mktRenderer;
    };
  }, [canvasRef, disabled, sectionRef, variant]);

  return { phase, frameReady, failed, variant };
}
