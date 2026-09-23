export type TransformationRenderer = "video" | "frames";

/**
 * Product-owner decision (2026-09-17, MKT-01): the transformation stage ships
 * as an Apple-style WebP scroll sequence drawn on one canvas. The MP4 scrub
 * stays an explicit A/B arm (`?renderer=video`) until a scrub-friendly encode
 * is delivered; it is no longer the production default.
 */
export const TRANSFORMATION_PRODUCTION_RENDERER: TransformationRenderer = "frames";

/** An explicit override ("video" | "frames") wins; anything else resolves to the production renderer. */
export function resolveTransformationRenderer(requested: string | undefined | null): TransformationRenderer {
  if (requested === "video" || requested === "frames") return requested;
  return TRANSFORMATION_PRODUCTION_RENDERER;
}
