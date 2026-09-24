# H19d kör ikinci okuyucu kontrolü (16 vaka)

Her vaka için üç cevap yaz:
1. **D5 maddi olarak etkileniyor mu?** (eşzamanlılık, kilit, yarış sırası, bayat yazma, iyimser sürüm, iç içe geçmeye duyarlı davranış) `yes` · `no` · `undetermined`
2. **`yes` ise** D5 dışında maddi olarak değişen eksen(ler): `D0` kiracı/yetki · `D1` atomiklik/tekrar · `D2` anlık görüntü/politika · `D3` personel/kapasite · `D4` zaman/sınır · ya da `yok`
3. **`no` ise** maddi olarak değişen eksen(ler)

Etiket fonksiyon düzeyindedir: çağıranların kilitleri sayılmaz, fonksiyonun kendi çağırdığı yardımcının koruması sayılır. Yön (zayıflatma/güçlendirme) sorulmuyor.
Cevaplardan sonra [`ikinci-okuyucu-anahtar.md`](ikinci-okuyucu-anahtar.md) ile karşılaştır. Uyuşmazlıkta vaka düşer (`dusen.json`); etiket değiştirilmez.

## Vaka 1

Fonksiyon: `public.f14_claim_ticket_command` (`supabase/migrations/20260922111500_f14_ticket_model.sql`)

```diff
@@ -284,12 +284,19 @@ begin
     raise exception 'INVALID_REQUEST_HASH';
   end if;
 
-  insert into public.ticket_commands(
-    business_id, actor_membership_id, command, idempotency_key, request_hash
-  ) values (
-    p_business_id, p_actor_membership_id, p_command, p_idempotency_key, p_request_hash
-  )
-  on conflict (business_id, actor_membership_id, command, idempotency_key) do nothing;
+  if not exists (
+    select 1 from public.ticket_commands c
+    where c.business_id = p_business_id
+      and c.actor_membership_id = p_actor_membership_id
+      and c.command = p_command
+      and c.idempotency_key = p_idempotency_key
+  ) then
+    insert into public.ticket_commands(
+      business_id, actor_membership_id, command, idempotency_key, request_hash
+    ) values (
+      p_business_id, p_actor_membership_id, p_command, p_idempotency_key, p_request_hash
+    );
+  end if;
 
   select c.request_hash, c.result_payload
   into v_hash, v_result
```

D5: `____` · eksen(ler): `________`

## Vaka 2

Fonksiyon: `public.restore_business_public_media_delete` (`supabase/migrations/20260914110500_f12_salon_profile_media.sql`)

```diff
@@ -429,7 +429,7 @@ begin
   perform public.f10_require_standard_session();
   if not public.can_manage_business(p_business_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
   update public.business_public_media m set status = 'ready'
-  where m.business_id = p_business_id and m.id = p_media_id and m.status = 'deleting'
+  where m.business_id = p_business_id and m.id = p_media_id
   returning * into v_row;
   if v_row.id is null then raise exception 'PUBLIC_MEDIA_STATE_CONFLICT'; end if;
   if coalesce(p_restore_cover, false) then
```

D5: `____` · eksen(ler): `________`

## Vaka 3

Fonksiyon: `public.release_notification_job_v2` (`supabase/migrations/20260912123000_s03_notification_consistency.sql`)

```diff
@@ -792,7 +792,7 @@ begin
   v_delay := greatest(1, least(coalesce(p_retry_after_seconds, 60), 86400));
   v_window_expired := v_certainty = 'ambiguous'
     and v_job.provider_idempotency_expires_at is not null
-    and now() + make_interval(secs => v_delay) >= v_job.provider_idempotency_expires_at;
+    and clock_timestamp() + make_interval(secs => v_delay) >= v_job.provider_idempotency_expires_at;
   v_error := case
     when v_window_expired then 'idempotency_window_expired_ambiguous'
     else p_error_class
@@ -801,7 +801,7 @@ begin
   if not v_job.is_current
      or not coalesce(p_retryable, false)
      or v_job.attempt_count >= v_job.max_attempts
-     or now() + make_interval(secs => v_delay) >= v_job.retry_until
+     or clock_timestamp() + make_interval(secs => v_delay) >= v_job.retry_until
      or v_window_expired then
     v_state := 'failed_terminal';
     update public.appointment_notification_jobs
```

