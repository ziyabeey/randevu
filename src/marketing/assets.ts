export const MARKETING_ASSETS = {
  heroModel: "/marketing/hero/randevu-hero-model.webp",
  transformationVideo: "/marketing/transformation/randevu-transformation-master.mp4",
  transformationMobileVideo: "/marketing/transformation/randevu-transformation-mobile.mp4",
  transformationPoster: "/marketing/transformation/randevu-transformation-poster.webp",
  transformationFinal: "/marketing/transformation/randevu-transformation-final.webp",
} as const;

/** Production renderer is the WebP sequence; the MP4 arm is optional, so the preview probe checks stills + sequence edges. */
export const MARKETING_PREVIEW_ASSETS = [
  MARKETING_ASSETS.heroModel,
  MARKETING_ASSETS.transformationPoster,
  MARKETING_ASSETS.transformationFinal,
  "/marketing/transformation/frames/desktop/frame-000.webp",
  "/marketing/transformation/frames/desktop/frame-120.webp",
  "/marketing/transformation/frames/mobile/frame-000.webp",
  "/marketing/transformation/frames/mobile/frame-120.webp",
] as const;
