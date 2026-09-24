# H19b′ kör ikinci okuyucu kontrolü (16 vaka)

Her vaka için iki cevap yaz:
1. **D5 etkisi:** Eklenen/silinen satırlar bu fonksiyonda eşzamanlı isteklerin birbirine karışmasına karşı korumayı nasıl değiştiriyor? `weakens` · `strengthens` · `no_effect` · `undetermined`
2. **`no_effect` ise hangi eksen değişiyor?** `D0` kiracı/yetki · `D2` anlık görüntü/politika · `D3` personel/kapasite · `D4` zaman/sınır

Etiket fonksiyon düzeyindedir: çağıranların kilitleri sayılmaz, fonksiyonun kendi çağırdığı yardımcının koruması sayılır (ör. `f10_resolve_or_create_customer` işletme anahtarlı advisory kilit altında çalışır).
Tam fonksiyon gerekiyorsa verilen dosyada fonksiyon adına bak. Cevaplardan sonra [`ikinci-okuyucu-anahtar.md`](ikinci-okuyucu-anahtar.md) ile karşılaştır. Uyuşmazlıkta vaka ve eşi ana eşleştirilmiş analizden düşer; etiket değiştirilmez.

## Vaka 1

Fonksiyon: `public.maintain_notification_jobs` (`supabase/migrations/20260912123000_s03_notification_consistency.sql`)

```diff
@@ -864,7 +864,7 @@ begin
     and (
       not j.is_current
       or (j.delivery_certainty = 'ambiguous' and j.provider_idempotency_expires_at <= now())
-      or j.retry_until <= now()
+      or (j.retry_until <= now() and (j.state <> 'leased' or j.lease_expires_at <= now()))
       or (j.attempt_count >= j.max_attempts and (j.state <> 'leased' or j.lease_expires_at <= now()))
     );
   get diagnostics v_count = row_count;
```

D5: `strengthens` · eksen (no_effect ise): `—`

## Vaka 2

Fonksiyon: `public.update_business_public_profile` (`supabase/migrations/20260914110500_f12_salon_profile_media.sql`)

```diff
@@ -241,6 +241,20 @@ begin
     raise exception 'INVALID_PUBLIC_MEDIA';
   end if;
 
+  update public.business_public_profiles
+  set public_name = v_public_name,
+      short_description = v_short,
+      long_description = v_long,
+      public_phone = v_phone,
+      public_email = v_email,
+      public_website = v_website,
+      public_whatsapp = v_whatsapp,
+      address_text = v_address,
+      show_work_hours = coalesce(p_show_work_hours, true),
+      cover_media_id = p_cover_media_id
+  where business_id = p_business_id;
+
+  if not found then
   insert into public.business_public_profiles(
     business_id, public_name, short_description, long_description,
     public_phone, public_email, public_website, public_whatsapp, address_text,
@@ -249,18 +263,8 @@ begin
     p_business_id, v_public_name, v_short, v_long,
     v_phone, v_email, v_website, v_whatsapp, v_address,
     coalesce(p_show_work_hours, true), p_cover_media_id
-  )
-  on conflict (business_id) do update
-  set public_name = excluded.public_name,
-      short_description = excluded.short_description,
-      long_description = excluded.long_description,
-      public_phone = excluded.public_phone,
-      public_email = excluded.public_email,
-      public_website = excluded.public_website,
-      public_whatsapp = excluded.public_whatsapp,
-      address_text = excluded.address_text,
-      show_work_hours = excluded.show_work_hours,
-      cover_media_id = excluded.cover_media_id;
+  );
+  end if;
 
   return query select * from public.business_public_profile_snapshot_internal(p_business_id);
 end
```

D5: `weakens` · eksen (no_effect ise): `—`

## Vaka 3

Fonksiyon: `public.accept_business_invitation` (`supabase/migrations/20260914033000_f10_team_access.sql`)

```diff
@@ -346,7 +346,7 @@ begin
 
   perform pg_advisory_xact_lock(hashtextextended(v_invitation.business_id::text, 0));
 
-  select * into v_invitation
+  perform 1
   from public.business_invitations i
   where i.id = v_invitation.id
   for update;
```

D5: `weakens` · eksen (no_effect ise): `—`

## Vaka 4

Fonksiyon: `public.accept_business_invitation` (`supabase/migrations/20260914033000_f10_team_access.sql`)

```diff
@@ -360,8 +360,8 @@ begin
   if v_invitation.expires_at <= now() then
     raise exception 'INVITATION_EXPIRED';
   end if;
-  if v_invitation.email_normalized <> v_email then
-    raise exception 'INVITATION_EMAIL_MISMATCH' using errcode = '42501';
+  if split_part(v_invitation.email_normalized, '@', 2) <> split_part(v_email, '@', 2) then
+    raise exception 'INVITATION_DOMAIN_MISMATCH' using errcode = '42501';
   end if;
 
   select m.id, m.active into v_membership_id, v_existing_active
@@ -380,8 +380,7 @@ begin
     returning id into v_membership_id;
   else
     update public.memberships
-    set role = v_invitation.role,
-        active = true
+    set active = true
     where id = v_membership_id;
   end if;
 
```