D5: `____` · eksen(ler): `________`

## Vaka 4

Fonksiyon: `public.f11_reschedule_group_core` (`supabase/migrations/20260917171000_f11_schedule_authority_lock_order.sql`)

```diff
@@ -36,6 +36,7 @@ begin
     raise exception 'INVALID_GROUP_VERSION';
   end if;
   if p_starts_at is null then raise exception 'INVALID_START'; end if;
+  if p_starts_at > now() + interval '180 days' then raise exception 'INVALID_START'; end if;
   if p_command not in ('group_reschedule','public_group_reschedule') then
     raise exception 'INVALID_GROUP_COMMAND';
   end if;
@@ -63,8 +64,7 @@ begin
 
   v_hash := md5(jsonb_build_object(
     'groupId',p_group_id,
-    'expectedVersion',p_expected_version,
-    'startsAt',p_starts_at
+    'expectedVersion',p_expected_version
   )::text);
 
   select * into v_claim
```

D5: `____` · eksen(ler): `________`

## Vaka 5

Fonksiyon: `public.f11_reschedule_group_core` (`supabase/migrations/20260917171000_f11_schedule_authority_lock_order.sql`)

```diff
@@ -35,7 +35,7 @@ begin
   if p_expected_version is null or p_expected_version < 1 then
     raise exception 'INVALID_GROUP_VERSION';
   end if;
-  if p_starts_at is null then raise exception 'INVALID_START'; end if;
+  if p_starts_at is null or p_starts_at <= now() then raise exception 'INVALID_START'; end if;
   if p_command not in ('group_reschedule','public_group_reschedule') then
     raise exception 'INVALID_GROUP_COMMAND';
   end if;
```

D5: `____` · eksen(ler): `________`

## Vaka 6

Fonksiyon: `public.create_business_with_owner` (`supabase/migrations/20260911090000_phase2_auth_tenancy.sql`)

```diff
@@ -146,7 +146,7 @@ begin
   returning * into v_business;
 
   insert into public.memberships(business_id, user_id, role, active)
-  values(v_business.id, v_user, 'owner', true);
+  values(v_business.id, v_user, 'manager', true);
 
   return query select v_business.id, v_business.name, v_business.slug, v_business.timezone, 'owner'::public.membership_role;
 end $$;
```

D5: `____` · eksen(ler): `________`

## Vaka 7

Fonksiyon: `public.complete_notification_job_v2` (`supabase/migrations/20260912123000_s03_notification_consistency.sql`)

```diff
@@ -725,7 +725,6 @@ begin
       provider_message_id = p_provider_message_id,
       sent_at = now(),
       terminal_at = now(),
-      last_error_class = null,
       lease_token = null,
       lease_expires_at = null,
       delivery_certainty = 'accepted',
```

D5: `____` · eksen(ler): `________`

## Vaka 8

Fonksiyon: `public.update_business_public_profile` (`supabase/migrations/20260914110500_f12_salon_profile_media.sql`)

```diff
@@ -219,7 +219,7 @@ declare
   v_address text := nullif(trim(coalesce(p_address_text, '')), '');
 begin
   perform public.f10_require_standard_session();
-  if not public.can_manage_business(p_business_id) then
+  if not public.is_active_member(p_business_id) then
     raise exception 'NOT_ALLOWED' using errcode = '42501';
   end if;
   if v_public_name is not null and char_length(v_public_name) not between 2 and 120 then
@@ -260,7 +260,7 @@ begin
       public_whatsapp = excluded.public_whatsapp,
       address_text = excluded.address_text,
       show_work_hours = excluded.show_work_hours,
-      cover_media_id = excluded.cover_media_id;
+      cover_media_id = coalesce(excluded.cover_media_id, public.business_public_profiles.cover_media_id);
 
   return query select * from public.business_public_profile_snapshot_internal(p_business_id);
 end
```

