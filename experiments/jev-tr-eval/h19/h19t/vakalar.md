# H19t vakaları (vakalar.v0.1.json, okunur liste)

## PS01 · PS · yes (yalnız D5) · weakens · aile: lock_removal

Fiş satırı kilidi kaldırıldı; kalan bakiye kontrolü serileşmiyor: aynı fişe eşzamanlı iki ödeme aynı bakiyeyi görüp birlikte geçer, fiş fazla ödenir.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":2,"changed":3,"removed_where_and":1,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `public.record_ticket_payment_guarded` (`supabase/migrations/20260922144500_f14_payment_ledger.sql`)

```diff
@@ -440,8 +440,7 @@ begin
   select * into v_ticket
   from public.tickets t
   where t.business_id = p_business_id
-    and t.id = p_ticket_id
-  for update;
+    and t.id = p_ticket_id;
 
   if v_ticket.id is null then raise exception 'TICKET_NOT_FOUND'; end if;
   if v_ticket.status = 'cancelled' then raise exception 'TICKET_CANCELLED'; end if;
```

## PS02 · PS · yes (yalnız D5) · weakens · aile: lock_downgrade

Fiş satırı kilidi FOR UPDATE yerine FOR SHARE oldu; aynı fişe eşzamanlı iki artırma düzeltmesi birlikte paylaşımlı kilit alır, ikisi de "toplamı aşma" kontrolünü geçer.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":1,"changed":2,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.record_ticket_correction_guarded` (`supabase/migrations/20260922144500_f14_payment_ledger.sql`)

```diff
@@ -524,7 +524,7 @@ begin
   from public.tickets t
   where t.business_id = p_business_id
     and t.id = p_ticket_id
-  for update;
+  for share of t;
   if v_ticket.id is null then raise exception 'TICKET_NOT_FOUND'; end if;
 
   select * into v_source
```

## PS03 · PS · yes (yalnız D5) · weakens · aile: stale_token

Ürün sürüm belirteci isteğe bağlı oldu; belirteç göndermeyen istemci, eşzamanlı bir ürün düzenlemesinden sonra bayat fiyat/ad görünümüyle satış satırı ekler.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":1,"changed":2,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.add_ticket_product_line_guarded` (`supabase/migrations/20260923113600_f15_product_sale_atomicity.sql`)

```diff
@@ -747,7 +747,7 @@ begin
   for update;
   if v_product.id is null then raise exception 'PRODUCT_NOT_FOUND'; end if;
   if not v_product.active then raise exception 'PRODUCT_ARCHIVED'; end if;
-  if p_expected_product_version is null or v_product.version <> p_expected_product_version then raise exception 'STALE_PRODUCT_WRITE'; end if;
+  if p_expected_product_version is not null and v_product.version <> p_expected_product_version then raise exception 'STALE_PRODUCT_WRITE'; end if;
   if v_product.stock_on_hand < p_quantity then raise exception 'INSUFFICIENT_STOCK'; end if;
   if v_ticket.currency is not null and v_ticket.currency <> v_product.currency then raise exception 'MIXED_CURRENCY'; end if;
 
```

## PS04 · PS · yes (yalnız D5) · weakens · aile: lock_downgrade

Kaynak gider satırı kilidi FOR UPDATE yerine FOR SHARE oldu; aynı gidere eşzamanlı iki düzeltme birlikte paylaşımlı kilit alır, ikisi de "zaten ters kaydedilmiş" kontrolünü geçer ve gider iki kez ters kaydedilir.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":1,"changed":2,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.correct_expense_guarded` (`supabase/migrations/20260923074000_f15_expense_ledger.sql`)

```diff
@@ -518,7 +518,7 @@ begin
   where e.business_id=p_business_id
     and e.id=p_source_event_id
     and e.event_type='expense'
-  for update;
+  for share;
 
   if v_source.id is null then raise exception 'EXPENSE_NOT_FOUND'; end if;
   if exists (
```

## PS05 · PS · yes (yalnız D5) · weakens · aile: lock_key_narrowed

Advisory kilit anahtarı işletmeden işletme + telefona daraltıldı; aynı e-postayla farklı telefonlu eşzamanlı iki ekleme serileşmez, ikisi de "iletişim zaten var mı" kontrolünü geçer.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":3,"removed":1,"changed":4,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.create_business_customer` (`supabase/migrations/20260914110000_f10_customer_records.sql`)

```diff
@@ -245,7 +245,9 @@ begin
 
   -- Customer management writes are low-frequency and business-scoped. A single
   -- tenant advisory lock makes same-contact concurrent creates deterministic.
-  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text, 0));
+  perform pg_advisory_xact_lock(hashtextextended(
+    p_business_id::text || ':' || coalesce(v_phone_normalized, ''), 0
+  ));
 
   if exists (
     select 1
```

## PS06 · PS · yes (yalnız D5) · weakens · aile: skip_locked_removed

Aday işlerin FOR UPDATE SKIP LOCKED kilidi kaldırıldı; eşzamanlı iki işçi aynı adayları seçer, güncelleme yalnız id eşleşmesini yeniden denetlediği için aynı iş iki kez kiralanıp gönderilebilir.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":0,"removed":1,"changed":1,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.claim_notification_jobs_v2` (`supabase/migrations/20260912123000_s03_notification_consistency.sql`)

```diff
@@ -545,7 +545,6 @@ begin
         or (j.state = 'leased' and j.lease_expires_at <= now())
       )
     order by j.available_at, j.created_at, j.id
-    for update skip locked
     limit v_limit
   ), claimed as (
     update public.appointment_notification_jobs j
```

## PS07 · PS · yes (yalnız D5) · weakens · aile: lock_removal

Tetikleyicideki grup satırı kilidi kaldırıldı; aynı grubun iki satırı eşzamanlı güncellenirse her tetikleyici özet durumu kendi anlık görüntüsünden hesaplar, son yazan diğerinin sonucunu ezer.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":2,"changed":3,"removed_where_and":1,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `public.f11_aggregate_group_status_from_line` (`supabase/migrations/20260915160300_f11_partial_line_lifecycle.sql`)

```diff
@@ -167,8 +167,7 @@ begin
   into v_legacy_appointment_id
   from public.appointment_groups g
   where g.business_id = new.business_id
-    and g.id = new.group_id
-  for update;
+    and g.id = new.group_id;
 
   if not found then
     raise exception 'BOOKING_GROUP_NOT_FOUND';
```

## PS08 · PS · yes (yalnız D5) · weakens · aile: version_check_removed

Beklenen grup sürümü artık hiç doğrulanmıyor (ön kontrol ve güncelleme sonrası sürüm kontrolü kaldırıldı); eski görünüme dayanan istemci, arada değişmiş grubun satırını iptal edebilir.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":0,"removed":6,"changed":6,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.cancel_appointment_group_line` (`supabase/migrations/20260917160200_f11_group_management_repair.sql`)

```diff
@@ -234,9 +234,6 @@ begin
     return public.f11_group_management_payload(p_business_id,p_group_id);
   end if;
 
-  if v_group.version <> p_expected_version then
-    raise exception 'BOOKING_GROUP_VERSION_CONFLICT';
-  end if;
   if v_line.status not in ('scheduled','confirmed') then
     raise exception 'BOOKING_GROUP_LINE_NOT_CANCELLABLE';
   end if;
@@ -253,9 +250,6 @@ begin
   select g.version into v_new_version
   from public.appointment_groups g
   where g.business_id=p_business_id and g.id=p_group_id;
-  if v_new_version <> p_expected_version+1 then
-    raise exception 'BOOKING_GROUP_VERSION_CONFLICT';
-  end if;
 
   insert into public.appointment_events(
     business_id,appointment_id,event_type,actor_user_id,actor_type,from_status,to_status,payload
```

## PS09 · PS · yes (yalnız D5) · weakens · aile: revision_check_removed

Sayfa revizyonu karşılaştırması kaldırıldı; sayfalar arasında eşzamanlı ekleme/silme olursa istemci bayat imleçle devam eder, satırlar atlanır ya da tekrarlanır (iyimser revizyon belirteci).

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":false,"added":0,"removed":5,"changed":5,"removed_where_and":1,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `public.list_appointments_page_v3` (`supabase/migrations/20260921013000_f13_booking_date_range.sql`)

```diff
@@ -85,11 +85,6 @@ begin
   where r.business_id = p_business_id
   for share;
 
-  if p_expected_revision is not null
-     and p_expected_revision is distinct from v_revision then
-    raise exception 'STALE_APPOINTMENT_PAGE';
-  end if;
-
   return query
   select
     a.id,a.business_id,a.customer_id,a.service_id,a.staff_id,a.status,
```

## PS10 · PS · yes (yalnız D5) · weakens · aile: version_bump_removed

Eski tip grupta satır değişince grup sürümü artık artmıyor; grup sürüm belirteciyle çalışan eşzamanlı istemciler arada olan değişikliği fark etmez (iyimser sürüm).

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":true,"added":0,"removed":1,"changed":1,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.f11_sync_legacy_group_from_line` (`supabase/migrations/20260915160000_f11_group_line_contract.sql`)

```diff
@@ -491,7 +491,6 @@ as $$
 begin
   update public.appointment_groups g
   set status = new.status,
-      version = g.version + 1,
       updated_at = new.updated_at
   where g.business_id = new.business_id
     and g.id = new.group_id
```

## PS11 · PS · yes (yalnız D5) · strengthens · aile: lock_added

Kullanıcı + sağlayıcı anahtarlı ikinci advisory kilit eklendi; aynı kullanıcıya farklı dış kimliklerin eşzamanlı bağlanması serileşir, "kullanıcı zaten bağlı" kontrolü yarışa açık kalmaz.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":0,"changed":1,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `core.command_link_identity_alias` (`supabase/migrations/20260916190000_kc01_core_platform_schema.sql`)

```diff
@@ -447,6 +447,7 @@ begin
   end if;
 
   perform pg_advisory_xact_lock(hashtextextended('identity_alias:' || v_provider || ':' || v_subject, 0));
+  perform pg_advisory_xact_lock(hashtextextended('identity_user:' || v_user_id::text || ':' || v_provider, 0));
 
   select * into v_existing
   from core.identity_aliases a
```

## PS12 · PS · yes (yalnız D5) · strengthens · aile: share_fence · fonksiyon yeniden kullanıldı

Kapak görselinin "ready" kontrolüne paylaşımlı satır kilidi eklendi; görsel satırını FOR UPDATE ile kilitleyen eşzamanlı silme başlatma, kontrol ile profil yazımı arasına giremez.

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":false,"added":1,"removed":0,"changed":1,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.update_business_public_profile` (`supabase/migrations/20260914110500_f12_salon_profile_media.sql`)

```diff
@@ -237,6 +237,7 @@ begin
   if p_cover_media_id is not null and not exists (
     select 1 from public.business_public_media m
     where m.business_id = p_business_id and m.id = p_cover_media_id and m.status = 'ready'
+    for share
   ) then
     raise exception 'INVALID_PUBLIC_MEDIA';
   end if;
```

