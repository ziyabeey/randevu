begin;

insert into auth.users(id,email,raw_user_meta_data)
values
  ('f1a00000-0000-4000-8000-000000000001','f1504-owner@example.invalid','{}'::jsonb),
  ('f1a00000-0000-4000-8000-000000000002','f1504-staff@example.invalid','{}'::jsonb),
  ('f1a00000-0000-4000-8000-000000000003','f1504-other@example.invalid','{}'::jsonb),
  ('f1a00000-0000-4000-8000-000000000004','f1504-berlin@example.invalid','{}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values
  ('f1a10000-0000-4000-8000-000000000001','F15-04 Salon','f1504-salon','Europe/Istanbul','f1a00000-0000-4000-8000-000000000001'),
  ('f1a10000-0000-4000-8000-000000000002','F15-04 Other','f1504-other','Europe/Istanbul','f1a00000-0000-4000-8000-000000000003'),
  ('f1a10000-0000-4000-8000-000000000003','F15-04 Berlin','f1504-berlin','Europe/Berlin','f1a00000-0000-4000-8000-000000000004');

insert into public.memberships(id,business_id,user_id,role,active)
values
  ('f1a20000-0000-4000-8000-000000000001','f1a10000-0000-4000-8000-000000000001','f1a00000-0000-4000-8000-000000000001','owner',true),
  ('f1a20000-0000-4000-8000-000000000002','f1a10000-0000-4000-8000-000000000001','f1a00000-0000-4000-8000-000000000002','staff',true),
  ('f1a20000-0000-4000-8000-000000000003','f1a10000-0000-4000-8000-000000000002','f1a00000-0000-4000-8000-000000000003','owner',true),
  ('f1a20000-0000-4000-8000-000000000004','f1a10000-0000-4000-8000-000000000003','f1a00000-0000-4000-8000-000000000004','owner',true);

insert into public.membership_financial_permissions(
  business_id,membership_id,permission,active,granted_by_membership_id,granted_at
) values (
  'f1a10000-0000-4000-8000-000000000001',
  'f1a20000-0000-4000-8000-000000000002',
  'financial_reports_read',true,
  'f1a20000-0000-4000-8000-000000000001',now()
);

insert into public.customers(id,business_id,name,phone,email,created_by)
values
  ('f1a30000-0000-4000-8000-000000000001','f1a10000-0000-4000-8000-000000000001','Rapor Müşteri',null,null,'f1a00000-0000-4000-8000-000000000001'),
  ('f1a30000-0000-4000-8000-000000000002','f1a10000-0000-4000-8000-000000000003','Berlin Müşteri',null,null,'f1a00000-0000-4000-8000-000000000004');

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  category,sort_order,price_minor,price_type,price_min_minor,price_max_minor,currency,active
) values (
  'f1a41000-0000-4000-8000-000000000001','f1a10000-0000-4000-8000-000000000001',
  'Rapor Hizmet',30,0,0,'Genel',10,20000,'fixed',20000,20000,'TRY',true
);

insert into public.staff_profiles(id,business_id,membership_id,name,active)
values (
  'f1a42000-0000-4000-8000-000000000001','f1a10000-0000-4000-8000-000000000001',
  'f1a20000-0000-4000-8000-000000000001','Rapor Personel',true
);

insert into public.appointment_groups(
  id,business_id,customer_id,status,source,version,created_by,created_at,updated_at
) values (
  'f1a43000-0000-4000-8000-000000000001','f1a10000-0000-4000-8000-000000000001',
  'f1a30000-0000-4000-8000-000000000001','scheduled','operator',1,
  'f1a00000-0000-4000-8000-000000000001','2026-09-23 08:00+03','2026-09-23 08:00+03'
);