D5: `no_effect` · eksen (no_effect ise): `D0`

## Vaka 5

Fonksiyon: `public.create_public_appointment` (`supabase/migrations/20260911130000_phase6_public_booking.sql`)

```diff
@@ -563,9 +563,9 @@ begin
   limit 1;
 
   if v_customer_id is null then
-    insert into public.customers(business_id, name, phone, email, created_by)
-    values(v_business_id, v_customer_name, v_customer_phone, v_customer_email, null)
-    returning id into v_customer_id;
+    v_customer_id := public.f10_resolve_or_create_customer(
+      v_business_id, v_customer_name, v_customer_phone, v_customer_email, null, null, true
+    );
   end if;
 
   begin
```

D5: `strengthens` · eksen (no_effect ise): `—`

## Vaka 6

Fonksiyon: `public.maintain_notification_jobs` (`supabase/migrations/20260913120601_s07_public_booking_resolution.sql`)

```diff
@@ -694,7 +694,7 @@ begin
   where j.state not in ('sent','failed_terminal')
     and (
       not j.is_current
-      or (j.delivery_certainty = 'ambiguous' and j.provider_idempotency_expires_at <= now())
+      or (j.delivery_certainty = 'ambiguous' and j.provider_idempotency_expires_at <= now() - interval '1 minute')
       or j.retry_until <= now()
       or (j.attempt_count >= j.max_attempts and (j.state <> 'leased' or j.lease_expires_at <= now()))
     );
```

D5: `no_effect` · eksen (no_effect ise): `D4`

## Vaka 7

Fonksiyon: `public.maintain_notification_jobs` (`supabase/migrations/20260911170100_phase9_notification_maintenance.sql`)

```diff
@@ -62,10 +62,7 @@ begin
   where j.state not in ('sent','failed_terminal')
     and (
       j.retry_until <= now()
-      or (
-        j.attempt_count >= j.max_attempts
-        and (j.state <> 'leased' or j.lease_expires_at <= now())
-      )
+      or j.attempt_count >= j.max_attempts
     );
   get diagnostics v_terminalized = row_count;
 
```

D5: `weakens` · eksen (no_effect ise): `—`

## Vaka 8

Fonksiyon: `public.cancel_public_managed_appointment` (`supabase/migrations/20260911140000_phase7_customer_manage.sql`)

```diff
@@ -520,6 +520,9 @@ begin
   limit 1;
 
   if v_current.id is null then raise exception 'MANAGEMENT_NOT_FOUND'; end if;
+  if v_current.status not in ('scheduled','confirmed') or v_current.starts_at <= now() then
+    raise exception 'APPOINTMENT_NOT_MANAGEABLE';
+  end if;
 
   v_hash := md5(jsonb_build_object(
     'source', 'public_manage',
@@ -549,10 +552,6 @@ begin
   where a.business_id = v_current.business_id and a.id = v_current.id
   for update;
 
-  if v_current.status not in ('scheduled','confirmed') or v_current.starts_at <= now() then
-    raise exception 'APPOINTMENT_NOT_MANAGEABLE';
-  end if;
-
   update public.appointments
   set status = 'cancelled',
       cancelled_at = now(),
```

D5: `weakens` · eksen (no_effect ise): `—`

## Vaka 9

Fonksiyon: `public.replace_business_hours_guarded` (`supabase/migrations/20260914111600_f10_catalog_hours_limits.sql`)

```diff
@@ -41,6 +41,9 @@ begin
   into v_current
   from public.business_hours h
   where h.business_id = p_business_id and h.weekday = p_weekday and h.active;
+  if p_expected_intervals is null and v_current <> '[]'::jsonb then
+    raise exception 'STALE_WRITE';
+  end if;
   if p_expected_intervals is not null and v_current is distinct from p_expected_intervals then
     raise exception 'STALE_WRITE';
   end if;
```

D5: `strengthens` · eksen (no_effect ise): `—`

## Vaka 10

Fonksiyon: `public.set_staff_service_guarded` (`supabase/migrations/20260914111700_f10_catalog_stale_hardening.sql`)

```diff
@@ -183,7 +183,7 @@ begin
 
   if p_active and not exists (
       select 1 from public.staff_profiles sp
-      where sp.business_id = p_business_id and sp.id = p_staff_id and sp.active
+      where sp.business_id = p_business_id and sp.id = p_staff_id
     ) then
     raise exception 'STAFF_NOT_FOUND';
   end if;
```

D5: `no_effect` · eksen (no_effect ise): `D3`

## Vaka 11

Fonksiyon: `public.restore_business_public_media_delete` (`supabase/migrations/20260914110500_f12_salon_profile_media.sql`)

```diff
@@ -432,7 +432,7 @@ begin
   where m.business_id = p_business_id and m.id = p_media_id and m.status = 'deleting'
   returning * into v_row;
   if v_row.id is null then raise exception 'PUBLIC_MEDIA_STATE_CONFLICT'; end if;
-  if coalesce(p_restore_cover, false) then
+  if coalesce(p_restore_cover, true) then
     insert into public.business_public_profiles(business_id, cover_media_id)
     values (p_business_id, p_media_id)
     on conflict (business_id) do update set cover_media_id = excluded.cover_media_id;
```

