export const MARKETING_ORIGIN = "https://randevukolay.net";
export const PRIVATE_OPERATOR_APP_ORIGIN = "https://randevu.kepenk.ai";
export const PUBLIC_TENANT_ORIGIN_PATTERN = "https://{business-slug}.randevukolay.net";

export const LOCAL_PREVIEW_OPERATOR_PATH = "/app";
export const MARKETING_PREVIEW_PATH = "/marketing-preview.html";

export interface MarketingLocationLike {
  hostname: string;
  pathname: string;
}

const LOCAL_MARKETING_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function isLocalOrStandaloneMarketingPreview(location: MarketingLocationLike): boolean {
  return LOCAL_MARKETING_HOSTS.has(location.hostname)
    || location.pathname.endsWith(MARKETING_PREVIEW_PATH);
}

export function getOperatorAppHref(location?: MarketingLocationLike): string {
  const currentLocation = location
    ?? (typeof window === "undefined" ? null : window.location);

  if (currentLocation && isLocalOrStandaloneMarketingPreview(currentLocation)) {
    return LOCAL_PREVIEW_OPERATOR_PATH;
  }

  return `${PRIVATE_OPERATOR_APP_ORIGIN}/`;
}

export function getPublicTenantOrigin(businessSlug: string): string {
  const slug = businessSlug.trim().toLowerCase();
  const validSlug = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug);

  if (!validSlug) {
    throw new Error("Public tenant slug must be a valid lowercase DNS label.");
  }

  return `https://${slug}.randevukolay.net`;
}