insert into public.appointments(
  id,business_id,customer_id,service_id,staff_id,status,
  starts_at,ends_at,occupied_starts_at,occupied_ends_at,timezone,
  customer_name_snapshot,customer_phone_snapshot,customer_email_snapshot,
  service_name_snapshot,staff_name_snapshot,duration_minutes_snapshot,
  buffer_before_minutes_snapshot,buffer_after_minutes_snapshot,price_minor_snapshot,
  currency_snapshot,notes,created_by,created_at,updated_at,source,
  group_id,line_ordinal,price_type_snapshot,price_min_minor_snapshot,
  price_max_minor_snapshot,price_policy_version_snapshot
) values (
  'f1a44000-0000-4000-8000-000000000001','f1a10000-0000-4000-8000-000000000001',
  'f1a30000-0000-4000-8000-000000000001','f1a41000-0000-4000-8000-000000000001',
  'f1a42000-0000-4000-8000-000000000001','scheduled',
  '2026-09-23 11:00+03','2026-09-23 11:30+03','2026-09-23 11:00+03','2026-09-23 11:30+03',
  'Europe/Istanbul','Rapor Müşteri',null,null,'Rapor Hizmet','Rapor Personel',30,0,0,20000,
  'TRY',null,'f1a00000-0000-4000-8000-000000000001','2026-09-23 08:00+03','2026-09-23 08:00+03',
  'operator','f1a43000-0000-4000-8000-000000000001',1,'fixed',20000,20000,1
);

insert into public.products(
  id,business_id,name,code,unit,sale_price_minor,currency,stock_on_hand,version,active,created_by_membership_id
) values
  ('f1a40000-0000-4000-8000-000000000001','f1a10000-0000-4000-8000-000000000001','Rapor Ürün','RPR-1','piece',10000,'TRY',90,1,true,'f1a20000-0000-4000-8000-000000000001'),
  ('f1a40000-0000-4000-8000-000000000002','f1a10000-0000-4000-8000-000000000001','Açık Bakiye','RPR-2','piece',30000,'TRY',9,1,true,'f1a20000-0000-4000-8000-000000000001');

insert into public.tickets(
  id,business_id,appointment_group_id,customer_id,source,status,currency,version,
  customer_name_snapshot,customer_phone_snapshot,customer_email_snapshot,
  created_by_membership_id,created_at,updated_at
) values
  ('f1a50000-0000-4000-8000-000000000001','f1a10000-0000-4000-8000-000000000001',null,'f1a30000-0000-4000-8000-000000000001','walk_in','open','TRY',1,'Rapor Müşteri',null,null,'f1a20000-0000-4000-8000-000000000001','2026-09-23 09:00+03','2026-09-23 09:00+03'),
  ('f1a50000-0000-4000-8000-000000000002','f1a10000-0000-4000-8000-000000000001',null,'f1a30000-0000-4000-8000-000000000001','walk_in','open','TRY',1,'Rapor Müşteri',null,null,'f1a20000-0000-4000-8000-000000000001','2026-09-23 09:30+03','2026-09-23 09:30+03'),
  ('f1a50000-0000-4000-8000-000000000004','f1a10000-0000-4000-8000-000000000001',null,'f1a30000-0000-4000-8000-000000000001','walk_in','open','TRY',1,'Rapor Müşteri',null,null,'f1a20000-0000-4000-8000-000000000001','2026-09-23 10:00+03','2026-09-23 10:00+03'),
  ('f1a50000-0000-4000-8000-000000000003','f1a10000-0000-4000-8000-000000000003',null,'f1a30000-0000-4000-8000-000000000002','walk_in','open','EUR',1,'Berlin Müşteri',null,null,'f1a20000-0000-4000-8000-000000000004','2026-10-25 00:15+00','2026-10-25 00:15+00');

