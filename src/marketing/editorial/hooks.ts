import { useEffect, type RefObject } from "react";

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Scroll progress through a tall pinned section, written as `--p` (0 when the
 * sticky stage pins, 1 when it releases). Scroll events already arrive once
 * per rendered frame, so the value is written directly.
 */
export function useSceneProgress(sectionRef: RefObject<HTMLElement | null>, disabled = false) {
  useEffect(() => {
    const section = sectionRef.current;
    if (!section || disabled) return undefined;

    let top = 0;
    let range = 1;
    const measure = () => {
      top = window.scrollY + section.getBoundingClientRect().top;
      range = Math.max(1, section.offsetHeight - window.innerHeight);
    };
    const write = () => {
      section.style.setProperty("--p", clamp01((window.scrollY - top) / range).toFixed(4));
    };
    const remeasure = () => {
      measure();
      write();
    };

    section.dataset.scene = "on";
    remeasure();
    window.addEventListener("scroll", write, { passive: true });
    window.addEventListener("resize", remeasure, { passive: true });
    const observer = new ResizeObserver(remeasure);
    observer.observe(document.body);
    void document.fonts?.ready.then(remeasure).catch(() => undefined);

    return () => {
      window.removeEventListener("scroll", write);
      window.removeEventListener("resize", remeasure);
      observer.disconnect();
      delete section.dataset.scene;
      section.style.removeProperty("--p");
    };
  }, [sectionRef, disabled]);
}

/** One salon day: each chapter is a time of day and a colour of the sky. */
export const DAY_CHAPTERS = [
  { selector: "#acilis", minutes: 9 * 60, label: "Açılış", sky: "#f3efe6", tone: "light" },
  { selector: "#nasil-calisiyor", minutes: 10 * 60 + 30, label: "İlk randevu", sky: "#f3efe6", tone: "light" },
  { selector: "#isletmen-icin", minutes: 12 * 60, label: "Takvim", sky: "#e9edf3", tone: "light" },
  { selector: "#donusum", minutes: 14 * 60 + 30, label: "Salon", sky: "#0f1a2e", tone: "dark" },
  { selector: "#gun-sonu", minutes: 19 * 60, label: "Gün sonu", sky: "#0b1629", tone: "dark" },
  // Same pinned scene, one screen later: the shutter is down at 19:30.
  { selector: "#gun-sonu", minutes: 19 * 60 + 30, label: "Kepenk iniyor", sky: "#0b1629", tone: "dark", shift: 1 },
  { selector: "#yardim", minutes: 19 * 60 + 45, label: "Dipnotlar", sky: "#f3efe6", tone: "light" },
] as const;

function mix(a: string, b: string, t: number) {
  const pa = Number.parseInt(a.slice(1), 16);
  const pb = Number.parseInt(b.slice(1), 16);
  const channel = (shift: number) => Math.round(((pa >> shift) & 255) + ((((pb >> shift) & 255) - ((pa >> shift) & 255)) * t));
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}

/**
 * The page's clock and sky: as each chapter's top crosses the middle of the
 * viewport the time advances toward that chapter and the background blends
 * to its colour. Writes the clock text, chapter label and nav tone.
 */
export function useDayClock(rootRef: RefObject<HTMLElement | null>, disabled = false) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    let stops: Array<{ top: number; minutes: number; label: string; sky: string; tone: string }> = [];
    const measure = () => {
      stops = DAY_CHAPTERS.flatMap((chapter) => {
        const section = root.querySelector(chapter.selector);
        if (!section) return [];
        const shift = "shift" in chapter ? chapter.shift * window.innerHeight : 0;
        return [{ ...chapter, top: section.getBoundingClientRect().top + window.scrollY + shift }];
      });
    };

    const write = () => {
      const probe = window.scrollY + window.innerHeight * 0.5;
      let index = 0;
      for (let i = 0; i < stops.length; i++) if ((stops[i]?.top ?? Infinity) <= probe) index = i;
      const current = stops[index];
      const next = stops[index + 1];
      if (!current) return;
      const span = next ? Math.max(1, next.top - current.top) : 1;
      const t = next ? clamp01((probe - current.top) / span) : 0;
      // Colour only turns in the last stretch before the next chapter, so each chapter reads in its own light.
      const blend = next ? clamp01((t - 0.72) / 0.28) : 0;
      // The clock keys off the top of the viewport so it never jumps when the label turns.
      let clockIndex = 0;
      for (let i = 0; i < stops.length; i++) if ((stops[i]?.top ?? Infinity) <= window.scrollY + 1) clockIndex = i;
      const from = stops[clockIndex] ?? current;
      const to = stops[clockIndex + 1];
      const clockT = to ? clamp01((window.scrollY - from.top) / Math.max(1, to.top - from.top)) : 0;
      const minutes = to ? from.minutes + (to.minutes - from.minutes) * clockT : from.minutes;
      const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
      const mm = String(Math.floor(minutes % 60)).padStart(2, "0");

      root.style.setProperty("--ed-sky", disabled || !next ? current.sky : mix(current.sky, next.sky, blend));
      const tone = blend > 0.5 && next ? next.tone : current.tone;
      root.dataset.tone = tone;
      for (const clock of root.querySelectorAll<HTMLElement>("[data-ed-clock]")) clock.textContent = `${hh}:${mm}`;
      for (const label of root.querySelectorAll<HTMLElement>("[data-ed-chapter]")) {
        const text = blend > 0.5 && next ? next.label : current.label;
        if (label.textContent !== text) label.textContent = text;
      }
    };

    const remeasure = () => {
      measure();
      write();
    };

    remeasure();
    window.addEventListener("scroll", write, { passive: true });
    window.addEventListener("resize", remeasure, { passive: true });
    const observer = new ResizeObserver(remeasure);
    observer.observe(document.body);
    void document.fonts?.ready.then(remeasure).catch(() => undefined);
    const settle = window.setTimeout(remeasure, 800);

    return () => {
      window.removeEventListener("scroll", write);
      window.removeEventListener("resize", remeasure);
      observer.disconnect();
      window.clearTimeout(settle);
    };
  }, [rootRef, disabled]);
}

