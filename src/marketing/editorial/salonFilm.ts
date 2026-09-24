import { useEffect, useState } from "react";

import { clamp01 } from "../transformation/timeline";
import type { FrameSequenceScrubConfig } from "../transformation/useFrameSequenceScrollScrub";

/**
 * The Cihangir time-lapse (2026-09-24): one locked camera from 14:30 to 19:00,
 * 13 s of film sampled into 121 frames (1660 px desktop, 1080 px mobile, 4:3).
 * The copy beats land on the film's light: reminder on the haircut, friction on
 * the afternoon rush, sweep on dusk and tea, pricing on the shutter coming down.
 */
const SALON_FILM_KEYFRAMES: ReadonlyArray<readonly [scroll: number, time: number]> = [
  [0, 0],
  [0.05, 0],
  [0.37, 0.27],
  [0.64, 0.52],
  [0.82, 0.76],
  [0.97, 1],
  [1, 1],
];

export function easeSalonFilm(scroll: number): number {
  const s = clamp01(scroll);
  let previousScroll = 0;
  let previousTime = 0;
  for (const [nextScroll, nextTime] of SALON_FILM_KEYFRAMES) {
    if (s <= nextScroll) {
      const span = Math.max(0.0001, nextScroll - previousScroll);
      return clamp01(previousTime + ((s - previousScroll) / span) * (nextTime - previousTime));
    }
    previousScroll = nextScroll;
    previousTime = nextTime;
  }
  return 1;
}

const SALON_FILM_ROOTS = {
  desktop: "/marketing/editorial/salon/desktop",
  mobile: "/marketing/editorial/salon/mobile",
} as const;

// The shop is framed whole on desktop; phones crop the sides around the chair.
const centreFocus = () => 0.5;

// A time-lapse reads as light, not as steps: neighbouring frames cross-fade and
// the shown time glides toward the scroll position (about a quarter second).
export const SALON_FILM: FrameSequenceScrubConfig = {
  source: { roots: SALON_FILM_ROOTS, extension: "avif", count: 121 },
  ease: easeSalonFilm,
  focusX: centreFocus,
  smoothing: 0.14,
  blend: true,
  cacheLimit: 14,
  warm: true,
};

export const SALON_FILM_POSTER = {
  avif: `${SALON_FILM_ROOTS.desktop}/frame-000.avif`,
  webp: `${SALON_FILM_ROOTS.desktop}/frame-000.webp`,
  width: 1660,
  height: 1244,
} as const;

// 1x1 AVIF: decodes only where the browser can decode the film's AVIF frames.
const AVIF_PROBE = "data:image/avif;base64,AAAAHGZ0eXBhdmlmAAAAAG1pZjFhdmlmbWlhZgAAANZtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAAA5waXRtAAAAAAABAAAAImlsb2MAAAAAREAAAQABAAAAAAD6AAEAAAAAAAAAGQAAACNpaW5mAAAAAAABAAAAFWluZmUCAAAAAAEAAGF2MDEAAAAAVmlwcnAAAAA4aXBjbwAAAAxhdjFDgSACAAAAABRpc3BlAAAAAAAAAAEAAAABAAAAEHBpeGkAAAAAAwgICAAAABZpcG1hAAAAAAAAAAEAAQOBAgMAAAAhbWRhdBIACgc4AAYQENBpMgwYAAooooQAALATS9g=";

let avifProbe: Promise<boolean> | null = null;

function probeAvif(): Promise<boolean> {
  avifProbe ??= new Promise<boolean>((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image.naturalWidth > 0);
    image.onerror = () => resolve(false);
    image.src = AVIF_PROBE;
  });
  return avifProbe;
}

export type SalonFilmSupport = "probing" | "film" | "still";

/**
 * Whether this browser scrubs the AVIF film. The rare browser without AVIF
 * gets the WebP poster frame instead of a second, heavier sequence.
 */
export function useSalonFilmSupport(): SalonFilmSupport {
  const [support, setSupport] = useState<SalonFilmSupport>("probing");
  useEffect(() => {
    let alive = true;
    void probeAvif().then((avif) => {
      if (alive) setSupport(avif ? "film" : "still");
    });
    return () => {
      alive = false;
    };
  }, []);
  return support;
}
