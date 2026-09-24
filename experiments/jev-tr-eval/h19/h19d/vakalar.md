# H19d vakaları (vakalar.v0.1.json, okunur liste)

## PS01 · PS · yes (yalnız D5) · weakens · aile: stale_token

Sürüm belirteci isteğe bağlı oldu; belirteç göndermeyen eşzamanlı güncelleme başka bir güncellemenin üstüne sessizce yazar.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":1,"changed":2,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.update_product_guarded` (`supabase/migrations/20260923051000_f15_product_stock_ledger.sql`)

```diff
@@ -658,7 +658,7 @@ begin
 
   if v_product.id is null then raise exception 'PRODUCT_NOT_FOUND'; end if;
   if not v_product.active then raise exception 'PRODUCT_ARCHIVED'; end if;
-  if p_expected_version is null or v_product.version <> p_expected_version then raise exception 'STALE_WRITE'; end if;
+  if p_expected_version is not null and v_product.version <> p_expected_version then raise exception 'STALE_WRITE'; end if;
 
   if char_length(v_name) not between 1 and 120 then raise exception 'INVALID_PRODUCT_NAME'; end if;
   if v_code is not null and (char_length(v_code) not between 1 and 64 or v_code !~ '^[A-Z0-9][A-Z0-9._-]*$') then
```

## PS02 · PS · yes (yalnız D5) · weakens · aile: lock_removal

Ürün satırı kilidi kaldırıldı; sürüm ve bakiye kilitsiz okunuyor, güncelleme koşulsuz: eşzamanlı iki ters kayıt aynı sürümü görüp bakiyeyi yanlış hesaplar.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":2,"changed":3,"removed_where_and":1,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `public.reverse_product_stock_movement_guarded` (`supabase/migrations/20260923051000_f15_product_stock_ledger.sql`)

```diff
@@ -854,8 +854,7 @@ begin
 
   select * into v_product
   from public.products p
-  where p.business_id = p_business_id and p.id = p_product_id
-  for update;
+  where p.business_id = p_business_id and p.id = p_product_id;
 
   if v_product.id is null then raise exception 'PRODUCT_NOT_FOUND'; end if;
   if not v_product.active then raise exception 'PRODUCT_ARCHIVED'; end if;
```

## PS03 · PS · yes (yalnız D5) · weakens · aile: lock_removal · fonksiyon yeniden kullanıldı

Randevu satırı kilidi kaldırıldı; durum geçişi kilitsiz okumayla doğrulanıyor ve güncelleme durum koşulu taşımıyor: eşzamanlı iki geçiş birlikte geçer.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":2,"changed":3,"removed_where_and":1,"added_exists_select":0,"removed_predicate":1}`

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

## PS04 · PS · yes (yalnız D5) · weakens · aile: lock_removal · fonksiyon yeniden kullanıldı

Fiş satırı kilidi kaldırıldı; durum ve sürüm kilitsiz okunuyor, iptal güncellemesi koşulsuz: eşzamanlı kapatma ile iptal birlikte geçer.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":2,"changed":3,"removed_where_and":1,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `public.cancel_ticket_guarded` (`supabase/migrations/20260922111500_f14_ticket_model.sql`)

```diff
@@ -1024,8 +1024,7 @@ begin
 
   select * into v_ticket
   from public.tickets t
-  where t.business_id = p_business_id and t.id = p_ticket_id
-  for update;
+  where t.business_id = p_business_id and t.id = p_ticket_id;
   if v_ticket.id is null then raise exception 'TICKET_NOT_FOUND'; end if;
   if v_ticket.status <> 'open' then raise exception 'TICKET_NOT_OPEN'; end if;
   if p_expected_version is null or v_ticket.version <> p_expected_version then
```

## PS05 · PS · yes (yalnız D5) · weakens · aile: lock_removal · fonksiyon yeniden kullanıldı

Hizmet satırı kilidi kaldırıldı; bayat yazma kontrolü kilitsiz okumada ve güncelleme koşulsuz: aynı belirteçle eşzamanlı iki düzenleme birlikte geçer.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":2,"changed":3,"removed_where_and":1,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `public.update_service_guarded` (`supabase/migrations/20260915150000_f12_service_price_range.sql`)

```diff
@@ -311,8 +311,7 @@ begin
 
   select * into v_row
   from public.services s
-  where s.business_id = p_business_id and s.id = p_service_id
-  for update;
+  where s.business_id = p_business_id and s.id = p_service_id;
   if not found then raise exception 'SERVICE_NOT_FOUND'; end if;
   if p_expected_updated_at is null
      or v_row.updated_at is distinct from p_expected_updated_at then
```

## PS06 · PS · yes (yalnız D5) · weakens · aile: cas_predicate · fonksiyon yeniden kullanıldı

Tamamlamanın kiralama belirteci koşulu kaldırıldı; kiralaması düşmüş eski bir işçi, işi yeniden kiralamış başka işçinin işini "gönderildi" yapabilir.

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":false,"added":0,"removed":1,"changed":1,"removed_where_and":1,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `public.complete_notification_job` (`supabase/migrations/20260911170000_phase9_notification_outbox.sql`)

```diff
@@ -316,7 +316,6 @@ begin
       updated_at = now()
   where j.id = p_job_id
     and j.state = 'leased'
-    and j.lease_token = p_lease_token
   returning j.recovery_id into v_recovery_id;
 
   get diagnostics v_updated = row_count;
```

## PS07 · PS · yes (yalnız D5) · weakens · aile: cas_predicate · fonksiyon yeniden kullanıldı

Geri yüklemenin "deleting" durum koşulu kaldırıldı; eşzamanlı olarak silinmesi bitirilen ya da temizlemeye alınan görsel tekrar "ready" yapılabilir.

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":false,"added":1,"removed":1,"changed":2,"removed_where_and":1,"added_exists_select":0,"removed_predicate":1}`

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

## PS08 · PS · yes (yalnız D5) · weakens · aile: lock_removal

Kaynak gider satırı kilidi kaldırıldı; "zaten ters kaydedilmiş" kontrolü serileşmiyor, eşzamanlı iki ters kayıt birlikte geçer.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":2,"changed":3,"removed_where_and":1,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `public.reverse_expense_guarded` (`supabase/migrations/20260923074000_f15_expense_ledger.sql`)

```diff
@@ -428,8 +428,7 @@ begin
   from public.expense_events e
   where e.business_id=p_business_id
     and e.id=p_source_event_id
-    and e.event_type='expense'
-  for update;
+    and e.event_type='expense';
 
   if v_source.id is null then raise exception 'EXPENSE_NOT_FOUND'; end if;
   if exists (
```

## PS09 · PS · yes (yalnız D5) · weakens · aile: stale_token

Fiş sürüm belirteci isteğe bağlı oldu; belirteçsiz eşzamanlı satır eklemeleri bayat görünüm üzerinden yazar.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":1,"changed":2,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.add_ticket_service_line_guarded` (`supabase/migrations/20260922111500_f14_ticket_model.sql`)

```diff
@@ -697,7 +697,7 @@ begin
 
   if v_ticket.id is null then raise exception 'TICKET_NOT_FOUND'; end if;
   if v_ticket.status <> 'open' then raise exception 'TICKET_NOT_OPEN'; end if;
-  if p_expected_version is null or v_ticket.version <> p_expected_version then
+  if p_expected_version is not null and v_ticket.version <> p_expected_version then
     raise exception 'STALE_WRITE';
   end if;
 
```

## PS10 · PS · yes (yalnız D5) · weakens · aile: optimistic_revision · fonksiyon yeniden kullanıldı

Randevu silinince sayfa revizyonu artık yenilenmiyor (satır varsa hiçbir şey yapılmıyor); eşzamanlı sayfalayan okuyucu, beklediği revizyon değişmediği için silmeyi fark etmez (iyimser revizyon belirteci).

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":false,"added":1,"removed":2,"changed":3,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.f13_bump_appointment_page_revision` (`supabase/migrations/20260920200000_f13_appointment_page_revision.sql`)

```diff
@@ -38,8 +38,7 @@ begin
   if tg_op = 'DELETE' then
     insert into private.appointment_page_revisions(business_id, revision)
     values (old.business_id, gen_random_uuid())
-    on conflict (business_id) do update
-      set revision = excluded.revision;
+    on conflict (business_id) do nothing;
     return old;
   end if;
 
```

## PS11 · PS · yes (yalnız D5) · strengthens · aile: lock_added · fonksiyon yeniden kullanıldı

İşletme satırı kilidi eklendi; yüklemeyi sonlandırma, aynı kilidi alan diğer görsel işlemleriyle serileşir.

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":true,"added":1,"removed":0,"changed":1,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.finalize_business_public_media_upload` (`supabase/migrations/20260914110500_f12_salon_profile_media.sql`)

```diff
@@ -358,6 +358,7 @@ declare v_row public.business_public_media;
 begin
   perform public.f10_require_standard_session();
   if not public.can_manage_business(p_business_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
+  perform 1 from public.businesses b where b.id = p_business_id for update;
   update public.business_public_media m
   set status = 'ready'
   where m.business_id = p_business_id and m.id = p_media_id and m.status = 'pending'
```