## PS13 · PS · yes (yalnız D5) · strengthens · aile: lock_added

İşletme + personel anahtarlı advisory kilit eklendi; aynı personele eşzamanlı yeniden planlamalar uygunluk kontrolü ile güncelleme arasında serileşir.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":0,"changed":1,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.reschedule_appointment` (`supabase/migrations/20260911120000_phase5_booking_core.sql`)

```diff
@@ -631,6 +631,7 @@ begin
   if v_staff.id is null then raise exception 'STAFF_NOT_ELIGIBLE'; end if;
 
   v_date := (p_starts_at at time zone v_current.timezone)::date;
+  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text || ':booking-staff:' || p_staff_id::text, 0));
   if not exists (
     select 1
     from public.compute_availability_slots_internal(
```

## PS14 · PS · yes (yalnız D5) · strengthens · aile: skip_locked_added

Silinecek eski sayaçlar FOR UPDATE SKIP LOCKED ile seçiliyor; eşzamanlı temizleyiciler birbirini beklemez, o anda başka işlemin kilitlediği sayaç atlanır.

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":true,"added":1,"removed":0,"changed":1,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.prune_public_booking_rate_counters` (`supabase/migrations/20260911180200_phase9_public_abuse_retention.sql`)

```diff
@@ -25,6 +25,7 @@ begin
     where stale.updated_at < clock_timestamp() - interval '48 hours'
     order by stale.updated_at
     limit 500
+    for update skip locked
   );
 
   get diagnostics v_deleted = row_count;
```

## PS15 · PS · yes (yalnız D5) · strengthens · aile: share_fence

Personel kontrolüne paylaşımlı satır kilidi eklendi; eşzamanlı personel pasifleştirme bu blok eklemesiyle serileşir.

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":false,"added":1,"removed":0,"changed":1,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.create_availability_block_local` (`supabase/migrations/20260911110000_phase4_availability.sql`)

```diff
@@ -292,6 +292,7 @@ begin
   if p_staff_id is not null and not exists (
     select 1 from public.staff_profiles s
     where s.business_id = p_business_id and s.id = p_staff_id and s.active
+    for share of s
   ) then
     raise exception 'STAFF_NOT_FOUND';
   end if;
```

## PS16 · PS · yes (yalnız D5) · strengthens · aile: share_fence

Finansal aktörün üyelik okumasına paylaşımlı satır kilidi eklendi; eşzamanlı üyelik pasifleştirme, bu fiş işlemi bitene kadar bekler.

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":false,"added":2,"removed":1,"changed":3,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.f14_financial_actor` (`supabase/migrations/20260922111500_f14_ticket_model.sql`)

```diff
@@ -236,7 +236,8 @@ begin
   where m.business_id = p_business_id
     and m.user_id = auth.uid()
     and m.active
-  limit 1;
+  limit 1
+  for share of m;
 
   if v_actor.id is null then
     raise exception 'NOT_ALLOWED' using errcode = '42501';
```

## PS17 · PS · yes (yalnız D5) · strengthens · aile: lock_before_check

Grup satırlarının kilidi durum sayımından önceye alındı; "bütün satırlar aynı durumda mı" kontrolü artık kilitli satırlar üzerinde yapılır, sayım ile toplu güncelleme arasına eşzamanlı satır değişikliği giremez.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":6,"removed":6,"changed":12,"removed_where_and":1,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `public.set_appointment_group_status` (`supabase/migrations/20260921023000_f13_group_lifecycle.sql`)

```diff
@@ -90,6 +90,12 @@ begin
     raise exception 'INVALID_GROUP_STATUS_TRANSITION';
   end if;
 
+  perform 1
+  from public.appointments a
+  where a.business_id=p_business_id and a.group_id=p_group_id
+  order by a.line_ordinal,a.id
+  for update;
+
   select
     count(*)::integer,
     count(*) filter (where a.status=v_from_status)::integer
@@ -101,12 +107,6 @@ begin
     raise exception 'BOOKING_GROUP_PARTIAL_STATUS';
   end if;
 
-  perform 1
-  from public.appointments a
-  where a.business_id=p_business_id and a.group_id=p_group_id
-  order by a.line_ordinal,a.id
-  for update;
-
   perform set_config('app.f11_group_management_id',p_group_id::text,true);
   perform set_config('app.f11_group_status_batch_id',p_group_id::text,true);
   update public.appointments a
```

## PS18 · PS · yes (yalnız D5) · strengthens · aile: share_fence

Ödeme aktörünün üyelik okumasına paylaşımlı satır kilidi eklendi; eşzamanlı üyelik pasifleştirme, bu ödeme işlemi bitene kadar bekler.

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":false,"added":2,"removed":1,"changed":3,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.f14_payment_actor` (`supabase/migrations/20260922144500_f14_payment_ledger.sql`)

```diff
@@ -98,7 +98,8 @@ begin
   where m.business_id = p_business_id
     and m.user_id = auth.uid()
     and m.active
-  limit 1;
+  limit 1
+  for share;
 
   if v_actor.id is null then
     raise exception 'NOT_ALLOWED' using errcode = '42501';
```

## PS19 · PS · yes (yalnız D5) · strengthens · aile: stale_token

İstek beklenen abonelik sürümünü taşıyorsa kilit altında karşılaştırılıyor; eski görünüme dayanan eşzamanlı plan değişikliği reddedilir (iyimser sürüm).

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":4,"removed":0,"changed":4,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `core.command_change_subscription` (`supabase/migrations/20260916190000_kc01_core_platform_schema.sql`)

```diff
@@ -753,6 +753,10 @@ begin
   select * into v_subscription
   from core.subscriptions s where s.business_id = v_business_id for update;
   v_exists := found;
+  if p_payload ? 'expected_version'
+     and v_subscription.version is distinct from (p_payload->>'expected_version')::integer then
+    raise exception 'SUBSCRIPTION_VERSION_CONFLICT';
+  end if;
 
   if v_grant is not null then
     v_changes := core.plan_entitlement_changes(v_business_id, v_plan_key, v_grant, v_period_end);
```

## PS20 · PS · yes (yalnız D5) · strengthens · aile: share_fence · fonksiyon yeniden kullanıldı

Müşteri okumasına paylaşımlı satır kilidi eklendi; aynı müşteriyi kilitleyen eşzamanlı düzenleme, fiş açma bitene kadar bekler.

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":false,"added":2,"removed":1,"changed":3,"removed_where_and":1,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `public.open_walk_in_ticket_guarded` (`supabase/migrations/20260922111500_f14_ticket_model.sql`)

```diff
@@ -637,7 +637,8 @@ begin
   select * into v_customer
   from public.customers c
   where c.business_id = p_business_id
-    and c.id = p_customer_id;
+    and c.id = p_customer_id
+  for share;
 
   if v_customer.id is null then raise exception 'CUSTOMER_NOT_FOUND'; end if;
 
```

## PP01 · PP · yes + D0 · weakens · aile: check_before_lock

D5: yetki okuması işletme kilidinden önceye taşındı (aynı kilidi alan eşzamanlı rol düşürme gözden kaçar). D0: finansal yetki yalnız personel değil yönetici üyelere de verilebiliyor.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":2,"removed":2,"changed":4,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.set_membership_financial_permission` (`supabase/migrations/20260914033000_f10_team_access.sql`)

```diff
@@ -545,11 +545,11 @@ begin
     raise exception 'INVALID_FINANCIAL_PERMISSION';
   end if;
 
-  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text, 0));
   select * into v_actor from public.f10_team_actor(p_business_id);
   if v_actor.membership_id is null or v_actor.role <> 'owner' then
     raise exception 'FINANCIAL_PERMISSION_OWNER_REQUIRED' using errcode = '42501';
   end if;
+  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text, 0));
 
   select * into v_target
   from public.memberships m
@@ -558,7 +558,7 @@ begin
   if v_target.id is null or not v_target.active then
     raise exception 'ACTIVE_MEMBERSHIP_NOT_FOUND';
   end if;
-  if v_target.role <> 'staff' then
+  if v_target.role not in ('staff', 'manager') then
     raise exception 'FINANCIAL_PERMISSION_STAFF_ONLY';
   end if;
 
```

## PP02 · PP · yes + D0 · weakens · aile: lock_removal

D5: blok sayımını serileştiren advisory kilit kaldırıldı (eşzamanlı eklemeler 100 sınırını birlikte geçer; aynı ad alanını kilitleyen grup randevusuyla da serileşmez). D0: blok eklemeyi yönetici yerine her aktif üye yapabiliyor.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":4,"changed":5,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.create_availability_block_local_guarded` (`supabase/migrations/20260914111600_f10_catalog_hours_limits.sql`)

```diff
@@ -116,12 +116,9 @@ declare
   v_count integer;
 begin
   perform public.f10_require_standard_session();
-  if not public.can_manage_business(p_business_id) then
+  if not public.is_active_member(p_business_id) then
     raise exception 'NOT_ALLOWED' using errcode = '42501';
   end if;
-  perform pg_advisory_xact_lock(hashtextextended(
-    'f10-04:availability-blocks:' || p_business_id::text, 0
-  ));
   select count(*) into v_count
   from public.availability_blocks b
   where b.business_id = p_business_id and b.active;
```

## PP03 · PP · yes + D0 · weakens · aile: version_check_removed

D5: beklenen grup sürümü artık karşılaştırılmıyor (ön kontrol ve güncelleme koşulu kaldırıldı; eski görünümle hizmet değiştirilebilir). D0: işlem her aktif üye yerine yalnız yöneticilere açık.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":2,"removed":3,"changed":5,"removed_where_and":1,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `public.change_appointment_group_line_service` (`supabase/migrations/20260917160500_f11_group_integration_repair.sql`)

```diff
@@ -270,7 +270,7 @@ declare
   v_timezone text;
 begin
   perform public.f10_require_standard_session();
-  if auth.uid() is null or not public.is_active_member(p_business_id) then
+  if auth.uid() is null or not public.can_manage_business(p_business_id) then
     raise exception 'NOT_ALLOWED';
   end if;
   if p_expected_version is null or p_expected_version<1 then raise exception 'INVALID_GROUP_VERSION'; end if;
@@ -307,7 +307,6 @@ begin
     return public.f11_group_management_payload(p_business_id,p_group_id);
   end if;
 
-  if v_group.version<>p_expected_version then raise exception 'BOOKING_GROUP_VERSION_CONFLICT'; end if;
   if v_line.status not in ('scheduled','confirmed') then
     raise exception 'BOOKING_GROUP_LINE_NOT_CHANGEABLE';
   end if;
@@ -368,7 +367,7 @@ begin
 
   update public.appointment_groups g
   set version=g.version+1,updated_at=now()
-  where g.business_id=p_business_id and g.id=p_group_id and g.version=p_expected_version
+  where g.business_id=p_business_id and g.id=p_group_id
   returning g.version into v_new_version;
   if v_new_version is null then raise exception 'BOOKING_GROUP_VERSION_CONFLICT'; end if;
 
```

