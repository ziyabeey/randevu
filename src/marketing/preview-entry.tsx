import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { MARKETING_PREVIEW_ASSETS } from "./assets";
import { MarketingHome } from "./MarketingHome";
import "./preview-reduced.css";
import { readMarketingPreviewMode } from "./previewModes";

const previewMode = readMarketingPreviewMode(window.location.search);

document.documentElement.dataset.mktRenderer = previewMode.renderer;
if (previewMode.reducedMotion) document.documentElement.dataset.mktReducedMotion = "true";
if (previewMode.debug) document.documentElement.dataset.mktDebug = "true";

type PreviewAssetStatus = "checking" | "ready" | "missing";

function PreviewDiagnostics() {
  const [status, setStatus] = useState<PreviewAssetStatus>("checking");
  const [missing, setMissing] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;

    const verifyAssets = async () => {
      const checks = await Promise.all(
        MARKETING_PREVIEW_ASSETS.map(async (asset) => {
          try {
            const response = await fetch(asset, { method: "HEAD", cache: "no-store" });
            const contentType = response.headers.get("content-type") ?? "";
            const expectedMedia = asset.endsWith(".mp4") ? "video/" : "image/";
            return response.ok && contentType.startsWith(expectedMedia) ? null : asset;
          } catch {
            return asset;
          }
        }),
      );

      if (cancelled) return;
      const missingAssets: string[] = checks.flatMap((asset) => (asset === null ? [] : [asset]));
      setMissing(missingAssets);
      setStatus(missingAssets.length === 0 ? "ready" : "missing");
    };

    void verifyAssets();
    return () => { cancelled = true; };
  }, []);

  return (
    <aside className={`mkt-preview-diagnostics is-${status}`} aria-live="polite">
      <strong>Preview</strong>
      <span>Renderer: {previewMode.renderer === "frames" ? "Frames A/B" : "Video"}</span>
      {previewMode.reducedMotion ? <span>Reduced motion</span> : null}
      {previewMode.debug ? <span>Debug</span> : null}
      {!previewMode.reducedMotion && status === "checking" ? <span>Assetler kontrol ediliyor…</span> : null}
      {!previewMode.reducedMotion && status === "ready" ? <span>Motion assetleri hazır ✓</span> : null}
      {!previewMode.reducedMotion && status === "missing" ? <span>{missing.length} asset eksik. ZIP&apos;i repo köküne aç.</span> : null}
    </aside>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Marketing preview root not found.");

createRoot(root).render(
  <StrictMode>
    <MarketingHome />
    {previewMode.clean ? null : <PreviewDiagnostics />}
  </StrictMode>,
);