/**
 * One "kolay" on screen at a time. The nav wordmark lends its "kolay" to the
 * story: while the travelling token reads "kolay." or any `[data-kolay]` word
 * is visible below the nav, the wordmark shows "randevu" alone
 * (`data-nav-kolay="off"`), and takes the word back once none is in view.
 */
export function useSingleKolay(rootRef: RefObject<HTMLElement | null>, tokenRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const navLine = 72;

    const inView = (rect: DOMRect) => rect.width > 0 && rect.bottom > navLine && rect.top < window.innerHeight;
    const shown = (element: HTMLElement) => {
      if (!inView(element.getBoundingClientRect())) return false;
      const own = getComputedStyle(element);
      // Anchors the token plays are transparent; the token check covers them.
      if (own.color === "rgba(0, 0, 0, 0)" || own.color === "transparent") return false;
      for (let node: HTMLElement | null = element; node && node !== root; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) < 0.15) return false;
      }
      return true;
    };
    const tokenSaysKolay = () => {
      const token = tokenRef.current;
      if (!token || root.dataset.journey !== "on" || Number(token.style.opacity || "1") < 0.15) return false;
      if (!inView(token.getBoundingClientRect())) return false;
      return [...token.querySelectorAll<HTMLElement>('[data-layer="word"], [data-layer="lockup"]')]
        .some((layer) => Number(layer.style.opacity || "0") > 0.2);
    };

    const write = () => {
      const elsewhere = tokenSaysKolay() || [...root.querySelectorAll<HTMLElement>("[data-kolay]")].some(shown);
      const next = elsewhere ? "off" : "on";
      if (root.dataset.navKolay !== next) root.dataset.navKolay = next;
    };

    // Scenes update their phase and token in their own animation frames, and
    // their listeners can re-register after this one; decide now and again two
    // frames later, once every scene has drawn.
    let frame: number | null = null;
    const onScroll = () => {
      write();
      if (frame === null) {
        frame = window.requestAnimationFrame(() => {
          frame = window.requestAnimationFrame(() => {
            frame = null;
            write();
          });
        });
      }
    };

    write();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    // The token glides on after the scroll stops; decide again where it lands.
    root.addEventListener("ed-journey-settle", write);
    const settle = window.setTimeout(write, 1000);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      root.removeEventListener("ed-journey-settle", write);
      window.clearTimeout(settle);
      if (frame !== null) window.cancelAnimationFrame(frame);
      delete root.dataset.navKolay;
    };
  }, [rootRef, tokenRef]);
}

/**
 * Depth for the scattered shop objects: each `[data-depth]` element drifts
 * against the scroll by its speed (front layers fast, back layers slow),
 * measured from its section's top so pinned stages get motion too. Writes
 * `--depth-y` only; the blur is baked into the image, never a live filter.
 */
export function useDepthParallax(rootRef: RefObject<HTMLElement | null>, disabled = false) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root || disabled) return undefined;

    let items: Array<{ element: HTMLElement; speed: number; shrink: number; anchor: number }> = [];
    const limit = 420;
    const write = () => {
      const y = window.scrollY;
      for (const item of items) {
        const shift = Math.max(-limit, Math.min(limit, -(y - item.anchor) * item.speed));
        item.element.style.setProperty("--depth-y", `${shift.toFixed(1)}px`);
        // Receding objects get smaller the further they have drifted.
        if (item.shrink) item.element.style.setProperty("--depth-scale", (1 - (Math.abs(shift) / limit) * item.shrink).toFixed(3));
      }
    };
    const measure = () => {
      items = [...root.querySelectorAll<HTMLElement>("[data-depth]")].map((element) => {
        const section = element.closest<HTMLElement>("section, footer") ?? root;
        return {
          element,
          speed: Number(element.dataset.depth) || 0,
          shrink: Number(element.dataset.shrink) || 0,
          anchor: section.getBoundingClientRect().top + window.scrollY,
        };
      });
      write();
    };

    measure();
    window.addEventListener("scroll", write, { passive: true });
    window.addEventListener("resize", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    return () => {
      window.removeEventListener("scroll", write);
      window.removeEventListener("resize", measure);
      observer.disconnect();
      for (const item of items) {
        item.element.style.removeProperty("--depth-y");
        item.element.style.removeProperty("--depth-scale");
      }
    };
  }, [rootRef, disabled]);
}
