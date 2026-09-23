export type TransformationPhase = "reminder" | "friction" | "sweep" | "pricing";

export const TRANSFORMATION_VIDEO_DURATION = 5.041667;

export const TRANSFORMATION_VIDEO_TIMES = {
  standing: 0,
  cutStarts: 0.7,
  cameraDrops: 1.8,
  hairOnFloor: 2.7,
  sweepStarts: 3.35,
  seatedReveal: 4.15,
  end: TRANSFORMATION_VIDEO_DURATION,
} as const;

const toProgress = (time: number) => time / TRANSFORMATION_VIDEO_DURATION;

export const TRANSFORMATION_PHASES = {
  reminder: { start: 0, end: toProgress(TRANSFORMATION_VIDEO_TIMES.cameraDrops) },
  friction: {
    start: toProgress(TRANSFORMATION_VIDEO_TIMES.cameraDrops),
    end: toProgress(TRANSFORMATION_VIDEO_TIMES.sweepStarts),
  },
  sweep: {
    start: toProgress(TRANSFORMATION_VIDEO_TIMES.sweepStarts),
    end: toProgress(TRANSFORMATION_VIDEO_TIMES.seatedReveal),
  },
  pricing: { start: toProgress(TRANSFORMATION_VIDEO_TIMES.seatedReveal), end: 1 },
} as const;

/**
 * Copy/story beats live on raw scroll time instead of media time. Keeping the
 * clocks separate lets a strong frame pause while the typography keeps moving.
 */
export const TRANSFORMATION_SCROLL_PHASES = {
  reminder: { start: 0, end: 0.37 },
  friction: { start: 0.37, end: 0.64 },
  sweep: { start: 0.64, end: 0.82 },
  pricing: { start: 0.82, end: 1 },
} as const;

/**
 * Scroll pacing (product-owner note 2026-09-17: some beats slower, some faster).
 * Piecewise-linear map from normalized scroll to normalized video time:
 * the cut and the sweep get more scroll, the camera drop less, and the seated
 * pricing reveal keeps the last fifth of the scroll for its crossfade.
 */
export const TRANSFORMATION_SCROLL_KEYFRAMES: ReadonlyArray<readonly [scroll: number, time: number]> = [
  [0, 0],
  [0.10, toProgress(TRANSFORMATION_VIDEO_TIMES.cutStarts)],
  [0.30, toProgress(TRANSFORMATION_VIDEO_TIMES.cameraDrops)],
  [0.37, toProgress(TRANSFORMATION_VIDEO_TIMES.cameraDrops)],
  [0.48, toProgress(TRANSFORMATION_VIDEO_TIMES.hairOnFloor)],
  [0.56, toProgress(TRANSFORMATION_VIDEO_TIMES.hairOnFloor)],
  [0.64, toProgress(TRANSFORMATION_VIDEO_TIMES.sweepStarts)],
  [0.70, toProgress(TRANSFORMATION_VIDEO_TIMES.sweepStarts)],
  [0.82, toProgress(TRANSFORMATION_VIDEO_TIMES.seatedReveal)],
  [0.90, toProgress(TRANSFORMATION_VIDEO_TIMES.seatedReveal)],
  [0.97, 1],
  [1, 1],
];

export function easeTransformationScroll(scroll: number): number {
  const s = clamp01(scroll);
  let previousScroll = 0;
  let previousTime = 0;
  for (const [nextScroll, nextTime] of TRANSFORMATION_SCROLL_KEYFRAMES) {
    if (s <= nextScroll) {
      const span = Math.max(0.0001, nextScroll - previousScroll);
      return clamp01(previousTime + ((s - previousScroll) / span) * (nextTime - previousTime));
    }
    previousScroll = nextScroll;
    previousTime = nextTime;
  }
  return 1;
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function getTransformationScrollPhase(scroll: number): TransformationPhase {
  const normalized = clamp01(scroll);

  if (normalized < TRANSFORMATION_SCROLL_PHASES.reminder.end) {
    return "reminder";
  }

  if (normalized < TRANSFORMATION_SCROLL_PHASES.friction.end) {
    return "friction";
  }

  if (normalized < TRANSFORMATION_SCROLL_PHASES.sweep.end) {
    return "sweep";
  }

  return "pricing";
}

export function getTransformationScrollPhaseProgress(
  scroll: number,
  phase: TransformationPhase = getTransformationScrollPhase(scroll),
): number {
  const normalized = clamp01(scroll);
  const bounds = TRANSFORMATION_SCROLL_PHASES[phase];
  const span = Math.max(0.0001, bounds.end - bounds.start);

  return clamp01((normalized - bounds.start) / span);
}

export function getTransformationPhase(progress: number): TransformationPhase {
  const normalized = clamp01(progress);

  if (normalized < TRANSFORMATION_PHASES.reminder.end) {
    return "reminder";
  }

  if (normalized < TRANSFORMATION_PHASES.friction.end) {
    return "friction";
  }

  if (normalized < TRANSFORMATION_PHASES.sweep.end) {
    return "sweep";
  }

  return "pricing";
}

export function getTransformationPhaseProgress(
  progress: number,
  phase: TransformationPhase = getTransformationPhase(progress),
): number {
  const normalized = clamp01(progress);
  const bounds = TRANSFORMATION_PHASES[phase];
  const span = Math.max(0.0001, bounds.end - bounds.start);

  return clamp01((normalized - bounds.start) / span);
}