## PP04 · PP · yes + D0 · weakens · aile: lock_removal

D5: işletme satırı kilidi düz okumaya indi (aynı kilidi alan profil kapak güncellemesiyle serileşmez; silinmekte olan görsel kapak olarak kalabilir). D0: görsel silmeyi yönetici yerine her aktif üye başlatabiliyor.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":2,"removed":2,"changed":4,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.begin_business_public_media_delete` (`supabase/migrations/20260914110600_f12_media_lifecycle_repair.sql`)

```diff
@@ -174,10 +174,10 @@ as $$
 declare v_path text; v_cover boolean;
 begin
   perform public.f10_require_standard_session();
-  if not public.can_manage_business(p_business_id) then
+  if not public.is_active_member(p_business_id) then
     raise exception 'NOT_ALLOWED' using errcode = '42501';
   end if;
-  perform 1 from public.businesses b where b.id = p_business_id for update;
+  perform 1 from public.businesses b where b.id = p_business_id;
   if not found then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
 
   select m.storage_path into v_path
```

## PP05 · PP · yes + D1 · weakens · aile: check_before_lock

"Komut zaten var mı" yoklaması advisory kilitten önceye taşındı: aynı anahtarla eşzamanlı iki istek kilitten önce komutu yok görür (D5); ikincisi çekirdekte tekrar olarak döner ama yeniden planlama bildirimini yine üretir (D1: tekrar eden istek ikinci yan etki).

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":5,"removed":4,"changed":9,"removed_where_and":1,"added_exists_select":2,"removed_predicate":1}`

Fonksiyon: `public.reschedule_public_managed_group` (`supabase/migrations/20260917160100_f11_public_group_management.sql`)

```diff
@@ -197,6 +197,11 @@ begin
     raise exception 'SLOT_UNAVAILABLE';
   end if;
 
+  select exists(
+    select 1 from public.booking_commands bc
+    where bc.business_id=v_ref.business_id and bc.idempotency_key=p_idempotency_key
+  ) into v_preexisting;
+
   -- Serialize the wrapper with the core so only the transaction that creates
   -- the command emits the one frozen reschedule notification.
   perform pg_advisory_xact_lock(hashtextextended(
@@ -207,10 +212,6 @@ begin
     'expectedVersion',p_expected_version,
     'startsAt',p_starts_at
   )::text);
-  select exists(
-    select 1 from public.booking_commands bc
-    where bc.business_id=v_ref.business_id and bc.idempotency_key=p_idempotency_key
-  ) into v_preexisting;
 
   v_result := public.f11_reschedule_group_core(
     v_ref.business_id,v_ref.group_id,p_idempotency_key,p_expected_version,p_starts_at,
```

## PP06 · PP · yes + D1 · weakens · aile: check_then_insert

Tekrar talebi ON CONFLICT DO NOTHING yerine "önce oku, yoksa ekle" oldu: aynı anahtarla eşzamanlı iki çağrı birlikte "yok" görür (D5); ikincisi kayıtlı sonucu döndürmek yerine benzersizlik hatası alır (D1: tekrar semantiği).

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":true,"added":7,"removed":7,"changed":14,"removed_where_and":1,"added_exists_select":1,"removed_predicate":1}`

Fonksiyon: `public.core_apply_platform_command` (`supabase/migrations/20260916190000_kc01_core_platform_schema.sql`)

```diff
@@ -923,15 +923,12 @@ begin
 
   begin
     -- Idempotency claim. Concurrent callers with the same key serialize on the PK.
-    insert into core.platform_commands (principal_id, idempotency_key, command, request_hash)
-    values (v_principal_id, p_idempotency_key, p_command, v_request_hash)
-    on conflict (principal_id, idempotency_key) do nothing;
-    get diagnostics v_inserted = row_count;
+    select * into v_existing
+    from core.platform_commands c
+    where c.principal_id = v_principal_id and c.idempotency_key = p_idempotency_key;
+    v_inserted := case when found then 0 else 1 end;
 
     if v_inserted = 0 then
-      select * into v_existing
-      from core.platform_commands c
-      where c.principal_id = v_principal_id and c.idempotency_key = p_idempotency_key;
       if v_existing.command <> p_command or v_existing.request_hash <> v_request_hash then
         raise exception 'PLATFORM_IDEMPOTENCY_CONFLICT';
       end if;
@@ -941,6 +938,9 @@ begin
       return v_existing.result;
     end if;
 
+    insert into core.platform_commands (principal_id, idempotency_key, command, request_hash)
+    values (v_principal_id, p_idempotency_key, p_command, v_request_hash);
+
     case p_command
       when 'LinkTenantAlias' then
         v_result := core.command_link_tenant_alias(v_principal_id, p_idempotency_key, p_payload);
```

## PP07 · PP · yes + D1 · weakens · aile: lock_removal

D5: işletme ve takma ad kilitleri kaldırıldı (aynı işletmeye eşzamanlı iki farklı takma ad bağlama "işletme zaten bağlı" kontrolünü birlikte geçer). D1: aynı takma adın aynı işletmeye yeniden bağlanması artık "zaten bağlı" diye başarılı dönmüyor, çakışma hatası veriyor (tekrar semantiği).

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":true,"added":1,"removed":12,"changed":13,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `core.command_link_tenant_alias` (`supabase/migrations/20260916190000_kc01_core_platform_schema.sql`)

```diff
@@ -376,23 +376,12 @@ begin
     raise exception 'BUSINESS_NOT_FOUND';
   end if;
 
-  perform core.lock_business(v_business_id);
-  perform core.lock_tenant_alias(v_provider, v_external_id);
-
   select * into v_existing
   from core.tenant_aliases a
   where a.provider = v_provider and a.external_id = v_external_id;
 
   if found then
-    if v_existing.business_id <> v_business_id then
-      raise exception 'TENANT_ALIAS_CONFLICT';
-    end if;
-    return jsonb_build_object(
-      'business_id', v_existing.business_id,
-      'provider', v_existing.provider,
-      'external_id', v_existing.external_id,
-      'linked', false
-    );
+    raise exception 'TENANT_ALIAS_CONFLICT';
   end if;
 
   if exists (
```

## PP08 · PP · yes + D1 · weakens · aile: lock_removal

D5: iptal döngüsündeki ürün satırı kilidi kaldırıldı (stok iadesi aynı ürünün eşzamanlı satışıyla kayıp güncelleme yaşar). D1: tekrar eden istek kayıtlı sonucu döndürmüyor, iptali yeniden çalıştırıyor.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":3,"changed":4,"removed_where_and":1,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `public.cancel_ticket_guarded` (`supabase/migrations/20260923113600_f15_product_sale_atomicity.sql`)

```diff
@@ -1062,7 +1062,6 @@ begin
   v_replay := public.f14_claim_ticket_command(
     p_business_id,v_actor.id,'cancel_ticket',p_idempotency_key,p_request_hash
   );
-  if v_replay is not null then return v_replay; end if;
   if v_reason is null or char_length(v_reason)>240 then raise exception 'INVALID_CANCELLATION_REASON'; end if;
 
   select * into v_ticket
@@ -1095,8 +1094,7 @@ begin
   loop
     select * into v_product
     from public.products p
-    where p.business_id=p_business_id and p.id=v_line.product_id
-    for update;
+    where p.business_id=p_business_id and p.id=v_line.product_id;
     if v_product.id is null then raise exception 'PRODUCT_NOT_FOUND'; end if;
 
     select * into v_sale
```

## PP09 · PP · yes + D2 · weakens · aile: share_fence_removed

D5: müşteri okumasındaki paylaşımlı kilit kaldırıldı (eşzamanlı müşteri düzenlemesi okuma ile fiş eklemesi arasına girebilir). D2: fiş müşteri e-posta anlık görüntüsünü yakalamıyor.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":false,"added":2,"removed":2,"changed":4,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.open_product_sale_guarded` (`supabase/migrations/20260923113600_f15_product_sale_atomicity.sql`)

```diff
@@ -834,7 +834,7 @@ begin
   select * into v_customer
   from public.customers c
   where c.business_id=p_business_id and c.id=p_customer_id
-  for share;
+  limit 1;
   if v_customer.id is null then raise exception 'CUSTOMER_NOT_FOUND'; end if;
 
   select * into v_product
@@ -851,7 +851,7 @@ begin
     customer_name_snapshot,customer_phone_snapshot,customer_email_snapshot,created_by_membership_id
   ) values (
     p_business_id,null,v_customer.id,'walk_in','open',v_product.currency,
-    v_customer.name,v_customer.phone,v_customer.email,v_actor.id
+    v_customer.name,v_customer.phone,null,v_actor.id
   ) returning * into v_ticket;
 
   insert into public.ticket_lines(
```

## PP10 · PP · yes + D2 · weakens · aile: version_bump_removed

D5: indirim artık fiş sürümünü artırmıyor (fişin sürüm belirteciyle çalışan eşzamanlı istemciler indirimi görmeden yazar). D2: indirim gerekçesi satırda saklanmıyor (geçmiş kaydı).

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":5,"changed":6,"removed_where_and":1,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `public.set_ticket_service_discount_guarded` (`supabase/migrations/20260922144500_f14_payment_ledger.sql`)

```diff
@@ -739,13 +739,9 @@ begin
   set discount_minor = p_discount_minor,
       discount_by_membership_id = case when p_discount_minor > 0 then v_actor.id else null end,
       discount_at = case when p_discount_minor > 0 then now() else null end,
-      discount_reason = case when p_discount_minor > 0 then v_reason else null end
+      discount_reason = null
   where business_id = p_business_id and id = p_line_id;
 
-  update public.tickets
-  set version = version + 1
-  where business_id = p_business_id and id = p_ticket_id;
-
   v_result := public.f14_ticket_projection(p_business_id, p_ticket_id);
   perform public.f14_finish_ticket_command(
     p_business_id, v_actor.id, 'set_service_discount',
```

## PP11 · PP · yes + D2 · weakens · aile: share_fence_removed

D5: grup okumasındaki paylaşımlı kilit kaldırıldı (grubu FOR UPDATE ile kilitleyen eşzamanlı iptal, fiş açmayla serileşmez; iptal edilmekte olan gruba fiş açılabilir). D2: fiş müşteri telefon anlık görüntüsünü yakalamıyor.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":false,"added":2,"removed":2,"changed":4,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.open_ticket_from_booking_group_guarded` (`supabase/migrations/20260922111500_f14_ticket_model.sql`)