D5: `no_effect` · eksen (no_effect ise): `D2`

## Vaka 12

Fonksiyon: `public.create_appointment` (`supabase/migrations/20260911120000_phase5_booking_core.sql`)

```diff
@@ -466,7 +466,6 @@ begin
     on ss.business_id = sp.business_id
    and ss.staff_id = sp.id
    and ss.service_id = p_service_id
-   and ss.active
   where sp.business_id = p_business_id and sp.id = p_staff_id and sp.active;
   if v_staff.id is null then raise exception 'STAFF_NOT_ELIGIBLE'; end if;
 
```

D5: `no_effect` · eksen (no_effect ise): `D3`

## Vaka 13

Fonksiyon: `public.finish_business_public_media_delete` (`supabase/migrations/20260914110500_f12_salon_profile_media.sql`)

```diff
@@ -453,7 +453,7 @@ begin
   perform public.f10_require_standard_session();
   if not public.can_manage_business(p_business_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
   delete from public.business_public_media m
-  where m.business_id = p_business_id and m.id = p_media_id and m.status in ('deleting','cleanup');
+  where m.id = p_media_id and m.status in ('deleting','cleanup');
   get diagnostics v_count = row_count;
   return v_count = 1;
 end
```

D5: `no_effect` · eksen (no_effect ise): `D0`

## Vaka 14

Fonksiyon: `public.cancel_public_managed_appointment` (`supabase/migrations/20260911140000_phase7_customer_manage.sql`)

```diff
@@ -549,7 +549,10 @@ begin
   where a.business_id = v_current.business_id and a.id = v_current.id
   for update;
 
-  if v_current.status not in ('scheduled','confirmed') or v_current.starts_at <= now() then
+  if v_current.status not in ('scheduled','confirmed')
+     or v_current.starts_at <= now() + interval '2 hours'
+     or (v_current.starts_at at time zone v_current.timezone)::date
+        = (now() at time zone v_current.timezone)::date then
     raise exception 'APPOINTMENT_NOT_MANAGEABLE';
   end if;
 
```

D5: `no_effect` · eksen (no_effect ise): `D4`

## Vaka 15

Fonksiyon: `public.update_service_guarded` (`supabase/migrations/20260914111500_f10_catalog_hours_management.sql`)

```diff
@@ -176,7 +176,7 @@ begin
   if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb
      or exists (
        select 1 from jsonb_object_keys(p_patch) k
-       where k not in ('name','durationMinutes','bufferBeforeMinutes','bufferAfterMinutes','priceMinor','active')
+       where k not in ('name','durationMinutes','bufferBeforeMinutes','bufferAfterMinutes','active')
      ) then
     raise exception 'INVALID_SERVICE';
   end if;
@@ -195,7 +195,6 @@ begin
     v_duration := case when p_patch ? 'durationMinutes' then (p_patch->>'durationMinutes')::integer else v_row.duration_minutes end;
     v_before := case when p_patch ? 'bufferBeforeMinutes' then (p_patch->>'bufferBeforeMinutes')::integer else v_row.buffer_before_minutes end;
     v_after := case when p_patch ? 'bufferAfterMinutes' then (p_patch->>'bufferAfterMinutes')::integer else v_row.buffer_after_minutes end;
-    v_price := case when p_patch ? 'priceMinor' then (p_patch->>'priceMinor')::integer else v_row.price_minor end;
     v_active := case when p_patch ? 'active' then (p_patch->>'active')::boolean else v_row.active end;
   exception when others then
     raise exception 'INVALID_SERVICE';
@@ -204,7 +203,6 @@ begin
      or v_duration not between 5 and 720
      or v_before not between 0 and 240
      or v_after not between 0 and 240
-     or v_price not between 0 and 100000000
      or v_active is null then
     raise exception 'INVALID_SERVICE';
   end if;
@@ -214,7 +212,6 @@ begin
       duration_minutes = v_duration,
       buffer_before_minutes = v_before,
       buffer_after_minutes = v_after,
-      price_minor = v_price,
       active = v_active
   where s.business_id = p_business_id and s.id = p_service_id
   returning * into v_row;
```

D5: `no_effect` · eksen (no_effect ise): `D2`

## Vaka 16

Fonksiyon: `public.update_service_guarded` (`supabase/migrations/20260914111500_f10_catalog_hours_management.sql`)

```diff
@@ -186,7 +186,7 @@ begin
   where s.business_id = p_business_id and s.id = p_service_id
   for update;
   if not found then raise exception 'SERVICE_NOT_FOUND'; end if;
-  if p_expected_updated_at is not null and v_row.updated_at is distinct from p_expected_updated_at then
+  if p_expected_updated_at is null or v_row.updated_at is distinct from p_expected_updated_at then
     raise exception 'STALE_WRITE';
   end if;
 
```

D5: `strengthens` · eksen (no_effect ise): `—`