## PS12 · PS · yes (yalnız D5) · strengthens · aile: lock_added · fonksiyon yeniden kullanıldı

Personel anahtarlı advisory kilit eklendi; aynı personele eşzamanlı herkese açık randevular uygunluk kontrolü ile ekleme arasında serileşir.

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":true,"added":2,"removed":0,"changed":2,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.create_public_appointment` (`supabase/migrations/20260911130000_phase6_public_booking.sql`)

```diff
@@ -540,6 +540,8 @@ begin
     and sp.active;
   if v_staff.id is null then raise exception 'STAFF_NOT_ELIGIBLE'; end if;
 
+  perform pg_advisory_xact_lock(hashtextextended('booking-staff:' || p_staff_id::text, 0));
+
   if not exists (
     select 1
     from public.compute_public_booking_slots(p_slug, p_service_id, v_date, p_staff_id) s
```

## PS13 · PS · yes (yalnız D5) · strengthens · aile: stale_token

Beklenen aralıklar belirteci zorunlu oldu; belirteçsiz eşzamanlı değiştirme artık reddediliyor.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":false,"added":1,"removed":1,"changed":2,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.replace_business_hours_guarded` (`supabase/migrations/20260914111500_f10_catalog_hours_management.sql`)

```diff
@@ -431,7 +431,7 @@ begin
   into v_current
   from public.business_hours h
   where h.business_id = p_business_id and h.weekday = p_weekday and h.active;
-  if p_expected_intervals is not null and v_current is distinct from p_expected_intervals then
+  if p_expected_intervals is null or v_current is distinct from p_expected_intervals then
     raise exception 'STALE_WRITE';
   end if;
   return query select * from public.replace_business_hours(p_business_id, p_weekday, p_intervals);
```

## PS14 · PS · yes (yalnız D5) · strengthens · aile: lock_added · fonksiyon yeniden kullanıldı

İşletme satırı kilidi eklendi; temizlemeye alma, aynı kilidi alan geri yükleme ve silme işlemleriyle serileşir.

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":true,"added":1,"removed":0,"changed":1,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.mark_business_public_media_cleanup` (`supabase/migrations/20260914110500_f12_salon_profile_media.sql`)

```diff
@@ -378,6 +378,7 @@ declare v_row public.business_public_media;
 begin
   perform public.f10_require_standard_session();
   if not public.can_manage_business(p_business_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
+  perform 1 from public.businesses b where b.id = p_business_id for update;
   update public.business_public_media m
   set status = 'cleanup'
   where m.business_id = p_business_id and m.id = p_media_id and m.status in ('pending','deleting')
```

## PS15 · PS · yes (yalnız D5) · strengthens · aile: lock_added · fonksiyon yeniden kullanıldı

İşletme satırı kilidi eklendi; silmeyi bitirme, aynı kilidi alan geri yükleme işlemiyle serileşir.

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":true,"added":1,"removed":0,"changed":1,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

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

## PS16 · PS · yes (yalnız D5) · strengthens · aile: share_fence · fonksiyon yeniden kullanıldı

Personel okumasına paylaşımlı satır kilidi eklendi; eşzamanlı personel pasifleştirme (satırı FOR UPDATE ile kilitler) bu satır eklemeyle serileşir.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":false,"added":2,"removed":1,"changed":3,"removed_where_and":1,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `public.add_ticket_service_line_guarded` (`supabase/migrations/20260922111500_f14_ticket_model.sql`)

```diff
@@ -714,7 +714,8 @@ begin
     from public.staff_profiles sp
     where sp.business_id = p_business_id
       and sp.id = p_staff_id
-      and sp.active;
+      and sp.active
+    for share;
     if v_staff.id is null then raise exception 'STAFF_NOT_FOUND'; end if;
     if not exists (
       select 1 from public.staff_services ss
```

## PS17 · PS · yes (yalnız D5) · strengthens · aile: lock_added · fonksiyon yeniden kullanıldı

Randevu anahtarlı advisory kilit eklendi; aynı randevu için eşzamanlı kurulumlar serileşir, ikincisi mevcut belirteci görüp karşılaştırır.

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":true,"added":2,"removed":0,"changed":2,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.provision_public_management_token` (`supabase/migrations/20260911140000_phase7_customer_manage.sql`)

```diff
@@ -83,6 +83,8 @@ begin
     raise exception 'INVALID_MANAGEMENT_BOOTSTRAP';
   end if;
 
+  perform pg_advisory_xact_lock(hashtextextended(p_appointment_id::text, 0));
+
   select c.token_hash into v_existing
   from public.appointment_management_capabilities c
   where c.appointment_id = p_appointment_id;
```

## PS18 · PS · yes (yalnız D5) · strengthens · aile: share_fence · fonksiyon yeniden kullanıldı

Personel uygunluk okumasına paylaşımlı satır kilidi eklendi; eşzamanlı personel pasifleştirme veya atama kaldırma bu randevu oluşturmayla serileşir.

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":false,"added":2,"removed":1,"changed":3,"removed_where_and":1,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `public.create_appointment` (`supabase/migrations/20260914110200_f10_customer_authority_repair.sql`)

```diff
@@ -227,7 +227,8 @@ begin
    and ss.staff_id = sp.id
    and ss.service_id = p_service_id
    and ss.active
-  where sp.business_id = p_business_id and sp.id = p_staff_id and sp.active;
+  where sp.business_id = p_business_id and sp.id = p_staff_id and sp.active
+  for share of sp, ss;
   if v_staff.id is null then raise exception 'STAFF_NOT_ELIGIBLE'; end if;
 
   select timezone into v_timezone
```

## PS19 · PS · yes (yalnız D5) · strengthens · aile: share_fence · fonksiyon yeniden kullanıldı

Personel uygunluk okumasına paylaşımlı satır kilidi eklendi; eşzamanlı personel pasifleştirme veya atama kaldırma serileşir.

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":false,"added":2,"removed":1,"changed":3,"removed_where_and":1,"added_exists_select":0,"removed_predicate":1}`

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

## PS20 · PS · yes (yalnız D5) · strengthens · aile: share_fence · fonksiyon yeniden kullanıldı

Personel uygunluk okumasına paylaşımlı satır kilidi eklendi; eşzamanlı personel pasifleştirme veya atama kaldırma herkese açık randevuyla serileşir.

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":false,"added":2,"removed":1,"changed":3,"removed_where_and":1,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `public.create_public_appointment` (`supabase/migrations/20260914110200_f10_customer_authority_repair.sql`)

```diff
@@ -431,7 +431,8 @@ begin
    and ss.active
   where sp.business_id = v_business_id
     and sp.id = p_staff_id
-    and sp.active;
+    and sp.active
+  for share of sp, ss;
   if v_staff.id is null then raise exception 'STAFF_NOT_ELIGIBLE'; end if;
 
   if not exists (
```

## PP01 · PP · yes + D0 · weakens · aile: check_before_lock

D5: yetki okuması işletme kilidinden önceye taşındı (eşzamanlı rol düşürme gözden kaçar). D0: bağlanacak üyelik artık işletme kapsamıyla sınırlı değil.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":2,"removed":3,"changed":5,"removed_where_and":2,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `public.set_staff_membership_link` (`supabase/migrations/20260914033000_f10_team_access.sql`)

```diff
@@ -488,11 +488,11 @@ begin
     raise exception 'AUTH_REQUIRED' using errcode = '42501';
   end if;
 
-  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text, 0));
   select * into v_actor from public.f10_team_actor(p_business_id);
   if v_actor.membership_id is null or v_actor.role not in ('owner', 'manager') then
     raise exception 'TEAM_FORBIDDEN' using errcode = '42501';
   end if;
+  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text, 0));
 
   select * into v_staff
   from public.staff_profiles s
@@ -505,8 +505,7 @@ begin
   if p_membership_id is not null then
     select * into v_member
     from public.memberships m
-    where m.business_id = p_business_id
-      and m.id = p_membership_id
+    where m.id = p_membership_id
       and m.active
     for update;
     if v_member.id is null then
```

## PP02 · PP · yes + D0 · weakens · aile: check_before_lock · fonksiyon yeniden kullanıldı

D5: iletişim çakışma kontrolü işletme kilidinden önceye taşındı (eşzamanlı müşteri oluşturmayla serileşmez). D0: düzenlenen müşteri artık işletme kapsamıyla sınırlı değil.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":14,"removed":15,"changed":29,"removed_where_and":2,"added_exists_select":1,"removed_predicate":1}`

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

## PP03 · PP · yes + D0 · strengthens · aile: lock_added · fonksiyon yeniden kullanıldı

D5: personel anahtarlı advisory kilit eklendi (uygunluk kontrolü ile ekleme serileşir). D0: randevu oluşturma yetkisi her aktif üyeden yöneticilere daraldı.

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":true,"added":2,"removed":1,"changed":3,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.create_appointment` (`supabase/migrations/20260911120000_phase5_booking_core.sql`)

