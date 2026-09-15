import {
  MARKETING_ORIGIN,
  PRIVATE_OPERATOR_APP_ORIGIN,
  PUBLIC_TENANT_ORIGIN_PATTERN,
  getOperatorAppHref,
  getPublicTenantOrigin,
} from "./domainContract.ts";

export type MarketingRouteSurface = "marketing" | "private-app" | "other";

export const MARKETING_HOME_PATH = "/";
export const PRIVATE_APP_HOME_PATH = "/";

/**
 * Compatibility export for the isolated marketing UI. In production this is
 * an absolute private-app URL; localhost and standalone preview keep `/app`
 * so the pre-cutover browser harness stays self-contained.
 */
export const WORKSPACE_HOME_PATH = getOperatorAppHref();

export {
  MARKETING_ORIGIN,
  PRIVATE_OPERATOR_APP_ORIGIN,
  PUBLIC_TENANT_ORIGIN_PATTERN,
  getOperatorAppHref,
  getPublicTenantOrigin,
};

export interface MarketingRouteInput {
  origin: string;
  path: string;
}

export function resolveMarketingRouteSurface({
  origin,
  path,
}: MarketingRouteInput): MarketingRouteSurface {
  if (origin === MARKETING_ORIGIN && path === MARKETING_HOME_PATH) {
    return "marketing";
  }

  if (origin === PRIVATE_OPERATOR_APP_ORIGIN) {
    return "private-app";
  }

  return "other";
}
