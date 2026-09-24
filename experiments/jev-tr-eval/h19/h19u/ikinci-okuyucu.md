# H19u kör ikinci okuyucu kontrolü (16 vaka)

Donmuş set SHA-256: `ba531c863b5ff27b382008dfd55d4f5d8f898c62b15bc8c9d6c652301a859914` · örneklem tohumu: ilk 8 hane (`ba531c86`).

Her vaka için tek etiket yaz (protokol §4):
- `D1_ONLY`: idempotency, komut kimliği, tekrar/makbuz semantiği, istek kimliği veya tekrarlanan komutun işlenişi maddi olarak değişir; eşzamanlılık/kilit/sürüm/serileştirme değişmez.
- `D5_ONLY`: eşzamanlılık, iyimser sürüm, kilit, serileştirme, bayat yazma koruması veya yarışa duyarlı davranış maddi olarak değişir; idempotency/komut kimliği değişmez.
- `BOTH`: iki aile birlikte maddi olarak değişir.
- `NEITHER_OR_OTHER`: iki aile de maddi olarak değişmez (yalnız D0/D2/D3/D4) ya da diff karar vermeye yetmez.

Etiket fonksiyon düzeyindedir: çağıranların kilitleri sayılmaz, fonksiyonun kendi çağırdığı yardımcının koruması sayılır. Yön sorulmuyor.
Cevaplardan sonra [`ikinci-okuyucu-anahtar.md`](ikinci-okuyucu-anahtar.md) ile karşılaştır. Uyuşmazlıkta vaka düşer (`dusen.json`); etiket değiştirilmez, yerine yenisi konmaz.

## Vaka 1

Fonksiyon: `public.close_ticket_guarded` (`supabase/migrations/20260922111500_f14_ticket_model.sql`)

```diff
@@ -982,10 +982,6 @@ begin
   where business_id = p_business_id and id = p_ticket_id;
 
   v_result := public.f14_ticket_projection(p_business_id, p_ticket_id);
-  perform public.f14_finish_ticket_command(
-    p_business_id, v_actor.id, 'close_ticket',
-    p_idempotency_key, p_ticket_id, v_result
-  );
   return v_result;
 end
 $$;
```

Etiket: `D1_ONLY`

## Vaka 2

Fonksiyon: `public.reschedule_public_managed_group` (`supabase/migrations/20260917160100_f11_public_group_management.sql`)

```diff
@@ -192,8 +192,7 @@ begin
 
   v_today := (now() at time zone v_timezone)::date;
   v_date := (p_starts_at at time zone v_timezone)::date;
-  if v_date < v_today or v_date > v_today+v_horizon_days
-     or p_starts_at < now()+make_interval(mins=>v_min_notice_minutes) then
+  if v_date < v_today or v_date > v_today+v_horizon_days then
     raise exception 'SLOT_UNAVAILABLE';
   end if;
 
```

Etiket: `NEITHER_OR_OTHER`

## Vaka 3

Fonksiyon: `core.command_provision_business` (`supabase/migrations/20260916190000_kc01_core_platform_schema.sql`)

```diff
@@ -533,7 +533,6 @@ begin
 
     -- Deterministic replay: an already-linked legacy tenant maps to its business.
     -- Concurrent provisioning of the same alias serializes on this lock.
-    perform core.lock_tenant_alias(v_alias_provider, v_alias_external_id);
     select * into v_existing_alias
     from core.tenant_aliases a
     where a.provider = v_alias_provider and a.external_id = v_alias_external_id;
```

Etiket: `BOTH`

## Vaka 4

Fonksiyon: `public.f11_validate_native_group_schedule_authority` (`supabase/migrations/20260918070000_f11_lock_order_final_repair.sql`)

```diff
@@ -440,7 +440,7 @@ begin
         )
         or exists (
           select 1 from public.availability_blocks ab
-          where ab.business_id=a.business_id and ab.active
+          where ab.business_id=a.business_id
             and (ab.staff_id is null or ab.staff_id=a.staff_id)
             and ab.starts_at<a.occupied_ends_at and ab.ends_at>a.occupied_starts_at
         )
```

Etiket: `NEITHER_OR_OTHER`

## Vaka 5

Fonksiyon: `public.f11_validate_native_group_schedule_authority` (`supabase/migrations/20260917170000_f11_schedule_authority_race_repair.sql`)