```diff
@@ -439,7 +439,7 @@ declare
   v_row public.appointments;
   v_date date;
 begin
-  if auth.uid() is null or not public.is_active_member(p_business_id) then
+  if auth.uid() is null or not public.can_manage_business(p_business_id) then
     raise exception 'NOT_ALLOWED';
   end if;
   if char_length(v_customer_name) < 2 or char_length(v_customer_name) > 120 then
@@ -495,6 +495,7 @@ begin
   end if;
 
   v_date := (p_starts_at at time zone v_timezone)::date;
+  perform pg_advisory_xact_lock(hashtextextended('booking-staff:' || p_staff_id::text, 0));
   if not exists (
     select 1
     from public.compute_availability_slots_internal(
```

## PP04 · PP · yes + D0 · strengthens · aile: lock_added · fonksiyon yeniden kullanıldı

D5: personel anahtarlı advisory kilit eklendi (uygunluk kontrolü ile ekleme serileşir). D0: hizmet araması artık işletme kapsamıyla sınırlı değil.

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":true,"added":2,"removed":2,"changed":4,"removed_where_and":2,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `public.create_public_appointment` (`supabase/migrations/20260914110200_f10_customer_authority_repair.sql`)

```diff
@@ -408,6 +408,7 @@ begin
 
   v_today := (now() at time zone v_timezone)::date;
   v_date := (p_starts_at at time zone v_timezone)::date;
+  perform pg_advisory_xact_lock(hashtextextended('booking-staff:' || p_staff_id::text, 0));
   if v_date < v_today or v_date > v_today + v_horizon_days then
     raise exception 'DATE_OUT_OF_RANGE';
   end if;
@@ -417,8 +418,7 @@ begin
 
   select * into v_service
   from public.services sv
-  where sv.business_id = v_business_id
-    and sv.id = p_service_id
+  where sv.id = p_service_id
     and sv.active;
   if v_service.id is null then raise exception 'SERVICE_NOT_FOUND'; end if;
 
```

## PP05 · PP · yes + D1 · weakens · aile: upsert_semantics

Çakışmada hiçbir şey yapmamak yerine istek özeti eziliyor ve satır "eklendi" sayılıyor: tekrar eden istek yeni komut gibi yürür (D1) ve aynı anahtarla eşzamanlı iki istek ikisi de yürütülür (D5).

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":false,"added":2,"removed":1,"changed":3,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.claim_booking_command` (`supabase/migrations/20260911120000_phase5_booking_core.sql`)

```diff
@@ -178,7 +178,8 @@ begin
   ) values (
     p_business_id, p_idempotency_key, p_command, p_request_hash, p_appointment_id, auth.uid()
   )
-  on conflict (business_id, idempotency_key) do nothing;
+  on conflict (business_id, idempotency_key) do update
+  set request_hash = excluded.request_hash;
 
   get diagnostics v_inserted = row_count;
   if v_inserted = 1 then
```

## PP06 · PP · yes + D1 · weakens · aile: claim_order · fonksiyon yeniden kullanıldı

Tekrar koruması (komut talebi) gider eklemesinden sonraya taşındı: tekrar eden istek ikinci bir gider ekler (D1) ve eşzamanlı aynı istekler talep kilidinden önce birlikte ekler (D5).

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":false,"added":5,"removed":4,"changed":9,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.create_expense_guarded` (`supabase/migrations/20260923074000_f15_expense_ledger.sql`)

```diff
@@ -353,10 +353,6 @@ declare
   v_result jsonb;
 begin
   v_actor:=public.f15_expense_actor(p_business_id);
-  v_replay:=public.f15_claim_expense_command(
-    p_business_id,v_actor.id,'create_expense',p_idempotency_key,p_request_hash
-  );
-  if v_replay is not null then return v_replay; end if;
 
   if char_length(v_category) not between 1 and 80 then raise exception 'INVALID_EXPENSE_CATEGORY'; end if;
   if v_description is not null and char_length(v_description) not between 2 and 240 then raise exception 'INVALID_EXPENSE_DESCRIPTION'; end if;
@@ -380,6 +376,11 @@ begin
   )
   returning * into v_event;
 
+  v_replay:=public.f15_claim_expense_command(
+    p_business_id,v_actor.id,'create_expense',p_idempotency_key,p_request_hash
+  );
+  if v_replay is not null then return v_replay; end if;
+
   v_result:=public.f15_expense_event_projection(p_business_id,v_event.id);
   perform public.f15_finish_expense_command(
     p_business_id,v_actor.id,'create_expense',p_idempotency_key,v_result
```

## PP07 · PP · yes + D1 · weakens · aile: check_then_act

Komut makbuzu ekleme "var mı bak, yoksa ekle"ye döndü: eşzamanlı aynı istekler kontrolü birlikte geçer (D5), ikincisi tekrar yanıtı yerine benzersizlik hatası alır (D1).

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":false,"added":13,"removed":6,"changed":19,"removed_where_and":0,"added_exists_select":2,"removed_predicate":0}`

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

## PP08 · PP · yes + D1 · weakens · aile: claim_order · fonksiyon yeniden kullanıldı

Tekrar koruması (komut talebi) ürün eklemesinden sonraya taşındı: tekrar eden istek ikinci ürün ekler (D1), eşzamanlı aynı istekler talep kilidinden önce birlikte ekler (D5).

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":false,"added":5,"removed":4,"changed":9,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.create_product_guarded` (`supabase/migrations/20260923051000_f15_product_stock_ledger.sql`)

```diff
@@ -571,10 +571,6 @@ begin
   v_actor := public.f15_inventory_actor(p_business_id);
   perform public.f15_require_pricing_permission(p_business_id);
 
-  v_replay := public.f15_claim_product_command(
-    p_business_id, v_actor.id, 'create_product', p_idempotency_key, p_request_hash
-  );
-  if v_replay is not null then return v_replay; end if;
 
   if char_length(v_name) not between 1 and 120 then raise exception 'INVALID_PRODUCT_NAME'; end if;
   if v_code is not null and (char_length(v_code) not between 1 and 64 or v_code !~ '^[A-Z0-9][A-Z0-9._-]*$') then
@@ -600,6 +596,11 @@ begin
     raise exception 'PRODUCT_CODE_EXISTS';
   end;
 
+  v_replay := public.f15_claim_product_command(
+    p_business_id, v_actor.id, 'create_product', p_idempotency_key, p_request_hash
+  );
+  if v_replay is not null then return v_replay; end if;
+
   if p_initial_quantity > 0 then
     insert into public.product_stock_movements(
       business_id, product_id, kind, quantity_delta, balance_after,
```

## PP09 · PP · yes + D2 · weakens · aile: share_fence · fonksiyon yeniden kullanıldı

Hizmet okumasındaki paylaşımlı kilit kaldırıldı: eşzamanlı hizmet düzenlemesi okuma ile ekleme arasına girebilir (D5) ve satır o an geçerli olmayan fiyat/politika anlık görüntüsünü yakalar (D2).

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":false,"added":1,"removed":2,"changed":3,"removed_where_and":1,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `public.add_ticket_service_line_guarded` (`supabase/migrations/20260922111500_f14_ticket_model.sql`)

```diff
@@ -705,8 +705,7 @@ begin
   from public.services s
   where s.business_id = p_business_id
     and s.id = p_service_id
-    and s.active
-  for share;
+    and s.active;
   if v_service.id is null then raise exception 'SERVICE_NOT_FOUND'; end if;
 
   if p_staff_id is not null then
```

## PP10 · PP · yes + D2 · weakens · aile: share_fence · fonksiyon yeniden kullanıldı

Randevu okumasındaki paylaşımlı kilit kaldırıldı: eşzamanlı iptal/yeniden planlama gönderim kapısıyla serileşmez (D5) ve anlık görüntü karşılaştırması bayat randevu verisiyle yapılır (D2).

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":false,"added":1,"removed":2,"changed":3,"removed_where_and":1,"added_exists_select":1,"removed_predicate":1}`

Fonksiyon: `public.lock_notification_request_v2` (`supabase/migrations/20260912123000_s03_notification_consistency.sql`)

```diff
@@ -634,8 +634,7 @@ begin
   -- committed cancel/reschedule wins over a send that has not crossed this gate.
   select a.* into v_appointment
   from public.appointments a
-  where a.id = (select j.appointment_id from public.appointment_notification_jobs j where j.id = p_job_id)
-  for share;
+  where a.id = (select j.appointment_id from public.appointment_notification_jobs j where j.id = p_job_id);
 
   select * into v_job
   from public.appointment_notification_jobs j
```

## PP11 · PP · yes + D2 · strengthens · aile: share_fence · fonksiyon yeniden kullanıldı

Hizmet okumasına paylaşımlı kilit eklendi: eşzamanlı hizmet düzenlemesiyle serileşir (D5) ve randevunun fiyat/süre anlık görüntüsü eklemeye kadar geçerli değeri yansıtır (D2).

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":false,"added":2,"removed":1,"changed":3,"removed_where_and":1,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `public.create_appointment` (`supabase/migrations/20260911121000_phase5_booking_hardening.sql`)

