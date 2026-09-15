begin;

insert into auth.users(id,email,raw_user_meta_data)
values ('b9000000-0000-4000-8000-000000000001','f10-04-limits@example.invalid','{}'::jsonb)
on conflict (id) do nothing;
insert into public.businesses(id,name,slug,timezone,created_by)
values ('b9100000-0000-4000-8000-000000000001','F10 04 Limits','f10-04-limits','Europe/Istanbul','b9000000-0000-4000-8000-000000000001');
insert into public.memberships(id,business_id,user_id,role,active)
values ('b9200000-0000-4000-8000-000000000001','b9100000-0000-4000-8000-000000000001','b9000000-0000-4000-8000-000000000001','owner',true);
insert into public.services(id,business_id,name,duration_minutes,price_minor,currency,active)
values ('b9250000-0000-4000-8000-000000000001','b9100000-0000-4000-8000-000000000001','Limit Service',30,10000,'TRY',true);
insert into public.staff_profiles(id,business_id,name,active)
values ('b9300000-0000-4000-8000-000000000001','b9100000-0000-4000-8000-000000000001','Limit Staff',true);
insert into public.staff_services(business_id,staff_id,service_id,active)
values (
  'b9100000-0000-4000-8000-000000000001',
  'b9300000-0000-4000-8000-000000000001',
  'b9250000-0000-4000-8000-000000000001',
  true
);
insert into public.business_hours(id,business_id,weekday,starts_local,ends_local,active)
values ('b9350000-0000-4000-8000-000000000001','b9100000-0000-4000-8000-000000000001',2,'09:00','17:00',true);
insert into public.staff_hours(id,business_id,staff_id,weekday,starts_local,ends_local,active)
values (
  'b9360000-0000-4000-8000-000000000001',
  'b9100000-0000-4000-8000-000000000001',
  'b9300000-0000-4000-8000-000000000001',
  2,'09:00','17:00',true
);

-- Bounded catalog reads are an exposed authenticated RPC, so recovery AMR must
-- be rejected at the database boundary even when Worker routes are bypassed.
set local role authenticated;
select set_config('request.jwt.claim.sub','b9000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"recovery"}]}',true);
do $$
begin
  begin
    perform * from public.get_catalog_snapshot('b9100000-0000-4000-8000-000000000001');
    raise exception 'recovery unexpectedly read catalog snapshot';
  exception when others then
    if sqlerrm = 'recovery unexpectedly read catalog snapshot' then raise; end if;
    if position('PASSWORD_UPDATE_REQUIRED' in sqlerrm)=0 then raise; end if;
  end;
end
$$;
reset role;

-- Eight daily intervals is the direct-RPC ceiling as well as the Worker ceiling.
set local role authenticated;
select set_config('request.jwt.claim.sub','b9000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
do $$
declare
  v_nine jsonb := '[
    {"start":"00:00","end":"01:00"},{"start":"01:30","end":"02:30"},
    {"start":"03:00","end":"04:00"},{"start":"04:30","end":"05:30"},
    {"start":"06:00","end":"07:00"},{"start":"07:30","end":"08:30"},
    {"start":"09:00","end":"10:00"},{"start":"10:30","end":"11:30"},
    {"start":"12:00","end":"13:00"}
  ]'::jsonb;
begin
  begin
    perform * from public.replace_business_hours_guarded(
      'b9100000-0000-4000-8000-000000000001',1::smallint,v_nine,null
    );
    raise exception 'business-hours direct RPC accepted 9 intervals';
  exception when others then
    if sqlerrm = 'business-hours direct RPC accepted 9 intervals' then raise; end if;
    if position('INVALID_INTERVALS' in sqlerrm)=0 then raise; end if;
  end;
  begin
    perform * from public.replace_staff_hours_guarded(
      'b9100000-0000-4000-8000-000000000001','b9300000-0000-4000-8000-000000000001',1::smallint,v_nine,null
    );
    raise exception 'staff-hours direct RPC accepted 9 intervals';
  exception when others then
    if sqlerrm = 'staff-hours direct RPC accepted 9 intervals' then raise; end if;
    if position('INVALID_INTERVALS' in sqlerrm)=0 then raise; end if;
  end;
end
$$;