```diff
@@ -233,7 +233,7 @@ begin
         and a.status in ('scheduled','confirmed')
     )
   order by s.id
-  for update;
+  for no key update;
 
   perform 1
   from public.staff_profiles sp
@@ -244,7 +244,7 @@ begin
         and a.status in ('scheduled','confirmed')
     )
   order by sp.id
-  for update;
+  for no key update;
 
   perform 1
   from public.staff_services ss
```

Etiket: `D5_ONLY`

## Vaka 6

Fonksiyon: `public.create_public_booking_confirmation_event` (`supabase/migrations/20260912123000_s03_notification_consistency.sql`)

```diff
@@ -257,7 +257,7 @@ begin
     'pending',
     now(),
     least(v_recovery.expires_at, now() + interval '72 hours'),
-    'public-booking-confirmation/' || v_event_id::text,
+    'public-booking-confirmation/' || p_appointment_id::text,
     v_event_id,
     v_event_version,
     p_event_reason,
```

Etiket: `D1_ONLY`

## Vaka 7

Fonksiyon: `public.set_appointment_status` (`supabase/migrations/20260911120000_phase5_booking_core.sql`)

```diff
@@ -721,7 +721,6 @@ begin
   for update;
 
   if v_current.id is null then raise exception 'APPOINTMENT_NOT_FOUND'; end if;
-  if v_current.status = p_status then return v_current; end if;
   if v_current.status in ('cancelled','completed','no_show') then
     raise exception 'INVALID_STATUS_TRANSITION';
   end if;
```

Etiket: `BOTH`

## Vaka 8

Fonksiyon: `public.reschedule_appointment` (`supabase/migrations/20260911120000_phase5_booking_core.sql`)

```diff
@@ -597,7 +597,6 @@ begin
   end if;
 
   v_hash := md5(jsonb_build_object(
-    'appointmentId', p_appointment_id,
     'staffId', p_staff_id,
     'startsAt', p_starts_at
   )::text);
@@ -613,7 +612,7 @@ begin
   select * into v_current
   from public.appointments
   where business_id = p_business_id and id = p_appointment_id
-  for update;
+  for key share of appointments;
 
   if v_current.id is null then raise exception 'APPOINTMENT_NOT_FOUND'; end if;
   if v_current.status not in ('scheduled','confirmed') then
```

Etiket: `BOTH`

## Vaka 9

Fonksiyon: `public.f12_require_public_support_contact` (`supabase/migrations/20260921083000_f12_booking_information_links.sql`)

```diff
@@ -159,9 +159,6 @@ declare v_required boolean;
 begin
   -- Keep direct table writes on the same serialization point as both public
   -- profile RPC writes and update_public_booking_settings.
-  perform 1 from public.businesses b where b.id = new.business_id for update;
-  if not found then raise exception 'BUSINESS_NOT_FOUND'; end if;
-
   if nullif(trim(coalesce(new.public_phone,'')),'') is not null
      or nullif(trim(coalesce(new.public_email,'')),'') is not null
      or nullif(trim(coalesce(new.public_whatsapp,'')),'') is not null then
```

Etiket: `D5_ONLY`

## Vaka 10

Fonksiyon: `public.archive_product_guarded` (`supabase/migrations/20260923051000_f15_product_stock_ledger.sql`)

```diff
@@ -715,7 +715,7 @@ declare
 begin
   v_actor := public.f15_inventory_actor(p_business_id);
   v_replay := public.f15_claim_product_command(
-    p_business_id, v_actor.id, 'archive_product', p_idempotency_key, p_request_hash
+    p_business_id, v_actor.id, 'update_product', p_idempotency_key, p_request_hash
   );
   if v_replay is not null then return v_replay; end if;
 
@@ -739,7 +739,7 @@ begin
 
   v_result := public.f15_product_projection(p_business_id, v_product.id);
   perform public.f15_finish_product_command(
-    p_business_id, v_actor.id, 'archive_product', p_idempotency_key, v_product.id, v_result
+    p_business_id, v_actor.id, 'update_product', p_idempotency_key, v_product.id, v_result
   );
   return v_result;
 end
```

Etiket: `D1_ONLY`

## Vaka 11