```diff
@@ -219,7 +219,8 @@ begin
   -- still returns its committed result even if the service/staff was deactivated later.
   select * into v_service
   from public.services
-  where business_id = p_business_id and id = p_service_id and active;
+  where business_id = p_business_id and id = p_service_id and active
+  for share;
   if v_service.id is null then raise exception 'SERVICE_NOT_FOUND'; end if;
 
   select sp.* into v_staff
```

## PP12 · PP · yes + D2 · strengthens · aile: share_fence · fonksiyon yeniden kullanıldı

Hizmet okumasına paylaşımlı kilit eklendi: eşzamanlı hizmet düzenlemesiyle serileşir (D5) ve fiyat/süre anlık görüntüsü eklemeye kadar geçerli kalır (D2).

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":false,"added":2,"removed":1,"changed":3,"removed_where_and":1,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `public.create_public_appointment` (`supabase/migrations/20260911130000_phase6_public_booking.sql`)

```diff
@@ -525,7 +525,8 @@ begin
   from public.services sv
   where sv.business_id = v_business_id
     and sv.id = p_service_id
-    and sv.active;
+    and sv.active
+  for share;
   if v_service.id is null then raise exception 'SERVICE_NOT_FOUND'; end if;
 
   select sp.* into v_staff
```

## PP13 · PP · yes + D3 · weakens · aile: key_scope · fonksiyon yeniden kullanıldı

D5: advisory kilit anahtarı personel adına daraldı (farklı adlı eşzamanlı eklemeler sayımı birlikte geçer). D3: personel limiti 100'den 200'e çıktı.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":2,"removed":2,"changed":4,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

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

## PP14 · PP · yes + D3 · weakens · aile: lock_removal · fonksiyon yeniden kullanıldı

D5: işletme satırı kilidi kaldırıldı (eşzamanlı yüklemeler sayımı birlikte geçer). D3: görsel limiti 20'den 25'e çıktı.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":2,"removed":2,"changed":4,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.begin_business_public_media_upload` (`supabase/migrations/20260914110500_f12_salon_profile_media.sql`)

```diff
@@ -306,7 +306,7 @@ begin
   if not public.can_manage_business(p_business_id) then
     raise exception 'NOT_ALLOWED' using errcode = '42501';
   end if;
-  perform 1 from public.businesses b where b.id = p_business_id for update;
+  perform 1 from public.businesses b where b.id = p_business_id;
   if not found then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
 
   if p_media_id is null
@@ -324,7 +324,7 @@ begin
   from public.business_public_media m
   where m.business_id = p_business_id;
 
-  if v_count >= 20 then raise exception 'PUBLIC_MEDIA_LIMIT_EXCEEDED'; end if;
+  if v_count >= 25 then raise exception 'PUBLIC_MEDIA_LIMIT_EXCEEDED'; end if;
 
   insert into public.business_public_media(
     id, business_id, storage_path, status, alt_text, sort_order,
```

## PP15 · PP · yes + D3 · strengthens · aile: lock_added · fonksiyon yeniden kullanıldı

D5: personel satırı kilitleniyor (aynı personel için eşzamanlı saat değiştirmeleri serileşir). D3: pasif personele de saat tanımlanabiliyor.

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":true,"added":4,"removed":4,"changed":8,"removed_where_and":1,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `public.replace_staff_hours` (`supabase/migrations/20260911110000_phase4_availability.sql`)

```diff
@@ -212,10 +212,10 @@ begin
   if auth.uid() is null or not public.can_manage_business(p_business_id) then
     raise exception 'NOT_ALLOWED';
   end if;
-  if not exists (
-    select 1 from public.staff_profiles s
-    where s.business_id = p_business_id and s.id = p_staff_id and s.active
-  ) then
+  perform 1 from public.staff_profiles s
+  where s.business_id = p_business_id and s.id = p_staff_id
+  for update;
+  if not found then
     raise exception 'STAFF_NOT_FOUND';
   end if;
   if p_weekday < 0 or p_weekday > 6 then
```

## PP16 · PP · yes + D3 · strengthens · aile: lock_added · fonksiyon yeniden kullanıldı

D5: işletme satırı kilitleniyor (eşzamanlı saat değiştirmeleri serileşir). D3: gün başına en fazla 4 çalışma aralığı.

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":true,"added":5,"removed":0,"changed":5,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.replace_business_hours` (`supabase/migrations/20260911110000_phase4_availability.sql`)

```diff
@@ -155,6 +155,11 @@ begin
     raise exception 'INVALID_INTERVALS';
   end if;
 
+  if jsonb_array_length(p_intervals) > 4 then
+    raise exception 'TOO_MANY_INTERVALS';
+  end if;
+  perform 1 from public.businesses b where b.id = p_business_id for update;
+
   delete from public.business_hours
   where business_id = p_business_id and weekday = p_weekday;
 
```

## PP17 · PP · yes + D4 · weakens · aile: lock_removal · fonksiyon yeniden kullanıldı

D5: randevu satırı kilidi kaldırıldı (eşzamanlı iptal/yeniden planlama ile ikinci iptal birlikte geçer). D4: iptal randevudan en geç 1 saat önce yapılabiliyor.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":2,"removed":3,"changed":5,"removed_where_and":1,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `public.cancel_public_managed_appointment` (`supabase/migrations/20260911140000_phase7_customer_manage.sql`)

```diff
@@ -546,10 +546,9 @@ begin
 
   select * into v_current
   from public.appointments a
-  where a.business_id = v_current.business_id and a.id = v_current.id
-  for update;
+  where a.business_id = v_current.business_id and a.id = v_current.id;
 
-  if v_current.status not in ('scheduled','confirmed') or v_current.starts_at <= now() then
+  if v_current.status not in ('scheduled','confirmed') or v_current.starts_at <= now() + interval '1 hour' then
     raise exception 'APPOINTMENT_NOT_MANAGEABLE';
   end if;
 
```

## PP18 · PP · yes + D4 · weakens · aile: lock_removal · fonksiyon yeniden kullanıldı

D5: randevu satırı kilidi kaldırıldı (eşzamanlı yeniden planlamalar birlikte geçer). D4: asgari önceden bildirim 30 dakika uzadı.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":2,"removed":3,"changed":5,"removed_where_and":1,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `public.reschedule_public_managed_appointment` (`supabase/migrations/20260911140000_phase7_customer_manage.sql`)

```diff
@@ -395,8 +395,7 @@ begin
 
   select * into v_current
   from public.appointments a
-  where a.business_id = v_current.business_id and a.id = v_current.id
-  for update;
+  where a.business_id = v_current.business_id and a.id = v_current.id;
 
   if v_current.status not in ('scheduled','confirmed') or v_current.starts_at <= now() then
     raise exception 'APPOINTMENT_NOT_MANAGEABLE';
@@ -420,7 +419,7 @@ begin
   if v_date < v_today or v_date > v_today + v_horizon_days then
     raise exception 'DATE_OUT_OF_RANGE';
   end if;
-  if p_starts_at < now() + make_interval(mins => v_min_notice_minutes) then
+  if p_starts_at < now() + make_interval(mins => v_min_notice_minutes + 30) then
     raise exception 'SLOT_UNAVAILABLE';
   end if;
 
```

## PP19 · PP · yes + D4 · strengthens · aile: lease_guard · fonksiyon yeniden kullanıldı

Süre dolumu dalı artık etkin kiralamayı korumadan sonlandırmıyor (D5: bakım ile gönderen işçi çakışmaz) ve 1 dakikalık tolerans tanıyor (D4).

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":false,"added":1,"removed":1,"changed":2,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.maintain_notification_jobs` (`supabase/migrations/20260911170100_phase9_notification_maintenance.sql`)

```diff
@@ -61,7 +61,7 @@ begin
       updated_at = now()
   where j.state not in ('sent','failed_terminal')
     and (
-      j.retry_until <= now()
+      (j.retry_until <= now() - interval '1 minute' and (j.state <> 'leased' or j.lease_expires_at <= now()))
       or (
         j.attempt_count >= j.max_attempts
         and (j.state <> 'leased' or j.lease_expires_at <= now())
```

## PP20 · PP · yes + D4 · strengthens · aile: clock_after_wait · fonksiyon yeniden kullanıldı

Kilit beklemesinden sonraki süre hesapları işlem başı now() yerine clock_timestamp() kullanıyor: uzun satır kilidi beklemesi sonrası pencere ve yeniden deneme sınırı gerçek zamana göre değerlendirilir (D4) ve bekleme sırasında dolan süre gözden kaçmaz (D5).

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":2,"removed":2,"changed":4,"removed_where_and":1,"added_exists_select":0,"removed_predicate":1}`

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

## NS01 · NS · no; D0 · aile: authz · fonksiyon yeniden kullanıldı

Personel-üyelik bağlama yetkisi personel rolüne de verildi (yetki kapsamı).

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":1,"changed":2,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.set_staff_membership_link` (`supabase/migrations/20260914033000_f10_team_access.sql`)