```diff
@@ -522,7 +522,7 @@ begin
   from public.appointment_groups g
   where g.business_id = p_business_id
     and g.id = p_group_id
-  for share;
+  limit 1;
 
   if v_group.id is null then raise exception 'BOOKING_GROUP_NOT_FOUND'; end if;
   if v_group.status = 'cancelled' then raise exception 'BOOKING_GROUP_CANCELLED'; end if;
@@ -556,7 +556,7 @@ begin
       'open',
       v_currency,
       a.customer_name_snapshot,
-      a.customer_phone_snapshot,
+      null,
       a.customer_email_snapshot,
       v_actor.id
     from public.appointments a
```

## PP12 · PP · yes + D2 · weakens · aile: lock_order_removed

D5: personel satırı kilitleri artık sabit artan sırayla alınmıyor (aynı personel kümesine eşzamanlı iki grup kilitlenmede birbirini bekleyip çıkmaza girebilir). D2: oluşturma olayı planlanan satırların anlık kaydını tutmuyor.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":3,"changed":4,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.create_appointment_group` (`supabase/migrations/20260917120000_f11_multi_service_group_booking.sql`)

```diff
@@ -567,7 +567,6 @@ begin
       select distinct (l->>'staffId')::uuid
       from jsonb_array_elements(v_plan->'lines') l
     )
-  order by sp.id
   for update;
 
   -- Replan under the locks: a slot that filled between search and commit must
@@ -641,8 +640,7 @@ begin
     p_business_id, v_anchor_id, 'created', auth.uid(), null, 'scheduled',
     jsonb_build_object(
       'startsAt', p_starts_at,
-      'lineCount', jsonb_array_length(v_plan->'lines'),
-      'lines', v_plan->'lines'
+      'lineCount', jsonb_array_length(v_plan->'lines')
     )
   );
 
```

## PP13 · PP · yes + D3 · weakens · aile: lock_removal

D5: bekleyen davet sayımını serileştiren advisory kilit kaldırıldı (eşzamanlı davetler sınırı birlikte geçer). D3: bekleyen davet sınırı 100'den 200'e çıktı.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":2,"changed":3,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.create_business_invitation` (`supabase/migrations/20260914060000_f10_team_security_hardening.sql`)

```diff
@@ -164,7 +164,6 @@ declare
   v_pending_count integer;
 begin
   perform public.f10_require_standard_session();
-  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text, 0));
 
   select count(*) into v_pending_count
   from public.business_invitations i
@@ -173,7 +172,7 @@ begin
     and i.accepted_at is null
     and i.expires_at > now();
 
-  if v_pending_count >= 100 then
+  if v_pending_count >= 200 then
     raise exception 'TEAM_INVITATIONS_LIMIT_EXCEEDED';
   end if;
 
```

## PP14 · PP · yes + D3 · weakens · aile: nowait

D5: aday iş kilitliyse atlanmıyor, NOWAIT ile hata veriliyor (eşzamanlı ikinci işçi talep turunu kaybeder). D3: tek talepte alınabilecek iş sayısı 50'den 200'e çıktı.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":2,"removed":2,"changed":4,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.claim_notification_jobs` (`supabase/migrations/20260911170000_phase9_notification_outbox.sql`)

```diff
@@ -188,7 +188,7 @@ begin
     raise exception 'NOTIFICATION_DISPATCH_UNAUTHORIZED';
   end if;
 
-  v_limit := greatest(1, least(coalesce(p_limit, 10), 50));
+  v_limit := greatest(1, least(coalesce(p_limit, 10), 200));
   v_lease_seconds := greatest(15, least(coalesce(p_lease_seconds, 45), 300));
 
   update public.appointment_notification_jobs j
@@ -235,7 +235,7 @@ begin
         or (j.state = 'leased' and j.lease_expires_at <= now())
       )
     order by j.available_at, j.created_at, j.id
-    for update skip locked
+    for update nowait
     limit v_limit
   ), claimed as (
     update public.appointment_notification_jobs j
```

## PP15 · PP · yes + D3 · weakens · aile: lock_removal · fonksiyon yeniden kullanıldı

D5: fiş satırı kilidi kaldırıldı (aynı fişe eşzamanlı satır eklemeleri aynı sıra numarasını ve sürümü görür). D3: stok yeterliliği denetlenmiyor; eldeki stoktan fazlası satılabiliyor.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":3,"changed":4,"removed_where_and":1,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `public.add_ticket_product_line_guarded` (`supabase/migrations/20260923113600_f15_product_sale_atomicity.sql`)

```diff
@@ -729,8 +729,7 @@ begin
 
   select * into v_ticket
   from public.tickets t
-  where t.business_id = p_business_id and t.id = p_ticket_id
-  for update;
+  where t.business_id = p_business_id and t.id = p_ticket_id;
   if v_ticket.id is null then raise exception 'TICKET_NOT_FOUND'; end if;
   if v_ticket.status <> 'open' then raise exception 'TICKET_NOT_OPEN'; end if;
   if p_expected_ticket_version is null or v_ticket.version <> p_expected_ticket_version then raise exception 'STALE_WRITE'; end if;
@@ -748,7 +747,6 @@ begin
   if v_product.id is null then raise exception 'PRODUCT_NOT_FOUND'; end if;
   if not v_product.active then raise exception 'PRODUCT_ARCHIVED'; end if;
   if p_expected_product_version is null or v_product.version <> p_expected_product_version then raise exception 'STALE_PRODUCT_WRITE'; end if;
-  if v_product.stock_on_hand < p_quantity then raise exception 'INSUFFICIENT_STOCK'; end if;
   if v_ticket.currency is not null and v_ticket.currency <> v_product.currency then raise exception 'MIXED_CURRENCY'; end if;
 
   select coalesce(max(line_ordinal),0)+1 into v_ordinal
```

## PP16 · PP · yes + D3 · strengthens · aile: share_fence · fonksiyon yeniden kullanıldı

D5: personel okumasına paylaşımlı satır kilidi eklendi (eşzamanlı personel düzenlemesi yeniden planlamayla serileşir). D3: personelin aktif olması şartı kalktı; pasif personele yeniden planlanabiliyor.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":false,"added":2,"removed":1,"changed":3,"removed_where_and":1,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `public.reschedule_appointment` (`supabase/migrations/20260911120000_phase5_booking_core.sql`)

```diff
@@ -627,7 +627,8 @@ begin
    and ss.staff_id = sp.id
    and ss.service_id = v_current.service_id
    and ss.active
-  where sp.business_id = p_business_id and sp.id = p_staff_id and sp.active;
+  where sp.business_id = p_business_id and sp.id = p_staff_id
+  for share of sp;
   if v_staff.id is null then raise exception 'STAFF_NOT_ELIGIBLE'; end if;
 
   v_date := (p_starts_at at time zone v_current.timezone)::date;
```

## PP17 · PP · yes + D4 · weakens · aile: lock_removal

D5: işletme satırı kilidi düz okumaya indi (yayına alma hazırlık kontrolü, iletişim bilgisini kaldıran eşzamanlı profil yazımıyla serileşmez). D4: asgari önceden bildirim üst sınırı 7 günden 30 güne çıktı.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":2,"removed":2,"changed":4,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.update_public_booking_settings` (`supabase/migrations/20260921083000_f12_booking_information_links.sql`)

```diff
@@ -105,14 +105,14 @@ begin
   end if;
   if p_enabled is null
      or p_step_minutes < 5 or p_step_minutes > 120
-     or p_min_notice_minutes < 0 or p_min_notice_minutes > 10080
+     or p_min_notice_minutes < 0 or p_min_notice_minutes > 43200
      or p_horizon_days < 1 or p_horizon_days > 366 then
     raise exception 'INVALID_PUBLIC_BOOKING_SETTINGS';
   end if;
 
   -- Serialize public-profile contact changes and booking enable/disable on the
   -- same tenant row. F12 profile writes use this exact business-row lock too.
-  perform 1 from public.businesses b where b.id = p_business_id for update;
+  perform 1 from public.businesses b where b.id = p_business_id;
   if not found then
     raise exception 'NOT_ALLOWED' using errcode = '42501';
   end if;
```

## PP18 · PP · yes + D4 · weakens · aile: fencing_token_removed

D5: kilitli okumadan kiralama belirteci koşulu kaldırıldı (kiralaması düşmüş eski bir işçi, işi yeniden kiralamış başka işçinin kiralamasını bırakabilir). D4: yeniden deneme gecikmesi üst sınırı 1 günden 7 güne çıktı.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":2,"changed":3,"removed_where_and":1,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `public.release_notification_job` (`supabase/migrations/20260911170000_phase9_notification_outbox.sql`)

```diff
@@ -359,14 +359,13 @@ begin
   from public.appointment_notification_jobs j
   where j.id = p_job_id
     and j.state = 'leased'
-    and j.lease_token = p_lease_token
   for update;
 
   if v_job.id is null then
     raise exception 'NOTIFICATION_LEASE_LOST';
   end if;
 
-  v_delay := greatest(1, least(coalesce(p_retry_after_seconds, 60), 86400));
+  v_delay := greatest(1, least(coalesce(p_retry_after_seconds, 60), 604800));
 
   if not coalesce(p_retryable, false)
      or v_job.attempt_count >= v_job.max_attempts
```

## PP19 · PP · yes + D4 · weakens · aile: share_fence_removed · fonksiyon yeniden kullanıldı

D5: sayfa revizyonu okumasındaki paylaşımlı kilit kaldırıldı (revizyonu yenileyen eşzamanlı randevu yazımı beklenmiyor; sayfa, verisiyle uyuşmayan revizyonla dönebilir). D4: tarih aralığının bitişi dahil oldu (bitiş gününün 00:00 randevusu da listeleniyor).

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":false,"added":2,"removed":3,"changed":5,"removed_where_and":1,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `public.list_appointments_page_v3` (`supabase/migrations/20260921013000_f13_booking_date_range.sql`)

```diff
@@ -82,8 +82,7 @@ begin
   select r.revision
     into v_revision
   from private.appointment_page_revisions r
-  where r.business_id = p_business_id
-  for share;
+  where r.business_id = p_business_id;
 
   if p_expected_revision is not null
      and p_expected_revision is distinct from v_revision then
@@ -102,7 +101,7 @@ begin
   where a.business_id = p_business_id
     and (
       v_from is null
-      or (a.starts_at >= v_from and a.starts_at < v_to)
+      or (a.starts_at >= v_from and a.starts_at <= v_to)
     )
     and (
       p_after_starts_at is null
```

## PP20 · PP · yes + D4 · weakens · aile: lock_removal

D5: sürmekte olan oluşturmayı bekleten advisory kilit kaldırıldı (aynı kurtarma kimliğiyle oluşturma bitmeden sorgu "yok" döner). D4: kurtarma bilgisi süresi dolduktan sonra 10 dakika daha geçerli ve o süre boyunca silinmiyor.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":2,"removed":6,"changed":8,"removed_where_and":2,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `public.recover_public_appointment` (`supabase/migrations/20260911160000_phase9_booking_recovery.sql`)

