-- H19 permanent interaction scenario: D0 x D3 (tenant isolation x staff/capacity).
-- Preserved from the clean-control holdout probe that passed CI #2213.

begin;

insert into auth.users(id,email,raw_user_meta_data)
values ('b3900000-0000-4000-8000-000000000001','h19-d0d3-owner@example.invalid','{}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values
  ('b3910000-0000-4000-8000-000000000001','H19 D0D3 Tenant A','h19-d0d3-a','Europe/Istanbul','b3900000-0000-4000-8000-000000000001'),
  ('b3910000-0000-4000-8000-000000000002','H19 D0D3 Tenant B','h19-d0d3-b','Europe/Istanbul','b3900000-0000-4000-8000-000000000001');

insert into public.memberships(id,business_id,user_id,role,active)
values ('b3920000-0000-4000-8000-000000000001','b3910000-0000-4000-8000-000000000001','b3900000-0000-4000-8000-000000000001','owner',true);

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  category,sort_order,price_minor,price_type,price_min_minor,price_max_minor,currency,active
) values (
  'b3930000-0000-4000-8000-000000000001','b3910000-0000-4000-8000-000000000001',
  'H19 D0D3 Service',30,0,0,'H19',10,10000,'fixed',10000,10000,'TRY',true
);

insert into public.staff_profiles(id,business_id,name,active)
values (
  'b3940000-0000-4000-8000-000000000001','b3910000-0000-4000-8000-000000000001',
  'H19 D0D3 Staff',true
);

insert into public.staff_services(business_id,staff_id,service_id,active)
values (
  'b3910000-0000-4000-8000-000000000001',
  'b3940000-0000-4000-8000-000000000001',
  'b3930000-0000-4000-8000-000000000001',true
);

insert into public.business_hours(business_id,weekday,starts_local,ends_local,active)
select
  'b3910000-0000-4000-8000-000000000001',
  extract(dow from (date_trunc('week',current_date)::date+7))::smallint,
  time '09:00',time '18:00',true;

insert into public.staff_hours(business_id,staff_id,weekday,starts_local,ends_local,active)
select
  'b3910000-0000-4000-8000-000000000001',
  'b3940000-0000-4000-8000-000000000001',
  extract(dow from (date_trunc('week',current_date)::date+7))::smallint,
  time '09:00',time '18:00',true;

-- The only closure at 10:00 belongs to Tenant B and is tenant-wide there.
-- It must not reduce Tenant A's staff capacity.
insert into public.availability_blocks(
  id,business_id,staff_id,starts_at,ends_at,reason,active
)
values (
  'b3950000-0000-4000-8000-000000000001',
  'b3910000-0000-4000-8000-000000000002',
  null,
  ((date_trunc('week',current_date)::date+7)+time '10:00') at time zone 'Europe/Istanbul',
  ((date_trunc('week',current_date)::date+7)+time '11:00') at time zone 'Europe/Istanbul',
  'foreign tenant capacity closure',
  true
);

set local role authenticated;
select set_config('request.jwt.claim.sub','b3900000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);

do $$
declare
  v_day date:=date_trunc('week',current_date)::date+7;
  v_result jsonb;
begin
  v_result:=public.create_appointment_group(
    'b3910000-0000-4000-8000-000000000001',
    'h19-d0d3-create-0001',
    'D0D3 Customer',
    '[{"serviceId":"b3930000-0000-4000-8000-000000000001","staffId":"b3940000-0000-4000-8000-000000000001"}]'::jsonb,
    (v_day+time '10:00') at time zone 'Europe/Istanbul',
    '05550000001'
  );

  if v_result->>'groupId' is null
     or v_result#>>'{lines,0,staffId}' is distinct from 'b3940000-0000-4000-8000-000000000001' then
    raise exception 'H19 D0xD3 tenant-capacity isolation returned an invalid group';
  end if;

  raise notice 'H19 D0xD3 holdout invariant accepted: foreign tenant-wide closure does not reduce local capacity';
exception when others then
  if position('GROUP_SLOT_UNAVAILABLE' in sqlerrm)>0
     or position('SLOT_UNAVAILABLE' in sqlerrm)>0 then
    raise exception 'H19 D0xD3 tenant-capacity scope mismatch: foreign tenant closure changed local availability';
  end if;
  raise;
end
$$;

reset role;
rollback;