```diff
@@ -490,7 +490,7 @@ begin
 
   perform pg_advisory_xact_lock(hashtextextended(p_business_id::text, 0));
   select * into v_actor from public.f10_team_actor(p_business_id);
-  if v_actor.membership_id is null or v_actor.role not in ('owner', 'manager') then
+  if v_actor.membership_id is null or v_actor.role not in ('owner', 'manager', 'staff') then
     raise exception 'TEAM_FORBIDDEN' using errcode = '42501';
   end if;
 
```

## NS02 · NS · no; D0 · aile: authz · fonksiyon yeniden kullanıldı

Davet iptali için sahip/yönetici rolü aranmıyor; her aktif üye iptal edebiliyor (yetki kapsamı). İşletme kilidi yerinde.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":1,"changed":2,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.revoke_business_invitation` (`supabase/migrations/20260914033000_f10_team_access.sql`)

```diff
@@ -277,7 +277,7 @@ begin
 
   perform pg_advisory_xact_lock(hashtextextended(p_business_id::text, 0));
   select * into v_actor from public.f10_team_actor(p_business_id);
-  if v_actor.membership_id is null or v_actor.role not in ('owner', 'manager') then
+  if v_actor.membership_id is null then
     raise exception 'TEAM_FORBIDDEN' using errcode = '42501';
   end if;
 
```

## NS03 · NS · no; D0 · aile: authz

Grup yeniden planlamayı "system" aktör türü de yapabiliyor (aktör kapsamı).

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":1,"changed":2,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.f11_reschedule_group_core` (`supabase/migrations/20260917171000_f11_schedule_authority_lock_order.sql`)

```diff
@@ -39,7 +39,7 @@ begin
   if p_command not in ('group_reschedule','public_group_reschedule') then
     raise exception 'INVALID_GROUP_COMMAND';
   end if;
-  if p_actor_type not in ('member','public') then raise exception 'INVALID_ACTOR_TYPE'; end if;
+  if p_actor_type not in ('member','public','system') then raise exception 'INVALID_ACTOR_TYPE'; end if;
 
   perform pg_advisory_xact_lock(hashtextextended(
     'f11:group-management:'||p_business_id::text||':'||p_group_id::text,0
```

## NS04 · NS · no; D0 · aile: authz · fonksiyon yeniden kullanıldı

İşletmeyi oluşturan kullanıcı sahip değil yönetici rolüyle üye oluyor (yetki kapsamı).

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":false,"added":1,"removed":1,"changed":2,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

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

## NS05 · NS · no; D1 · aile: duplicate_suppression · fonksiyon yeniden kullanıldı

"Zaten ters kaydedilmiş" kontrolü kaldırıldı; aynı gider sırayla ikinci kez ters kaydedilebilir (tekilleştirme). Kaynak satır kilidi yerinde.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":0,"removed":8,"changed":8,"removed_where_and":3,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `public.reverse_expense_guarded` (`supabase/migrations/20260923074000_f15_expense_ledger.sql`)

```diff
@@ -432,14 +432,6 @@ begin
   for update;
 
   if v_source.id is null then raise exception 'EXPENSE_NOT_FOUND'; end if;
-  if exists (
-    select 1 from public.expense_events r
-    where r.business_id=p_business_id
-      and r.source_expense_event_id=p_source_event_id
-      and r.event_type='reversal'
-  ) then
-    raise exception 'EXPENSE_ALREADY_REVERSED';
-  end if;
 
   insert into public.expense_events(
     business_id,event_type,source_expense_event_id,correction_of_event_id,category,description,
```

## NS06 · NS · no; D1 · aile: replay

Aynı anahtarla farklı içerikli istek artık reddedilmiyor, önceki sonuç döndürülüyor (tekrar semantiği).

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":0,"removed":3,"changed":3,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.f15_claim_expense_command` (`supabase/migrations/20260923074000_f15_expense_ledger.sql`)

```diff
@@ -207,9 +207,6 @@ begin
     and c.idempotency_key=p_idempotency_key
   for update;
 
-  if v_hash is distinct from p_request_hash then
-    raise exception 'IDEMPOTENCY_CONFLICT';
-  end if;
 
   return v_result;
 end
```

## NS07 · NS · no; D1 · aile: replay · fonksiyon yeniden kullanıldı

Tekrar kontrolü artık yalnız komut türünü karşılaştırıyor; aynı anahtarla farklı içerikli istek önceki sonucu alır (tekrar semantiği).

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":false,"added":1,"removed":1,"changed":2,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.claim_booking_command` (`supabase/migrations/20260911130000_phase6_public_booking.sql`)

```diff
@@ -125,7 +125,7 @@ begin
   where business_id = p_business_id
     and idempotency_key = p_idempotency_key;
 
-  if v_existing.command <> p_command or v_existing.request_hash <> p_request_hash then
+  if v_existing.command <> p_command then
     raise exception 'IDEMPOTENCY_CONFLICT';
   end if;
   if v_existing.appointment_id is null then
```

## NS08 · NS · no; D1 · aile: replay · fonksiyon yeniden kullanıldı

Tekrar eden istek kayıtlı sonucu değil fişin güncel projeksiyonunu döndürüyor (tekrar semantiği).

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":false,"added":3,"removed":1,"changed":4,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.open_walk_in_ticket_guarded` (`supabase/migrations/20260922111500_f14_ticket_model.sql`)

```diff
@@ -632,7 +632,9 @@ begin
     p_business_id, v_actor.id, 'open_walk_in',
     p_idempotency_key, p_request_hash
   );
-  if v_replay is not null then return v_replay; end if;
+  if v_replay is not null then
+    return public.f14_ticket_projection(p_business_id, (v_replay->>'id')::uuid);
+  end if;
 
   select * into v_customer
   from public.customers c
```

## NS09 · NS · no; D2 · aile: snapshot · fonksiyon yeniden kullanıldı

Fişin para birimi ilk satırdaki değerde kalmıyor, her yeni satırın hizmet para birimiyle ezilir (yakalanan durum). Fiş kilidi ve sürüm artışı yerinde.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":1,"changed":2,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.add_ticket_service_line_guarded` (`supabase/migrations/20260922111500_f14_ticket_model.sql`)

```diff
@@ -758,7 +758,7 @@ begin
   );
 
   update public.tickets
-  set currency = coalesce(currency, v_service.currency),
+  set currency = v_service.currency,
       version = version + 1
   where business_id = p_business_id and id = p_ticket_id;
 
```

## NS10 · NS · no; D2 · aile: policy · fonksiyon yeniden kullanıldı

Düzeltme kayıtları da ters kaydedilebiliyor (hangi kaydın kaynak olabileceği politikası); kaynak satır kilidi yerinde.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":1,"changed":2,"removed_where_and":1,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `public.reverse_expense_guarded` (`supabase/migrations/20260923074000_f15_expense_ledger.sql`)

```diff
@@ -428,7 +428,7 @@ begin
   from public.expense_events e
   where e.business_id=p_business_id
     and e.id=p_source_event_id
-    and e.event_type='expense'
+    and e.event_type in ('expense','correction')
   for update;
 
   if v_source.id is null then raise exception 'EXPENSE_NOT_FOUND'; end if;
```

## NS11 · NS · no; D2 · aile: history · fonksiyon yeniden kullanıldı

Başarılı tamamlamada son hata sınıfı artık temizlenmiyor; geçmiş hata kaydı korunuyor (geçmiş değer).

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":false,"added":0,"removed":1,"changed":1,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

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

## NS12 · NS · no; D2 · aile: history · fonksiyon yeniden kullanıldı

Olay kaydındaki grup sürümü, yeni sürüm yerine istemcinin beklediği eski sürümü yazıyor (geçmiş kaydın anlamı).

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":1,"changed":2,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.set_appointment_group_status` (`supabase/migrations/20260921043000_f13_group_lifecycle_partial_repair.sql`)

```diff
@@ -129,7 +129,7 @@ begin
     p_business_id,a.id,p_status,auth.uid(),'member',v_from_status,p_status,
     jsonb_build_object(
       'groupId',p_group_id,
-      'groupVersion',v_new_version,
+      'groupVersion',p_expected_version,
       'lineOrdinal',a.line_ordinal,
       'scope','group'
     )
```

## NS13 · NS · no; D3 · aile: limit · fonksiyon yeniden kullanıldı

Hizmet limitine yalnız aktif hizmetler sayılıyor (kapasite kuralı); sayım aynı kilit altında.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":1,"changed":2,"removed_where_and":0,"added_exists_select":1,"removed_predicate":0}`

Fonksiyon: `public.create_service_guarded` (`supabase/migrations/20260915150000_f12_service_price_range.sql`)

```diff
@@ -166,7 +166,7 @@ begin
   end if;
 
   perform pg_advisory_xact_lock(hashtextextended('f10-04:services:' || p_business_id::text, 0));
-  select count(*), least(coalesce(max(s.sort_order), -10) + 10, 1000000)
+  select count(*) filter (where s.active), least(coalesce(max(s.sort_order), -10) + 10, 1000000)
     into v_count, v_sort
   from public.services s
   where s.business_id = p_business_id;
```

