import { useEffect, type RefObject } from "react";

interface ScrollSceneOptions {
  cssProperty?: `--${string}`;
  datasetKey?: string;
  disabled?: boolean;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function useScrollScene(
  sectionRef: RefObject<HTMLElement | null>,
  options: ScrollSceneOptions = {},
): void {
  const {
    cssProperty = "--mkt-scroll-progress",
    datasetKey = "scrollProgress",
    disabled = false,
  } = options;

  useEffect(() => {
    const section = sectionRef.current;
    if (!section || disabled) return undefined;

    let sectionTop = 0;
    let scrollRange = 1;
    let scrollFrame: number | null = null;
    let geometryFrame: number | null = null;
    let disposed = false;

    const updateGeometry = () => {
      const rect = section.getBoundingClientRect();
      sectionTop = window.scrollY + rect.top;
      scrollRange = Math.max(1, section.offsetHeight - window.innerHeight);
    };

    const writeProgress = () => {
      const progress = clamp01((window.scrollY - sectionTop) / scrollRange);
      const value = progress.toFixed(4);
      section.style.setProperty(cssProperty, value);
      section.dataset[datasetKey] = value;
    };

    const schedule = () => {
      if (scrollFrame !== null || disposed) return;
      scrollFrame = window.requestAnimationFrame(() => {
        scrollFrame = null;
        if (!disposed) writeProgress();
      });
    };

    const scheduleGeometry = () => {
      if (geometryFrame !== null || disposed) return;
      geometryFrame = window.requestAnimationFrame(() => {
        geometryFrame = null;
        if (disposed) return;
        updateGeometry();
        writeProgress();
      });
    };

    updateGeometry();
    writeProgress();

    window.addEventListener("scroll", schedule, { passive: true });
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

    return () => {
      disposed = true;
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", scheduleGeometry);
      visualViewport?.removeEventListener("resize", scheduleGeometry);
      window.removeEventListener("orientationchange", scheduleGeometry);
      resizeObserver?.disconnect();
      if (scrollFrame !== null) window.cancelAnimationFrame(scrollFrame);
      if (geometryFrame !== null) window.cancelAnimationFrame(geometryFrame);
      section.style.removeProperty(cssProperty);
      delete section.dataset[datasetKey];
    };
  }, [cssProperty, datasetKey, disabled, sectionRef]);
}
