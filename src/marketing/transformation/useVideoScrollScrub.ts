import { useEffect, useRef, useState, type RefObject } from "react";

import {
  TRANSFORMATION_VIDEO_DURATION,
  clamp01,
  getTransformationPhase,
  type TransformationPhase,
} from "./timeline";

interface VideoScrollScrubResult {
  phase: TransformationPhase;
  metadataReady: boolean;
}

export function usePrefersReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(query.matches);

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
  const visibleRef = useRef(true);
  const phaseRef = useRef<TransformationPhase>("reminder");

  useEffect(() => {
    const section = sectionRef.current;
    const video = videoRef.current;

    if (!section || !video || disabled) {
      return undefined;
    }

    let sectionTop = 0;
    let scrollRange = 1;

    const updateGeometry = () => {
      const rect = section.getBoundingClientRect();
      sectionTop = window.scrollY + rect.top;
      scrollRange = Math.max(1, section.offsetHeight - window.innerHeight);
    };

    const getProgress = () => clamp01((window.scrollY - sectionTop) / scrollRange);

    const writePhase = (progress: number) => {
      const nextPhase = getTransformationPhase(progress);
      section.dataset.phase = nextPhase;
      section.style.setProperty("--mkt-progress", progress.toFixed(4));

      if (nextPhase !== phaseRef.current) {
        phaseRef.current = nextPhase;
        setPhase(nextPhase);
      }
    };

    const tick = () => {
      frameRef.current = null;

      if (!visibleRef.current || video.readyState < HTMLMediaElement.HAVE_METADATA) {
        return;
      }

      const duration = Number.isFinite(video.duration) && video.duration > 0
        ? video.duration
        : TRANSFORMATION_VIDEO_DURATION;
      const targetTime = Math.min(duration, Math.max(0, targetTimeRef.current));
      const delta = targetTime - video.currentTime;

      if (Math.abs(delta) <= 1 / 120) {
        if (Math.abs(delta) > 0.0001) {
          video.currentTime = targetTime;
        }
        return;
      }

      video.currentTime += delta * 0.24;
      frameRef.current = window.requestAnimationFrame(tick);
    };

    const schedule = () => {
      const progress = getProgress();
      writePhase(progress);

      const duration = Number.isFinite(video.duration) && video.duration > 0
        ? video.duration
        : TRANSFORMATION_VIDEO_DURATION;
      targetTimeRef.current = progress * duration;

      if (visibleRef.current && frameRef.current === null) {
        frameRef.current = window.requestAnimationFrame(tick);
      }
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
    window.addEventListener("resize", updateGeometry, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });

    const resizeObserver = new ResizeObserver(() => {
      updateGeometry();
      schedule();
    });
    resizeObserver.observe(section);

    const intersectionObserver = new IntersectionObserver(
      ([entry]) => {
        visibleRef.current = entry?.isIntersecting ?? false;
        if (visibleRef.current) {
          schedule();
        } else if (frameRef.current !== null) {
          window.cancelAnimationFrame(frameRef.current);
          frameRef.current = null;
        }
      },
      { rootMargin: "25% 0px 25% 0px" },
    );
    intersectionObserver.observe(section);

    return () => {
      video.removeEventListener("loadedmetadata", onMetadata);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", updateGeometry);
      window.removeEventListener("resize", schedule);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();

      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
      }
    };
  }, [disabled, sectionRef, videoRef]);

  return { phase, metadataReady };
}