D5: `____` · eksen(ler): `________`

## Vaka 9

Fonksiyon: `public.set_appointment_status` (`supabase/migrations/20260911121000_phase5_booking_hardening.sql`)

```diff
@@ -475,8 +475,7 @@ begin
 
   select * into v_current
   from public.appointments
-  where business_id = p_business_id and id = p_appointment_id
-  for update;
+  where business_id = p_business_id and id = p_appointment_id;
 
   if v_current.id is null then raise exception 'APPOINTMENT_NOT_FOUND'; end if;
   if v_current.status = p_status then return v_current; end if;
```

D5: `____` · eksen(ler): `________`

## Vaka 10

Fonksiyon: `public.replace_staff_hours` (`supabase/migrations/20260911110000_phase4_availability.sql`)

```diff
@@ -237,22 +237,10 @@ begin
       raise exception 'INVALID_TIME';
     end;
 
-    if v_start is null or v_end is null or v_start >= v_end then
+    if v_start is null or v_end is null or v_start = v_end then
       raise exception 'INVALID_INTERVAL';
     end if;
 
-    if exists (
-      select 1 from public.staff_hours h
-      where h.business_id = p_business_id
-        and h.staff_id = p_staff_id
-        and h.weekday = p_weekday
-        and h.active
-        and h.starts_local < v_end
-        and v_start < h.ends_local
-    ) then
-      raise exception 'OVERLAPPING_INTERVALS';
-    end if;
-
     insert into public.staff_hours(business_id, staff_id, weekday, starts_local, ends_local)
     values(p_business_id, p_staff_id, p_weekday, v_start, v_end);
   end loop;
```

D5: `____` · eksen(ler): `________`

## Vaka 11

Fonksiyon: `public.update_business_customer` (`supabase/migrations/20260914110000_f10_customer_records.sql`)

```diff
@@ -323,21 +323,6 @@ begin
     raise exception 'NOTES_TOO_LONG';
   end if;
 
-  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text, 0));
-
-  select * into v_current
-  from public.customers c
-  where c.business_id = p_business_id
-    and c.id = p_customer_id
-  for update;
-
-  if v_current.id is null then
-    raise exception 'CUSTOMER_NOT_FOUND';
-  end if;
-  if v_current.updated_at <> p_expected_updated_at then
-    raise exception 'CUSTOMER_VERSION_CONFLICT';
-  end if;
-
   if exists (
     select 1
     from public.customers c
@@ -354,6 +339,20 @@ begin
     raise exception 'CUSTOMER_CONTACT_EXISTS';
   end if;
 
+  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text, 0));
+
+  select * into v_current
+  from public.customers c
+  where c.id = p_customer_id
+  for update;
+
+  if v_current.id is null then
+    raise exception 'CUSTOMER_NOT_FOUND';
+  end if;
+  if v_current.updated_at <> p_expected_updated_at then
+    raise exception 'CUSTOMER_VERSION_CONFLICT';
+  end if;
+
   update public.customers c
   set name = v_name,
       phone = v_phone,
```

D5: `____` · eksen(ler): `________`

## Vaka 12

Fonksiyon: `public.create_appointment` (`supabase/migrations/20260911121000_phase5_booking_hardening.sql`)

```diff
@@ -229,7 +229,8 @@ begin
    and ss.staff_id = sp.id
    and ss.service_id = p_service_id
    and ss.active
-  where sp.business_id = p_business_id and sp.id = p_staff_id and sp.active;
+  where sp.business_id = p_business_id and sp.id = p_staff_id and sp.active
+  for share of sp, ss;
   if v_staff.id is null then raise exception 'STAFF_NOT_ELIGIBLE'; end if;
 
   select timezone into v_timezone
```

