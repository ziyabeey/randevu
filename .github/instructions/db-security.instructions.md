---
applyTo: "supabase/**/*.sql,worker/**/*.ts"
---

# DB, security and concurrency invariants

Use the task's accepted contracts and
[R1 review procedure](../skills/r1-db-security-review/SKILL.md).
These file-scoped instructions do not assign the reader the R1 role.

- Business is the tenant root. Client IDs/cookies do not grant authority:
  validate Auth, active Membership, RLS and cross-tenant fail-closed behavior.
- Inspect every executable surface, not just table grants: SECURITY DEFINER,
  pinned `search_path`, EXECUTE grants, views/RPCs and recovery-session boundaries.
  Never add a service-role key to the Worker.
- Keep accepted migrations immutable; use only an assigned forward migration,
  with clean/historical-upgrade proof and explicit grants/RLS.
- Inspect row/advisory lock ordering and FK KEY SHARE interaction. A weaker
  lock mode is not a repair without preserved authority and real concurrency proof.
- Prove CAS/stale-write fences, idempotency and changed-intent rejection,
  atomicity, zero half-state/orphans, snapshot/audit and provider evidence.
- Use real timestamptz instants and business IANA timezone. PostgreSQL exclusion
  constraints including buffers remain the final staff-conflict guard.
- Money is server-computed; closed financial history cannot be silently mutated.
  Estimates are not definitive charges.

No silent weakening of accepted invariants. A green test summary alone is not
independent DB/security acceptance or proof of an exact failure cause.