```diff
@@ -252,17 +252,13 @@ begin
     return;
   end if;
 
-  -- If create is still in-flight for this recovery ID, wait for its transaction
-  -- outcome before deciding whether the booking exists.
-  perform pg_advisory_xact_lock(hashtextextended(p_recovery_id::text, 0));
-
   -- Expired proof material is lazily removed. Encrypted management material stays
   -- for F09-03's bounded delivery window and is not itself a bearer credential.
   update public.public_booking_recoveries r
   set recovery_secret_hash = null
   where r.recovery_id = p_recovery_id
     and r.idempotency_key = p_idempotency_key
-    and r.expires_at <= now();
+    and r.expires_at <= now() - interval '10 minutes';
 
   return query
   select
@@ -294,7 +290,7 @@ begin
   where r.recovery_id = p_recovery_id
     and r.idempotency_key = p_idempotency_key
     and r.recovery_secret_hash = p_recovery_secret_hash
-    and r.expires_at > now()
+    and r.expires_at > now() - interval '10 minutes'
   limit 1;
 end
 $$;
```

## NS01 · NS · no; D0 · aile: authority_scope · fonksiyon yeniden kullanıldı

Finansal yetki verme/geri alma sahibe ek olarak yöneticiye de açıldı (yetki kapsamı); kontrol aynı kilit altında.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":1,"changed":2,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.set_membership_financial_permission` (`supabase/migrations/20260914033000_f10_team_access.sql`)

```diff
@@ -547,7 +547,7 @@ begin
 
   perform pg_advisory_xact_lock(hashtextextended(p_business_id::text, 0));
   select * into v_actor from public.f10_team_actor(p_business_id);
-  if v_actor.membership_id is null or v_actor.role <> 'owner' then
+  if v_actor.membership_id is null or v_actor.role not in ('owner', 'manager') then
     raise exception 'FINANCIAL_PERMISSION_OWNER_REQUIRED' using errcode = '42501';
   end if;
 
```

## NS02 · NS · no; D0 · aile: authority_scope

Silinmekte olan görseli geri yüklemeyi yönetici yerine her aktif üye yapabiliyor (yetki kapsamı); işletme kilidi yerinde.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":1,"changed":2,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.restore_business_public_media_delete` (`supabase/migrations/20260914110600_f12_media_lifecycle_repair.sql`)

```diff
@@ -214,7 +214,7 @@ as $$
 declare v_row public.business_public_media;
 begin
   perform public.f10_require_standard_session();
-  if not public.can_manage_business(p_business_id) then
+  if not public.is_active_member(p_business_id) then
     raise exception 'NOT_ALLOWED' using errcode = '42501';
   end if;
   perform 1 from public.businesses b where b.id = p_business_id for update;
```

## NS03 · NS · no; D0 · aile: authority_scope

Pasifleştirilmiş servis kimlikleri de yetkilendiriliyor (etkinlik koşulu kaldırıldı).

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":false,"added":0,"removed":1,"changed":1,"removed_where_and":1,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `core.authorize_service_principal` (`supabase/migrations/20260916190000_kc01_core_platform_schema.sql`)

```diff
@@ -256,7 +256,6 @@ as $$
   select p.id
   from core.service_principals p
   where p.name = p_name
-    and p.active
     and p_secret is not null
     and char_length(p_secret) between 43 and 256
     and (
```

## NS04 · NS · no; D0 · aile: authority_scope · fonksiyon yeniden kullanıldı

Gönderim sırrı doğrulaması kaldırıldı; iş talebini ve alıcı/yönetim verisini yetkisiz çağıran da alabilir.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":false,"added":0,"removed":4,"changed":4,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.claim_notification_jobs_v2` (`supabase/migrations/20260912123000_s03_notification_consistency.sql`)

```diff
@@ -468,10 +468,6 @@ declare
   v_limit integer;
   v_lease_seconds integer;
 begin
-  if not public.notification_dispatch_authorized(p_dispatch_secret) then
-    raise exception 'NOTIFICATION_DISPATCH_UNAUTHORIZED';
-  end if;
-
   v_limit := greatest(1, least(coalesce(p_limit, 10), 50));
   v_lease_seconds := greatest(15, least(coalesce(p_lease_seconds, 45), 300));
 
```

## NS05 · NS · no; D1 · aile: request_hash · fonksiyon yeniden kullanıldı

Tekrar özeti hedef durumu içermiyor; aynı anahtarla farklı durum isteyen çağrı, öncekinin tekrarı sayılıp önceki sonucu alır.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":2,"changed":3,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.set_appointment_group_status` (`supabase/migrations/20260921023000_f13_group_lifecycle.sql`)

```diff
@@ -68,8 +68,7 @@ begin
 
   v_hash := md5(jsonb_build_object(
     'groupId',p_group_id,
-    'expectedVersion',p_expected_version,
-    'status',p_status
+    'expectedVersion',p_expected_version
   )::text);
 
   select * into v_claim
```

## NS06 · NS · no; D1 · aile: request_hash · fonksiyon yeniden kullanıldı

Tekrar özeti yeni hizmeti içermiyor; aynı anahtarla farklı hizmet isteyen çağrı, öncekinin tekrarı sayılır.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":1,"changed":2,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.change_appointment_group_line_service` (`supabase/migrations/20260917160500_f11_group_integration_repair.sql`)

```diff
@@ -297,7 +297,7 @@ begin
 
   v_hash := md5(jsonb_build_object(
     'groupId',p_group_id,'appointmentId',p_appointment_id,
-    'expectedVersion',p_expected_version,'serviceId',p_service_id
+    'expectedVersion',p_expected_version
   )::text);
   select * into v_claim
   from public.claim_booking_command(
```

## NS07 · NS · no; D1 · aile: request_hash

Tekrar özeti iptal gerekçesini içermiyor; aynı anahtarla farklı gerekçeli istek, öncekinin tekrarı sayılır.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":2,"changed":3,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.f11_cancel_group_core` (`supabase/migrations/20260917160200_f11_group_management_repair.sql`)

```diff
@@ -70,8 +70,7 @@ begin
 
   v_hash := md5(jsonb_build_object(
     'groupId',p_group_id,
-    'expectedVersion',p_expected_version,
-    'reason',v_reason
+    'expectedVersion',p_expected_version
   )::text);
 
   select * into v_claim
```

## NS08 · NS · no; D1 · aile: receipt_conflict

Aynı anahtarla farklı içerikli istek, önceki komut tamamlandıysa reddedilmiyor ve önceki sonucu alıyor (tekrar semantiği).

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":1,"changed":2,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.f14_claim_ticket_command` (`supabase/migrations/20260922144500_f14_payment_ledger.sql`)

```diff
@@ -243,7 +243,7 @@ begin
     and c.idempotency_key = p_idempotency_key
   for update;
 
-  if v_hash is distinct from p_request_hash then
+  if v_hash is distinct from p_request_hash and v_result is null then
     raise exception 'IDEMPOTENCY_CONFLICT';
   end if;
 
```

## NS09 · NS · no; D2 · aile: snapshot · fonksiyon yeniden kullanıldı

Hizmet değişince satırın fiyat politikası sürümü anlık görüntüsü güncellenmiyor; yeni fiyat alanları eski politika sürümüyle etiketli kalır.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":0,"removed":1,"changed":1,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.change_appointment_group_line_service` (`supabase/migrations/20260917160500_f11_group_integration_repair.sql`)

```diff
@@ -359,7 +359,6 @@ begin
       price_min_minor_snapshot=v_service.price_min_minor,
       price_max_minor_snapshot=v_service.price_max_minor,
       price_minor_snapshot=case when v_service.price_type='fixed' then v_service.price_minor else null end,
-      price_policy_version_snapshot=v_service.price_policy_version,
       currency_snapshot=v_service.currency,
       updated_at=now()
   where a.business_id=p_business_id and a.group_id=p_group_id and a.id=p_appointment_id;
```

## NS10 · NS · no; D2 · aile: history · fonksiyon yeniden kullanıldı

Abonelik olayı, değişikliğin hangi plan politikası sürümüyle hesaplandığını kaydetmiyor (yakalanan politika).

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":1,"changed":2,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `core.command_change_subscription` (`supabase/migrations/20260916190000_kc01_core_platform_schema.sql`)

```diff
@@ -773,7 +773,7 @@ begin
     ),
     p_principal_id,
     p_idempotency_key,
-    v_policy_version
+    null
   )
   returning id into v_event_id;
 
```

## NS11 · NS · no; D2 · aile: snapshot · fonksiyon yeniden kullanıldı

Satış satırı ürün kodu anlık görüntüsünü yakalamıyor (kod sonradan değişirse satırdan izlenemez).

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":1,"changed":2,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.add_ticket_product_line_guarded` (`supabase/migrations/20260923113600_f15_product_sale_atomicity.sql`)

```diff
@@ -767,7 +767,7 @@ begin
   ) values (
     p_business_id,p_ticket_id,v_ordinal,'product',null,
     null,null,null,null,
-    v_product.id,v_product.name,v_product.code,
+    v_product.id,v_product.name,null,
     p_quantity,'fixed',v_product.sale_price_minor,v_product.sale_price_minor,
     v_product.currency,v_product.version,
     v_product.sale_price_minor,v_actor.id,now(),'product_catalog_snapshot',
```

## NS12 · NS · no; D2 · aile: snapshot · fonksiyon yeniden kullanıldı

Satış satırı, fiyatın hangi ürün sürümünden alındığını (fiyat politikası sürümü anlık görüntüsü) yakalamıyor.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":1,"changed":2,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.open_product_sale_guarded` (`supabase/migrations/20260923113600_f15_product_sale_atomicity.sql`)

```diff
@@ -867,7 +867,7 @@ begin
     null,null,null,null,
     v_product.id,v_product.name,v_product.code,
     p_quantity,'fixed',v_product.sale_price_minor,v_product.sale_price_minor,
-    v_product.currency,v_product.version,
+    v_product.currency,null,
     v_product.sale_price_minor,v_actor.id,now(),'product_catalog_snapshot',
     0,v_actor.id
   ) returning * into v_line;
```

## NS13 · NS · no; D3 · aile: service_availability

Yeni oluşturulan ya da hizmeti değiştirilen grup satırında arşivlenmiş (pasif) hizmet de kabul ediliyor (hizmet uygunluğu).

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":1,"changed":2,"removed_where_and":1,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `public.f11_validate_native_group_schedule_authority` (`supabase/migrations/20260918070000_f11_lock_order_final_repair.sql`)

```diff
@@ -386,7 +386,7 @@ begin
     or (tg_op='UPDATE' and new.service_id is distinct from old.service_id);
   if v_require_active_service and not exists (
     select 1 from public.services s
-    where s.business_id=new.business_id and s.id=new.service_id and s.active
+    where s.business_id=new.business_id and s.id=new.service_id
   ) then
     raise exception 'SLOT_UNAVAILABLE';
   end if;
```

