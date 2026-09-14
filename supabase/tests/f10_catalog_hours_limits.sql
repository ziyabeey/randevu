begin;

insert into auth.users(id,email,raw_user_meta_data)
values ('b9000000-0000-4000-8000-000000000001','f10-04-limits@example.invalid','{}'::jsonb)
on conflict (id) do nothing;
insert into public.businesses(id,name,slug,timezone,created_by)
values ('b9100000-0000-4000-8000-000000000001','F10 04 Limits','f10-04-limits','Europe/Istanbul','b9000000-0000-4000-8000-000000000001');
insert into public.memberships(id,business_id,user_id,role,active)
values ('b9200000-0000-4000-8000-000000000001','b9100000-0000-4000-8000-000000000001','b9000000-0000-4000-8000-000000000001','owner',true);
insert into public.staff_profiles(id,business_id,name,active)
values ('b9300000-0000-4000-8000-000000000001','b9100000-0000-4000-8000-000000000001','Limit Staff',true);

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
      'b9100000-0000-4000-8000-000000000001',1,v_nine,null
    );
    raise exception 'business-hours direct RPC accepted 9 intervals';
  exception when others then
    if sqlerrm = 'business-hours direct RPC accepted 9 intervals' then raise; end if;
    if position('INVALID_INTERVALS' in sqlerrm)=0 then raise; end if;
  end;
  begin
    perform * from public.replace_staff_hours_guarded(
      'b9100000-0000-4000-8000-000000000001','b9300000-0000-4000-8000-000000000001',1,v_nine,null
    );
    raise exception 'staff-hours direct RPC accepted 9 intervals';
  exception when others then
    if sqlerrm = 'staff-hours direct RPC accepted 9 intervals' then raise; end if;
    if position('INVALID_INTERVALS' in sqlerrm)=0 then raise; end if;
  end;
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
