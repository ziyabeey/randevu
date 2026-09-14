import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { MarketingHome } from "./MarketingHome";

const PREVIEW_ASSETS = [
  "/marketing/hero/randevu-hero-model.webp",
  "/marketing/transformation/randevu-transformation-poster.webp",
  "/marketing/transformation/randevu-transformation-master.mp4",
] as const;

type PreviewAssetStatus = "checking" | "ready" | "missing";

function PreviewDiagnostics() {
  const [status, setStatus] = useState<PreviewAssetStatus>("checking");
  const [missing, setMissing] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;

    const verifyAssets = async () => {
      const checks = await Promise.all(
        PREVIEW_ASSETS.map(async (asset) => {
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

      if (cancelled) {
        return;
      }

      const missingAssets = checks.filter((asset): asset is string => asset !== null);
      setMissing(missingAssets);
      setStatus(missingAssets.length === 0 ? "ready" : "missing");
    };

    void verifyAssets();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <aside className={`mkt-preview-diagnostics is-${status}`} aria-live="polite">
      <strong>Preview</strong>
      {status === "checking" ? <span>Assetler kontrol ediliyor…</span> : null}
      {status === "ready" ? <span>Motion assetleri hazır ✓</span> : null}
      {status === "missing" ? (
        <span>{missing.length} asset eksik. ZIP&apos;i repo köküne aç.</span>
      ) : null}
    </aside>
  );
}

const root = document.getElementById("root");

if (!root) {
  throw new Error("Marketing preview root not found.");
}

createRoot(root).render(
  <StrictMode>
    <MarketingHome />
    <PreviewDiagnostics />
  </StrictMode>,
);
