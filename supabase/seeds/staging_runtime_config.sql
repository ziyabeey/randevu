\set ON_ERROR_STOP on

-- Raw secrets must never be passed to this SQL file. Hash them before invoking psql.
begin;

insert into public.notification_dispatch_config(config_key, secret_hash, updated_at)
values ('default', :'dispatch_hash', now())
on conflict (config_key) do update
set secret_hash = excluded.secret_hash,
    updated_at = now();

insert into public.public_booking_abuse_config(config_key, gate_secret_hash, updated_at)
values ('default', :'gate_hash', now())
on conflict (config_key) do update
set gate_secret_hash = excluded.gate_secret_hash,
    updated_at = now();

commit;
