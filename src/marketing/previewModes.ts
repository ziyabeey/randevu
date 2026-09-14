export type MarketingPreviewRenderer = "video" | "frames";

export interface MarketingPreviewMode {
  clean: boolean;
  debug: boolean;
  reducedMotion: boolean;
  renderer: MarketingPreviewRenderer;
}

export function readMarketingPreviewMode(search: string): MarketingPreviewMode {
  const params = new URLSearchParams(search);
  return {
    clean: params.get("clean") === "1",
    debug: params.get("debug") === "1",
    reducedMotion: params.get("reduced") === "1",
    renderer: params.get("renderer") === "frames" ? "frames" : "video",
  };
}
