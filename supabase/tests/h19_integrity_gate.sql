\set ON_ERROR_STOP on

-- H19 Integrity Gate
--
-- Single canonical CI entry point for permanent H19 interaction regressions.
-- Scenario files remain independently readable evidence, but CI invokes H19
-- through this gate only. New permanent H19 scenarios should be registered
-- here rather than added as separate ci-postgres-plan.json steps.
--
-- Axis model:
--   D0 tenant / authorization
--   D1 atomicity / idempotency
--   D2 snapshot / policy
--   D3 staff / capacity
--   D4 time / boundary
--   D5 concurrency / version

\echo 'H19 Integrity Gate: D0xD1 tenant/idempotency'
\ir h19_d0_d1_tenant_idempotency.sql

\echo 'H19 Integrity Gate: D1xD5 idempotency/concurrency'
\ir h19_d1_d5_idempotency_concurrency.sql

\echo 'H19 Integrity Gate: D0xD4 tenant/time-boundary'
\ir h19_d0_d4_tenant_time_boundary.sql

\echo 'H19 Integrity Gate: D0xD5 tenant/concurrency lock isolation'
\ir h19_d0_d5_tenant_lock_isolation.sql

\echo 'H19 Integrity Gate: D4xD5 cross-day authority/version'
\ir h19_d4_d5_cross_day_authority.sql

do $$
begin
  raise notice 'H19 INTEGRITY GATE PASS: registered interaction invariants accepted';
end
$$;
