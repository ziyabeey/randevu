export const SNAPSHOT_LIMITS = {
  memberships: 100,
  services: 100,
  staff: 100,
  assignments: 5000,
} as const;

export function snapshotProbeLimit(limit: number) {
  return limit + 1;
}

export function snapshotOverflow<T>(rows: T[] | null | undefined, limit: number) {
  return (rows?.length ?? 0) > limit;
}