## NS14 · NS · no; D3 · aile: staff_eligibility · fonksiyon yeniden kullanıldı

Grup satırlarının personel uygunluk denetimi pasif personeli de kabul ediyor (personel etkinlik koşulu kaldırıldı).

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":1,"changed":2,"removed_where_and":1,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `public.f11_validate_native_group_schedule_authority` (`supabase/migrations/20260918070000_f11_lock_order_final_repair.sql`)

```diff
@@ -403,7 +403,7 @@ begin
       and (
         not exists (
           select 1 from public.staff_profiles sp
-          where sp.business_id=a.business_id and sp.id=a.staff_id and sp.active
+          where sp.business_id=a.business_id and sp.id=a.staff_id
         )
         or not exists (
           select 1 from public.staff_services ss
```

## NS15 · NS · no; D3 · aile: resource_limit · fonksiyon yeniden kullanıldı

Blok limitine pasif bloklar da sayılıyor (kapasite kuralı); sayım aynı kilit altında.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":1,"changed":2,"removed_where_and":1,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `public.create_availability_block_local_guarded` (`supabase/migrations/20260914111600_f10_catalog_hours_limits.sql`)

```diff
@@ -124,7 +124,7 @@ begin
   ));
   select count(*) into v_count
   from public.availability_blocks b
-  where b.business_id = p_business_id and b.active;
+  where b.business_id = p_business_id;
   if v_count >= 100 then
     raise exception 'AVAILABILITY_BLOCKS_LIMIT_EXCEEDED';
   end if;
```

## NS16 · NS · no; D3 · aile: staff_eligibility

Grup satırı pasif personele de taşınabiliyor (personel etkinlik koşulu kaldırıldı).

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":false,"added":1,"removed":1,"changed":2,"removed_where_and":1,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `public.reschedule_appointment_group_line` (`supabase/migrations/20260917160500_f11_group_integration_repair.sql`)

```diff
@@ -543,7 +543,7 @@ begin
 
   select sp.name into v_staff_name
   from public.staff_profiles sp
-  where sp.business_id=p_business_id and sp.id=p_staff_id and sp.active;
+  where sp.business_id=p_business_id and sp.id=p_staff_id;
   if v_staff_name is null then raise exception 'SLOT_UNAVAILABLE'; end if;
 
   perform set_config('app.f11_group_management_id',p_group_id::text,true);
```

## NS17 · NS · no; D4 · aile: time_boundary · fonksiyon yeniden kullanıldı

Tam kapanış saatinde biten grup satırı artık işletme saatleri dışında sayılıyor (pencere sonu dışlayıcı oldu).

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":1,"changed":2,"removed_where_and":1,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `public.f11_validate_native_group_schedule_authority` (`supabase/migrations/20260918070000_f11_lock_order_final_repair.sql`)

```diff
@@ -417,7 +417,7 @@ begin
             and bh.weekday=extract(dow from (a.starts_at at time zone v_timezone)::date)::smallint
             and bh.active
             and ((((a.starts_at at time zone v_timezone)::date)+bh.starts_local) at time zone v_timezone) <= a.starts_at
-            and ((((a.starts_at at time zone v_timezone)::date)+bh.ends_local) at time zone v_timezone) >= a.ends_at
+            and ((((a.starts_at at time zone v_timezone)::date)+bh.ends_local) at time zone v_timezone) > a.ends_at
         )
         or exists (
           select 1 from public.availability_blocks ab
```

## NS18 · NS · no; D4 · aile: time_boundary · fonksiyon yeniden kullanıldı

İşletme saatleri kontrolü yalnız başlangıcın pencere içinde olmasını istiyor; hizmet kapanış saatini aşabiliyor (zaman penceresi sınırı).

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":1,"changed":2,"removed_where_and":1,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `public.reschedule_appointment_group_line` (`supabase/migrations/20260917160500_f11_group_integration_repair.sql`)

```diff
@@ -503,7 +503,7 @@ begin
       and bh.weekday=extract(dow from (p_starts_at at time zone v_timezone)::date)::smallint
       and bh.active
       and ((((p_starts_at at time zone v_timezone)::date)+bh.starts_local) at time zone v_timezone) <= p_starts_at
-      and ((((p_starts_at at time zone v_timezone)::date)+bh.ends_local) at time zone v_timezone) >= v_ends_at
+      and ((((p_starts_at at time zone v_timezone)::date)+bh.ends_local) at time zone v_timezone) >= p_starts_at
   ) or exists (
     select 1
     from public.availability_blocks ab
```

## NS19 · NS · no; D4 · aile: time_boundary · fonksiyon yeniden kullanıldı

Gece yarısını aşan bloklar artık ertesi güne taşınmıyor; bitişi başlangıçtan önce olan yerel saatler geçersiz blok sayılıyor (yerel gün sınırı).

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":false,"added":1,"removed":1,"changed":2,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.create_availability_block_local` (`supabase/migrations/20260911110000_phase4_availability.sql`)

```diff
@@ -307,7 +307,7 @@ begin
     raise exception 'BUSINESS_NOT_FOUND';
   end if;
 
-  v_end_date := case when p_end_local <= p_start_local then p_date + 1 else p_date end;
+  v_end_date := p_date;
   v_start_at := (p_date + p_start_local) at time zone v_timezone;
   v_end_at := (v_end_date + p_end_local) at time zone v_timezone;
 
```

## NS20 · NS · no; D4 · aile: time_boundary · fonksiyon yeniden kullanıldı

Eski sayaçların silinme eşiği 48 saatten 72 saate çıktı (saklama süresi sınırı).

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":true,"added":1,"removed":1,"changed":2,"removed_where_and":1,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `public.prune_public_booking_rate_counters` (`supabase/migrations/20260911180200_phase9_public_abuse_retention.sql`)

```diff
@@ -22,7 +22,7 @@ begin
   where c.ctid in (
     select stale.ctid
     from public.public_booking_rate_counters stale
-    where stale.updated_at < clock_timestamp() - interval '48 hours'
+    where stale.updated_at < clock_timestamp() - interval '72 hours'
     order by stale.updated_at
     limit 500
   );
```

## NP01 · NP · no; D0, D1 · aile: authority_scope+replay · fonksiyon yeniden kullanıldı

D0: herkese açık yönetim bağlantısı işletme tarafından oluşturulmuş grupları da yeniden planlayabiliyor (kaynak koşulu kaldırıldı). D1: tekrar eden istek de yeniden planlama bildirimini yeniden üretiyor.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":false,"added":2,"removed":2,"changed":4,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.reschedule_public_managed_group` (`supabase/migrations/20260917160100_f11_public_group_management.sql`)

```diff
@@ -179,7 +179,7 @@ begin
   select * into v_group
   from public.appointment_groups g
   where g.business_id=v_ref.business_id and g.id=v_ref.group_id;
-  if v_group.id is null or v_group.legacy_appointment_id is not null or v_group.source<>'public' then
+  if v_group.id is null or v_group.legacy_appointment_id is not null then
     raise exception 'MANAGEMENT_GROUP_REQUIRED';
   end if;
 
@@ -217,7 +217,7 @@ begin
     'public_group_reschedule','public',null
   );
 
-  if not v_preexisting and v_ref.recovery_id is not null then
+  if v_ref.recovery_id is not null then
     perform public.create_public_booking_confirmation_event(
       v_ref.business_id,v_ref.appointment_id,v_ref.recovery_id,'rescheduled'
     );
```

## NP02 · NP · no; D0, D1 · aile: authority_scope+request_hash · fonksiyon yeniden kullanıldı

D0: işlem için işletme üyeliği aranmıyor; oturum açmış herhangi bir kullanıcı yeterli. D1: tekrar özeti personeli içermiyor (farklı personelli istek aynı istek sayılır).

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":2,"removed":2,"changed":4,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.reschedule_appointment_group_line` (`supabase/migrations/20260917160500_f11_group_integration_repair.sql`)

```diff
@@ -429,7 +429,7 @@ declare
   v_new_version integer;
 begin
   perform public.f10_require_standard_session();
-  if auth.uid() is null or not public.is_active_member(p_business_id) then
+  if auth.uid() is null then
     raise exception 'NOT_ALLOWED';
   end if;
   if p_expected_version is null or p_expected_version<1 then raise exception 'INVALID_GROUP_VERSION'; end if;
@@ -456,7 +456,7 @@ begin
 
   v_hash := md5(jsonb_build_object(
     'groupId',p_group_id,'appointmentId',p_appointment_id,
-    'expectedVersion',p_expected_version,'staffId',p_staff_id,'startsAt',p_starts_at
+    'expectedVersion',p_expected_version,'startsAt',p_starts_at
   )::text);
   select * into v_claim
   from public.claim_booking_command(
```

## NP03 · NP · no; D0, D2 · aile: authority_scope+history

D0: fiş kapatma fiyat düzeltme yetkisi yerine ödeme yetkisi istiyor. D2: kapatan üye kaydedilmiyor (geçmiş kaydı).

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":2,"changed":3,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.close_ticket_guarded` (`supabase/migrations/20260922144500_f14_payment_ledger.sql`)

```diff
@@ -775,7 +775,7 @@ declare
   v_count integer;
   v_unfinalized integer;
 begin
-  v_actor := public.f14_financial_actor(p_business_id);
+  v_actor := public.f14_payment_actor(p_business_id);
   v_replay := public.f14_claim_ticket_command(
     p_business_id, v_actor.id, 'close_ticket',
     p_idempotency_key, p_request_hash
@@ -811,7 +811,6 @@ begin
   update public.tickets
   set status = 'closed',
       version = version + 1,
-      closed_by_membership_id = v_actor.id,
       closed_at = now()
   where business_id = p_business_id and id = p_ticket_id;
 
```

## NP04 · NP · no; D0, D2 · aile: authority_scope+history

D0: ürün iadesi artık ödeme yetkisi istemiyor, envanter yetkisi yetiyor. D2: stoka dönüş hareketi iade gerekçesini değil sabit bir etiketi kaydediyor (geçmiş kaydı).

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":false,"added":2,"removed":2,"changed":4,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.record_product_return_refund_guarded` (`supabase/migrations/20260923113600_f15_product_sale_atomicity.sql`)

```diff
@@ -927,7 +927,7 @@ declare
   v_return_value bigint;
   v_before jsonb;
 begin
-  v_actor := public.f15_product_return_actor(p_business_id);
+  v_actor := public.f15_inventory_actor(p_business_id);
   v_replay := public.f14_claim_ticket_command(
     p_business_id,v_actor.id,'product_return_refund',p_idempotency_key,p_request_hash
   );
@@ -1010,7 +1010,7 @@ begin
       business_id,product_id,kind,quantity_delta,balance_after,reason,
       ticket_line_id,source_sale_movement_id,created_by_membership_id
     ) values (
-      p_business_id,v_product.id,'return',p_quantity,v_new_balance,v_reason,
+      p_business_id,v_product.id,'return',p_quantity,v_new_balance,'product_return',
       v_line.id,v_sale_movement.id,v_actor.id
     ) returning * into v_stock_return;
   end if;
```