insert into public.ticket_lines(
  id,business_id,ticket_id,line_ordinal,source_type,source_appointment_line_id,
  service_id,staff_id,service_name_snapshot,staff_name_snapshot,
  product_id,product_name_snapshot,product_code_snapshot,
  quantity,price_type_snapshot,price_min_minor_snapshot,price_max_minor_snapshot,
  currency_snapshot,price_policy_version_snapshot,final_unit_price_minor,
  finalized_by_membership_id,finalized_at,finalization_reason,discount_minor,
  created_by_membership_id,created_at
) values
  ('f1a60000-0000-4000-8000-000000000001','f1a10000-0000-4000-8000-000000000001','f1a50000-0000-4000-8000-000000000001',1,'product',null,
   null,null,null,null,'f1a40000-0000-4000-8000-000000000001','Rapor Ürün','RPR-1',
   10,'fixed',10000,10000,'TRY',1,10000,'f1a20000-0000-4000-8000-000000000001','2026-09-23 09:00+03','product_catalog_snapshot',0,
   'f1a20000-0000-4000-8000-000000000001','2026-09-23 09:00+03'),
  ('f1a60000-0000-4000-8000-000000000002','f1a10000-0000-4000-8000-000000000001','f1a50000-0000-4000-8000-000000000002',1,'product',null,
   null,null,null,null,'f1a40000-0000-4000-8000-000000000002','Açık Bakiye','RPR-2',
   1,'fixed',30000,30000,'TRY',1,30000,'f1a20000-0000-4000-8000-000000000001','2026-09-23 09:30+03','product_catalog_snapshot',0,
   'f1a20000-0000-4000-8000-000000000001','2026-09-23 09:30+03'),
  ('f1a60000-0000-4000-8000-000000000004','f1a10000-0000-4000-8000-000000000001','f1a50000-0000-4000-8000-000000000004',1,'service',null,
   'f1a41000-0000-4000-8000-000000000001',null,'Rapor Hizmet',null,null,null,null,
   1,'fixed',20000,20000,'TRY',1,20000,'f1a20000-0000-4000-8000-000000000001','2026-09-23 10:00+03','manual final',0,
   'f1a20000-0000-4000-8000-000000000001','2026-09-23 10:00+03');

insert into public.product_stock_movements(
  id,business_id,product_id,kind,quantity_delta,balance_after,reason,
  reverses_movement_id,ticket_line_id,source_sale_movement_id,created_by_membership_id,created_at
) values (
  'f1a70000-0000-4000-8000-000000000001','f1a10000-0000-4000-8000-000000000001',
  'f1a40000-0000-4000-8000-000000000001','sale',-10,90,'product_sale',
  null,'f1a60000-0000-4000-8000-000000000001',null,'f1a20000-0000-4000-8000-000000000001','2026-09-23 09:00+03'
);

insert into public.ticket_payment_events(
  id,business_id,ticket_id,event_type,source_payment_event_id,payment_method,
  correction_direction,amount_minor,reason,actor_membership_id,created_at
) values
  ('f1a80000-0000-4000-8000-000000000001','f1a10000-0000-4000-8000-000000000001','f1a50000-0000-4000-8000-000000000001','payment',null,'cash',null,60000,null,'f1a20000-0000-4000-8000-000000000001','2026-09-23 10:00+03'),
  ('f1a80000-0000-4000-8000-000000000002','f1a10000-0000-4000-8000-000000000001','f1a50000-0000-4000-8000-000000000001','payment',null,'card',null,40000,null,'f1a20000-0000-4000-8000-000000000001','2026-09-23 10:05+03'),
  ('f1a80000-0000-4000-8000-000000000003','f1a10000-0000-4000-8000-000000000001','f1a50000-0000-4000-8000-000000000001','refund','f1a80000-0000-4000-8000-000000000001','cash',null,10000,'İade','f1a20000-0000-4000-8000-000000000001','2026-09-23 10:10+03'),
  ('f1a80000-0000-4000-8000-000000000007','f1a10000-0000-4000-8000-000000000001','f1a50000-0000-4000-8000-000000000001','correction','f1a80000-0000-4000-8000-000000000002','card','increase',5000,'Kart artış düzeltmesi','f1a20000-0000-4000-8000-000000000001','2026-09-23 10:11+03'),
  ('f1a80000-0000-4000-8000-000000000008','f1a10000-0000-4000-8000-000000000001','f1a50000-0000-4000-8000-000000000001','correction','f1a80000-0000-4000-8000-000000000002','card','decrease',5000,'Kart azalış düzeltmesi','f1a20000-0000-4000-8000-000000000001','2026-09-23 10:12+03'),
  ('f1a80000-0000-4000-8000-000000000009','f1a10000-0000-4000-8000-000000000001','f1a50000-0000-4000-8000-000000000004','payment',null,'card',null,20000,null,'f1a20000-0000-4000-8000-000000000001','2026-09-24 09:00+03'),
  ('f1a80000-0000-4000-8000-000000000004','f1a10000-0000-4000-8000-000000000003','f1a50000-0000-4000-8000-000000000003','payment',null,'cash',null,10000,null,'f1a20000-0000-4000-8000-000000000004','2026-10-25 00:30+00'),
  ('f1a80000-0000-4000-8000-000000000005','f1a10000-0000-4000-8000-000000000003','f1a50000-0000-4000-8000-000000000003','payment',null,'card',null,20000,null,'f1a20000-0000-4000-8000-000000000004','2026-10-25 01:30+00'),
  ('f1a80000-0000-4000-8000-000000000006','f1a10000-0000-4000-8000-000000000003','f1a50000-0000-4000-8000-000000000003','payment',null,'cash',null,40000,null,'f1a20000-0000-4000-8000-000000000004','2026-10-25 23:30+00');