## NS14 · NS · no; D3 · aile: limit

Yönetim değişikliği için kişi başı istek limiti 10'dan 5'e indi (kaynak sınırı).

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":false,"added":1,"removed":1,"changed":2,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

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

## NS15 · NS · no; D3 · aile: eligibility · fonksiyon yeniden kullanıldı

Pasif hizmetler de herkese açık randevuya açık (hizmet uygunluğu).

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":false,"added":1,"removed":2,"changed":3,"removed_where_and":2,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `public.create_public_appointment` (`supabase/migrations/20260914110200_f10_customer_authority_repair.sql`)

```diff
@@ -418,8 +418,7 @@ begin
   select * into v_service
   from public.services sv
   where sv.business_id = v_business_id
-    and sv.id = p_service_id
-    and sv.active;
+    and sv.id = p_service_id;
   if v_service.id is null then raise exception 'SERVICE_NOT_FOUND'; end if;
 
   select sp.* into v_staff
```

## NS16 · NS · no; D3 · aile: eligibility · fonksiyon yeniden kullanıldı

Personel uygunluğunda atamanın aktif olması şartı kalktı; pasif atamayla herkese açık randevu alınabilir (atama kuralı).

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":false,"added":0,"removed":1,"changed":1,"removed_where_and":1,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `public.create_public_appointment` (`supabase/migrations/20260911130000_phase6_public_booking.sql`)

```diff
@@ -534,7 +534,6 @@ begin
     on ss.business_id = sp.business_id
    and ss.staff_id = sp.id
    and ss.service_id = p_service_id
-   and ss.active
   where sp.business_id = v_business_id
     and sp.id = p_staff_id
     and sp.active;
```

## NS17 · NS · no; D4 · aile: window · fonksiyon yeniden kullanıldı

Müşteri yeniden planlaması randevudan en geç 3 saat önce yapılabiliyor (zaman sınırı); kontrol aynı kilit altında.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":1,"changed":2,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.reschedule_public_managed_appointment` (`supabase/migrations/20260911140000_phase7_customer_manage.sql`)

```diff
@@ -398,7 +398,7 @@ begin
   where a.business_id = v_current.business_id and a.id = v_current.id
   for update;
 
-  if v_current.status not in ('scheduled','confirmed') or v_current.starts_at <= now() then
+  if v_current.status not in ('scheduled','confirmed') or v_current.starts_at <= now() + interval '3 hours' then
     raise exception 'APPOINTMENT_NOT_MANAGEABLE';
   end if;
   if p_starts_at is null then raise exception 'INVALID_START'; end if;
```

## NS18 · NS · no; D4 · aile: window · fonksiyon yeniden kullanıldı

Herkese açık randevu artık aynı gün için alınamıyor (yerel gün sınırı).

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":false,"added":1,"removed":1,"changed":2,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.create_public_appointment` (`supabase/migrations/20260911130000_phase6_public_booking.sql`)

```diff
@@ -514,7 +514,7 @@ begin
 
   v_today := (now() at time zone v_timezone)::date;
   v_date := (p_starts_at at time zone v_timezone)::date;
-  if v_date < v_today or v_date > v_today + v_horizon_days then
+  if v_date <= v_today or v_date > v_today + v_horizon_days then
     raise exception 'DATE_OUT_OF_RANGE';
   end if;
   if p_starts_at < now() + make_interval(mins => v_min_notice_minutes) then
```

## NS19 · NS · no; D4 · aile: local_day · fonksiyon yeniden kullanıldı

Ters kaydın iş günü işletmenin yerel günü yerine UTC günüyle hesaplanıyor (yerel gün dönüşümü).

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":false,"added":1,"removed":1,"changed":2,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.reverse_expense_guarded` (`supabase/migrations/20260923074000_f15_expense_ledger.sql`)

```diff
@@ -447,7 +447,7 @@ begin
     reason,actor_membership_id
   ) values (
     p_business_id,'reversal',v_source.id,null,v_source.category,v_source.description,
-    v_source.amount_minor,v_source.currency,v_source.payment_method,v_occurred_at,p_occurred_local::date,v_timezone,
+    v_source.amount_minor,v_source.currency,v_source.payment_method,v_occurred_at,(v_occurred_at at time zone 'UTC')::date,v_timezone,
     v_reason,v_actor.id
   )
   returning * into v_event;
```

## NS20 · NS · no; D4 · aile: window · fonksiyon yeniden kullanıldı

Grup yeni başlangıç zamanı geçmişte olamıyor (zaman sınırı).

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":1,"changed":2,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

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

## NP01 · NP · no; D0, D1 · aile: replay

Komut makbuzu okuması artık aktöre göre sınırlı değil: başka üyenin aynı anahtarlı komutu okunabilir (D0) ve onun sonucu tekrar olarak döner (D1).

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":0,"removed":1,"changed":1,"removed_where_and":1,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `public.f15_claim_product_command` (`supabase/migrations/20260923051000_f15_product_stock_ledger.sql`)

```diff
@@ -329,7 +329,6 @@ begin
   into v_hash, v_result
   from public.product_commands c
   where c.business_id = p_business_id
-    and c.actor_membership_id = p_actor_membership_id
     and c.command = p_command
     and c.idempotency_key = p_idempotency_key
   for update;
```

## NP02 · NP · no; D0, D1 · aile: replay · fonksiyon yeniden kullanıldı

D1: tekrar kontrolü komut türünü karşılaştırmıyor. D0: komutu oluşturan kullanıcı kaydedilmiyor (aktör izi).

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":false,"added":2,"removed":2,"changed":4,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.claim_booking_command` (`supabase/migrations/20260911120000_phase5_booking_core.sql`)

```diff
@@ -176,7 +176,7 @@ begin
   insert into public.booking_commands(
     business_id, idempotency_key, command, request_hash, appointment_id, created_by
   ) values (
-    p_business_id, p_idempotency_key, p_command, p_request_hash, p_appointment_id, auth.uid()
+    p_business_id, p_idempotency_key, p_command, p_request_hash, p_appointment_id, null
   )
   on conflict (business_id, idempotency_key) do nothing;
 
@@ -191,7 +191,7 @@ begin
   where business_id = p_business_id
     and idempotency_key = p_idempotency_key;
 
-  if v_existing.command <> p_command or v_existing.request_hash <> p_request_hash then
+  if v_existing.request_hash <> p_request_hash then
     raise exception 'IDEMPOTENCY_CONFLICT';
   end if;
   if v_existing.appointment_id is null then
```

## NP03 · NP · no; D0, D2 · aile: authz · fonksiyon yeniden kullanıldı

D0: herkese açık profili her aktif üye düzenleyebiliyor. D2: kapak gönderilmezse önceki kapak korunuyor (yakalanan durum politikası).

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":false,"added":2,"removed":2,"changed":4,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

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

## NP04 · NP · no; D0, D2 · aile: authz · fonksiyon yeniden kullanıldı

D0: para birimi değişikliği artık fiyatlandırma yetkisi istemiyor. D2: ürün para birimi oluşturulduktan sonra korunuyor, istekteki değer yok sayılıyor (yakalanan politika).

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":2,"removed":3,"changed":5,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.update_product_guarded` (`supabase/migrations/20260923051000_f15_product_stock_ledger.sql`)

```diff
@@ -668,8 +668,7 @@ begin
   if p_sale_price_minor is null or p_sale_price_minor < 0 then raise exception 'INVALID_PRODUCT_PRICE'; end if;
   if v_currency !~ '^[A-Z]{3}$' then raise exception 'INVALID_CURRENCY'; end if;
 
-  if v_product.sale_price_minor is distinct from p_sale_price_minor
-      or v_product.currency is distinct from v_currency then
+  if v_product.sale_price_minor is distinct from p_sale_price_minor then
     perform public.f15_require_pricing_permission(p_business_id);
   end if;
 
@@ -679,7 +678,7 @@ begin
         code = v_code,
         unit = v_unit,
         sale_price_minor = p_sale_price_minor,
-        currency = v_currency,
+        currency = v_product.currency,
         version = version + 1
     where business_id = p_business_id and id = p_product_id
     returning * into v_product;
```

## NP05 · NP · no; D0, D3 · aile: authz · fonksiyon yeniden kullanıldı

D0: atamayı her aktif üye yapabiliyor. D3: atama limiti 5000'den 1000'e indi.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":false,"added":2,"removed":2,"changed":4,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

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

## NP06 · NP · no; D0, D3 · aile: authz · fonksiyon yeniden kullanıldı

D0: randevu oluşturma yetkisi yöneticilere daraldı. D3: pasif personele randevu verilebiliyor.

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":false,"added":2,"removed":2,"changed":4,"removed_where_and":1,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `public.create_appointment` (`supabase/migrations/20260911121000_phase5_booking_hardening.sql`)