## NP05 · NP · no; D0, D3 · aile: authority_scope+rate_limit

D0: herkese açık rezervasyon kapısı sırrı doğrulanmıyor. D3: oluşturma istekleri artık istek sınırına (kişi/ağ başı kota) tabi değil.

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":false,"added":0,"removed":10,"changed":10,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.create_public_appointment_with_recovery_guarded` (`supabase/migrations/20260911180000_phase9_public_abuse_control.sql`)

```diff
@@ -339,10 +339,6 @@ declare
   v_business_id uuid;
   v_safe_retry boolean := false;
 begin
-  if not public.public_booking_gate_authorized(p_gate_secret) then
-    raise exception 'PUBLIC_BOOKING_GATE_UNAVAILABLE';
-  end if;
-
   select b.id into v_business_id
   from public.businesses b
   where lower(b.slug) = lower(trim(p_slug))
@@ -363,12 +359,6 @@ begin
       and r.appointment_id is not null
   ) into v_safe_retry;
 
-  if not v_safe_retry then
-    perform public.enforce_public_booking_rate(
-      'create', p_actor_hash, p_network_hash, v_business_id
-    );
-  end if;
-
   return query
   select *
   from public.create_public_appointment_with_recovery(
```

## NP06 · NP · no; D0, D3 · aile: authority_scope+resource_limit · fonksiyon yeniden kullanıldı

D0: ürün satırı eklemek fiyatlandırma yetkisi istemiyor, envanter yetkisi yetiyor. D3: fiş başına satır sınırı 100'den 500'e çıktı.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":false,"added":2,"removed":2,"changed":4,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.add_ticket_product_line_guarded` (`supabase/migrations/20260923113600_f15_product_sale_atomicity.sql`)

```diff
@@ -719,7 +719,7 @@ declare
   v_result jsonb;
   v_new_balance bigint;
 begin
-  v_actor := public.f15_product_sale_actor(p_business_id);
+  v_actor := public.f15_inventory_actor(p_business_id);
   v_replay := public.f14_claim_ticket_command(
     p_business_id, v_actor.id, 'add_product_line', p_idempotency_key, p_request_hash
   );
@@ -754,7 +754,7 @@ begin
   select coalesce(max(line_ordinal),0)+1 into v_ordinal
   from public.ticket_lines
   where business_id=p_business_id and ticket_id=p_ticket_id;
-  if v_ordinal > 100 then raise exception 'TICKET_LINE_LIMIT_EXCEEDED'; end if;
+  if v_ordinal > 500 then raise exception 'TICKET_LINE_LIMIT_EXCEEDED'; end if;
 
   insert into public.ticket_lines(
     business_id,ticket_id,line_ordinal,source_type,source_appointment_line_id,
```

## NP07 · NP · no; D0, D4 · aile: authority_scope+local_day · fonksiyon yeniden kullanıldı

D0: standart oturum şartı kaldırıldı (kısıtlı oturum türleri de listeleyebiliyor). D4: tarih aralığının başlangıcı işletmenin yerel gün başı yerine UTC gün başı.

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":false,"added":1,"removed":2,"changed":3,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.list_appointments_page_v3` (`supabase/migrations/20260921013000_f13_booking_date_range.sql`)

```diff
@@ -45,7 +45,6 @@ declare
   v_from timestamptz;
   v_to timestamptz;
 begin
-  perform public.f10_require_standard_session();
   if auth.uid() is null or not public.is_active_member(p_business_id) then
     raise exception 'NOT_ALLOWED';
   end if;
@@ -71,7 +70,7 @@ begin
     if v_timezone is null then
       raise exception 'BUSINESS_NOT_FOUND';
     end if;
-    v_from := p_start_date::timestamp at time zone v_timezone;
+    v_from := p_start_date::timestamptz;
     v_to := p_end_date::timestamp at time zone v_timezone;
   end if;
 
```

## NP08 · NP · no; D0, D4 · aile: authority_scope+time_boundary · fonksiyon yeniden kullanıldı

D0: blok eklemeyi yönetici yerine her aktif üye yapabiliyor. D4: geçmişte başlayan blok artık reddediliyor (zaman sınırı).

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":true,"added":2,"removed":2,"changed":4,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.create_availability_block_local` (`supabase/migrations/20260911110000_phase4_availability.sql`)

```diff
@@ -286,7 +286,7 @@ declare
   v_end_at timestamptz;
   v_row public.availability_blocks;
 begin
-  if auth.uid() is null or not public.can_manage_business(p_business_id) then
+  if auth.uid() is null or not public.is_active_member(p_business_id) then
     raise exception 'NOT_ALLOWED';
   end if;
   if p_staff_id is not null and not exists (
@@ -311,7 +311,7 @@ begin
   v_start_at := (p_date + p_start_local) at time zone v_timezone;
   v_end_at := (v_end_date + p_end_local) at time zone v_timezone;
 
-  if v_start_at >= v_end_at then
+  if v_start_at >= v_end_at or v_start_at < now() then
     raise exception 'INVALID_BLOCK';
   end if;
 
```

## NP09 · NP · no; D1, D2 · aile: dedupe+snapshot · fonksiyon yeniden kullanıldı

D1: "zaten ters kaydedilmiş" kontrolü kaldırıldı; aynı gider sırayla ikinci kez düzeltilebilir (tekilleştirme). D2: yeni gider kaydı saat dilimi anlık görüntüsünü yakalamıyor.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":10,"changed":11,"removed_where_and":3,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `public.correct_expense_guarded` (`supabase/migrations/20260923074000_f15_expense_ledger.sql`)

```diff
@@ -521,15 +521,6 @@ begin
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
-
   insert into public.expense_events(
     business_id,event_type,source_expense_event_id,correction_of_event_id,category,description,
     amount_minor,currency,payment_method,occurred_at,business_date,timezone_snapshot,
@@ -547,7 +538,7 @@ begin
     reason,actor_membership_id
   ) values (
     p_business_id,'expense',null,v_source.id,v_category,v_description,
-    p_amount_minor,v_currency,p_payment_method,v_occurred_at,p_occurred_local::date,v_timezone,
+    p_amount_minor,v_currency,p_payment_method,v_occurred_at,p_occurred_local::date,null,
     null,v_actor.id
   )
   returning * into v_replacement;
```

## NP10 · NP · no; D1, D2 · aile: request_hash+history · fonksiyon yeniden kullanıldı

D1: tekrar özeti beklenen sürümü içermiyor (farklı sürüme dayanan istek aynı istek sayılır). D2: satır olayları satır sırasını kaydetmiyor (geçmiş kaydı).

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":0,"removed":2,"changed":2,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.set_appointment_group_status` (`supabase/migrations/20260921023000_f13_group_lifecycle.sql`)

```diff
@@ -68,7 +68,6 @@ begin
 
   v_hash := md5(jsonb_build_object(
     'groupId',p_group_id,
-    'expectedVersion',p_expected_version,
     'status',p_status
   )::text);
 
@@ -134,7 +133,6 @@ begin
     jsonb_build_object(
       'groupId',p_group_id,
       'groupVersion',v_new_version,
-      'lineOrdinal',a.line_ordinal,
       'scope','group'
     )
   from public.appointments a
```

## NP11 · NP · no; D1, D3 · aile: receipt+resource_limit · fonksiyon yeniden kullanıldı

D1: komut makbuzu sonuçla kapatılmıyor; tekrar eden istek kayıtlı sonucu bulamayıp satışı yeniden açar. D3: stok yeterliliği denetlenmiyor; eldeki stoktan fazlası satılabiliyor.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":0,"removed":5,"changed":5,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.open_product_sale_guarded` (`supabase/migrations/20260923113600_f15_product_sale_atomicity.sql`)

```diff
@@ -844,8 +844,6 @@ begin
   if v_product.id is null then raise exception 'PRODUCT_NOT_FOUND'; end if;
   if not v_product.active then raise exception 'PRODUCT_ARCHIVED'; end if;
   if p_expected_product_version is null or v_product.version <> p_expected_product_version then raise exception 'STALE_PRODUCT_WRITE'; end if;
-  if v_product.stock_on_hand < p_quantity then raise exception 'INSUFFICIENT_STOCK'; end if;
-
   insert into public.tickets(
     business_id,appointment_group_id,customer_id,source,status,currency,
     customer_name_snapshot,customer_phone_snapshot,customer_email_snapshot,created_by_membership_id
@@ -885,9 +883,6 @@ begin
   );
 
   v_result := public.f14_ticket_projection(p_business_id,v_ticket.id);
-  perform public.f14_finish_ticket_command(
-    p_business_id,v_actor.id,'open_product_sale',p_idempotency_key,v_ticket.id,v_result
-  );
   return v_result;
 end
 $f1502open$;
```

## NP12 · NP · no; D1, D3 · aile: request_hash+resource_limit

D1: tekrar özeti notları içermiyor (farklı notlu istek aynı istek sayılır). D3: grup başına satır sınırı denetlenmiyor.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":5,"changed":6,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.f11_create_group_internal` (`supabase/migrations/20260918070000_f11_lock_order_final_repair.sql`)

```diff
@@ -65,9 +65,6 @@ begin
   -- service catalog state before resolving an existing command.
   v_requested_count := jsonb_array_length(p_lines);
   if v_requested_count < 1 then raise exception 'INVALID_GROUP_LINES'; end if;
-  if v_requested_count > public.f11_group_line_limit() then
-    raise exception 'GROUP_LINE_LIMIT_EXCEEDED';
-  end if;
   if p_idempotency_key is null
      or char_length(p_idempotency_key) < 8
      or char_length(p_idempotency_key) > 128 then
@@ -80,8 +77,7 @@ begin
     'customerPhone', v_customer_phone,
     'customerEmail', v_customer_email,
     'lines', p_lines,
-    'startsAt', p_starts_at,
-    'notes', v_notes
+    'startsAt', p_starts_at
   )::text);
 
   -- Serialize this group's key before the read-only replay probe. A locked
```

## NP13 · NP · no; D1, D4 · aile: request_hash+local_day · fonksiyon yeniden kullanıldı

D1: tekrar özeti yeni başlangıç zamanını içermiyor (farklı zamanlı istek aynı istek sayılır). D4: personel uygunluğu için gün, işletmenin yerel günü yerine UTC gününden alınıyor.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":2,"removed":2,"changed":4,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.reschedule_appointment_group_line` (`supabase/migrations/20260917160500_f11_group_integration_repair.sql`)