insert into public.ticket_product_returns(
  id,business_id,ticket_id,ticket_line_id,product_id,sale_movement_id,refund_event_id,
  quantity,return_to_stock,stock_return_movement_id,reason,actor_membership_id,created_at
) values (
  'f1a90000-0000-4000-8000-000000000001','f1a10000-0000-4000-8000-000000000001',
  'f1a50000-0000-4000-8000-000000000001','f1a60000-0000-4000-8000-000000000001',
  'f1a40000-0000-4000-8000-000000000001','f1a70000-0000-4000-8000-000000000001',
  'f1a80000-0000-4000-8000-000000000003',1,false,null,'Hasarlı ürün',
  'f1a20000-0000-4000-8000-000000000001','2026-09-23 10:10+03'
);

insert into public.expense_events(
  id,business_id,event_type,source_expense_event_id,correction_of_event_id,category,
  description,amount_minor,currency,payment_method,occurred_at,business_date,
  timezone_snapshot,reason,actor_membership_id,created_at
) values
  ('f1aa0000-0000-4000-8000-000000000001','f1a10000-0000-4000-8000-000000000001','expense',null,null,'Malzeme',
   null,15000,'TRY','cash','2026-09-23 12:00+03','2026-09-23','Europe/Istanbul',null,'f1a20000-0000-4000-8000-000000000001','2026-09-23 12:00+03'),
  ('f1aa0000-0000-4000-8000-000000000002','f1a10000-0000-4000-8000-000000000002','expense',null,null,'Başka tenant',
   null,999999,'TRY','cash','2026-09-23 12:00+03','2026-09-23','Europe/Istanbul',null,'f1a20000-0000-4000-8000-000000000003','2026-09-23 12:00+03'),
  ('f1aa0000-0000-4000-8000-000000000003','f1a10000-0000-4000-8000-000000000003','expense',null,null,'DST',
   'Spring first',110,'EUR','cash','2026-03-28 23:30+00','2026-03-29','Europe/Berlin',null,'f1a20000-0000-4000-8000-000000000004','2026-03-28 23:30+00'),
  ('f1aa0000-0000-4000-8000-000000000004','f1a10000-0000-4000-8000-000000000003','expense',null,null,'DST',
   'Spring last',220,'EUR','cash','2026-03-29 21:30+00','2026-03-29','Europe/Berlin',null,'f1a20000-0000-4000-8000-000000000004','2026-03-29 21:30+00'),
  ('f1aa0000-0000-4000-8000-000000000005','f1a10000-0000-4000-8000-000000000003','expense',null,null,'DST',
   'Spring after',440,'EUR','cash','2026-03-29 22:30+00','2026-03-30','Europe/Berlin',null,'f1a20000-0000-4000-8000-000000000004','2026-03-29 22:30+00');