Fonksiyon: `public.open_ticket_from_booking_group_guarded` (`supabase/migrations/20260922111500_f14_ticket_model.sql`)

```diff
@@ -514,9 +514,6 @@ begin
   );
   if v_replay is not null then return v_replay; end if;
 
-  perform pg_advisory_xact_lock(hashtextextended(
-    p_business_id::text || ':ticket-group:' || coalesce(p_group_id::text, ''), 0
-  ));
 
   select * into v_group
   from public.appointment_groups g
```

Etiket: `D5_ONLY`

## Vaka 12

Fonksiyon: `public.record_ticket_refund_guarded` (`supabase/migrations/20260922144500_f14_payment_ledger.sql`)

```diff
@@ -593,7 +593,7 @@ declare
   v_reason text;
   v_source_net bigint;
 begin
-  v_actor := public.f14_payment_actor(p_business_id);
+  v_actor := public.f14_financial_actor(p_business_id);
   v_replay := public.f14_claim_ticket_command(
     p_business_id, v_actor.id, 'record_refund',
     p_idempotency_key, p_request_hash
```

Etiket: `NEITHER_OR_OTHER`

## Vaka 13

Fonksiyon: `public.open_product_sale_guarded` (`supabase/migrations/20260923113600_f15_product_sale_atomicity.sql`)

```diff
@@ -866,7 +866,7 @@ begin
     p_business_id,v_ticket.id,1,'product',null,
     null,null,null,null,
     v_product.id,v_product.name,v_product.code,
-    p_quantity,'fixed',v_product.sale_price_minor,v_product.sale_price_minor,
+    p_quantity,'fixed',v_product.sale_price_minor,null,
     v_product.currency,v_product.version,
     v_product.sale_price_minor,v_actor.id,now(),'product_catalog_snapshot',
     0,v_actor.id
```

Etiket: `NEITHER_OR_OTHER`

## Vaka 14

Fonksiyon: `public.set_ticket_service_discount_guarded` (`supabase/migrations/20260922144500_f14_payment_ledger.sql`)

```diff
@@ -695,7 +695,7 @@ begin
   select * into v_ticket
   from public.tickets t
   where t.business_id = p_business_id and t.id = p_ticket_id
-  for update;
+  for key share of t;
   if v_ticket.id is null then raise exception 'TICKET_NOT_FOUND'; end if;
   if v_ticket.status <> 'open' then raise exception 'TICKET_NOT_OPEN'; end if;
   if p_expected_version is null or v_ticket.version <> p_expected_version then
@@ -707,7 +707,7 @@ begin
   where l.business_id = p_business_id
     and l.ticket_id = p_ticket_id
     and l.id = p_line_id
-  for update;
+  for key share of l;
   if v_line.id is null then raise exception 'TICKET_LINE_NOT_FOUND'; end if;
   if v_line.final_unit_price_minor is null then raise exception 'SERVICE_PRICE_NOT_FINAL'; end if;
   if p_discount_minor > v_line.final_unit_price_minor then raise exception 'DISCOUNT_EXCEEDS_LINE'; end if;
```

Etiket: `D5_ONLY`

## Vaka 15

Fonksiyon: `public.f11_create_group_internal` (`supabase/migrations/20260918070000_f11_lock_order_final_repair.sql`)

```diff
@@ -87,9 +87,6 @@ begin
   -- Serialize this group's key before the read-only replay probe. A locked
   -- existing command is validated by the canonical claim routine below and
   -- returns frozen line data even if today's catalog is archived or repriced.
-  perform pg_advisory_xact_lock(hashtextextended(
-    'f11:group-command:' || p_business_id::text || ':' || p_idempotency_key, 0
-  ));
   perform 1
   from public.booking_commands bc
   where bc.business_id = p_business_id
```

Etiket: `BOTH`

## Vaka 16

Fonksiyon: `public.f11_reschedule_group_core` (`supabase/migrations/20260917160000_f11_group_management_compat.sql`)

```diff
@@ -614,7 +614,7 @@ begin
       where a.business_id=p_business_id and a.group_id=p_group_id
     )
   order by sp.id
-  for update;
+  for key share;
 
   -- Availability is intentionally recomputed after the stable staff locks.
   v_plan := public.f11_plan_existing_group_at(p_business_id,p_group_id,p_starts_at);
```

Etiket: `D5_ONLY`

