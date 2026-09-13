-- Real existing verifier rows must remain byte-identical through S05 migration.
insert into public.public_booking_abuse_config(config_key,gate_secret_hash)
values ('default',encode(digest(repeat('old-gate-',8),'sha256'),'hex'))
on conflict(config_key) do update set gate_secret_hash=excluded.gate_secret_hash;
insert into public.notification_dispatch_config(config_key,secret_hash)
values ('default',encode(digest(repeat('old-dispatch-',6),'sha256'),'hex'))
on conflict(config_key) do update set secret_hash=excluded.secret_hash;
-- Mirror hosted service-role defaults as well as anon/authenticated defaults.
do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
alter default privileges for role postgres in schema public grant execute on functions to service_role;
alter default privileges for role postgres in schema public grant all on tables to service_role;