set local role authenticated;
select set_config('request.jwt.claim.sub','f1a00000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);

do $f1504_summary$
declare
  v jsonb;
begin
  v:=public.get_financial_day_report(
    'f1a10000-0000-4000-8000-000000000001','2026-09-23','2026-09-23'
  );

  if (v->>'collectedMinor')::bigint<>100000
     or (v->>'cashCollectedMinor')::bigint<>60000
     or (v->>'cardCollectedMinor')::bigint<>40000
     or (v->>'refundMinor')::bigint<>10000
     or (v->>'correctionIncreaseMinor')::bigint<>5000
     or (v->>'correctionDecreaseMinor')::bigint<>5000
     or (v->>'expenseMinor')::bigint<>15000
     or (v->>'netMovementMinor')::bigint<>75000
     or (v->>'cashNetMovementMinor')::bigint<>35000
     or (v->>'cardNetMovementMinor')::bigint<>40000 then
    raise exception 'F15-04 source reconciliation wrong: %',v;
  end if;

  if (v->>'expectedMinMinor')::bigint<>140000
     or (v->>'expectedMaxMinor')::bigint<>140000
     or (v->>'expectedAppointmentMinMinor')::bigint<>20000
     or (v->>'expectedAppointmentMaxMinor')::bigint<>20000
     or (v->>'appointmentCount')::integer<>1
     or (v->>'serviceSaleMinor')::bigint<>20000
     or (v->>'productSaleMinor')::bigint<>120000
     or (v->>'saleValueMinor')::bigint<>140000
     or (v->>'outstandingMinor')::bigint<>30000 then
    raise exception 'F15-04 sale/outstanding separation wrong: %',v;
  end if;

  if v->>'currency'<>'TRY' or v->>'timezone'<>'Europe/Istanbul' then
    raise exception 'F15-04 currency/timezone projection wrong: %',v;
  end if;
end
$f1504_summary$;

-- A staff grant is checked on every read; revocation affects the next call.
select set_config('request.jwt.claim.sub','f1a00000-0000-4000-8000-000000000002',true);
do $f1504_staff_allowed$
begin
  perform public.get_financial_day_report(
    'f1a10000-0000-4000-8000-000000000001','2026-09-23','2026-09-23'
  );
end
$f1504_staff_allowed$;

reset role;
update public.membership_financial_permissions
set active=false,
    revoked_by_membership_id='f1a20000-0000-4000-8000-000000000001',
    revoked_at=now()
where business_id='f1a10000-0000-4000-8000-000000000001'
  and membership_id='f1a20000-0000-4000-8000-000000000002'
  and permission='financial_reports_read';

set local role authenticated;
select set_config('request.jwt.claim.sub','f1a00000-0000-4000-8000-000000000002',true);
do $f1504_staff_revoked$
declare v_error text;
begin
  begin
    perform public.get_financial_day_report(
      'f1a10000-0000-4000-8000-000000000001','2026-09-23','2026-09-23'
    );
  exception when others then v_error:=sqlerrm;
  end;
  if position('FINANCIAL_REPORTS_PERMISSION_REQUIRED' in coalesce(v_error,''))=0 then
    raise exception 'F15-04 revoked staff report permission still worked: %',v_error;
  end if;
end
$f1504_staff_revoked$;

-- Europe/Berlin 2026-10-25 contains both 02:30 instants during DST fall-back.
select set_config('request.jwt.claim.sub','f1a00000-0000-4000-8000-000000000004',true);
do $f1504_dst$
declare v jsonb;
begin
  v:=public.get_financial_day_report(
    'f1a10000-0000-4000-8000-000000000003','2026-10-25','2026-10-25'
  );
  if (v->>'collectedMinor')::bigint<>30000
     or (v->>'cashCollectedMinor')::bigint<>10000
     or (v->>'cardCollectedMinor')::bigint<>20000 then
    raise exception 'F15-04 DST day boundary lost/duplicated an event: %',v;
  end if;
end
$f1504_dst$;

do $f1504_spring$
declare v jsonb;
begin
  v:=public.get_financial_day_report(
    'f1a10000-0000-4000-8000-000000000003','2026-03-29','2026-03-29'
  );
  if (v->>'expenseMinor')::bigint<>330 then
    raise exception 'F15-04 DST spring-forward boundary lost/duplicated an event: %',v;
  end if;
end
$f1504_spring$;

do $f1504_range$
declare v_error text;
begin
  begin
    perform public.get_financial_day_report(
      'f1a10000-0000-4000-8000-000000000003','2026-01-01','2026-06-01'
    );
  exception when others then v_error:=sqlerrm;
  end;
  if position('INVALID_REPORT_RANGE' in coalesce(v_error,''))=0 then
    raise exception 'F15-04 oversized range was not rejected: %',v_error;
  end if;
end
$f1504_range$;

reset role;
rollback;
