export type MarketingPreviewRenderer = "video" | "frames";

export interface MarketingPreviewMode {
  clean: boolean;
  debug: boolean;
  reducedMotion: boolean;
  /** Explicit override from `?renderer=`; when absent the production policy in rendererPolicy.ts applies. */
  rendererExplicit: boolean;
  renderer: MarketingPreviewRenderer;
}

export function readMarketingPreviewMode(search: string): MarketingPreviewMode {
  const params = new URLSearchParams(search);
  return {
    clean: params.get("clean") === "1",
    debug: params.get("debug") === "1",
    reducedMotion: params.get("reduced") === "1",
    rendererExplicit: params.get("renderer") === "frames" || params.get("renderer") === "video",
    renderer: params.get("renderer") === "frames" ? "frames" : "video",
  };
}