```diff
@@ -176,7 +176,7 @@ declare
   v_row public.appointments;
   v_date date;
 begin
-  if auth.uid() is null or not public.is_active_member(p_business_id) then
+  if auth.uid() is null or not public.can_manage_business(p_business_id) then
     raise exception 'NOT_ALLOWED';
   end if;
   if char_length(v_customer_name) < 2 or char_length(v_customer_name) > 120 then
@@ -229,7 +229,7 @@ begin
    and ss.staff_id = sp.id
    and ss.service_id = p_service_id
    and ss.active
-  where sp.business_id = p_business_id and sp.id = p_staff_id and sp.active;
+  where sp.business_id = p_business_id and sp.id = p_staff_id;
   if v_staff.id is null then raise exception 'STAFF_NOT_ELIGIBLE'; end if;
 
   select timezone into v_timezone
```

## NP07 · NP · no; D0, D4 · aile: authz · fonksiyon yeniden kullanıldı

D0: iptal edilmiş yönetim bağlantısı da kullanılabiliyor. D4: iptal randevu başladıktan sonra 15 dakikaya kadar yapılabiliyor.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":2,"changed":3,"removed_where_and":1,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `public.cancel_public_managed_appointment` (`supabase/migrations/20260911140000_phase7_customer_manage.sql`)

```diff
@@ -516,7 +516,6 @@ begin
     on a.business_id = cap.business_id
    and a.id = cap.appointment_id
   where cap.token_hash = v_hash_token
-    and cap.revoked_at is null
   limit 1;
 
   if v_current.id is null then raise exception 'MANAGEMENT_NOT_FOUND'; end if;
@@ -549,7 +548,7 @@ begin
   where a.business_id = v_current.business_id and a.id = v_current.id
   for update;
 
-  if v_current.status not in ('scheduled','confirmed') or v_current.starts_at <= now() then
+  if v_current.status not in ('scheduled','confirmed') or v_current.starts_at <= now() - interval '15 minutes' then
     raise exception 'APPOINTMENT_NOT_MANAGEABLE';
   end if;
 
```

## NP08 · NP · no; D0, D4 · aile: authz

D0: ayarları her aktif üye değiştirebiliyor. D4: rezervasyon ufku üst sınırı 366'dan 730 güne çıktı.

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":false,"added":2,"removed":2,"changed":4,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.update_public_booking_settings` (`supabase/migrations/20260914090000_f10_onboarding_readiness.sql`)

```diff
@@ -340,13 +340,13 @@ declare
 begin
   perform public.f10_require_standard_session();
 
-  if not public.can_manage_business(p_business_id) then
+  if not public.is_active_member(p_business_id) then
     raise exception 'NOT_ALLOWED' using errcode = '42501';
   end if;
   if p_enabled is null
      or p_step_minutes < 5 or p_step_minutes > 120
      or p_min_notice_minutes < 0 or p_min_notice_minutes > 10080
-     or p_horizon_days < 1 or p_horizon_days > 366 then
+     or p_horizon_days < 1 or p_horizon_days > 730 then
     raise exception 'INVALID_PUBLIC_BOOKING_SETTINGS';
   end if;
 
```

## NP09 · NP · no; D1, D2 · aile: duplicate_suppression · fonksiyon yeniden kullanıldı

D1: "zaten ters kaydedilmiş" kontrolü kaldırıldı (aynı hareket sırayla ikinci kez ters kaydedilebilir). D2: ters kayıt gerekçesi yakalanmıyor.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":false,"added":1,"removed":9,"changed":10,"removed_where_and":3,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `public.reverse_product_stock_movement_guarded` (`supabase/migrations/20260923051000_f15_product_stock_ledger.sql`)

```diff
@@ -870,14 +870,6 @@ begin
 
   if v_source.id is null then raise exception 'STOCK_MOVEMENT_NOT_FOUND'; end if;
   if v_source.kind = 'reversal' then raise exception 'STOCK_REVERSAL_SOURCE_INVALID'; end if;
-  if exists (
-    select 1 from public.product_stock_movements r
-    where r.business_id = p_business_id
-      and r.product_id = p_product_id
-      and r.reverses_movement_id = p_movement_id
-  ) then
-    raise exception 'STOCK_MOVEMENT_ALREADY_REVERSED';
-  end if;
 
   v_new_balance := v_product.stock_on_hand - v_source.quantity_delta;
   if v_new_balance < 0 then raise exception 'NEGATIVE_STOCK'; end if;
@@ -893,7 +885,7 @@ begin
     reason, reverses_movement_id, created_by_membership_id
   ) values (
     p_business_id, p_product_id, 'reversal', -v_source.quantity_delta, v_new_balance,
-    v_reason, p_movement_id, v_actor.id
+    null, p_movement_id, v_actor.id
   );
 
   v_result := public.f15_product_projection(p_business_id, p_product_id);
```

## NP10 · NP · no; D1, D2 · aile: replay · fonksiyon yeniden kullanıldı

D1: tekrar eden istek kayıtlı sonucu değil güncel projeksiyonu döndürüyor. D2: gider kaydı saat dilimi anlık görüntüsünü yakalamıyor.

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":false,"added":2,"removed":2,"changed":4,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.create_expense_guarded` (`supabase/migrations/20260923074000_f15_expense_ledger.sql`)

```diff
@@ -356,7 +356,7 @@ begin
   v_replay:=public.f15_claim_expense_command(
     p_business_id,v_actor.id,'create_expense',p_idempotency_key,p_request_hash
   );
-  if v_replay is not null then return v_replay; end if;
+  if v_replay is not null then return public.f15_expense_event_projection(p_business_id,(v_replay->>'id')::uuid); end if;
 
   if char_length(v_category) not between 1 and 80 then raise exception 'INVALID_EXPENSE_CATEGORY'; end if;
   if v_description is not null and char_length(v_description) not between 2 and 240 then raise exception 'INVALID_EXPENSE_DESCRIPTION'; end if;
@@ -375,7 +375,7 @@ begin
     reason,actor_membership_id
   ) values (
     p_business_id,'expense',null,null,v_category,v_description,
-    p_amount_minor,v_currency,p_payment_method,v_occurred_at,p_occurred_local::date,v_timezone,
+    p_amount_minor,v_currency,p_payment_method,v_occurred_at,p_occurred_local::date,null,
     null,v_actor.id
   )
   returning * into v_event;
```

## NP11 · NP · no; D1, D3 · aile: replay · fonksiyon yeniden kullanıldı

D1: tekrar eden istek kayıtlı sonucu değil güncel projeksiyonu döndürüyor. D3: stok eksiye düşebiliyor (kaynak sınırı).

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":2,"changed":3,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.record_product_stock_movement_guarded` (`supabase/migrations/20260923051000_f15_product_stock_ledger.sql`)

```diff
@@ -772,7 +772,7 @@ begin
   v_replay := public.f15_claim_product_command(
     p_business_id, v_actor.id, 'record_stock', p_idempotency_key, p_request_hash
   );
-  if v_replay is not null then return v_replay; end if;
+  if v_replay is not null then return public.f15_product_projection(p_business_id, p_product_id); end if;
 
   if p_kind not in ('receipt'::public.stock_movement_kind, 'adjustment'::public.stock_movement_kind) then
     raise exception 'INVALID_STOCK_KIND';
@@ -797,7 +797,6 @@ begin
   if p_expected_version is null or v_product.version <> p_expected_version then raise exception 'STALE_WRITE'; end if;
 
   v_new_balance := v_product.stock_on_hand + p_quantity_delta;
-  if v_new_balance < 0 then raise exception 'NEGATIVE_STOCK'; end if;
 
   update public.products
   set stock_on_hand = v_new_balance,
```

## NP12 · NP · no; D1, D3 · aile: replay · fonksiyon yeniden kullanıldı

D1: tekrar eden istek kayıtlı sonucu değil güncel projeksiyonu döndürüyor. D3: başlangıç stoku üst sınırı 1 milyara değil 1 milyona indi.

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":false,"added":2,"removed":2,"changed":4,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.create_product_guarded` (`supabase/migrations/20260923051000_f15_product_stock_ledger.sql`)

```diff
@@ -574,7 +574,7 @@ begin
   v_replay := public.f15_claim_product_command(
     p_business_id, v_actor.id, 'create_product', p_idempotency_key, p_request_hash
   );
-  if v_replay is not null then return v_replay; end if;
+  if v_replay is not null then return public.f15_product_projection(p_business_id, (v_replay->>'id')::uuid); end if;
 
   if char_length(v_name) not between 1 and 120 then raise exception 'INVALID_PRODUCT_NAME'; end if;
   if v_code is not null and (char_length(v_code) not between 1 and 64 or v_code !~ '^[A-Z0-9][A-Z0-9._-]*$') then
@@ -583,7 +583,7 @@ begin
   if v_unit <> 'piece' then raise exception 'INVALID_PRODUCT_UNIT'; end if;
   if p_sale_price_minor is null or p_sale_price_minor < 0 then raise exception 'INVALID_PRODUCT_PRICE'; end if;
   if v_currency !~ '^[A-Z]{3}$' then raise exception 'INVALID_CURRENCY'; end if;
-  if p_initial_quantity is null or p_initial_quantity < 0 or p_initial_quantity > 1000000000 then
+  if p_initial_quantity is null or p_initial_quantity < 0 or p_initial_quantity > 1000000 then
     raise exception 'INVALID_STOCK_QUANTITY';
   end if;
 
```

