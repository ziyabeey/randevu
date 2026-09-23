begin;

insert into auth.users(id,email,raw_user_meta_data) values
  ('e4510000-0000-4000-8000-000000000001','h19-team-owner-a@example.invalid','{}'::jsonb),
  ('e4510000-0000-4000-8000-000000000002','h19-team-target@example.invalid','{}'::jsonb);

insert into public.businesses(id,name,slug,timezone,created_by) values
  ('e4511000-0000-4000-8000-000000000001','H19 Team A','h19-team-a','Europe/Istanbul','e4510000-0000-4000-8000-000000000001'),
  ('e4511000-0000-4000-8000-000000000002','H19 Team B','h19-team-b','Europe/Istanbul','e4510000-0000-4000-8000-000000000002');

insert into public.memberships(id,business_id,user_id,role,active) values
  ('e4512000-0000-4000-8000-000000000001','e4511000-0000-4000-8000-000000000001','e4510000-0000-4000-8000-000000000001','owner',true),
  ('e4512000-0000-4000-8000-000000000002','e4511000-0000-4000-8000-000000000002','e4510000-0000-4000-8000-000000000002','owner',true);

insert into public.business_invitations(
  id,business_id,email_normalized,role,token_hash,invited_by_membership_id,expires_at
) values (
  'e4513000-0000-4000-8000-000000000001',
  'e4511000-0000-4000-8000-000000000001',
  'h19-team-target@example.invalid',
  'staff',
  repeat('a',64),
  'e4512000-0000-4000-8000-000000000001',
  now() + interval '1 hour'
);

select set_config('request.jwt.claim.sub','e4510000-0000-4000-8000-000000000002',true);

do $h19$
declare
  v_accept record;
begin
  select * into v_accept
  from public.accept_business_invitation(repeat('a',64));

  if v_accept.business_id <> 'e4511000-0000-4000-8000-000000000001'::uuid then
    raise exception 'H19 team D0xD1 accepted invitation under wrong tenant: %', v_accept.business_id;
  end if;

  if not exists (
    select 1 from public.memberships
    where business_id='e4511000-0000-4000-8000-000000000001'
      and user_id='e4510000-0000-4000-8000-000000000002'
      and active
  ) then
    raise exception 'H19 team D0xD1 valid tenant-A invitation did not create tenant-A membership';
  end if;

  if not exists (
    select 1 from public.memberships
    where business_id='e4511000-0000-4000-8000-000000000002'
      and user_id='e4510000-0000-4000-8000-000000000002'
      and active
      and role='owner'
  ) then
    raise exception 'H19 team D0xD1 tenant-B membership changed during tenant-A invitation acceptance';
  end if;

  raise notice 'H19 team D0xD1 prospective invariant accepted: membership existence remains tenant-scoped during invite acceptance';
end
$h19$;

rollback;
