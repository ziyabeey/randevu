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
-- Each permanent scenario also carries its selection origin plus frozen three-arm evidence:
-- origin is prospective, coverage-first, or holdout; evidence is baseline/current-suite PASS,
-- prospective-probe FAIL, clean-control PASS.
select pg_temp.h19_expect('booking.d0d1.tenant_idempotency','booking','D0','D1','prospective',2131,2135,2136);
select pg_temp.h19_expect('booking.d1d5.idempotency_concurrency','booking','D1','D5','prospective',2197,2200,2202);
select pg_temp.h19_expect('booking.d0d4.tenant_time_boundary','booking','D0','D4','prospective',2152,2174,2175);
select pg_temp.h19_expect('booking.d0d5.tenant_lock_isolation','booking','D0','D5','prospective',2177,2181,2249);
select pg_temp.h19_expect('booking.d4d5.cross_day_authority','booking','D4','D5','prospective',2216,2232,2233);
select pg_temp.h19_expect('booking.d0d3.tenant_capacity','booking','D0','D3','holdout',2207,2212,2213);
select pg_temp.h19_expect('booking.d3d4.staff_hours_fallback','booking','D3','D4','prospective',2162,2164,2285);
select pg_temp.h19_expect('inventory.d0d1.actor_idempotency','inventory','D0','D1','prospective',2283,2287,2288);
select pg_temp.h19_expect('inventory.d1d5.idempotency_concurrency','inventory','D1','D5','prospective',2355,2359,2360);
select pg_temp.h19_expect('booking.d2d3.snapshot_staff_coherence','booking','D2','D3','prospective',2106,2107,2098);
select pg_temp.h19_expect('payments.d1d2.replay_snapshot','payments','D1','D2','prospective',2386,2389,2390);
-- HOLDOUT CONTROL: D2xD5 is a frozen antipodal pair; keep regression evidence but exclude it from H19 geometry-selection scoring.
select pg_temp.h19_expect('payments.d2d5.snapshot_concurrency','payments','D2','D5','holdout',2436,2441,2444);
select pg_temp.h19_expect('team.d0d1.invite_scope','team','D0','D1','prospective',2513,2518,2519);
select pg_temp.h19_expect('catalog.d0d2.history_scope','catalog','D0','D2','prospective',2544,2551,2552);
select pg_temp.h19_expect('public-booking.d0d4.slot_scope','public-booking','D0','D4','prospective',2557,2582,2583);
select pg_temp.h19_expect('calendar.d4d5.range_revision','calendar','D4','D5','prospective',2597,2609,2610);
select pg_temp.h19_expect('customers.d1d5.version_serialization','customers','D1','D5','prospective',2620,2624,2625);
select pg_temp.h19_expect('customers.d0d5.tenant_serialization','customers','D0','D5','coverage-first',2626,2627,2628);
select pg_temp.h19_expect('product-sales.d0d2.snapshot_scope','product-sales','D0','D2','coverage-first',2630,2631,2632);
select pg_temp.h19_expect('expenses.d1d2.replay_snapshot','expenses','D1','D2','prospective',2633,2635,2636);
select pg_temp.h19_expect('reporting.d2d4.snapshot_day','reporting','D2','D4','coverage-first',2642,2646,2647);

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

\echo 'H19 Integrity Gate: F15 D1xD5 idempotency/concurrency replay'
\ir h19_inventory_d1_d5_idempotency_concurrency.sql
select pg_temp.h19_pass('inventory.d1d5.idempotency_concurrency');

\echo 'H19 Integrity Gate: D2xD3 snapshot/staff coherence'
\ir h19_d2_d3_snapshot_staff_coherence.sql
select pg_temp.h19_pass('booking.d2d3.snapshot_staff_coherence');

\echo 'H19 Integrity Gate: F14 D1xD2 replay snapshot'
\ir h19_f14_d1_d2_replay_snapshot.sql
select pg_temp.h19_pass('payments.d1d2.replay_snapshot');

\echo 'H19 Integrity Gate: F14 D2xD5 snapshot concurrency'
\ir h19_f14_d2_d5_snapshot_concurrency.sql
select pg_temp.h19_pass('payments.d2d5.snapshot_concurrency');

\echo 'H19 Integrity Gate: F10 team D0xD1 invite scope'
\ir h19_team_d0_d1_invite_scope.sql
select pg_temp.h19_pass('team.d0d1.invite_scope');

\echo 'H19 Integrity Gate: F10/F12 catalog D0xD2 history scope'
\ir h19_catalog_d0_d2_history_scope.sql
select pg_temp.h19_pass('catalog.d0d2.history_scope');

\echo 'H19 Integrity Gate: F12 public-booking D0xD4 slot authority'
\ir h19_public_booking_d0_d4_slot_scope.sql
select pg_temp.h19_pass('public-booking.d0d4.slot_scope');

\echo 'H19 Integrity Gate: F13 calendar D4xD5 range/revision coherence'
\ir h19_calendar_d4_d5_range_revision.sql
select pg_temp.h19_pass('calendar.d4d5.range_revision');

\echo 'H19 Integrity Gate: customers D1xD5 version/serialization'
\ir h19_customers_d1_d5_version_serialization.sql
select pg_temp.h19_pass('customers.d1d5.version_serialization');

\echo 'H19 Integrity Gate: customers D0xD5 tenant serialization isolation'
\ir h19_customers_d0_d5_tenant_serialization.sql
select pg_temp.h19_pass('customers.d0d5.tenant_serialization');

\echo 'H19 Integrity Gate: product-sales D0xD2 immutable snapshot scope'
\ir h19_product_sales_d0_d2_snapshot_scope.sql
select pg_temp.h19_pass('product-sales.d0d2.snapshot_scope');

\echo 'H19 Integrity Gate: expenses D1xD2 replay snapshot'
\ir h19_expenses_d1_d2_replay_snapshot.sql
select pg_temp.h19_pass('expenses.d1d2.replay_snapshot');

\echo 'H19 Integrity Gate: reporting D2xD4 snapshot/local-day coherence'
\ir h19_reporting_d2_d4_snapshot_day.sql
select pg_temp.h19_pass('reporting.d2d4.snapshot_day');

select pg_temp.h19_assert_complete(21);

do $h19done$
begin
  raise notice 'H19 INTEGRITY GATE PASS: 21/21 registered interaction invariants accepted';
end
$h19done$;
