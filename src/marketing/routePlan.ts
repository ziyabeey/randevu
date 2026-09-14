export type MarketingRouteSurface = "invite" | "marketing" | "workspace" | "other";

export const MARKETING_HOME_PATH = "/";
export const WORKSPACE_HOME_PATH = "/app";

export interface MarketingRouteInput {
  path: string;
  hasPendingTeamInvite: boolean;
}

export function resolveMarketingRouteSurface({
  path,
  hasPendingTeamInvite,
}: MarketingRouteInput): MarketingRouteSurface {
  if (path === MARKETING_HOME_PATH) {
    return hasPendingTeamInvite ? "invite" : "marketing";
  }

  if (path === WORKSPACE_HOME_PATH || path === `${WORKSPACE_HOME_PATH}/`) {
    return "workspace";
  }

  return "other";
}
