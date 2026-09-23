\set ON_ERROR_STOP on

-- H19 Integrity Gate
--
-- Single canonical repo-level CI entry point for permanent H19 interaction regressions.
-- Scenario files remain independently readable evidence, but CI invokes H19
-- through this gate only. New permanent H19 scenarios should be registered
-- here rather than added as separate ci-postgres-plan.json steps.
--
\ir h19_test_support.sql

-- Axis model:
--   D0 tenant / authorization
--   D1 atomicity / idempotency
--   D2 snapshot / policy
--   D3 staff / capacity
--   D4 time / boundary
--   D5 concurrency / version


-- Canonical scenario manifest. Axis pairs may repeat across domains when the
-- same interaction geometry protects a distinct authority model.
select pg_temp.h19_expect('booking.d0d1.tenant_idempotency','booking','D0','D1');
select pg_temp.h19_expect('booking.d1d5.idempotency_concurrency','booking','D1','D5');
select pg_temp.h19_expect('booking.d0d4.tenant_time_boundary','booking','D0','D4');
select pg_temp.h19_expect('booking.d0d5.tenant_lock_isolation','booking','D0','D5');
select pg_temp.h19_expect('booking.d4d5.cross_day_authority','booking','D4','D5');
select pg_temp.h19_expect('booking.d0d3.tenant_capacity','booking','D0','D3');
select pg_temp.h19_expect('booking.d3d4.staff_hours_fallback','booking','D3','D4');
select pg_temp.h19_expect('inventory.d0d1.actor_idempotency','inventory','D0','D1');
select pg_temp.h19_expect('booking.d2d3.snapshot_staff_coherence','booking','D2','D3');

\echo 'H19 Integrity Gate: D0xD1 tenant/idempotency'
\ir h19_d0_d1_tenant_idempotency.sql
select pg_temp.h19_pass('booking.d0d1.tenant_idempotency');

\echo 'H19 Integrity Gate: D1xD5 idempotency/concurrency'
\ir h19_d1_d5_idempotency_concurrency.sql
select pg_temp.h19_pass('booking.d1d5.idempotency_concurrency');

\echo 'H19 Integrity Gate: D0xD4 tenant/time-boundary'
\ir h19_d0_d4_tenant_time_boundary.sql
select pg_temp.h19_pass('booking.d0d4.tenant_time_boundary');

\echo 'H19 Integrity Gate: D0xD5 tenant/concurrency lock isolation'
\ir h19_d0_d5_tenant_lock_isolation.sql
select pg_temp.h19_pass('booking.d0d5.tenant_lock_isolation');

\echo 'H19 Integrity Gate: D4xD5 cross-day authority/version'
\ir h19_d4_d5_cross_day_authority.sql
select pg_temp.h19_pass('booking.d4d5.cross_day_authority');

\echo 'H19 Integrity Gate: D0xD3 tenant/capacity isolation'
\ir h19_d0_d3_tenant_capacity.sql
select pg_temp.h19_pass('booking.d0d3.tenant_capacity');

\echo 'H19 Integrity Gate: D3xD4 staff-hours fallback'
\ir h19_d3_d4_staff_hours_fallback.sql
select pg_temp.h19_pass('booking.d3d4.staff_hours_fallback');

\echo 'H19 Integrity Gate: F15 D0xD1 actor/idempotency scope'
\ir h19_f15_d0_d1_actor_idempotency.sql
select pg_temp.h19_pass('inventory.d0d1.actor_idempotency');

\echo 'H19 Integrity Gate: D2xD3 snapshot/staff coherence'
\ir h19_d2_d3_snapshot_staff_coherence.sql
select pg_temp.h19_pass('booking.d2d3.snapshot_staff_coherence');

select pg_temp.h19_assert_complete(9);

do $h19done$
begin
  raise notice 'H19 INTEGRITY GATE PASS: 9/9 registered interaction invariants accepted';
end
$h19done$;
