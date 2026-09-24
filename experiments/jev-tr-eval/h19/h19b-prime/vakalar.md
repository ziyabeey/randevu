# H19b′ vakaları (vakalar.v0.1.json, okunur liste)

## AP01 · A′ · weakens · eş CP01 · aile: check_before_lock

Durum ve zaman kontrolü kilitsiz yetenek okumasının hemen arkasına taşındı; satır kilidiyle yeniden okunan randevu artık kontrol edilmiyor. Eşzamanlı bir iptal/yeniden planlama arada tamamlanırsa ikinci iptal yine yazılır.

Olgular: `{"lock_context":true,"version_guard":false,"changed_inside_locked_region":true,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

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

## CP01 · C′ · no_effect · D4 · eş AP01

Müşteri iptali randevudan en geç 2 saat önce ve aynı yerel gün içinde olmamak koşuluyla yapılabiliyor (zaman sınırı, yerel gün); kontrol aynı kilit altında.

Olgular: `{"lock_context":true,"version_guard":false,"changed_inside_locked_region":true,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

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

## AP02 · A′ · strengthens · eş CP02 · aile: stale_token

Bayat yazma belirteci zorunlu oldu; belirteç vermeyen eşzamanlı bir düzenleme artık başka bir düzenlemenin üstüne sessizce yazamaz.

Olgular: `{"lock_context":true,"version_guard":false,"changed_inside_locked_region":true,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

Fonksiyon: `public.update_staff_guarded` (`supabase/migrations/20260914111500_f10_catalog_hours_management.sql`)

```diff
@@ -291,7 +291,7 @@ begin
   where sp.business_id = p_business_id and sp.id = p_staff_id
   for update;
   if not found then raise exception 'STAFF_NOT_FOUND'; end if;
-  if p_expected_updated_at is not null and v_row.updated_at is distinct from p_expected_updated_at then
+  if p_expected_updated_at is null or v_row.updated_at is distinct from p_expected_updated_at then
     raise exception 'STALE_WRITE';
   end if;
 
```

## CP02 · C′ · no_effect · D2 · eş AP02

Personel adı değişince gelecekteki randevuların personel adı anlık görüntüsü de yeniden yazılıyor (sonraki durum önceki anlamı değiştiriyor).

Olgular: `{"lock_context":true,"version_guard":false,"changed_inside_locked_region":true,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

Fonksiyon: `public.update_staff_guarded` (`supabase/migrations/20260914111500_f10_catalog_hours_management.sql`)

```diff
@@ -312,6 +312,13 @@ begin
   set name = v_name, phone = v_phone, active = v_active
   where sp.business_id = p_business_id and sp.id = p_staff_id
   returning * into v_row;
+
+  update public.appointments a
+  set staff_name_snapshot = v_row.name
+  where a.business_id = p_business_id
+    and a.staff_id = p_staff_id
+    and a.status in ('scheduled','confirmed')
+    and a.starts_at > now();
   return v_row;
 end
 $$;
```

## AP03 · A′ · weakens · eş CP03 · aile: stale_token, surface_protective

Bayat yazma belirteci isteğe bağlı oldu; belirteç göndermeyen eşzamanlı düzenleme başka bir düzenlemenin üstüne sessizce yazar (kayıp güncelleme).

Olgular: `{"lock_context":true,"version_guard":false,"changed_inside_locked_region":true,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

Fonksiyon: `public.update_staff_guarded` (`supabase/migrations/20260914111700_f10_catalog_stale_hardening.sql`)

```diff
@@ -113,8 +113,8 @@ begin
   where sp.business_id = p_business_id and sp.id = p_staff_id
   for update;
   if not found then raise exception 'STAFF_NOT_FOUND'; end if;
-  if p_expected_updated_at is null
-     or v_row.updated_at is distinct from p_expected_updated_at then
+  if p_expected_updated_at is not null
+     and v_row.updated_at is distinct from p_expected_updated_at then
     raise exception 'STALE_WRITE';
   end if;
 
```

## CP03 · C′ · no_effect · D0 · eş AP03

Yöneticiye ek olarak, personel kaydına bağlı aktif üye kendi personel profilini düzenleyebiliyor (yetki kapsamı).

Olgular: `{"lock_context":true,"version_guard":false,"changed_inside_locked_region":false,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

Fonksiyon: `public.update_staff_guarded` (`supabase/migrations/20260914111700_f10_catalog_stale_hardening.sql`)

```diff
@@ -97,7 +97,16 @@ declare
   v_active boolean;
 begin
   perform public.f10_require_standard_session();
-  if not public.can_manage_business(p_business_id) then
+  if not public.can_manage_business(p_business_id)
+     and not exists (
+       select 1
+       from public.staff_profiles sp
+       join public.memberships m on m.id = sp.membership_id
+       where sp.business_id = p_business_id
+         and sp.id = p_staff_id
+         and m.user_id = auth.uid()
+         and m.active
+     ) then
     raise exception 'NOT_ALLOWED' using errcode = '42501';
   end if;
   if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb
```

## AP04 · A′ · strengthens · eş CP04 · aile: stale_token

Bayat yazma belirteci zorunlu oldu; eşzamanlı hizmet düzenlemeleri birbirinin üstüne sessizce yazamaz.

Olgular: `{"lock_context":true,"version_guard":false,"changed_inside_locked_region":true,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

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

## CP04 · C′ · no_effect · D2 · eş AP04

Hizmet fiyatı oluşturulduktan sonra bu fonksiyonla değiştirilemiyor; fiyat alanı yamadan, hesaplamadan ve güncellemeden çıkarıldı (yakalanan fiyat politikası).

Olgular: `{"lock_context":true,"version_guard":false,"changed_inside_locked_region":true,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

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

## AP05 · A′ · weakens · eş CP05 · aile: stale_token, surface_protective

Bayat yazma belirteci isteğe bağlı oldu; belirteçsiz eşzamanlı düzenleme kayıp güncelleme üretir.

Olgular: `{"lock_context":true,"version_guard":false,"changed_inside_locked_region":true,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

Fonksiyon: `public.update_service_guarded` (`supabase/migrations/20260915150000_f12_service_price_range.sql`)

```diff
@@ -314,8 +314,8 @@ begin
   where s.business_id = p_business_id and s.id = p_service_id
   for update;
   if not found then raise exception 'SERVICE_NOT_FOUND'; end if;
-  if p_expected_updated_at is null
-     or v_row.updated_at is distinct from p_expected_updated_at then
+  if p_expected_updated_at is not null
+     and v_row.updated_at is distinct from p_expected_updated_at then
     raise exception 'STALE_WRITE';
   end if;
 
```

## CP05 · C′ · no_effect · D2 · eş AP05

Fiyat politikası yeniden yazıldı: eski tek fiyat alanı mevcut fiyat tipini koruyup aralığı kaydırıyor, para birimi oluşturulduktan sonra değişmiyor (politika seçimi).

Olgular: `{"lock_context":true,"version_guard":false,"changed_inside_locked_region":true,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

Fonksiyon: `public.update_service_guarded` (`supabase/migrations/20260915150000_f12_service_price_range.sql`)

```diff
@@ -328,16 +328,15 @@ begin
     v_sort := case when p_patch ? 'sortOrder' then (p_patch->>'sortOrder')::integer else v_row.sort_order end;
     v_active := case when p_patch ? 'active' then (p_patch->>'active')::boolean else v_row.active end;
     v_legacy_price := p_patch ? 'priceMinor';
+    v_currency := v_row.currency;
     if v_legacy_price then
-      v_type := 'fixed';
+      v_type := v_row.price_type;
       v_min := (p_patch->>'priceMinor')::integer;
-      v_max := v_min;
-      v_currency := v_row.currency;
+      v_max := greatest(v_min, v_row.price_max_minor);
     else
-      v_type := case when p_patch ? 'priceType' then lower(trim(p_patch->>'priceType')) else v_row.price_type end;
-      v_min := case when p_patch ? 'priceMinMinor' then (p_patch->>'priceMinMinor')::integer else v_row.price_min_minor end;
-      v_max := case when p_patch ? 'priceMaxMinor' then (p_patch->>'priceMaxMinor')::integer else v_row.price_max_minor end;
-      v_currency := case when p_patch ? 'currency' then upper(trim(p_patch->>'currency')) else v_row.currency end;
+      v_type := coalesce(lower(trim(p_patch->>'priceType')), v_row.price_type);
+      v_min := coalesce((p_patch->>'priceMinMinor')::integer, v_row.price_min_minor);
+      v_max := coalesce((p_patch->>'priceMaxMinor')::integer, v_row.price_max_minor);
     end if;
   exception when others then
     raise exception 'INVALID_SERVICE';
```

## AP06 · A′ · strengthens · eş CP06 · aile: stale_token

Belirteçsiz istek, mevcut saatler boş değilse bayat sayılıyor; eşzamanlı iki değiştirmeden ikincisi ilkini körlemesine silemez.

Olgular: `{"lock_context":true,"version_guard":false,"changed_inside_locked_region":true,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

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

## CP06 · C′ · no_effect · D4 · eş AP06

06:00'dan önce başlayan aralıklar sessizce atlanıyor (zaman penceresi kuralı); çağrı aynı kilit altında.

Olgular: `{"lock_context":true,"version_guard":false,"changed_inside_locked_region":true,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

Fonksiyon: `public.replace_business_hours_guarded` (`supabase/migrations/20260914111600_f10_catalog_hours_limits.sql`)

```diff
@@ -44,7 +44,15 @@ begin
   if p_expected_intervals is not null and v_current is distinct from p_expected_intervals then
     raise exception 'STALE_WRITE';
   end if;
-  return query select * from public.replace_business_hours(p_business_id, p_weekday, p_intervals);
+  return query select * from public.replace_business_hours(
+    p_business_id,
+    p_weekday,
+    coalesce((
+      select jsonb_agg(e order by e->>'start')
+      from jsonb_array_elements(p_intervals) e
+      where (e->>'start')::time >= time '06:00'
+    ), '[]'::jsonb)
+  );
 end
 $$;
 
```

## AP07 · A′ · strengthens · eş CP07 · aile: stale_token

Belirteçsiz istek, mevcut personel saatleri boş değilse bayat sayılıyor; eşzamanlı değiştirmeler birbirini körlemesine ezemez.

Olgular: `{"lock_context":true,"version_guard":false,"changed_inside_locked_region":true,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

Fonksiyon: `public.replace_staff_hours_guarded` (`supabase/migrations/20260914111600_f10_catalog_hours_limits.sql`)

```diff
@@ -90,6 +90,9 @@ begin
     and h.staff_id = p_staff_id
     and h.weekday = p_weekday
     and h.active;
+  if p_expected_intervals is null and v_current <> '[]'::jsonb then
+    raise exception 'STALE_WRITE';
+  end if;
   if p_expected_intervals is not null and v_current is distinct from p_expected_intervals then
     raise exception 'STALE_WRITE';
   end if;
```

## CP07 · C′ · no_effect · D4 · eş AP07

Personel aralıklarının bitişi 23:00'e kırpılıyor (zaman penceresi kuralı); çağrı aynı kilit altında.

Olgular: `{"lock_context":true,"version_guard":false,"changed_inside_locked_region":true,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

Fonksiyon: `public.replace_staff_hours_guarded` (`supabase/migrations/20260914111600_f10_catalog_hours_limits.sql`)

```diff
@@ -94,7 +94,14 @@ begin
     raise exception 'STALE_WRITE';
   end if;
   return query select * from public.replace_staff_hours(
-    p_business_id, p_staff_id, p_weekday, p_intervals
+    p_business_id, p_staff_id, p_weekday,
+    coalesce((
+      select jsonb_agg(jsonb_build_object(
+        'start', e->>'start',
+        'end', to_char(least((e->>'end')::time, time '23:00'), 'HH24:MI')
+      ))
+      from jsonb_array_elements(p_intervals) e
+    ), '[]'::jsonb)
   );
 end
 $$;
```

## AP08 · A′ · strengthens · eş CP08 · aile: stale_token

Beklenen aralıklar belirteci zorunlu oldu; belirteçsiz eşzamanlı değiştirme artık reddediliyor.

Olgular: `{"lock_context":true,"version_guard":false,"changed_inside_locked_region":true,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

Fonksiyon: `public.replace_staff_hours_guarded` (`supabase/migrations/20260914111500_f10_catalog_hours_management.sql`)

```diff
@@ -473,7 +473,7 @@ begin
     and h.staff_id = p_staff_id
     and h.weekday = p_weekday
     and h.active;
-  if p_expected_intervals is not null and v_current is distinct from p_expected_intervals then
+  if p_expected_intervals is null or v_current is distinct from p_expected_intervals then
     raise exception 'STALE_WRITE';
   end if;
   return query select * from public.replace_staff_hours(
```

## CP08 · C′ · no_effect · D4 · eş AP08

ISO hafta günü 7 (pazar) 0'a çevriliyor; gün sınırı/takvim yorumu değişir. Eşleme en başta yapıldığı için kilit anahtarı ve veri aynı günü kullanır.

Olgular: `{"lock_context":true,"version_guard":false,"changed_inside_locked_region":false,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

Fonksiyon: `public.replace_staff_hours_guarded` (`supabase/migrations/20260914111500_f10_catalog_hours_management.sql`)

```diff
@@ -457,6 +457,7 @@ begin
   if not public.can_manage_business(p_business_id) then
     raise exception 'NOT_ALLOWED' using errcode = '42501';
   end if;
+  p_weekday := case when p_weekday = 7 then 0 else p_weekday end;
   if p_expected_intervals is not null and jsonb_typeof(p_expected_intervals) <> 'array' then
     raise exception 'INVALID_INTERVALS';
   end if;
```

## AP09 · A′ · weakens · eş CP09 · aile: key_scope, surface_protective

Advisory kilit anahtarı işletmeden personele daraltıldı; işletme geneli atama sayısı limiti artık serileşmiyor, farklı personel için eşzamanlı atamalar limiti birlikte aşar.

Olgular: `{"lock_context":true,"version_guard":false,"changed_inside_locked_region":true,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

Fonksiyon: `public.set_staff_service_guarded` (`supabase/migrations/20260914111700_f10_catalog_stale_hardening.sql`)

```diff
@@ -162,7 +162,7 @@ begin
   end if;
   if p_active is null then raise exception 'INVALID_ASSIGNMENT'; end if;
 
-  perform pg_advisory_xact_lock(hashtextextended('f10-04:assignments:' || p_business_id::text, 0));
+  perform pg_advisory_xact_lock(hashtextextended('f10-04:assignments:' || p_business_id::text || ':' || p_staff_id::text, 0));
   select * into v_row
   from public.staff_services ss
   where ss.business_id = p_business_id
```

## CP09 · C′ · no_effect · D3 · eş AP09 · aile: removed_predicate

Etkinleştirmede personelin aktif olması şartı kalktı; pasif personele hizmet atanabilir (personel/atama kuralı).

Olgular: `{"lock_context":true,"version_guard":false,"changed_inside_locked_region":true,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

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

## AP10 · A′ · strengthens · eş CP10 · aile: stale_token

Var olan atama için bayat yazma belirteci zorunlu oldu; eşzamanlı düzenlemeler birbirinin üstüne sessizce yazamaz.

Olgular: `{"lock_context":true,"version_guard":false,"changed_inside_locked_region":true,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

Fonksiyon: `public.set_staff_service_guarded` (`supabase/migrations/20260914111500_f10_catalog_hours_management.sql`)

```diff
@@ -348,8 +348,10 @@ begin
   for update;
   v_exists := found;
 
-  if v_exists and p_expected_updated_at is not null
-     and v_row.updated_at is distinct from p_expected_updated_at then
+  if v_exists and (
+       p_expected_updated_at is null
+       or v_row.updated_at is distinct from p_expected_updated_at
+     ) then
     raise exception 'STALE_WRITE';
   end if;
   if not v_exists and p_expected_updated_at is not null then
```

## CP10 · C′ · no_effect · D3 · eş AP10

Atama limitine yalnız aktif atamalar sayılıyor (kapasite kuralı); sayım aynı kilit altında.

Olgular: `{"lock_context":true,"version_guard":false,"changed_inside_locked_region":true,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

Fonksiyon: `public.set_staff_service_guarded` (`supabase/migrations/20260914111500_f10_catalog_hours_management.sql`)

```diff
@@ -380,7 +380,7 @@ begin
       raise exception 'ASSIGNMENT_NOT_FOUND';
     end if;
     select count(*) into v_count
-    from public.staff_services ss where ss.business_id = p_business_id;
+    from public.staff_services ss where ss.business_id = p_business_id and ss.active;
     if v_count >= 5000 then raise exception 'CATALOG_ASSIGNMENTS_LIMIT_EXCEEDED'; end if;
     insert into public.staff_services(business_id, staff_id, service_id, active)
     values(p_business_id, p_staff_id, p_service_id, p_active)
```

## AP11 · A′ · weakens · eş CP11 · aile: check_before_lock

Sayım ve limit kontrolü işletme satırı kilidinden önceye taşındı; eşzamanlı yüklemeler 20 limitini ve sort_order hesabını birlikte geçer.

Olgular: `{"lock_context":true,"version_guard":false,"changed_inside_locked_region":true,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

Fonksiyon: `public.begin_business_public_media_upload` (`supabase/migrations/20260914110500_f12_salon_profile_media.sql`)

```diff
@@ -306,6 +306,13 @@ begin
   if not public.can_manage_business(p_business_id) then
     raise exception 'NOT_ALLOWED' using errcode = '42501';
   end if;
+  select count(*), coalesce(max(m.sort_order), -1) + 1
+    into v_count, v_order
+  from public.business_public_media m
+  where m.business_id = p_business_id;
+
+  if v_count >= 20 then raise exception 'PUBLIC_MEDIA_LIMIT_EXCEEDED'; end if;
+
   perform 1 from public.businesses b where b.id = p_business_id for update;
   if not found then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
 
@@ -319,13 +326,6 @@ begin
     raise exception 'INVALID_PUBLIC_MEDIA';
   end if;
 
-  select count(*), coalesce(max(m.sort_order), -1) + 1
-    into v_count, v_order
-  from public.business_public_media m
-  where m.business_id = p_business_id;
-
-  if v_count >= 20 then raise exception 'PUBLIC_MEDIA_LIMIT_EXCEEDED'; end if;
-
   insert into public.business_public_media(
     id, business_id, storage_path, status, alt_text, sort_order,
     mime_type, size_bytes, width, height, created_by
```

## CP11 · C′ · no_effect · D3 · eş AP11

Görsel limiti kapak görseli seçilmiş işletmeler için 30, diğerleri için 20 (kaynak sınırı); kontrol kilit altında.

Olgular: `{"lock_context":true,"version_guard":false,"changed_inside_locked_region":true,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

Fonksiyon: `public.begin_business_public_media_upload` (`supabase/migrations/20260914110500_f12_salon_profile_media.sql`)

```diff
@@ -324,7 +324,15 @@ begin
   from public.business_public_media m
   where m.business_id = p_business_id;
 
-  if v_count >= 20 then raise exception 'PUBLIC_MEDIA_LIMIT_EXCEEDED'; end if;
+  if v_count >= case
+       when exists (
+         select 1 from public.business_public_profiles p
+         where p.business_id = p_business_id and p.cover_media_id is not null
+       ) then 30
+       else 20
+     end then
+    raise exception 'PUBLIC_MEDIA_LIMIT_EXCEEDED';
+  end if;
 
   insert into public.business_public_media(
     id, business_id, storage_path, status, alt_text, sort_order,
```

## AP12 · A′ · weakens · eş CP12 · aile: snapshot_refresh, surface_protective

Davet satırı kilitleniyor ama yeniden okunmuyor; iptal/kabul/süre kontrolleri kilit öncesi anlık görüntüde çalışıyor. Aynı işletme kilidini alan eşzamanlı bir iptal gözden kaçar.

Olgular: `{"lock_context":true,"version_guard":false,"changed_inside_locked_region":true,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

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

## CP12 · C′ · no_effect · D0 · eş AP12

Davet e-postasının tam eşleşmesi yerine yalnız alan adı eşleşmesi aranıyor ve yeniden etkinleşen üye eski rolünü koruyor (yetki kapsamı ve rol).

Olgular: `{"lock_context":true,"version_guard":false,"changed_inside_locked_region":true,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

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

## AP13 · A′ · weakens · eş CP13 · aile: key_scope, surface_protective

Advisory kilit anahtarı işletmeden müşteriye daraltıldı; iletişim bilgisi çakışma kontrolü, aynı işletme anahtarını kullanan müşteri oluşturma ile artık serileşmiyor, yinelenen iletişim oluşabilir.

Olgular: `{"lock_context":true,"version_guard":false,"changed_inside_locked_region":true,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

Fonksiyon: `public.update_business_customer` (`supabase/migrations/20260914110000_f10_customer_records.sql`)

```diff
@@ -323,7 +323,7 @@ begin
     raise exception 'NOTES_TOO_LONG';
   end if;
 
-  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text, 0));
+  perform pg_advisory_xact_lock(hashtextextended(p_customer_id::text, 0));
 
   select * into v_current
   from public.customers c
```

## CP13 · C′ · no_effect · D0 · eş AP13

Müşteri düzenleme yetkisi her aktif üyeden yöneticilere ve müşteriyi oluşturan üyeye daraldı (yetki kapsamı).

Olgular: `{"lock_context":true,"version_guard":false,"changed_inside_locked_region":false,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

Fonksiyon: `public.update_business_customer` (`supabase/migrations/20260914110000_f10_customer_records.sql`)

```diff
@@ -304,7 +304,14 @@ declare
   v_row public.customers;
 begin
   perform public.f10_require_standard_session();
-  if not public.is_active_member(p_business_id) then
+  if not public.can_manage_business(p_business_id)
+     and not exists (
+       select 1
+       from public.customers c
+       where c.business_id = p_business_id
+         and c.id = p_customer_id
+         and c.created_by = auth.uid()
+     ) then
     raise exception 'NOT_ALLOWED' using errcode = '42501';
   end if;
   if p_expected_updated_at is null then
```

## AP14 · A′ · weakens · eş CP14 · aile: clock_after_wait

Kilit beklemesinden sonraki zaman kaynağı clock_timestamp() yerine işlem başı now() oldu; uzun satır kilidi beklemesinden çıkan istek süresi dolmuş kiralamayla gönderim izni alabilir, işi geri alan başka işçiyle çakışır.

Olgular: `{"lock_context":true,"version_guard":false,"changed_inside_locked_region":true,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

Fonksiyon: `public.lock_notification_request_v2` (`supabase/migrations/20260912123000_s03_notification_consistency.sql`)

```diff
@@ -651,7 +651,7 @@ begin
   end if;
 
   -- now() is the transaction start; it can predate a long row-lock wait.
-  v_now := clock_timestamp();
+  v_now := now();
   if v_job.lease_expires_at is null or v_job.lease_expires_at <= v_now then
     raise exception 'NOTIFICATION_LEASE_EXPIRED';
   end if;
```

## CP14 · C′ · no_effect · D2 · eş AP14

Gönderen ve köken anlık görüntüleri ilk yakalanan değerde kalıyor (yakalanan durum politikası); güncelleme aynı kilit altında.

Olgular: `{"lock_context":true,"version_guard":false,"changed_inside_locked_region":true,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

Fonksiyon: `public.lock_notification_request_v2` (`supabase/migrations/20260912123000_s03_notification_consistency.sql`)

```diff
@@ -676,8 +676,8 @@ begin
   -- It survives lease reclamation/cancellation so a late real acceptance is kept.
   v_receipt_token := coalesce(v_job.receipt_token, gen_random_uuid());
   update public.appointment_notification_jobs
-  set sender_snapshot = btrim(p_sender),
-      origin_snapshot = p_origin,
+  set sender_snapshot = coalesce(sender_snapshot, btrim(p_sender)),
+      origin_snapshot = coalesce(origin_snapshot, p_origin),
       request_fingerprint = p_request_fingerprint,
       request_locked_at = coalesce(request_locked_at, v_now),
       first_provider_attempt_at = coalesce(first_provider_attempt_at, v_now),
```

## AP15 · A′ · strengthens · eş CP15 · aile: share_fence

Personel uygunluk okumasına paylaşımlı satır kilidi eklendi; personeli pasifleştiren veya atamayı kaldıran eşzamanlı işlemler (bu satırları FOR UPDATE ile kilitler) bu yeniden planlamayla serileşir.

Olgular: `{"lock_context":true,"version_guard":false,"changed_inside_locked_region":true,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

Fonksiyon: `public.reschedule_public_managed_appointment` (`supabase/migrations/20260911140000_phase7_customer_manage.sql`)

```diff
@@ -412,7 +412,8 @@ begin
    and ss.active
   where sp.business_id = v_current.business_id
     and sp.id = p_staff_id
-    and sp.active;
+    and sp.active
+  for share of sp, ss;
   if v_staff.id is null then raise exception 'STAFF_NOT_ELIGIBLE'; end if;
 
   v_today := (now() at time zone v_business_timezone)::date;
```

## CP15 · C′ · no_effect · D3 · eş AP15 · aile: removed_predicate

Personel uygunluğunda atamanın aktif olması şartı kalktı; pasif atamayla yeniden planlanabilir (atama kuralı).

Olgular: `{"lock_context":true,"version_guard":false,"changed_inside_locked_region":true,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

Fonksiyon: `public.reschedule_public_managed_appointment` (`supabase/migrations/20260911140000_phase7_customer_manage.sql`)

```diff
@@ -409,7 +409,6 @@ begin
     on ss.business_id = sp.business_id
    and ss.staff_id = sp.id
    and ss.service_id = v_current.service_id
-   and ss.active
   where sp.business_id = v_current.business_id
     and sp.id = p_staff_id
     and sp.active;
```

## AP16 · A′ · strengthens · eş CP16 · aile: share_fence

Personel uygunluk okumasına paylaşımlı satır kilidi eklendi; eşzamanlı personel pasifleştirme veya atama kaldırma bu yeniden planlamayla serileşir.

Olgular: `{"lock_context":true,"version_guard":false,"changed_inside_locked_region":true,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

Fonksiyon: `public.reschedule_appointment` (`supabase/migrations/20260911121000_phase5_booking_hardening.sql`)

```diff
@@ -371,7 +371,8 @@ begin
    and ss.staff_id = sp.id
    and ss.service_id = v_current.service_id
    and ss.active
-  where sp.business_id = p_business_id and sp.id = p_staff_id and sp.active;
+  where sp.business_id = p_business_id and sp.id = p_staff_id and sp.active
+  for share of sp, ss;
   if v_staff.id is null then raise exception 'STAFF_NOT_ELIGIBLE'; end if;
 
   select b.timezone into v_timezone
```

## CP16 · C′ · no_effect · D0 · eş AP16

Yeniden planlama yetkisi her aktif üyeden yöneticilere ve randevuya atanmış personelin üyesine daraldı (yetki kapsamı).

Olgular: `{"lock_context":true,"version_guard":false,"changed_inside_locked_region":false,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

Fonksiyon: `public.reschedule_appointment` (`supabase/migrations/20260911121000_phase5_booking_hardening.sql`)

```diff
@@ -335,7 +335,20 @@ declare
   v_old_staff_id uuid;
   v_old_timezone text;
 begin
-  if auth.uid() is null or not public.is_active_member(p_business_id) then
+  if auth.uid() is null
+     or not (
+       public.can_manage_business(p_business_id)
+       or exists (
+         select 1
+         from public.appointments a
+         join public.staff_profiles sp on sp.id = a.staff_id
+         join public.memberships m on m.id = sp.membership_id
+         where a.business_id = p_business_id
+           and a.id = p_appointment_id
+           and m.user_id = auth.uid()
+           and m.active
+       )
+     ) then
     raise exception 'NOT_ALLOWED';
   end if;
 
```

## BP01 · B′ · weakens · eş DP01 · aile: window_boundary

Pencere karşılaştırması ">=" yerine "=" oldu (s04 onarımının geri alınması); pencere sınırında geç kalan eski bir istek sayacı eski pencereye döndürüp sıfırlar, eşzamanlı istekler limiti aşar.

Olgular: `{"lock_context":false,"version_guard":false,"changed_inside_locked_region":false,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

Fonksiyon: `public.consume_public_booking_rate` (`supabase/migrations/20260913030912_s04_resource_limits.sql`)

```diff
@@ -48,12 +48,12 @@ begin
   )
   on conflict (action, dimension, key_hash) do update
   set window_started_at = case
-        when public.public_booking_rate_counters.window_started_at >= v_window_start
+        when public.public_booking_rate_counters.window_started_at = v_window_start
           then public.public_booking_rate_counters.window_started_at
         else v_window_start
       end,
       count = case
-        when public.public_booking_rate_counters.window_started_at >= v_window_start
+        when public.public_booking_rate_counters.window_started_at = v_window_start
           then public.public_booking_rate_counters.count + 1
         else 1
       end,
```

## DP01 · D′ · no_effect · D3 · eş BP01

Limit sınırı bir eksildi ("> limit" yerine ">= limit"); pencere başına izin verilen istek sayısı (kaynak sınırı) değişir.

Olgular: `{"lock_context":false,"version_guard":false,"changed_inside_locked_region":false,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

Fonksiyon: `public.consume_public_booking_rate` (`supabase/migrations/20260913030912_s04_resource_limits.sql`)

```diff
@@ -60,7 +60,7 @@ begin
       updated_at = v_now
   returning count, window_started_at into v_count, v_window_start;
 
-  if v_count > p_limit then
+  if v_count >= p_limit then
     v_retry_after := greatest(
       1,
       ceil(extract(epoch from (
```

## BP02 · B′ · strengthens · eş DP02 · aile: window_boundary

Pencere karşılaştırması "=" yerine ">=" oldu (gerçek s04 onarımı); pencere sınırında geç kalan eski istek sayacı geri sarıp sıfırlayamaz, yeni pencereyi artırır.

Olgular: `{"lock_context":false,"version_guard":false,"changed_inside_locked_region":false,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

Fonksiyon: `public.consume_public_booking_rate` (`supabase/migrations/20260911180000_phase9_public_abuse_control.sql`)

```diff
@@ -98,12 +98,12 @@ begin
   )
   on conflict (action, dimension, key_hash) do update
   set window_started_at = case
-        when public.public_booking_rate_counters.window_started_at = v_window_start
+        when public.public_booking_rate_counters.window_started_at >= v_window_start
           then public.public_booking_rate_counters.window_started_at
         else v_window_start
       end,
       count = case
-        when public.public_booking_rate_counters.window_started_at = v_window_start
+        when public.public_booking_rate_counters.window_started_at >= v_window_start
           then public.public_booking_rate_counters.count + 1
         else 1
       end,
```

## DP02 · D′ · no_effect · D4 · eş BP02

Pencere başlangıcı pencere uzunluğuna göre değil dakikaya göre hizalanıyor (zaman penceresi sınırı değişir).

Olgular: `{"lock_context":false,"version_guard":false,"changed_inside_locked_region":false,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

Fonksiyon: `public.consume_public_booking_rate` (`supabase/migrations/20260911180000_phase9_public_abuse_control.sql`)

```diff
@@ -87,9 +87,7 @@ begin
     raise exception 'PUBLIC_BOOKING_GATE_INVALID_PROOF';
   end if;
 
-  v_window_start := to_timestamp(
-    floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds
-  );
+  v_window_start := date_trunc('minute', v_now);
 
   insert into public.public_booking_rate_counters(
     action, dimension, key_hash, window_started_at, count, updated_at
```

## BP03 · B′ · weakens · eş DP03 · aile: lease_guard, removed_predicate

Deneme bütçesi dalında etkin kiralama koruması kaldırıldı; bakım, bir işçi gönderim yaparken işi sonlandırıp kiralama belirtecini siler.

Olgular: `{"lock_context":false,"version_guard":false,"changed_inside_locked_region":false,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

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

## DP03 · D′ · no_effect · D4 · eş BP03

Onay bildirimleri için yeniden deneme süresi dolumuna 5 dakikalık tolerans tanındı (iş türüne göre zaman sınırı).

Olgular: `{"lock_context":false,"version_guard":false,"changed_inside_locked_region":false,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

Fonksiyon: `public.maintain_notification_jobs` (`supabase/migrations/20260911170100_phase9_notification_maintenance.sql`)

```diff
@@ -61,7 +61,10 @@ begin
       updated_at = now()
   where j.state not in ('sent','failed_terminal')
     and (
-      j.retry_until <= now()
+      j.retry_until <= now() - case
+        when j.kind = 'public_booking_confirmation' then interval '5 minutes'
+        else interval '0 minutes'
+      end
       or (
         j.attempt_count >= j.max_attempts
         and (j.state <> 'leased' or j.lease_expires_at <= now())
```

## BP04 · B′ · strengthens · eş DP04 · aile: lease_guard

Süre dolumu dalına etkin kiralama koruması eklendi; bakım, gönderim yapan bir işçinin işini artık altından sonlandırmaz.

Olgular: `{"lock_context":false,"version_guard":false,"changed_inside_locked_region":false,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

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

## DP04 · D′ · no_effect · D2 · eş BP04

Sonlandırmada daha önce yakalanmış hata sınıfı ve ayrıntılı nedenler korunmuyor, hepsi tek sabit etiketle ezilir (geçmiş değerin yeniden yazılması).

Olgular: `{"lock_context":false,"version_guard":false,"changed_inside_locked_region":false,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

Fonksiyon: `public.maintain_notification_jobs` (`supabase/migrations/20260912123000_s03_notification_consistency.sql`)

```diff
@@ -850,13 +850,7 @@ begin
   update public.appointment_notification_jobs j
   set state = 'failed_terminal',
       terminal_at = coalesce(j.terminal_at, now()),
-      last_error_class = case
-        when not j.is_current then 'stale_notification_event'
-        when j.delivery_certainty = 'ambiguous'
-          and j.provider_idempotency_expires_at <= now()
-          then 'idempotency_window_expired_ambiguous'
-        else coalesce(j.last_error_class, 'retry_budget_exhausted')
-      end,
+      last_error_class = 'retry_budget_exhausted',
       lease_token = null,
       lease_expires_at = null,
       updated_at = now()
```

## BP05 · B′ · strengthens · eş DP05 · aile: lease_guard

Süre dolumu dalına etkin kiralama koruması eklendi; bakım, gönderim yapan işçinin işini altından sonlandırmaz.

Olgular: `{"lock_context":false,"version_guard":false,"changed_inside_locked_region":false,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

Fonksiyon: `public.maintain_notification_jobs` (`supabase/migrations/20260913120601_s07_public_booking_resolution.sql`)

```diff
@@ -695,7 +695,7 @@ begin
     and (
       not j.is_current
       or (j.delivery_certainty = 'ambiguous' and j.provider_idempotency_expires_at <= now())
-      or j.retry_until <= now()
+      or (j.retry_until <= now() and (j.state <> 'leased' or j.lease_expires_at <= now()))
       or (j.attempt_count >= j.max_attempts and (j.state <> 'leased' or j.lease_expires_at <= now()))
     );
   get diagnostics v_count = row_count;
```

## DP05 · D′ · no_effect · D4 · eş BP05

Belirsiz teslimatlarda sağlayıcı tekilleştirme penceresi 1 dakika tolerans sonrası kapanmış sayılıyor (zaman sınırı).

Olgular: `{"lock_context":false,"version_guard":false,"changed_inside_locked_region":false,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

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

## BP06 · B′ · weakens · eş DP06 · aile: cas_predicate, removed_predicate

Koşullu geçişin "pending" durum koşulu kaldırıldı; eşzamanlı silme/temizleme sürecindeki görsel tekrar "ready" yapılabilir.

Olgular: `{"lock_context":false,"version_guard":false,"changed_inside_locked_region":false,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

Fonksiyon: `public.finalize_business_public_media_upload` (`supabase/migrations/20260914110500_f12_salon_profile_media.sql`)

```diff
@@ -360,7 +360,7 @@ begin
   if not public.can_manage_business(p_business_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
   update public.business_public_media m
   set status = 'ready'
-  where m.business_id = p_business_id and m.id = p_media_id and m.status = 'pending'
+  where m.business_id = p_business_id and m.id = p_media_id
   returning * into v_row;
   if v_row.id is null then raise exception 'PUBLIC_MEDIA_STATE_CONFLICT'; end if;
   return v_row;
```

## DP06 · D′ · no_effect · D0 · eş BP06

Yüklemeyi sonlandırma yetkisi yöneticiye ek olarak görseli yükleyen aktif üyeye de verildi (yetki kapsamı).

Olgular: `{"lock_context":false,"version_guard":false,"changed_inside_locked_region":false,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

Fonksiyon: `public.finalize_business_public_media_upload` (`supabase/migrations/20260914110500_f12_salon_profile_media.sql`)

```diff
@@ -357,7 +357,15 @@ as $$
 declare v_row public.business_public_media;
 begin
   perform public.f10_require_standard_session();
-  if not public.can_manage_business(p_business_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
+  if not public.can_manage_business(p_business_id)
+     and not exists (
+       select 1 from public.business_public_media m
+       where m.business_id = p_business_id
+         and m.id = p_media_id
+         and m.created_by = auth.uid()
+     ) then
+    raise exception 'NOT_ALLOWED' using errcode = '42501';
+  end if;
   update public.business_public_media m
   set status = 'ready'
   where m.business_id = p_business_id and m.id = p_media_id and m.status = 'pending'
```

## BP07 · B′ · weakens · eş DP07 · aile: check_then_act

Koşullu silme "önce bak, sonra id ile sil"e bölündü; kontrolle silme arasında eşzamanlı bir geri yükleme görseli "ready" yaparsa görsel yine silinir.

Olgular: `{"lock_context":false,"version_guard":false,"changed_inside_locked_region":false,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

Fonksiyon: `public.finish_business_public_media_delete` (`supabase/migrations/20260914110500_f12_salon_profile_media.sql`)

```diff
@@ -452,8 +452,14 @@ declare v_count integer;
 begin
   perform public.f10_require_standard_session();
   if not public.can_manage_business(p_business_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
+  if not exists (
+    select 1 from public.business_public_media m
+    where m.business_id = p_business_id and m.id = p_media_id and m.status in ('deleting','cleanup')
+  ) then
+    return false;
+  end if;
   delete from public.business_public_media m
-  where m.business_id = p_business_id and m.id = p_media_id and m.status in ('deleting','cleanup');
+  where m.business_id = p_business_id and m.id = p_media_id;
   get diagnostics v_count = row_count;
   return v_count = 1;
 end
```

## DP07 · D′ · no_effect · D0 · eş BP07 · aile: removed_predicate

Silme koşulundan işletme kapsamı kaldırıldı; başka işletmenin görseli id ile silinebilir (kiracı yalıtımı).

Olgular: `{"lock_context":false,"version_guard":false,"changed_inside_locked_region":false,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

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

## BP08 · B′ · weakens · eş DP08 · aile: check_then_act

Koşullu geçiş "önce oku, uygunsa id ile güncelle"ye bölündü; okuma ile yazma arasında eşzamanlı bir geri yükleme görseli "ready" yaparsa temizlemeye yine alınır.

Olgular: `{"lock_context":false,"version_guard":false,"changed_inside_locked_region":false,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

Fonksiyon: `public.mark_business_public_media_cleanup` (`supabase/migrations/20260914110500_f12_salon_profile_media.sql`)

```diff
@@ -378,10 +378,16 @@ declare v_row public.business_public_media;
 begin
   perform public.f10_require_standard_session();
   if not public.can_manage_business(p_business_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
-  update public.business_public_media m
-  set status = 'cleanup'
-  where m.business_id = p_business_id and m.id = p_media_id and m.status in ('pending','deleting')
-  returning * into v_row;
+  select * into v_row from public.business_public_media m
+  where m.business_id = p_business_id and m.id = p_media_id;
+  if v_row.status in ('pending','deleting') then
+    update public.business_public_media m
+    set status = 'cleanup'
+    where m.business_id = p_business_id and m.id = p_media_id
+    returning * into v_row;
+  else
+    v_row := null;
+  end if;
   if v_row.id is null then
     select * into v_row from public.business_public_media m
     where m.business_id = p_business_id and m.id = p_media_id and m.status = 'cleanup';
```

## DP08 · D′ · no_effect · D0 · eş BP08 · aile: removed_predicate

Yedek okumadan işletme kapsamı kaldırıldı; başka işletmenin temizlemedeki görseli döndürülebilir (kiracı yalıtımı).

Olgular: `{"lock_context":false,"version_guard":false,"changed_inside_locked_region":false,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

Fonksiyon: `public.mark_business_public_media_cleanup` (`supabase/migrations/20260914110500_f12_salon_profile_media.sql`)

```diff
@@ -384,7 +384,7 @@ begin
   returning * into v_row;
   if v_row.id is null then
     select * into v_row from public.business_public_media m
-    where m.business_id = p_business_id and m.id = p_media_id and m.status = 'cleanup';
+    where m.id = p_media_id and m.status = 'cleanup';
   end if;
   return v_row;
 end
```

## BP09 · B′ · strengthens · eş DP09 · aile: upsert_semantics

Kapak geri yükleme yalnız kapak boşsa yazıyor; arada eşzamanlı bir profil güncellemesinin seçtiği yeni kapak artık ezilmez.

Olgular: `{"lock_context":false,"version_guard":false,"changed_inside_locked_region":false,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

Fonksiyon: `public.restore_business_public_media_delete` (`supabase/migrations/20260914110500_f12_salon_profile_media.sql`)

```diff
@@ -435,7 +435,8 @@ begin
   if coalesce(p_restore_cover, false) then
     insert into public.business_public_profiles(business_id, cover_media_id)
     values (p_business_id, p_media_id)
-    on conflict (business_id) do update set cover_media_id = excluded.cover_media_id;
+    on conflict (business_id) do update set cover_media_id = excluded.cover_media_id
+    where public.business_public_profiles.cover_media_id is null;
   end if;
   return v_row;
 end
```

## DP09 · D′ · no_effect · D2 · eş BP09

Kapak geri yükleme varsayılan politikası "hayır"dan "evet"e döndü (politika seçimi).

Olgular: `{"lock_context":false,"version_guard":false,"changed_inside_locked_region":false,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

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

## BP10 · B′ · strengthens · eş DP10 · aile: check_then_act

Ön kontrolden sonraki ekleme çakışmada hiçbir şey yapmıyor ve mevcut belirteci yeniden karşılaştırıyor; kontrol ile ekleme arasındaki yarışta ikinci eşzamanlı kurulum ham hata yerine doğru sonuca ulaşır.

Olgular: `{"lock_context":false,"version_guard":false,"changed_inside_locked_region":false,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

Fonksiyon: `public.provision_public_management_token` (`supabase/migrations/20260911140000_phase7_customer_manage.sql`)

```diff
@@ -98,7 +98,17 @@ begin
     appointment_id, business_id, token_hash
   ) values (
     p_appointment_id, v_business_id, v_hash
-  );
+  )
+  on conflict (appointment_id) do nothing;
+
+  if not found then
+    select c.token_hash into v_existing
+    from public.appointment_management_capabilities c
+    where c.appointment_id = p_appointment_id;
+    if v_existing <> v_hash then
+      raise exception 'MANAGEMENT_TOKEN_ALREADY_PROVISIONED';
+    end if;
+  end if;
 
   return true;
 end
```

## DP10 · D′ · no_effect · D0 · eş BP10 · aile: removed_predicate

Başlangıç koşulundan randevu kaynağı şartı kaldırıldı; işletme tarafından oluşturulmuş randevulara da herkese açık yönetim belirteci kurulabilir (yetki kapsamı).

Olgular: `{"lock_context":false,"version_guard":false,"changed_inside_locked_region":false,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

Fonksiyon: `public.provision_public_management_token` (`supabase/migrations/20260911140000_phase7_customer_manage.sql`)

```diff
@@ -72,7 +72,6 @@ begin
   join public.appointments a
     on a.business_id = bc.business_id
    and a.id = bc.appointment_id
-   and a.source = 'public'
   where bc.appointment_id = p_appointment_id
     and bc.idempotency_key = p_booking_idempotency_key
     and bc.command = 'public_create'
```

## BP11 · B′ · weakens · eş DP11 · aile: helper_delegation

Seri hale getiren müşteri çözümleyici çağrısı yerine kilitsiz "bul, yoksa ekle"; aynı yeni iletişim bilgisiyle eşzamanlı iki herkese açık randevu iki ayrı müşteri kaydı oluşturur.

Olgular: `{"lock_context":false,"version_guard":false,"changed_inside_locked_region":false,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

Fonksiyon: `public.create_public_appointment` (`supabase/migrations/20260914110200_f10_customer_authority_repair.sql`)

```diff
@@ -442,15 +442,20 @@ begin
     raise exception 'SLOT_UNAVAILABLE';
   end if;
 
-  v_customer_id := public.f10_resolve_or_create_customer(
-    v_business_id,
-    v_customer_name,
-    v_customer_phone,
-    v_customer_email,
-    null,
-    null,
-    true
-  );
+  select c.id into v_customer_id
+  from public.customers c
+  where c.business_id = v_business_id
+    and (
+      (v_customer_phone is not null and c.phone = v_customer_phone)
+      or (v_customer_email is not null and c.email = v_customer_email)
+    )
+  limit 1;
+
+  if v_customer_id is null then
+    insert into public.customers(business_id, name, phone, email, created_by)
+    values (v_business_id, v_customer_name, v_customer_phone, v_customer_email, null)
+    returning id into v_customer_id;
+  end if;
 
   begin
     insert into public.appointments(
```

## DP11 · D′ · no_effect · D3 · eş BP11 · aile: removed_predicate

Personel uygunluğunda personelin aktif olması şartı kalktı; pasif personele herkese açık randevu alınabilir (personel kuralı).

Olgular: `{"lock_context":false,"version_guard":false,"changed_inside_locked_region":false,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

Fonksiyon: `public.create_public_appointment` (`supabase/migrations/20260914110200_f10_customer_authority_repair.sql`)

```diff
@@ -430,8 +430,7 @@ begin
    and ss.service_id = p_service_id
    and ss.active
   where sp.business_id = v_business_id
-    and sp.id = p_staff_id
-    and sp.active;
+    and sp.id = p_staff_id;
   if v_staff.id is null then raise exception 'STAFF_NOT_ELIGIBLE'; end if;
 
   if not exists (
```

## BP12 · B′ · weakens · eş DP12 · aile: upsert_semantics

Tek ifadelik upsert "güncelle, bulamazsan ekle"ye bölündü; profil satırı otomatik oluşturulmadığı için ilk kaydı yapan eşzamanlı iki istekten ikincisi benzersizlik hatası alır.

Olgular: `{"lock_context":false,"version_guard":false,"changed_inside_locked_region":false,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

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

## DP12 · D′ · no_effect · D2 · eş BP12

Varsayılan politikalar değişti: çalışma saatleri varsayılan olarak gizli, boş herkese açık ad işletme adıyla dolduruluyor (politika seçimi).

Olgular: `{"lock_context":false,"version_guard":false,"changed_inside_locked_region":false,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

Fonksiyon: `public.update_business_public_profile` (`supabase/migrations/20260914110500_f12_salon_profile_media.sql`)

```diff
@@ -246,9 +246,11 @@ begin
     public_phone, public_email, public_website, public_whatsapp, address_text,
     show_work_hours, cover_media_id
   ) values (
-    p_business_id, v_public_name, v_short, v_long,
+    p_business_id,
+    coalesce(v_public_name, (select b.name from public.businesses b where b.id = p_business_id)),
+    v_short, v_long,
     v_phone, v_email, v_website, v_whatsapp, v_address,
-    coalesce(p_show_work_hours, true), p_cover_media_id
+    coalesce(p_show_work_hours, false), p_cover_media_id
   )
   on conflict (business_id) do update
   set public_name = excluded.public_name,
```

## BP13 · B′ · weakens · eş DP13 · aile: cas_predicate, removed_predicate

Tamamlamanın gönderim makbuzu koşulu kaldırıldı; aynı iş için başka bir kiralama altında üretilmiş eski bir tamamlama isteği de işi "gönderildi" yapabilir.

Olgular: `{"lock_context":false,"version_guard":false,"changed_inside_locked_region":false,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

Fonksiyon: `public.complete_notification_job_v2` (`supabase/migrations/20260912123000_s03_notification_consistency.sql`)

```diff
@@ -731,7 +731,6 @@ begin
       delivery_certainty = 'accepted',
       updated_at = now()
   where j.id = p_job_id
-    and j.receipt_token = p_receipt_token
     and j.request_fingerprint = p_request_fingerprint
     and (j.provider_message_id is null or j.provider_message_id = p_provider_message_id);
 
```

## DP13 · D′ · no_effect · D2 · eş BP13

Gönderim zamanı ve sağlayıcı mesaj kimliği ilk kaydedilen değerde kalıyor (geçmiş değer semantiği).

Olgular: `{"lock_context":false,"version_guard":false,"changed_inside_locked_region":false,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

Fonksiyon: `public.complete_notification_job_v2` (`supabase/migrations/20260912123000_s03_notification_consistency.sql`)

```diff
@@ -722,8 +722,8 @@ begin
 
   update public.appointment_notification_jobs j
   set state = 'sent',
-      provider_message_id = p_provider_message_id,
-      sent_at = now(),
+      provider_message_id = coalesce(j.provider_message_id, p_provider_message_id),
+      sent_at = coalesce(j.sent_at, now()),
       terminal_at = now(),
       last_error_class = null,
       lease_token = null,
```

## BP14 · B′ · strengthens · eş DP14 · aile: helper_delegation

Hızlı arama korunuyor, ama müşteri bulunamazsa yarışa açık doğrudan ekleme yerine seri hale getiren müşteri çözümleyici çağrılıyor; aynı yeni iletişim bilgisiyle gelen eşzamanlı randevular yinelenen müşteri oluşturamaz.

Olgular: `{"lock_context":false,"version_guard":false,"changed_inside_locked_region":false,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

Fonksiyon: `public.create_appointment` (`supabase/migrations/20260911121000_phase5_booking_hardening.sql`)

```diff
@@ -260,9 +260,9 @@ begin
   limit 1;
 
   if v_customer_id is null then
-    insert into public.customers(business_id, name, phone, email, created_by)
-    values(p_business_id, v_customer_name, v_customer_phone, v_customer_email, auth.uid())
-    returning id into v_customer_id;
+    v_customer_id := public.f10_resolve_or_create_customer(
+      p_business_id, v_customer_name, v_customer_phone, v_customer_email, null, auth.uid(), true
+    );
   else
     update public.customers
     set name = v_customer_name,
```

## DP14 · D′ · no_effect · D4 · eş BP14

Randevunun takvim günü işletme saat diliminde değil UTC'de hesaplanıyor (yerel gün dönüşümü).

Olgular: `{"lock_context":false,"version_guard":false,"changed_inside_locked_region":false,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

Fonksiyon: `public.create_appointment` (`supabase/migrations/20260911121000_phase5_booking_hardening.sql`)

```diff
@@ -236,7 +236,7 @@ begin
   from public.businesses where id = p_business_id;
   if v_timezone is null then raise exception 'BUSINESS_NOT_FOUND'; end if;
 
-  v_date := (p_starts_at at time zone v_timezone)::date;
+  v_date := (p_starts_at at time zone 'UTC')::date;
   if not exists (
     select 1
     from public.compute_availability_slots_internal(
```

## BP15 · B′ · strengthens · eş DP15 · aile: helper_delegation

Hızlı arama korunuyor, ama müşteri bulunamazsa yarışa açık doğrudan ekleme yerine seri hale getiren müşteri çözümleyici çağrılıyor; aynı yeni iletişim bilgisiyle gelen eşzamanlı randevular yinelenen müşteri oluşturamaz.

Olgular: `{"lock_context":false,"version_guard":false,"changed_inside_locked_region":false,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

Fonksiyon: `public.create_appointment` (`supabase/migrations/20260911120000_phase5_booking_core.sql`)

```diff
@@ -519,9 +519,9 @@ begin
   limit 1;
 
   if v_customer_id is null then
-    insert into public.customers(business_id, name, phone, email, created_by)
-    values(p_business_id, v_customer_name, v_customer_phone, v_customer_email, auth.uid())
-    returning id into v_customer_id;
+    v_customer_id := public.f10_resolve_or_create_customer(
+      p_business_id, v_customer_name, v_customer_phone, v_customer_email, null, auth.uid(), true
+    );
   else
     update public.customers
     set name = v_customer_name,
```

## DP15 · D′ · no_effect · D3 · eş BP15 · aile: removed_predicate

Personel uygunluğunda atamanın aktif olması şartı kalktı; pasif atamayla randevu alınabilir (atama kuralı).

Olgular: `{"lock_context":false,"version_guard":false,"changed_inside_locked_region":false,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

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

## BP16 · B′ · strengthens · eş DP16 · aile: helper_delegation

Hızlı arama korunuyor, ama müşteri bulunamazsa yarışa açık doğrudan ekleme yerine seri hale getiren müşteri çözümleyici çağrılıyor; aynı yeni iletişim bilgisiyle gelen eşzamanlı randevular yinelenen müşteri oluşturamaz.

Olgular: `{"lock_context":false,"version_guard":false,"changed_inside_locked_region":false,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

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

## DP16 · D′ · no_effect · D3 · eş BP16 · aile: removed_predicate

Personel uygunluğunda atamanın bu hizmete ait olması şartı kalktı; personelin herhangi bir aktif ataması yeterli (personel/hizmet eşleşme kuralı).

Olgular: `{"lock_context":false,"version_guard":false,"changed_inside_locked_region":false,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

Fonksiyon: `public.create_public_appointment` (`supabase/migrations/20260911130000_phase6_public_booking.sql`)

```diff
@@ -533,7 +533,6 @@ begin
   join public.staff_services ss
     on ss.business_id = sp.business_id
    and ss.staff_id = sp.id
-   and ss.service_id = p_service_id
    and ss.active
   where sp.business_id = v_business_id
     and sp.id = p_staff_id
```

