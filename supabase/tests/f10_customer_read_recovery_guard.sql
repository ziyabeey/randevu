begin;

insert into auth.users(id, email, raw_user_meta_data)
values (
  'da000000-0000-4000-8000-000000000001',
  'customer-read-guard-owner@example.invalid',
  '{"full_name":"Customer Read Guard Owner"}'::jsonb
)
on conflict(id) do nothing;

insert into public.businesses(id, name, slug, timezone, created_by)
values (
  'db000000-0000-4000-8000-000000000001',
  'Customer Read Guard Tenant',
  'customer-read-guard-tenant',
  'Europe/Istanbul',
  'da000000-0000-4000-8000-000000000001'
)
on conflict(id) do nothing;

insert into public.memberships(id, business_id, user_id, role, active)
values (
  'dc000000-0000-4000-8000-000000000001',
  'db000000-0000-4000-8000-000000000001',
  'da000000-0000-4000-8000-000000000001',
  'owner',
  true
)
on conflict(business_id, user_id) do update set role=excluded.role, active=excluded.active;

-- The repair must not remove the established authenticated Data API RPC grants.
do $$
begin
  if not has_function_privilege(
    'authenticated',
    'public.list_appointments_page(uuid,integer,timestamptz,uuid)',
    'EXECUTE'
  ) then
    raise exception 'authenticated lost list_appointments_page EXECUTE';
  end if;
  if not has_function_privilege(
    'authenticated',
    'public.get_calendar_appointments(uuid,date,integer,uuid)',
    'EXECUTE'
  ) then
    raise exception 'authenticated lost get_calendar_appointments EXECUTE';
  end if;
end
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'da000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"amr":[{"method":"recovery"}]}', true);

-- Recovery authority is not normal tenant authority, even through direct RPC.
do $$
begin
  begin
    perform * from public.list_appointments_page(
      'db000000-0000-4000-8000-000000000001', 26, null, null
    );
    raise exception 'recovery unexpectedly read list_appointments_page';
  exception when others then
    if sqlerrm = 'recovery unexpectedly read list_appointments_page' then raise; end if;
    if position('PASSWORD_UPDATE_REQUIRED' in sqlerrm) = 0 then raise; end if;
  end;

  begin
    perform * from public.get_calendar_appointments(
      'db000000-0000-4000-8000-000000000001',
      (now() at time zone 'Europe/Istanbul')::date,
      1,
      null
    );
    raise exception 'recovery unexpectedly read get_calendar_appointments';
  exception when others then
    if sqlerrm = 'recovery unexpectedly read get_calendar_appointments' then raise; end if;
    if position('PASSWORD_UPDATE_REQUIRED' in sqlerrm) = 0 then raise; end if;
  end;
end
$$;

-- A normal password session with an active Membership keeps both read surfaces.
select set_config('request.jwt.claims', '{"amr":[{"method":"password"}]}', true);

do $$
declare
  v_list_count integer;
  v_calendar_count integer;
begin
  select count(*) into v_list_count
  from public.list_appointments_page(
    'db000000-0000-4000-8000-000000000001', 26, null, null
  );

  select count(*) into v_calendar_count
  from public.get_calendar_appointments(
    'db000000-0000-4000-8000-000000000001',
    (now() at time zone 'Europe/Istanbul')::date,
    1,
    null
  );

  if v_list_count <> 0 then
    raise exception 'password member list_appointments_page expected empty result, got %', v_list_count;
  end if;
  if v_calendar_count <> 0 then
    raise exception 'password member get_calendar_appointments expected empty result, got %', v_calendar_count;
  end if;
end
$$;

reset role;
rollback;
