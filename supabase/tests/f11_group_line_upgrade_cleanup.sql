\ir f11_price_snapshot_concurrency.sql

drop function if exists public.f11_upgrade_v2_key(uuid,bigint,text);
drop table if exists public.f11_upgrade_expected;