D5: `____` · eksen(ler): `________`

## Vaka 13

Fonksiyon: `public.create_staff_guarded` (`supabase/migrations/20260914111500_f10_catalog_hours_management.sql`)

```diff
@@ -246,9 +246,9 @@ begin
     raise exception 'INVALID_STAFF';
   end if;
 
-  perform pg_advisory_xact_lock(hashtextextended('f10-04:staff:' || p_business_id::text, 0));
+  perform pg_advisory_xact_lock(hashtextextended('f10-04:staff:' || p_business_id::text || ':' || lower(trim(p_name)), 0));
   select count(*) into v_count from public.staff_profiles sp where sp.business_id = p_business_id;
-  if v_count >= 100 then raise exception 'CATALOG_STAFF_LIMIT_EXCEEDED'; end if;
+  if v_count >= 200 then raise exception 'CATALOG_STAFF_LIMIT_EXCEEDED'; end if;
 
   insert into public.staff_profiles(business_id, name, phone)
   values(p_business_id, trim(p_name), v_phone)
```

D5: `____` · eksen(ler): `________`

## Vaka 14

Fonksiyon: `public.finish_business_public_media_delete` (`supabase/migrations/20260914110500_f12_salon_profile_media.sql`)

```diff
@@ -452,6 +452,7 @@ declare v_count integer;
 begin
   perform public.f10_require_standard_session();
   if not public.can_manage_business(p_business_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
+  perform 1 from public.businesses b where b.id = p_business_id for update;
   delete from public.business_public_media m
   where m.business_id = p_business_id and m.id = p_media_id and m.status in ('deleting','cleanup');
   get diagnostics v_count = row_count;
```

D5: `____` · eksen(ler): `________`

## Vaka 15

Fonksiyon: `public.enforce_public_booking_rate` (`supabase/migrations/20260913030912_s04_resource_limits.sql`)

```diff
@@ -119,7 +119,7 @@ begin
     when 'request' then v_window := 60; v_actor := 60; v_network := 600;
     when 'manage_read' then v_window := 60; v_actor := 60; v_network := 600;
     when 'manage_slot' then v_window := 60; v_actor := 30; v_network := 300;
-    when 'manage_change' then v_window := 60; v_actor := 10; v_network := 100;
+    when 'manage_change' then v_window := 60; v_actor := 5; v_network := 100;
     when 'manage_cancel' then v_window := 60; v_actor := 10; v_network := 100;
     else raise exception 'PUBLIC_BOOKING_GATE_INVALID_PROOF';
   end case;
```

D5: `____` · eksen(ler): `________`

## Vaka 16

Fonksiyon: `public.set_staff_service_guarded` (`supabase/migrations/20260914111500_f10_catalog_hours_management.sql`)

```diff
@@ -334,7 +334,7 @@ declare
   v_count integer;
 begin
   perform public.f10_require_standard_session();
-  if not public.can_manage_business(p_business_id) then
+  if not public.is_active_member(p_business_id) then
     raise exception 'NOT_ALLOWED' using errcode = '42501';
   end if;
   if p_active is null then raise exception 'INVALID_ASSIGNMENT'; end if;
@@ -381,7 +381,7 @@ begin
     end if;
     select count(*) into v_count
     from public.staff_services ss where ss.business_id = p_business_id;
-    if v_count >= 5000 then raise exception 'CATALOG_ASSIGNMENTS_LIMIT_EXCEEDED'; end if;
+    if v_count >= 1000 then raise exception 'CATALOG_ASSIGNMENTS_LIMIT_EXCEEDED'; end if;
     insert into public.staff_services(business_id, staff_id, service_id, active)
     values(p_business_id, p_staff_id, p_service_id, p_active)
     returning * into v_row;
```

D5: `____` · eksen(ler): `________`