```diff
@@ -456,7 +456,7 @@ begin
 
   v_hash := md5(jsonb_build_object(
     'groupId',p_group_id,'appointmentId',p_appointment_id,
-    'expectedVersion',p_expected_version,'staffId',p_staff_id,'startsAt',p_starts_at
+    'expectedVersion',p_expected_version,'staffId',p_staff_id
   )::text);
   select * into v_claim
   from public.claim_booking_command(
@@ -483,7 +483,7 @@ begin
 
   select b.timezone into v_timezone from public.businesses b where b.id=p_business_id;
   if v_timezone is null then raise exception 'BUSINESS_NOT_FOUND'; end if;
-  v_date := (p_starts_at at time zone v_timezone)::date;
+  v_date := p_starts_at::date;
   v_ends_at := p_starts_at+make_interval(mins=>v_line.duration_minutes_snapshot);
   v_staff_active_end := case
     when v_line.processing_capacity_policy_snapshot='RELEASE'
```

## NP14 · NP · no; D1, D4 · aile: replay+timezone

D1: zaten bağlı takma adla tekrar gelen istek artık mevcut işletmeye eşlenmiyor, çakışma hatası veriyor (tekrar semantiği). D4: saat dilimi verilmezse işletme İstanbul yerine UTC ile açılıyor.

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":false,"added":2,"removed":12,"changed":14,"removed_where_and":1,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `core.command_provision_business` (`supabase/migrations/20260916190000_kc01_core_platform_schema.sql`)

```diff
@@ -500,7 +500,7 @@ declare
   v_owner uuid := core.require_uuid(p_payload->>'owner_user_id', 'USER_NOT_FOUND');
   v_name text := btrim(coalesce(p_payload->>'name', ''));
   v_slug text := lower(btrim(coalesce(p_payload->>'slug', '')));
-  v_timezone text := coalesce(nullif(btrim(p_payload->>'timezone'), ''), 'Europe/Istanbul');
+  v_timezone text := coalesce(nullif(btrim(p_payload->>'timezone'), ''), 'UTC');
   v_alias jsonb := p_payload->'tenant_alias';
   v_alias_provider text;
   v_alias_external_id text;
@@ -538,17 +538,7 @@ begin
     from core.tenant_aliases a
     where a.provider = v_alias_provider and a.external_id = v_alias_external_id;
     if found then
-      select m.id into v_membership_id
-      from public.memberships m
-      where m.business_id = v_existing_alias.business_id and m.user_id = v_owner and m.active
-      limit 1;
-      return jsonb_build_object(
-        'business_id', v_existing_alias.business_id,
-        'slug', (select b.slug from public.businesses b where b.id = v_existing_alias.business_id),
-        'membership_id', v_membership_id,
-        'created', false,
-        'tenant_alias_linked', true
-      );
+      raise exception 'TENANT_ALIAS_CONFLICT';
     end if;
   end if;
 
```

## NP15 · NP · no; D2, D3 · aile: snapshot+availability · fonksiyon yeniden kullanıldı

D2: personel değişince satırın personel adı anlık görüntüsü güncellenmiyor. D3: yeni personelin o aralıkta müsait olup olmadığı denetlenmiyor.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":false,"added":1,"removed":8,"changed":9,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.reschedule_appointment_group_line` (`supabase/migrations/20260917160500_f11_group_integration_repair.sql`)

```diff
@@ -525,13 +525,6 @@ begin
     raise exception 'SLOT_UNAVAILABLE';
   end if;
 
-  if not public.f11_staff_slot_free(
-    p_business_id,p_staff_id,v_line.service_id,v_date,
-    v_occupied_start,v_occupied_end,p_group_id
-  ) then
-    raise exception 'SLOT_UNAVAILABLE';
-  end if;
-
   if exists (
     select 1 from public.appointments a
     where a.business_id=p_business_id and a.group_id=p_group_id
@@ -549,7 +542,7 @@ begin
   perform set_config('app.f11_group_management_id',p_group_id::text,true);
   begin
     update public.appointments a
-    set staff_id=p_staff_id,staff_name_snapshot=v_staff_name,
+    set staff_id=p_staff_id,
         starts_at=p_starts_at,ends_at=v_ends_at,
         occupied_starts_at=v_occupied_start,occupied_ends_at=v_occupied_end,
         timezone=v_timezone,updated_at=now()
```

## NP16 · NP · no; D2, D3 · aile: snapshot+availability · fonksiyon yeniden kullanıldı

D2: hizmet değişince satırın sabit fiyat anlık görüntüsü güncellenmiyor (eski hizmetin fiyatı kalır). D3: personelin o aralıkta müsait olup olmadığı denetlenmiyor.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":0,"removed":8,"changed":8,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.change_appointment_group_line_service` (`supabase/migrations/20260917160500_f11_group_integration_repair.sql`)

```diff
@@ -343,13 +343,6 @@ begin
   select b.timezone into v_timezone from public.businesses b where b.id=p_business_id;
   if v_timezone is null then raise exception 'BUSINESS_NOT_FOUND'; end if;
   v_date := (v_line.starts_at at time zone v_timezone)::date;
-  if not public.f11_staff_slot_free(
-    p_business_id,v_line.staff_id,p_service_id,v_date,
-    v_line.occupied_starts_at,v_line.occupied_ends_at,p_group_id
-  ) then
-    raise exception 'SLOT_UNAVAILABLE';
-  end if;
-
   perform set_config('app.f11_group_management_id',p_group_id::text,true);
   perform set_config('app.f11_line_service_change_id',p_appointment_id::text,true);
   update public.appointments a
@@ -358,7 +351,6 @@ begin
       price_type_snapshot=v_service.price_type,
       price_min_minor_snapshot=v_service.price_min_minor,
       price_max_minor_snapshot=v_service.price_max_minor,
-      price_minor_snapshot=case when v_service.price_type='fixed' then v_service.price_minor else null end,
       price_policy_version_snapshot=v_service.price_policy_version,
       currency_snapshot=v_service.currency,
       updated_at=now()
```

## NP17 · NP · no; D2, D4 · aile: policy_selection+validity

D2: plan değişikliği yalnız plandan gelen yetkileri değil elle verilmiş yetkileri de geri alıyor (hangi yetkinin plana ait sayıldığı politikası). D4: plandan gelen yetkiler dönem sonu geçerlilik tarihi taşımıyor, süresiz kalıyor.

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":false,"added":1,"removed":2,"changed":3,"removed_where_and":1,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `core.plan_entitlement_changes` (`supabase/migrations/20260916190000_kc01_core_platform_schema.sql`)

```diff
@@ -637,7 +637,7 @@ as $$
       'entitlement_key', pe.entitlement_key,
       'granted', (p_grant and pe.granted),
       'limit_value', pe.limit_value,
-      'valid_until', p_valid_until
+      'valid_until', null
     ) as change
     from core.plan_entitlements pe
     where pe.plan_key = p_plan_key
@@ -652,7 +652,6 @@ as $$
     join core.subscription_events se on se.id = e.source_event_id
     where e.business_id = p_business_id
       and e.granted
-      and se.event_type = 'subscription_changed'
       and not exists (
         select 1 from core.plan_entitlements pe
         where pe.plan_key = p_plan_key and pe.entitlement_key = e.entitlement_key
```

## NP18 · NP · no; D2, D4 · aile: history+time_boundary · fonksiyon yeniden kullanıldı

D2: sonlandırmada ilk kaydedilmiş hata sınıfı korunuyor, son hata onu ezmiyor (geçmiş değer semantiği). D4: yeniden deneme bitiş anına tam denk gelen deneme artık son sayılmıyor (sınır).

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":false,"added":2,"removed":2,"changed":4,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.release_notification_job` (`supabase/migrations/20260911170000_phase9_notification_outbox.sql`)

```diff
@@ -370,12 +370,12 @@ begin
 
   if not coalesce(p_retryable, false)
      or v_job.attempt_count >= v_job.max_attempts
-     or now() + make_interval(secs => v_delay) >= v_job.retry_until then
+     or now() + make_interval(secs => v_delay) > v_job.retry_until then
     v_state := 'failed_terminal';
     update public.appointment_notification_jobs
     set state = v_state,
         terminal_at = now(),
-        last_error_class = p_error_class,
+        last_error_class = coalesce(last_error_class, p_error_class),
         lease_token = null,
         lease_expires_at = null,
         updated_at = now()
```

## NP19 · NP · no; D3, D4 · aile: availability+time_boundary · fonksiyon yeniden kullanıldı

D3: personelin pasif çalışma saatleri de geçerli sayılıyor. D4: işletme açılış anında başlayan grup satırı artık saatlerin dışında sayılıyor (pencere başı dışlayıcı oldu).

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":2,"changed":3,"removed_where_and":2,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `public.f11_validate_native_group_schedule_authority` (`supabase/migrations/20260918070000_f11_lock_order_final_repair.sql`)

```diff
@@ -416,7 +416,7 @@ begin
           where bh.business_id=a.business_id
             and bh.weekday=extract(dow from (a.starts_at at time zone v_timezone)::date)::smallint
             and bh.active
-            and ((((a.starts_at at time zone v_timezone)::date)+bh.starts_local) at time zone v_timezone) <= a.starts_at
+            and ((((a.starts_at at time zone v_timezone)::date)+bh.starts_local) at time zone v_timezone) < a.starts_at
             and ((((a.starts_at at time zone v_timezone)::date)+bh.ends_local) at time zone v_timezone) >= a.ends_at
         )
         or exists (
@@ -431,7 +431,6 @@ begin
             on sh.business_id=bh.business_id
            and sh.staff_id=a.staff_id
            and sh.weekday=bh.weekday
-           and sh.active
           where bh.business_id=a.business_id
             and bh.weekday=extract(dow from (a.starts_at at time zone v_timezone)::date)::smallint
             and bh.active
```

## NP20 · NP · no; D3, D4 · aile: assignment+local_day · fonksiyon yeniden kullanıldı

D3: pasif personel-hizmet ataması da geçerli sayılıyor. D4: işletme saatlerinin haftanın günü, yerel tarih yerine UTC tarihinden hesaplanıyor.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":2,"removed":2,"changed":4,"removed_where_and":2,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `public.f11_validate_native_group_schedule_authority` (`supabase/migrations/20260918070000_f11_lock_order_final_repair.sql`)

```diff
@@ -408,13 +408,13 @@ begin
         or not exists (
           select 1 from public.staff_services ss
           where ss.business_id=a.business_id and ss.staff_id=a.staff_id
-            and ss.service_id=a.service_id and ss.active
+            and ss.service_id=a.service_id
         )
         or not exists (
           select 1
           from public.business_hours bh
           where bh.business_id=a.business_id
-            and bh.weekday=extract(dow from (a.starts_at at time zone v_timezone)::date)::smallint
+            and bh.weekday=extract(dow from a.starts_at::date)::smallint
             and bh.active
             and ((((a.starts_at at time zone v_timezone)::date)+bh.starts_local) at time zone v_timezone) <= a.starts_at
             and ((((a.starts_at at time zone v_timezone)::date)+bh.ends_local) at time zone v_timezone) >= a.ends_at
```

