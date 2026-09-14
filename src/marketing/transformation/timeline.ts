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

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
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
