import { useEffect, useRef, useState, type RefObject } from "react";

import {
  TRANSFORMATION_VIDEO_DURATION,
  clamp01,
  getTransformationPhase,
  getTransformationPhaseProgress,
  type TransformationPhase,
} from "./timeline";

interface VideoScrollScrubResult {
  phase: TransformationPhase;
  metadataReady: boolean;
}

function isReducedMotionForced(): boolean {
  return typeof document !== "undefined" && document.documentElement.dataset.mktReducedMotion === "true";
}

export function usePrefersReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }

    return isReducedMotionForced() || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(isReducedMotionForced() || query.matches);

    sync();
    query.addEventListener("change", sync);

    return () => query.removeEventListener("change", sync);
  }, []);

  return reducedMotion;
}

export function useVideoScrollScrub(
  sectionRef: RefObject<HTMLElement | null>,
  videoRef: RefObject<HTMLVideoElement | null>,
  disabled = false,
): VideoScrollScrubResult {
  const [phase, setPhase] = useState<TransformationPhase>("reminder");
  const [metadataReady, setMetadataReady] = useState(false);
  const targetTimeRef = useRef(0);
  const frameRef = useRef<number | null>(null);
  const visibleRef = useRef(false);
  const phaseRef = useRef<TransformationPhase>("reminder");

  useEffect(() => {
    const section = sectionRef.current;
    const video = videoRef.current;

    if (!section || !video || disabled) {
      return undefined;
    }

    let sectionTop = 0;
    let scrollRange = 1;
    let preloadPromoted = video.preload === "auto";
    let geometryFrame: number | null = null;
    let disposed = false;

    const updateGeometry = () => {
      const rect = section.getBoundingClientRect();
      sectionTop = window.scrollY + rect.top;
      scrollRange = Math.max(1, section.offsetHeight - window.innerHeight);
    };

    const getProgress = () => clamp01((window.scrollY - sectionTop) / scrollRange);

    const writePhase = (progress: number) => {
      const normalized = clamp01(progress);
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

    const getDuration = () => (
      Number.isFinite(video.duration) && video.duration > 0
        ? video.duration
        : TRANSFORMATION_VIDEO_DURATION
    );

    const tick = () => {
      frameRef.current = null;

      if (!visibleRef.current || video.readyState < HTMLMediaElement.HAVE_METADATA) {
        return;
      }

      const duration = getDuration();
      const targetTime = Math.min(duration, Math.max(0, targetTimeRef.current));
      const delta = targetTime - video.currentTime;
      const distance = Math.abs(delta);

      if (distance > 0.7) {
        video.currentTime = targetTime;
        writePhase(targetTime / duration);
        return;
      }

      if (distance <= 1 / 120) {
        if (distance > 0.0001) {
          video.currentTime = targetTime;
        }
        writePhase(targetTime / duration);
        return;
      }

      video.currentTime += delta * 0.28;
      writePhase(video.currentTime / duration);
      frameRef.current = window.requestAnimationFrame(tick);
    };

    const schedule = () => {
      const scrollProgress = getProgress();
      const duration = getDuration();
      targetTimeRef.current = scrollProgress * duration;

      if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
        writePhase(scrollProgress);
      }

      if (visibleRef.current && frameRef.current === null) {
        frameRef.current = window.requestAnimationFrame(tick);
      }
    };

    const scheduleGeometry = () => {
      if (geometryFrame !== null || disposed) {
        return;
      }

      geometryFrame = window.requestAnimationFrame(() => {
        geometryFrame = null;
        if (disposed) {
          return;
        }
        updateGeometry();
        schedule();
      });
    };

    const onMetadata = () => {
      video.pause();
      setMetadataReady(true);
      schedule();
    };

    updateGeometry();
    schedule();

    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      onMetadata();
    } else {
      video.addEventListener("loadedmetadata", onMetadata);
    }

    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", scheduleGeometry, { passive: true });

    const resizeObserver = new ResizeObserver(scheduleGeometry);
    resizeObserver.observe(section);
    resizeObserver.observe(document.body);

    void document.fonts?.ready.then(() => {
      if (!disposed) {
        scheduleGeometry();
      }
    }).catch(() => undefined);

    const intersectionObserver = new IntersectionObserver(
      ([entry]) => {
        visibleRef.current = entry?.isIntersecting ?? false;
        if (visibleRef.current) {
          if (!preloadPromoted) {
            preloadPromoted = true;
            video.preload = "auto";
          }
          schedule();
        } else if (frameRef.current !== null) {
          window.cancelAnimationFrame(frameRef.current);
          frameRef.current = null;
        }
      },
      { rootMargin: "75% 0px 75% 0px" },
    );
    intersectionObserver.observe(section);

    return () => {
      disposed = true;
      video.removeEventListener("loadedmetadata", onMetadata);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", scheduleGeometry);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();

      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
      }
      if (geometryFrame !== null) {
        window.cancelAnimationFrame(geometryFrame);
      }
    };
  }, [disabled, sectionRef, videoRef]);

  return { phase, metadataReady };
}
