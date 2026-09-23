begin;

insert into auth.users(id,email,raw_user_meta_data)
values
  ('f1800000-0000-4000-8000-000000000001','f1503-owner@example.invalid','{}'::jsonb),
  ('f1800000-0000-4000-8000-000000000002','f1503-staff@example.invalid','{}'::jsonb),
  ('f1800000-0000-4000-8000-000000000003','f1503-owner-b@example.invalid','{}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values
  ('f1810000-0000-4000-8000-000000000001','F15-03 Salon A','f1503-salon-a','Europe/Istanbul','f1800000-0000-4000-8000-000000000001'),
  ('f1810000-0000-4000-8000-000000000002','F15-03 Salon B','f1503-salon-b','Europe/Istanbul','f1800000-0000-4000-8000-000000000003');

insert into public.memberships(id,business_id,user_id,role,active)
values
  ('f1820000-0000-4000-8000-000000000001','f1810000-0000-4000-8000-000000000001','f1800000-0000-4000-8000-000000000001','owner',true),
  ('f1820000-0000-4000-8000-000000000002','f1810000-0000-4000-8000-000000000001','f1800000-0000-4000-8000-000000000002','staff',true),
  ('f1820000-0000-4000-8000-000000000003','f1810000-0000-4000-8000-000000000002','f1800000-0000-4000-8000-000000000003','owner',true);

do $acl$
begin
  if has_table_privilege('authenticated','public.expense_events','SELECT')
     or has_table_privilege('authenticated','public.expense_events','UPDATE')
     or has_table_privilege('authenticated','public.expense_events','DELETE')
     or has_table_privilege('authenticated','public.expense_commands','SELECT')
     or has_table_privilege('anon','public.expense_events','SELECT') then
    raise exception 'F15-03 expense tables unexpectedly exposed';
  end if;
  if not has_function_privilege('authenticated','public.create_expense_guarded(uuid,text,text,integer,text,text,timestamp without time zone,text,text)','EXECUTE')
     or has_function_privilege('anon','public.create_expense_guarded(uuid,text,text,integer,text,text,timestamp without time zone,text,text)','EXECUTE') then
    raise exception 'F15-03 RPC grants wrong';
  end if;
end
$acl$;

set local role authenticated;
select set_config('request.jwt.claim.sub','f1800000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);

do $create$
declare
  v_event jsonb;
  v_replay jsonb;
  v_id uuid;
  v_conflict boolean:=false;
begin
  v_event:=public.create_expense_guarded(
    'f1810000-0000-4000-8000-000000000001',
    'Malzeme','Eldiven',15000,'TRY','cash','2026-09-23 10:00:00',
    'f1503-create-0001',repeat('a',64)
  );
  v_id:=(v_event->>'eventId')::uuid;
  perform set_config('f1503.expense_id',v_id::text,false);

  if v_event->>'eventType'<>'expense'
     or (v_event->>'effectMinor')::int<>15000
     or v_event->>'paymentMethod'<>'cash'
     or v_event->>'businessDate'<>'2026-09-23'
     or v_event->>'timezone'<>'Europe/Istanbul' then
    raise exception 'F15-03 expense projection wrong: %',v_event;
  end if;

  v_replay:=public.create_expense_guarded(
    'f1810000-0000-4000-8000-000000000001',
    'Malzeme','Eldiven',15000,'TRY','cash','2026-09-23 10:00:00',
    'f1503-create-0001',repeat('a',64)
  );
  if v_replay<>v_event then raise exception 'F15-03 same-key replay changed result'; end if;

  begin
    perform public.create_expense_guarded(
      'f1810000-0000-4000-8000-000000000001',
      'Malzeme','Eldiven',16000,'TRY','cash','2026-09-23 10:00:00',
      'f1503-create-0001',repeat('b',64)
    );
  exception when others then
    if position('IDEMPOTENCY_CONFLICT' in sqlerrm)>0 then v_conflict:=true; else raise; end if;
  end;
  if not v_conflict then raise exception 'F15-03 same key accepted different payload'; end if;
end
$create$;

reset role;

do $immutable$
declare
  v_update boolean:=false;
  v_delete boolean:=false;
begin
  begin
    update public.expense_events set amount_minor=1
    where id=current_setting('f1503.expense_id')::uuid;
  exception when others then
    if position('EXPENSE_EVENT_IMMUTABLE' in sqlerrm)>0 then v_update:=true; else raise; end if;
  end;
  if not v_update then raise exception 'F15-03 expense UPDATE allowed'; end if;

  begin
    delete from public.expense_events
    where id=current_setting('f1503.expense_id')::uuid;
  exception when others then
    if position('EXPENSE_EVENT_IMMUTABLE' in sqlerrm)>0 then v_delete:=true; else raise; end if;
  end;
  if not v_delete then raise exception 'F15-03 expense DELETE allowed'; end if;
end
$immutable$;

do $command_immutable$
declare
  v_update boolean:=false;
  v_delete boolean:=false;
begin
  begin
    update public.expense_commands
    set request_hash=repeat('9',64)
    where business_id='f1810000-0000-4000-8000-000000000001'
      and actor_membership_id='f1820000-0000-4000-8000-000000000001'
      and command='create_expense'
      and idempotency_key='f1503-create-0001';
  exception when others then
    if position('EXPENSE_COMMAND_IMMUTABLE' in sqlerrm)>0 then v_update:=true; else raise; end if;
  end;
  if not v_update then raise exception 'F15-03 finalized expense command UPDATE allowed'; end if;

  begin
    delete from public.expense_commands
    where business_id='f1810000-0000-4000-8000-000000000001'
      and actor_membership_id='f1820000-0000-4000-8000-000000000001'
      and command='create_expense'
      and idempotency_key='f1503-create-0001';
  exception when others then
    if position('EXPENSE_COMMAND_IMMUTABLE' in sqlerrm)>0 then v_delete:=true; else raise; end if;
  end;
  if not v_delete then raise exception 'F15-03 finalized expense command DELETE allowed'; end if;
end
$command_immutable$;

-- Staff default deny.
set local role authenticated;
select set_config('request.jwt.claim.sub','f1800000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);

do $staff_denied$
declare v_denied boolean:=false;
begin
  begin
    perform public.create_expense_guarded(
      'f1810000-0000-4000-8000-000000000001',
      'Diğer',null,1000,'TRY','card','2026-09-23 10:30:00',
      'f1503-staff-denied',repeat('c',64)
    );
  exception when others then
    if position('EXPENSES_PERMISSION_REQUIRED' in sqlerrm)>0 then v_denied:=true; else raise; end if;
  end;
  if not v_denied then raise exception 'F15-03 staff wrote expense without permission'; end if;
end
$staff_denied$;

do $staff_read_denied$
declare v_denied boolean:=false;
begin
  begin
    perform * from public.list_expense_events_page(
      'f1810000-0000-4000-8000-000000000001',
      25,null,null
    );
  exception when others then
    if position('FINANCIAL_REPORTS_PERMISSION_REQUIRED' in sqlerrm)>0 then v_denied:=true; else raise; end if;
  end;
  if not v_denied then raise exception 'F15-03 staff read expenses without financial_reports_read'; end if;
end
$staff_read_denied$;

reset role;

insert into public.membership_financial_permissions(
  business_id,membership_id,permission,active,granted_by_membership_id
) values
(
  'f1810000-0000-4000-8000-000000000001',
  'f1820000-0000-4000-8000-000000000002',
  'expenses_write',
  true,
  'f1820000-0000-4000-8000-000000000001'
),
(
  'f1810000-0000-4000-8000-000000000001',
  'f1820000-0000-4000-8000-000000000002',
  'financial_reports_read',
  true,
  'f1820000-0000-4000-8000-000000000001'
);

set local role authenticated;
select set_config('request.jwt.claim.sub','f1800000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);

do $staff_allowed$
declare
  v_event jsonb;
  v_read_count integer;
begin
  select count(*)::integer into v_read_count
  from public.list_expense_events_page(
    'f1810000-0000-4000-8000-000000000001',
    25,null,null
  );
  if v_read_count < 1 then raise exception 'F15-03 granted staff could not read expense ledger'; end if;

  v_event:=public.create_expense_guarded(
    'f1810000-0000-4000-8000-000000000001',
    'Temizlik',null,2000,'TRY','card','2026-09-23 10:40:00',
    'f1503-staff-allowed',repeat('d',64)
  );
  if v_event->>'actorMembershipId'<>'f1820000-0000-4000-8000-000000000002' then
    raise exception 'F15-03 actor evidence wrong';
  end if;
end
$staff_allowed$;

-- Revoke permission and prove next write fails.
reset role;
update public.membership_financial_permissions
set active=false,
    revoked_by_membership_id='f1820000-0000-4000-8000-000000000001',
    revoked_at=now()
where business_id='f1810000-0000-4000-8000-000000000001'
  and membership_id='f1820000-0000-4000-8000-000000000002'
  and permission='expenses_write';

set local role authenticated;
select set_config('request.jwt.claim.sub','f1800000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);

do $staff_revoked$
declare v_denied boolean:=false;
begin
  begin
    perform public.create_expense_guarded(
      'f1810000-0000-4000-8000-000000000001',
      'Diğer',null,1000,'TRY','cash','2026-09-23 10:50:00',
      'f1503-staff-revoked',repeat('e',64)
    );
  exception when others then
    if position('EXPENSES_PERMISSION_REQUIRED' in sqlerrm)>0 then v_denied:=true; else raise; end if;
  end;
  if not v_denied then raise exception 'F15-03 revoked staff still wrote expense'; end if;
end
$staff_revoked$;

reset role;

-- Real foreign-tenant event.
set local role authenticated;
select set_config('request.jwt.claim.sub','f1800000-0000-4000-8000-000000000003',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
do $business_b$
declare v_event jsonb;
begin
  v_event:=public.create_expense_guarded(
    'f1810000-0000-4000-8000-000000000002',
    'Kira',null,50000,'TRY','card','2026-09-23 09:00:00',
    'f1503-business-b',repeat('f',64)
  );
  perform set_config('f1503.business_b_event',v_event->>'eventId',false);
end
$business_b$;

reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','f1800000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);

do $cross$
declare v_missing boolean:=false;
begin
  begin
    perform public.reverse_expense_guarded(
      'f1810000-0000-4000-8000-000000000001',
      current_setting('f1503.business_b_event')::uuid,
      'Yanlış tenant','2026-09-23 11:00:00',
      'f1503-cross',repeat('1',64)
    );
  exception when others then
    if position('EXPENSE_NOT_FOUND' in sqlerrm)>0 then v_missing:=true; else raise; end if;
  end;
  if not v_missing then raise exception 'F15-03 foreign expense did not fail closed'; end if;
end
$cross$;

do $correct$
declare
  v_result jsonb;
  v_reversal jsonb;
  v_replacement jsonb;
begin
  v_result:=public.correct_expense_guarded(
    'f1810000-0000-4000-8000-000000000001',
    current_setting('f1503.expense_id')::uuid,
    'Tutar düzeltmesi',
    'Malzeme','Eldiven',12000,'TRY','card',
    '2026-09-23 10:00:00','2026-09-23 11:05:00',
    'f1503-correct-0001',repeat('2',64)
  );
  v_reversal:=v_result->'reversal';
  v_replacement:=v_result->'replacement';

  if (v_reversal->>'eventType')<>'reversal'
     or (v_reversal->>'effectMinor')::int<>-15000
     or (v_replacement->>'eventType')<>'expense'
     or (v_replacement->>'effectMinor')::int<>12000
     or v_replacement->>'paymentMethod'<>'card' then
    raise exception 'F15-03 correction projection wrong: %',v_result;
  end if;

  if (
    select count(*) from public.expense_events e
    where e.business_id='f1810000-0000-4000-8000-000000000001'
      and e.source_expense_event_id=current_setting('f1503.expense_id')::uuid
      and e.event_type='reversal'
  )<>1 then
    raise exception 'F15-03 correction did not create exactly one reversal';
  end if;
end
$correct$;

do $double_reverse$
declare v_blocked boolean:=false;
begin
  begin
    perform public.reverse_expense_guarded(
      'f1810000-0000-4000-8000-000000000001',
      current_setting('f1503.expense_id')::uuid,
      'İkinci reversal','2026-09-23 11:10:00',
      'f1503-double-reverse',repeat('3',64)
    );
  exception when others then
    if position('EXPENSE_ALREADY_REVERSED' in sqlerrm)>0 then v_blocked:=true; else raise; end if;
  end;
  if not v_blocked then raise exception 'F15-03 second reversal was accepted'; end if;
end
$double_reverse$;

rollback;
