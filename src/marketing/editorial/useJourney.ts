import { useEffect, type RefObject } from "react";

/**
 * The thread of the page: the lime "kolay" leaves the hero headline and plays
 * every step of one appointment — selection, confirmation, calendar entry,
 * customer card, live badge, finished row — then comes home to the word
 * painted on the closing shutter.
 *
 * Waypoints are DOM anchors with hold windows in document scroll space. During
 * a hold the token sits exactly on its anchor (following pinned stages); between
 * holds it flies from one live anchor rect to the next on an arc, travelling
 * with the page and fading under the nav or past the bottom edge rather than
 * pinning to the viewport. Only transforms and sizes are written; scroll is native.
 *
 * The token's place on the journey glides toward the scroll position instead of
 * jumping with it, so a wheel notch that crosses a whole flight still reads as a
 * flight. Rects are read live every frame, so holds stay glued to their anchors.
 */

type Edge = { scene: string; at: number } | { line: number } | { y: number };

interface Waypoint {
  id: string;
  from: Edge;
  to: Edge;
  fill: string;
  ink: string;
  radius: number;
}

const LIME = "#c6e800";
const INK = "#0f1a2e";

export const JOURNEY: Waypoint[] = [
  // The word rides the headline up and fades under the nav, then drops into the phone once it stands upright.
  { id: "word", from: { y: 0 }, to: { y: 0.45 }, fill: LIME, ink: INK, radius: 14 },
  { id: "service", from: { scene: "#nasil-calisiyor", at: 0.26 }, to: { scene: "#nasil-calisiyor", at: 0.42 }, fill: LIME, ink: INK, radius: 14 },
  { id: "slot", from: { scene: "#nasil-calisiyor", at: 0.5 }, to: { scene: "#nasil-calisiyor", at: 0.66 }, fill: LIME, ink: INK, radius: 10 },
  { id: "done", from: { scene: "#nasil-calisiyor", at: 0.76 }, to: { scene: "#nasil-calisiyor", at: 1 }, fill: LIME, ink: INK, radius: 999 },
  { id: "block", from: { scene: "#isletmen-icin", at: 0.42 }, to: { scene: "#isletmen-icin", at: 1 }, fill: LIME, ink: INK, radius: 6 },
  { id: "card", from: { scene: "#donusum", at: 0.08 }, to: { scene: "#donusum", at: 0.3 }, fill: "#f3efe6", ink: INK, radius: 4 },
  { id: "badge", from: { scene: "#donusum", at: 0.4 }, to: { scene: "#donusum", at: 1 }, fill: LIME, ink: INK, radius: 999 },
  { id: "row", from: { scene: "#gun-sonu", at: 0 }, to: { scene: "#gun-sonu", at: 0.42 }, fill: LIME, ink: INK, radius: 4 },
  { id: "lockup", from: { scene: "#gun-sonu", at: 0.56 }, to: { y: Number.POSITIVE_INFINITY }, fill: LIME, ink: INK, radius: 12 },
];

interface Rect { x: number; y: number; w: number; h: number }
interface Resolved extends Waypoint { element: HTMLElement; start: number; end: number }

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
// Sine ease: soft take-off and landing, half the peak speed of a cubic.
const easeInOut = (t: number) => 0.5 - Math.cos(Math.PI * t) / 2;
const smoothstep = (a: number, b: number, t: number) => {
  const x = clamp01((t - a) / (b - a));
  return x * x * (3 - 2 * x);
};

function mix(a: string, b: string, t: number) {
  const pa = Number.parseInt(a.slice(1), 16);
  const pb = Number.parseInt(b.slice(1), 16);
  const channel = (shift: number) => Math.round(((pa >> shift) & 255) + ((((pb >> shift) & 255) - ((pa >> shift) & 255)) * t));
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}

const rectOf = (element: HTMLElement): Rect => {
  const r = element.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
};
const docTop = (element: Element) => element.getBoundingClientRect().top + window.scrollY;

const NAV_LINE = 72;
// Fades run over a fixed stretch of travel, so a small badge fades as gently as the headline word.
const FADE = 96;
const GLIDE_MS = 140;

const visibility = (top: number, height: number) =>
  Math.min(smoothstep(0, FADE, top + height - NAV_LINE), smoothstep(0, FADE, window.innerHeight - top));

function resolve(edge: Edge, anchor: HTMLElement): number {
  if ("y" in edge) return Number.isFinite(edge.y) ? edge.y * window.innerHeight : edge.y;
  if ("scene" in edge) {
    const scene = document.querySelector<HTMLElement>(edge.scene);
    if (!scene) return Number.NaN;
    return docTop(scene) + Math.max(0, scene.offsetHeight - window.innerHeight) * edge.at;
  }
  return docTop(anchor) - window.innerHeight * edge.line;
}