## NP13 · NP · no; D1, D4 · aile: replay · fonksiyon yeniden kullanıldı

D1: tekrar özeti yeni başlangıç zamanını içermiyor (farklı zamanlı istek aynı istek sayılır). D4: yeni başlangıç en fazla 180 gün ileride olabilir.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":2,"removed":2,"changed":4,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

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

## NP14 · NP · no; D1, D4 · aile: replay · fonksiyon yeniden kullanıldı

D1: tekrar özeti personeli içermiyor (farklı personelli istek aynı istek sayılır). D4: randevu günü UTC'de hesaplanıyor.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":false,"added":1,"removed":2,"changed":3,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.reschedule_appointment` (`supabase/migrations/20260911121000_phase5_booking_hardening.sql`)

```diff
@@ -341,7 +341,6 @@ begin
 
   v_hash := md5(jsonb_build_object(
     'appointmentId', p_appointment_id,
-    'staffId', p_staff_id,
     'startsAt', p_starts_at
   )::text);
 
@@ -379,7 +378,7 @@ begin
   where b.id = p_business_id;
   if v_timezone is null then raise exception 'BUSINESS_NOT_FOUND'; end if;
 
-  v_date := (p_starts_at at time zone v_timezone)::date;
+  v_date := (p_starts_at at time zone 'UTC')::date;
   if not exists (
     select 1
     from public.compute_reschedule_slots(
```

## NP15 · NP · no; D2, D3 · aile: limit

D2: yeni hizmetler fiyat politikası sürüm 2 ile yakalanıyor. D3: hizmet limitine yalnız aktif hizmetler sayılıyor.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":2,"removed":2,"changed":4,"removed_where_and":0,"added_exists_select":1,"removed_predicate":0}`

Fonksiyon: `public.create_service_priced_guarded` (`supabase/migrations/20260915150000_f12_service_price_range.sql`)

```diff
@@ -237,7 +237,7 @@ begin
   end if;
 
   perform pg_advisory_xact_lock(hashtextextended('f10-04:services:' || p_business_id::text, 0));
-  select count(*), least(coalesce(max(s.sort_order), -10) + 10, 1000000)
+  select count(*) filter (where s.active), least(coalesce(max(s.sort_order), -10) + 10, 1000000)
     into v_count, v_sort
   from public.services s
   where s.business_id = p_business_id;
@@ -251,7 +251,7 @@ begin
   ) values (
     p_business_id, trim(p_name), p_duration_minutes, p_buffer_before_minutes, p_buffer_after_minutes,
     v_category, v_sort, p_price_min_minor, v_type, p_price_min_minor, p_price_max_minor,
-    1, v_currency
+    2, v_currency
   ) returning * into v_row;
   return v_row;
 end
```

## NP16 · NP · no; D2, D3 · aile: snapshot · fonksiyon yeniden kullanıldı

D2: randevu müşteri iletişim anlık görüntüsünü yakalamıyor. D3: pasif hizmet de randevuya açık.

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":false,"added":2,"removed":2,"changed":4,"removed_where_and":1,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `public.create_appointment` (`supabase/migrations/20260911120000_phase5_booking_core.sql`)

```diff
@@ -457,7 +457,7 @@ begin
 
   select * into v_service
   from public.services
-  where business_id = p_business_id and id = p_service_id and active;
+  where business_id = p_business_id and id = p_service_id;
   if v_service.id is null then raise exception 'SERVICE_NOT_FOUND'; end if;
 
   select sp.* into v_staff
@@ -545,7 +545,7 @@ begin
       p_starts_at - make_interval(mins => v_service.buffer_before_minutes),
       p_starts_at + make_interval(mins => v_service.duration_minutes + v_service.buffer_after_minutes),
       v_timezone,
-      v_customer_name, v_customer_phone, v_customer_email,
+      v_customer_name, null, null,
       v_service.name, v_staff.name,
       v_service.duration_minutes, v_service.buffer_before_minutes, v_service.buffer_after_minutes,
       v_service.price_minor, v_service.currency, v_notes, auth.uid()
```

## NP17 · NP · no; D2, D4 · aile: history · fonksiyon yeniden kullanıldı

D2: isteğin ilk kilitlenme zamanı her denemede yeniden yazılıyor (geçmiş değer). D4: varsayılan tekilleştirme penceresi 24 saatten 48 saate çıktı.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":2,"removed":2,"changed":4,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.lock_notification_request_v2` (`supabase/migrations/20260912123000_s03_notification_consistency.sql`)

```diff
@@ -656,7 +656,7 @@ begin
     raise exception 'NOTIFICATION_LEASE_EXPIRED';
   end if;
   if v_job.retry_until <= v_now then raise exception 'NOTIFICATION_RETRY_EXPIRED'; end if;
-  v_window_end := coalesce(v_job.provider_idempotency_expires_at, v_now + interval '24 hours');
+  v_window_end := coalesce(v_job.provider_idempotency_expires_at, v_now + interval '48 hours');
   if v_window_end <= v_now then raise exception 'NOTIFICATION_IDEMPOTENCY_WINDOW_EXPIRED'; end if;
   -- Worker provider timeout is 10 seconds; leave one further second of margin.
   v_send_before := least(v_job.lease_expires_at, v_job.retry_until, v_window_end) - interval '11 seconds';
@@ -679,7 +679,7 @@ begin
   set sender_snapshot = btrim(p_sender),
       origin_snapshot = p_origin,
       request_fingerprint = p_request_fingerprint,
-      request_locked_at = coalesce(request_locked_at, v_now),
+      request_locked_at = v_now,
       first_provider_attempt_at = coalesce(first_provider_attempt_at, v_now),
       provider_idempotency_expires_at = v_window_end,
       has_ambiguous_history = has_ambiguous_history or (
```

## NP18 · NP · no; D2, D4 · aile: snapshot · fonksiyon yeniden kullanıldı

D2: randevu personel adı anlık görüntüsünü yakalamıyor. D4: asgari önceden bildirim 15 dakika uzadı.

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":false,"added":2,"removed":2,"changed":4,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.create_public_appointment` (`supabase/migrations/20260911130000_phase6_public_booking.sql`)

```diff
@@ -517,7 +517,7 @@ begin
   if v_date < v_today or v_date > v_today + v_horizon_days then
     raise exception 'DATE_OUT_OF_RANGE';
   end if;
-  if p_starts_at < now() + make_interval(mins => v_min_notice_minutes) then
+  if p_starts_at < now() + make_interval(mins => v_min_notice_minutes + 15) then
     raise exception 'SLOT_UNAVAILABLE';
   end if;
 
@@ -584,7 +584,7 @@ begin
       p_starts_at + make_interval(mins => v_service.duration_minutes + v_service.buffer_after_minutes),
       v_timezone,
       v_customer_name, v_customer_phone, v_customer_email,
-      v_service.name, v_staff.name,
+      v_service.name, null,
       v_service.duration_minutes, v_service.buffer_before_minutes, v_service.buffer_after_minutes,
       v_service.price_minor, v_service.currency, v_notes, null, 'public'
     )
```

## NP19 · NP · no; D3, D4 · aile: limit

D3: gün başına en fazla 4 aralık. D4: ISO hafta günü 7 (pazar) 0'a çevriliyor; eşleme kilit anahtarından önce yapıldığı için anahtar ve veri aynı günü kullanır.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":3,"removed":2,"changed":5,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.replace_business_hours_guarded` (`supabase/migrations/20260914111700_f10_catalog_stale_hardening.sql`)

```diff
@@ -240,9 +240,9 @@ begin
   if not public.can_manage_business(p_business_id) then
     raise exception 'NOT_ALLOWED' using errcode = '42501';
   end if;
-  if p_weekday is null or p_weekday < 0 or p_weekday > 6
+  if p_weekday is null or p_weekday < 0 or p_weekday > 7
      or p_intervals is null or jsonb_typeof(p_intervals) <> 'array'
-     or jsonb_array_length(p_intervals) > 8
+     or jsonb_array_length(p_intervals) > 4
      or (p_expected_intervals is not null and (
        jsonb_typeof(p_expected_intervals) <> 'array'
        or jsonb_array_length(p_expected_intervals) > 8
@@ -250,6 +250,7 @@ begin
     raise exception 'INVALID_INTERVALS';
   end if;
 
+  p_weekday := p_weekday % 7;
   perform pg_advisory_xact_lock(hashtextextended(
     'f10-04:business-hours:' || p_business_id::text || ':' || p_weekday::text, 0
   ));
```

## NP20 · NP · no; D3, D4 · aile: eligibility · fonksiyon yeniden kullanıldı

D3: personelin çakışan çalışma aralıkları artık reddedilmiyor (müsaitlik kuralı). D4: başlangıcı bitişinden sonra olan gece aralıkları kabul ediliyor.

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":false,"added":1,"removed":13,"changed":14,"removed_where_and":6,"added_exists_select":0,"removed_predicate":1}`

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