-- Existing records require optimistic proof even when the caller bypasses the
-- Worker and invokes the authenticated Data API RPC directly.
do $$
begin
  begin
    perform public.update_service_guarded(
      'b9100000-0000-4000-8000-000000000001',
      'b9250000-0000-4000-8000-000000000001',
      null,
      '{"priceMinor":11000}'::jsonb
    );
    raise exception 'service update accepted missing version';
  exception when others then
    if sqlerrm = 'service update accepted missing version' then raise; end if;
    if position('STALE_WRITE' in sqlerrm)=0 then raise; end if;
  end;

  begin
    perform public.update_staff_guarded(
      'b9100000-0000-4000-8000-000000000001',
      'b9300000-0000-4000-8000-000000000001',
      null,
      '{"name":"Changed Staff"}'::jsonb
    );
    raise exception 'staff update accepted missing version';
  exception when others then
    if sqlerrm = 'staff update accepted missing version' then raise; end if;
    if position('STALE_WRITE' in sqlerrm)=0 then raise; end if;
  end;

  begin
    perform public.set_staff_service_guarded(
      'b9100000-0000-4000-8000-000000000001',
      'b9300000-0000-4000-8000-000000000001',
      'b9250000-0000-4000-8000-000000000001',
      false,
      null
    );
    raise exception 'assignment update accepted missing version';
  exception when others then
    if sqlerrm = 'assignment update accepted missing version' then raise; end if;
    if position('STALE_WRITE' in sqlerrm)=0 then raise; end if;
  end;

  begin
    perform * from public.replace_business_hours_guarded(
      'b9100000-0000-4000-8000-000000000001',2::smallint,
      '[{"start":"10:00","end":"18:00"}]'::jsonb,null
    );
    raise exception 'business-hours update accepted missing snapshot';
  exception when others then
    if sqlerrm = 'business-hours update accepted missing snapshot' then raise; end if;
    if position('STALE_WRITE' in sqlerrm)=0 then raise; end if;
  end;

  begin
    perform * from public.replace_staff_hours_guarded(
      'b9100000-0000-4000-8000-000000000001',
      'b9300000-0000-4000-8000-000000000001',2::smallint,
      '[{"start":"10:00","end":"18:00"}]'::jsonb,null
    );
    raise exception 'staff-hours update accepted missing snapshot';
  exception when others then
    if sqlerrm = 'staff-hours update accepted missing snapshot' then raise; end if;
    if position('STALE_WRITE' in sqlerrm)=0 then raise; end if;
  end;

  -- An empty day has no stale state to protect, so first-time setup can keep the
  -- legacy null expected snapshot and remains compatible with F10-03.
  perform * from public.replace_business_hours_guarded(
    'b9100000-0000-4000-8000-000000000001',3::smallint,
    '[{"start":"09:00","end":"17:00"}]'::jsonb,null
  );
  if not exists (
    select 1 from public.business_hours
    where business_id='b9100000-0000-4000-8000-000000000001'
      and weekday=3 and starts_local='09:00' and ends_local='17:00'
  ) then
    raise exception 'first-time business-hours compatibility write failed';
  end if;
end
$$;
reset role;

-- Fill the active closure budget exactly to 100 without exercising the guarded
-- creator, then prove the 101st guarded write is rejected while delete remains open.
insert into public.availability_blocks(
  id,business_id,staff_id,starts_at,ends_at,reason,active
)
select gen_random_uuid(),'b9100000-0000-4000-8000-000000000001',null,
  timestamptz '2026-10-01 00:00:00+03' + (g || ' hours')::interval,
  timestamptz '2026-10-01 00:30:00+03' + (g || ' hours')::interval,
  'Cap ' || g,true
from generate_series(0,99) g;

set local role authenticated;
select set_config('request.jwt.claim.sub','b9000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
do $$
declare
  v_block uuid;
begin
  begin
    perform public.create_availability_block_local_guarded(
      'b9100000-0000-4000-8000-000000000001',null,'2026-10-10','12:00','13:00','Overflow'
    );
    raise exception 'availability block write cap not enforced';
  exception when others then
    if sqlerrm = 'availability block write cap not enforced' then raise; end if;
    if position('AVAILABILITY_BLOCKS_LIMIT_EXCEEDED' in sqlerrm)=0 then raise; end if;
  end;

  select id into v_block
  from public.availability_blocks
  where business_id='b9100000-0000-4000-8000-000000000001'
  limit 1;
  if not public.delete_availability_block_guarded(
    'b9100000-0000-4000-8000-000000000001',v_block
  ) then
    raise exception 'delete path did not remain available at block cap';
  end if;

  if (select count(*) from public.availability_blocks
      where business_id='b9100000-0000-4000-8000-000000000001' and active) <> 99 then
    raise exception 'block cap cleanup count mismatch';
  end if;
end
$$;
reset role;

rollback;