export function useJourney(rootRef: RefObject<HTMLElement | null>, tokenRef: RefObject<HTMLElement | null>, disabled = false) {
  useEffect(() => {
    const root = rootRef.current;
    const token = tokenRef.current;
    if (!root || !token || disabled) return undefined;

    let points: Resolved[] = [];
    const salon = root.querySelector<HTMLElement>("#donusum");

    const measure = () => {
      points = JOURNEY.flatMap((waypoint) => {
        const element = root.querySelector<HTMLElement>(`[data-journey-anchor="${waypoint.id}"]`);
        // An anchor hidden at this breakpoint is skipped, never flown to.
        if (!element || element.getClientRects().length === 0) return [];
        const start = resolve(waypoint.from, element);
        const end = resolve(waypoint.to, element);
        if (Number.isNaN(start) || Number.isNaN(end)) return [];
        return [{ ...waypoint, element, start, end: Math.max(start, end) }];
      });
      const word = points.find((point) => point.id === "word")?.element;
      if (word) token.style.setProperty("--tok-word-size", getComputedStyle(word).fontSize);
      const lockup = points.find((point) => point.id === "lockup")?.element;
      if (lockup) token.style.setProperty("--tok-lockup-size", getComputedStyle(lockup).fontSize);
    };

    const place = (rect: Rect, fill: string, ink: string, radius: number) => {
      token.style.transform = `translate3d(${rect.x.toFixed(2)}px, ${rect.y.toFixed(2)}px, 0)`;
      token.style.width = `${Math.max(1, rect.w).toFixed(2)}px`;
      token.style.height = `${Math.max(1, rect.h).toFixed(2)}px`;
      token.style.borderRadius = `${Math.min(radius, rect.h / 2).toFixed(2)}px`;
      token.style.background = fill;
      token.style.color = ink;
    };

    // Faces turn over like a drum: the old one rolls up and out while the new one
    // rolls in right beneath it, so the block never goes blank and texts never overlap.
    const layers = (from: string, to: string | null, t: number) => {
      const turn = to === null ? 0 : smoothstep(0.3, 0.7, t);
      for (const layer of token.querySelectorAll<HTMLElement>("[data-layer]")) {
        const id = layer.dataset.layer;
        let opacity = 0;
        let shift = 0;
        if (id === to) {
          opacity = smoothstep(0.1, 0.65, turn);
          shift = 100 * (1 - turn);
        } else if (id === from) {
          opacity = 1 - smoothstep(0.35, 0.9, turn);
          shift = -100 * turn;
        }
        layer.style.opacity = opacity.toFixed(3);
        layer.style.transform = shift ? `translate3d(0, ${shift.toFixed(2)}%, 0)` : "";
      }
    };

    // Journey coordinate: i holds on points[i]; i + t flies from points[i] to points[i + 1].
    const goal = () => {
      const y = window.scrollY;
      for (let i = 0; i < points.length; i++) {
        const point = points[i];
        const following = points[i + 1];
        if (!point) continue;
        if (y <= point.end || !following) return i;
        if (y < following.start) return i + clamp01((y - point.end) / Math.max(1, following.start - point.end));
      }
      return 0;
    };

    const draw = (s: number) => {
      if (salon) token.style.setProperty("--tok-progress", salon.style.getPropertyValue("--mkt-progress") || "0");
      const index = Math.min(points.length - 1, Math.max(0, Math.floor(s)));
      const current = points[index];
      if (!current) {
        token.style.opacity = "0";
        return;
      }
      const t = s - index;
      const next = t > 0.0005 ? points[index + 1] ?? null : null;

      const at = next ? `${current.id}-${next.id}` : current.id;
      token.dataset.at = at;
      root.dataset.journeyAt = at;

      if (!next) {
        const rect = rectOf(current.element);
        place(rect, current.fill, current.ink, current.radius);
        token.style.opacity = visibility(rect.y, rect.h).toFixed(3);
        token.style.boxShadow = "";
        layers(current.id, null, 0);
        return;
      }

      const a = rectOf(current.element);
      const b = rectOf(next.element);
      const e = easeInOut(t);
      const lift = Math.sin(Math.PI * e);
      const w = lerp(a.w, b.w, e);
      const h = lerp(a.h, b.h, e);
      const margin = 14;
      const top = lerp(a.y, b.y, e) - lift * Math.min(90, window.innerHeight * 0.09);
      place({
        x: Math.min(Math.max(lerp(a.x, b.x, e), margin), window.innerWidth - w - margin),
        y: top,
        w,
        h,
      }, mix(current.fill, next.fill, e), mix(current.ink, next.ink, e), lerp(current.radius, next.radius, e));
      // No pinning to the viewport: the token travels with the page and fades as it slides under the nav or off the bottom.
      token.style.opacity = visibility(top, h).toFixed(3);
      token.style.boxShadow = `0 ${Math.round(14 + lift * 28)}px ${Math.round(34 + lift * 46)}px rgba(15, 26, 46, ${(0.12 + lift * 0.18).toFixed(3)})`;
      layers(current.id, next.id, e);
    };

    let shown = Number.NaN;
    let last = 0;
    let tick = 0;

    const step = (now: number) => {
      tick = 0;
      const target = goal();
      const dt = last ? Math.min(64, now - last) : 16;
      last = now;
      // More than one waypoint away (a menu jump, a resize): cut, do not fly through the page.
      if (!Number.isFinite(shown) || Math.abs(target - shown) > 1.2) shown = target;
      else shown += (target - shown) * (1 - Math.exp(-dt / GLIDE_MS));
      if (Math.abs(target - shown) < 0.0008) shown = target;
      draw(shown);
      if (shown !== target) tick = window.requestAnimationFrame(step);
      else {
        last = 0;
        root.dispatchEvent(new Event("ed-journey-settle"));
      }
    };

    const frame = () => {
      if (!tick) tick = window.requestAnimationFrame(step);
    };

    const remeasure = () => {
      measure();
      shown = Number.NaN;
      frame();
    };

    root.dataset.journey = "on";
    remeasure();
    window.addEventListener("scroll", frame, { passive: true });
    window.addEventListener("resize", remeasure, { passive: true });
    const observer = new ResizeObserver(remeasure);
    observer.observe(document.body);
    void document.fonts?.ready.then(remeasure).catch(() => undefined);
    const settle = window.setTimeout(remeasure, 900);

    return () => {
      window.removeEventListener("scroll", frame);
      window.removeEventListener("resize", remeasure);
      observer.disconnect();
      window.clearTimeout(settle);
      if (tick) window.cancelAnimationFrame(tick);
      delete root.dataset.journey;
      delete root.dataset.journeyAt;
    };
  }, [rootRef, tokenRef, disabled]);
}
