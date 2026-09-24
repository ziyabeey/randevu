# H19b vakaları (vakalar.v0.1.json, okunur liste)

## A01 · hücre A · weakens · eş: C01

Sayım ve limit kontrolü advisory kilitten önceye taşındı; eşzamanlı iki ekleme 99 kaydı görüp limiti (100) aşabilir.

Fonksiyon: `public.create_staff_guarded` (`supabase/migrations/20260914111500_f10_catalog_hours_management.sql`)

Olgular: `{"lock_context":true,"version_guard":false,"changed_inside_locked_region":true,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

```diff
@@ -246,9 +246,9 @@ begin
     raise exception 'INVALID_STAFF';
   end if;
 
-  perform pg_advisory_xact_lock(hashtextextended('f10-04:staff:' || p_business_id::text, 0));
   select count(*) into v_count from public.staff_profiles sp where sp.business_id = p_business_id;
   if v_count >= 100 then raise exception 'CATALOG_STAFF_LIMIT_EXCEEDED'; end if;
+  perform pg_advisory_xact_lock(hashtextextended('f10-04:staff:' || p_business_id::text, 0));
 
   insert into public.staff_profiles(business_id, name, phone)
   values(p_business_id, trim(p_name), v_phone)
```

## A02 · hücre A · weakens · eş: C02

Yetki okuması işletme kilidinden önceye taşındı; aynı kilidi alan eşzamanlı bir rol düşürme arada tamamlanırsa iptal eski yetkiyle yürür.

Fonksiyon: `public.revoke_business_invitation` (`supabase/migrations/20260914033000_f10_team_access.sql`)

Olgular: `{"lock_context":true,"version_guard":false,"changed_inside_locked_region":true,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

```diff
@@ -275,11 +275,11 @@ begin
     raise exception 'AUTH_REQUIRED' using errcode = '42501';
   end if;
 
-  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text, 0));
   select * into v_actor from public.f10_team_actor(p_business_id);
   if v_actor.membership_id is null or v_actor.role not in ('owner', 'manager') then
     raise exception 'TEAM_FORBIDDEN' using errcode = '42501';
   end if;
+  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text, 0));
 
   select * into v_invitation
   from public.business_invitations i
```

## A03 · hücre A · weakens · eş: C03

Sürüm kontrolü kilitsiz okumaya taşındı, satır kilidi sonra alınıyor ve güncelleme sürüm koşulu taşımıyor; aynı beklenen sürümle gelen eşzamanlı yazmalar birlikte geçer (kayıp güncelleme).

Fonksiyon: `public.archive_product_guarded` (`supabase/migrations/20260923051000_f15_product_stock_ledger.sql`)

Olgular: `{"lock_context":true,"version_guard":false,"changed_inside_locked_region":true,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

```diff
@@ -721,12 +721,16 @@ begin
 
   select * into v_product
   from public.products p
-  where p.business_id = p_business_id and p.id = p_product_id
-  for update;
+  where p.business_id = p_business_id and p.id = p_product_id;
 
   if v_product.id is null then raise exception 'PRODUCT_NOT_FOUND'; end if;
   if p_expected_version is null or v_product.version <> p_expected_version then raise exception 'STALE_WRITE'; end if;
 
+  perform 1
+  from public.products p
+  where p.business_id = p_business_id and p.id = p_product_id
+  for update;
+
   if v_product.active then
     update public.products
     set active = false,
```

## A04 · hücre A · weakens · eş: C04

Advisory kilit anahtarı işletmeden üyeliğe daraltıldı; son aktif sahip kontrolü artık serileşmiyor. İki sahip eşzamanlı düşürülürse ikisi de "başka sahip var" görür, işletme sahipsiz kalır.

Fonksiyon: `public.update_team_membership` (`supabase/migrations/20260914033000_f10_team_access.sql`)

Olgular: `{"lock_context":true,"version_guard":false,"changed_inside_locked_region":true,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

```diff
@@ -422,7 +422,7 @@ begin
     raise exception 'INVALID_MEMBERSHIP_UPDATE';
   end if;
 
-  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text, 0));
+  perform pg_advisory_xact_lock(hashtextextended(p_membership_id::text, 0));
 
   select * into v_actor from public.f10_team_actor(p_business_id);
   if v_actor.membership_id is null or v_actor.role not in ('owner', 'manager') then
```

## A05 · hücre A · weakens · eş: C05

Advisory kilit anahtarı hizmet adına daraltıldı; farklı adlı eşzamanlı eklemeler 100 limitini ve sort_order hesabını birlikte geçer.

Fonksiyon: `public.create_service_guarded` (`supabase/migrations/20260915150000_f12_service_price_range.sql`)

Olgular: `{"lock_context":true,"version_guard":false,"changed_inside_locked_region":true,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

```diff
@@ -165,7 +165,7 @@ begin
     raise exception 'INVALID_SERVICE';
   end if;
 
-  perform pg_advisory_xact_lock(hashtextextended('f10-04:services:' || p_business_id::text, 0));
+  perform pg_advisory_xact_lock(hashtextextended('f10-04:services:' || p_business_id::text || ':' || lower(trim(p_name)), 0));
   select count(*), least(coalesce(max(s.sort_order), -10) + 10, 1000000)
     into v_count, v_sort
   from public.services s
```

## A06 · hücre A · weakens · eş: C06

İşletme satırı kilidi sayım ve eklemeden sonraya taşındı; eşzamanlı yüklemeler 20 limitini ve sort_order hesabını birlikte geçer.

Fonksiyon: `public.begin_business_public_media_upload` (`supabase/migrations/20260914110500_f12_salon_profile_media.sql`)

Olgular: `{"lock_context":true,"version_guard":false,"changed_inside_locked_region":true,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

```diff
@@ -306,9 +306,6 @@ begin
   if not public.can_manage_business(p_business_id) then
     raise exception 'NOT_ALLOWED' using errcode = '42501';
   end if;
-  perform 1 from public.businesses b where b.id = p_business_id for update;
-  if not found then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
-
   if p_media_id is null
      or p_storage_path <> p_business_id::text || '/' || p_media_id::text || '.webp'
      or p_mime_type <> 'image/webp'
@@ -334,6 +331,9 @@ begin
     p_mime_type, p_size_bytes, p_width, p_height, auth.uid()
   );
 
+  perform 1 from public.businesses b where b.id = p_business_id for update;
+  if not found then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
+
   return query
   select m.id, m.storage_path, m.status, m.alt_text, m.sort_order,
          m.mime_type, m.size_bytes, m.width, m.height
```

## A07 · hücre A · weakens · eş: C07

Durum geçişi kilitsiz okumayla doğrulanıyor, satır kilidi sonra alınıyor ve güncelleme durum koşulu taşımıyor; eşzamanlı iki geçiş eski durumdan geçerli görünür, son yazan kazanır ve olay kaydı tutarsızlaşır.

Fonksiyon: `public.set_appointment_status` (`supabase/migrations/20260911121000_phase5_booking_hardening.sql`)

Olgular: `{"lock_context":true,"version_guard":false,"changed_inside_locked_region":true,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

```diff
@@ -475,8 +475,7 @@ begin
 
   select * into v_current
   from public.appointments
-  where business_id = p_business_id and id = p_appointment_id
-  for update;
+  where business_id = p_business_id and id = p_appointment_id;
 
   if v_current.id is null then raise exception 'APPOINTMENT_NOT_FOUND'; end if;
   if v_current.status = p_status then return v_current; end if;
@@ -491,6 +490,11 @@ begin
     raise exception 'INVALID_STATUS_TRANSITION';
   end if;
 
+  perform 1
+  from public.appointments
+  where business_id = p_business_id and id = p_appointment_id
+  for update;
+
   update public.appointments
   set status = p_status,
       cancelled_at = case when p_status = 'cancelled' then now() else cancelled_at end,
```

## A08 · hücre A · weakens · eş: C08

Kilitli okumadan kiralama belirteci (lease_token) koşulu kaldırıldı; kiralaması düşmüş eski bir işçi, işi yeniden kiralamış başka bir işçinin işini serbest bırakabilir.

Fonksiyon: `public.release_notification_job_v2` (`supabase/migrations/20260912123000_s03_notification_consistency.sql`)

Olgular: `{"lock_context":true,"version_guard":false,"changed_inside_locked_region":false,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

```diff
@@ -775,7 +775,6 @@ begin
   from public.appointment_notification_jobs j
   where j.id = p_job_id
     and j.state = 'leased'
-    and j.lease_token = p_lease_token
   for update;
 
   if v_job.id is null then raise exception 'NOTIFICATION_LEASE_LOST'; end if;
```

## A09 · hücre A · weakens · eş: C09

Pasifleştirme için kilidi ve bayat yazma kontrolünü atlayan erken bir yazma yolu eklendi; eşzamanlı bir etkinleştirmeyle sırası belirsizleşir, eski görünümle yapılan pasifleştirme sessizce yazılır.

Fonksiyon: `public.set_staff_service_guarded` (`supabase/migrations/20260914111700_f10_catalog_stale_hardening.sql`)

Olgular: `{"lock_context":true,"version_guard":false,"changed_inside_locked_region":false,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

```diff
@@ -162,6 +162,16 @@ begin
   end if;
   if p_active is null then raise exception 'INVALID_ASSIGNMENT'; end if;
 
+  if not p_active then
+    update public.staff_services ss
+    set active = false
+    where ss.business_id = p_business_id
+      and ss.staff_id = p_staff_id
+      and ss.service_id = p_service_id
+    returning * into v_row;
+    if found then return v_row; end if;
+  end if;
+
   perform pg_advisory_xact_lock(hashtextextended('f10-04:assignments:' || p_business_id::text, 0));
   select * into v_row
   from public.staff_services ss
```

## A10 · hücre A · weakens · eş: C10

Durum ve sürüm kontrolü kilitsiz okumaya taşındı, kilit sonra alınıyor; eşzamanlı kapatma ve iptal ikisi de "open" görür, koşulsuz güncelleme kapanmış fişi iptal edebilir.

Fonksiyon: `public.cancel_ticket_guarded` (`supabase/migrations/20260922111500_f14_ticket_model.sql`)

Olgular: `{"lock_context":true,"version_guard":false,"changed_inside_locked_region":true,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

```diff
@@ -1024,13 +1024,15 @@ begin
 
   select * into v_ticket
   from public.tickets t
-  where t.business_id = p_business_id and t.id = p_ticket_id
-  for update;
+  where t.business_id = p_business_id and t.id = p_ticket_id;
   if v_ticket.id is null then raise exception 'TICKET_NOT_FOUND'; end if;
   if v_ticket.status <> 'open' then raise exception 'TICKET_NOT_OPEN'; end if;
   if p_expected_version is null or v_ticket.version <> p_expected_version then
     raise exception 'STALE_WRITE';
   end if;
+  perform 1 from public.tickets t
+  where t.business_id = p_business_id and t.id = p_ticket_id
+  for update;
 
   update public.tickets
   set status = 'cancelled',
```

## B01 · hücre B · weakens

Koşullu "ilk yazan kazanır" güncellemesinin boşluk koşulları kaldırıldı; aynı komutu eşzamanlı bitiren ikinci istek sonucu sessizce ezer, çakışma hatası artık oluşmaz.

Fonksiyon: `public.f14_finish_ticket_command` (`supabase/migrations/20260922111500_f14_ticket_model.sql`)

Olgular: `{"lock_context":false,"version_guard":false,"changed_inside_locked_region":false,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

```diff
@@ -335,9 +335,7 @@ begin
   where business_id = p_business_id
     and actor_membership_id = p_actor_membership_id
     and command = p_command
-    and idempotency_key = p_idempotency_key
-    and ticket_id is null
-    and result_payload is null;
+    and idempotency_key = p_idempotency_key;
 
   if not found then
     raise exception 'TICKET_COMMAND_RESULT_CONFLICT';
```

## B02 · hücre B · weakens

Tek koşullu güncelleme "önce kontrol et, sonra yaz"a bölündü; eşzamanlı iki bitirme kontrolü birlikte geçer, ikincisi sonucu ezer.

Fonksiyon: `public.f15_finish_expense_command` (`supabase/migrations/20260923074000_f15_expense_ledger.sql`)

Olgular: `{"lock_context":false,"version_guard":false,"changed_inside_locked_region":false,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

```diff
@@ -228,13 +228,23 @@ security definer
 set search_path = ''
 as $$
 begin
+  if exists (
+    select 1 from public.expense_commands
+    where business_id=p_business_id
+      and actor_membership_id=p_actor_membership_id
+      and command=p_command
+      and idempotency_key=p_idempotency_key
+      and result_payload is not null
+  ) then
+    raise exception 'EXPENSE_COMMAND_RESULT_CONFLICT';
+  end if;
+
   update public.expense_commands
   set result_payload=p_result
   where business_id=p_business_id
     and actor_membership_id=p_actor_membership_id
     and command=p_command
-    and idempotency_key=p_idempotency_key
-    and result_payload is null;
+    and idempotency_key=p_idempotency_key;
 
   if not found then
     raise exception 'EXPENSE_COMMAND_RESULT_CONFLICT';
```

## B03 · hücre B · weakens

Sağlayıcı mesaj kimliği koşulu kaldırıldı; aynı iş için eşzamanlı iki tamamlama farklı kimliklerle gelirse ikincisi ilkini ezer (önceden çakışma hatası veriyordu).

Fonksiyon: `public.complete_notification_job_v2` (`supabase/migrations/20260912123000_s03_notification_consistency.sql`)

Olgular: `{"lock_context":false,"version_guard":false,"changed_inside_locked_region":false,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

```diff
@@ -732,8 +732,7 @@ begin
       updated_at = now()
   where j.id = p_job_id
     and j.receipt_token = p_receipt_token
-    and j.request_fingerprint = p_request_fingerprint
-    and (j.provider_message_id is null or j.provider_message_id = p_provider_message_id);
+    and j.request_fingerprint = p_request_fingerprint;
 
   get diagnostics v_updated = row_count;
   if v_updated <> 1 then raise exception 'NOTIFICATION_LEASE_LOST'; end if;
```

## B04 · hücre B · weakens

ON CONFLICT yerine "var mı bak, yoksa ekle"; aynı anahtarla eşzamanlı iki istek kontrolü birlikte geçer, ikincisi idempotent yanıt yerine benzersizlik hatası alır.

Fonksiyon: `public.claim_booking_command` (`supabase/migrations/20260911130000_phase6_public_booking.sql`)

Olgular: `{"lock_context":false,"version_guard":false,"changed_inside_locked_region":false,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

```diff
@@ -107,15 +107,16 @@ begin
     raise exception 'INVALID_IDEMPOTENCY_KEY';
   end if;
 
-  insert into public.booking_commands(
-    business_id, idempotency_key, command, request_hash, appointment_id, created_by, source
-  ) values (
-    p_business_id, p_idempotency_key, p_command, p_request_hash, p_appointment_id, auth.uid(), v_source
-  )
-  on conflict (business_id, idempotency_key) do nothing;
-
-  get diagnostics v_inserted = row_count;
-  if v_inserted = 1 then
+  if not exists (
+    select 1 from public.booking_commands
+    where business_id = p_business_id
+      and idempotency_key = p_idempotency_key
+  ) then
+    insert into public.booking_commands(
+      business_id, idempotency_key, command, request_hash, appointment_id, created_by, source
+    ) values (
+      p_business_id, p_idempotency_key, p_command, p_request_hash, p_appointment_id, auth.uid(), v_source
+    );
     return query select true, p_appointment_id;
     return;
   end if;
```

## B05 · hücre B · weakens

Tek ifadelik upsert "güncelle, bulamazsan ekle"ye bölündü; işletmenin ilk iki randevusu eşzamanlı eklenirse ikisi de satırı bulamaz, ikincisi benzersizlik hatasıyla randevu eklemesini düşürür.

Fonksiyon: `public.f13_bump_appointment_page_revision` (`supabase/migrations/20260920200000_f13_appointment_page_revision.sql`)

Olgular: `{"lock_context":false,"version_guard":false,"changed_inside_locked_region":false,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

```diff
@@ -28,10 +28,13 @@ set search_path = pg_catalog, public, private
 as $$
 begin
   if tg_op = 'INSERT' then
-    insert into private.appointment_page_revisions(business_id, revision)
-    values (new.business_id, gen_random_uuid())
-    on conflict (business_id) do update
-      set revision = excluded.revision;
+    update private.appointment_page_revisions
+    set revision = gen_random_uuid()
+    where business_id = new.business_id;
+    if not found then
+      insert into private.appointment_page_revisions(business_id, revision)
+      values (new.business_id, gen_random_uuid());
+    end if;
     return new;
   end if;
 
```

## B06 · hücre B · weakens

Değişen satırları kaydeden tek ifade (CTE) iki ifadeye bölündü; olaylar ayrı bir okumadan yazılıyor. Eşzamanlı iki iptal ikisi de olay yazar; arada verilen bir izin olay kaydı olmadan kapanır.

Fonksiyon: `public.f10_revoke_financial_permissions` (`supabase/migrations/20260914033000_f10_team_access.sql`)

Olgular: `{"lock_context":false,"version_guard":false,"changed_inside_locked_region":false,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

```diff
@@ -156,22 +156,23 @@ security definer
 set search_path = ''
 as $$
 begin
-  with changed as (
-    update public.membership_financial_permissions p
-    set active = false,
-        revoked_by_membership_id = p_actor_membership_id,
-        revoked_at = now()
-    where p.business_id = p_business_id
-      and p.membership_id = p_membership_id
-      and p.active
-    returning p.permission
-  )
   insert into public.membership_financial_permission_events(
     business_id, membership_id, permission, action, actor_membership_id
   )
-  select p_business_id, p_membership_id, c.permission, 'revoke'::public.financial_permission_action,
+  select p_business_id, p_membership_id, p.permission, 'revoke'::public.financial_permission_action,
          p_actor_membership_id
-  from changed c;
+  from public.membership_financial_permissions p
+  where p.business_id = p_business_id
+    and p.membership_id = p_membership_id
+    and p.active;
+
+  update public.membership_financial_permissions p
+  set active = false,
+      revoked_by_membership_id = p_actor_membership_id,
+      revoked_at = now()
+  where p.business_id = p_business_id
+    and p.membership_id = p_membership_id
+    and p.active;
 end
 $$;
 
```

## B07 · hücre B · weakens

Kiralama kontrolü ayrı bir okumaya taşındı, güncelleme yalnız id ile yapılıyor; kontrol ile yazma arasında kiralama başka işçiye geçerse eski işçi işi "gönderildi" yapar.

Fonksiyon: `public.complete_notification_job` (`supabase/migrations/20260911170000_phase9_notification_outbox.sql`)

Olgular: `{"lock_context":false,"version_guard":false,"changed_inside_locked_region":false,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

```diff
@@ -305,6 +305,15 @@ begin
     raise exception 'INVALID_PROVIDER_MESSAGE_ID';
   end if;
 
+  if not exists (
+    select 1 from public.appointment_notification_jobs j
+    where j.id = p_job_id
+      and j.state = 'leased'
+      and j.lease_token = p_lease_token
+  ) then
+    raise exception 'NOTIFICATION_LEASE_LOST';
+  end if;
+
   update public.appointment_notification_jobs j
   set state = 'sent',
       provider_message_id = p_provider_message_id,
@@ -315,8 +324,6 @@ begin
       lease_expires_at = null,
       updated_at = now()
   where j.id = p_job_id
-    and j.state = 'leased'
-    and j.lease_token = p_lease_token
   returning j.recovery_id into v_recovery_id;
 
   get diagnostics v_updated = row_count;
```

## B08 · hücre B · weakens

Ekleme, çakışmada belirteci ezen upsert oldu; eşzamanlı iki kurulum kontrolü birlikte geçerse ikincisi hata almak yerine ilk belirteci ezer, ilk müşterinin yönetim bağlantısı sessizce geçersizleşir.

Fonksiyon: `public.provision_public_management_token` (`supabase/migrations/20260911140000_phase7_customer_manage.sql`)

Olgular: `{"lock_context":false,"version_guard":false,"changed_inside_locked_region":false,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

```diff
@@ -98,7 +98,9 @@ begin
     appointment_id, business_id, token_hash
   ) values (
     p_appointment_id, v_business_id, v_hash
-  );
+  )
+  on conflict (appointment_id) do update
+    set token_hash = excluded.token_hash;
 
   return true;
 end
```

## B09 · hücre B · weakens · eş: D10

"İlk yazan kazanır" koşulu gevşetildi (sonuç boşluğu koşulu kaldırıldı); aynı ürün için eşzamanlı ikinci bitirme sonucu ezer.

Fonksiyon: `public.f15_finish_product_command` (`supabase/migrations/20260923051000_f15_product_stock_ledger.sql`)

Olgular: `{"lock_context":false,"version_guard":false,"changed_inside_locked_region":false,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

```diff
@@ -367,8 +367,7 @@ begin
     and actor_membership_id = p_actor_membership_id
     and command = p_command
     and idempotency_key = p_idempotency_key
-    and product_id is null
-    and result_payload is null;
+    and (product_id is null or product_id = p_product_id);
 
   if not found then
     raise exception 'PRODUCT_COMMAND_RESULT_CONFLICT';
```

## B10 · hücre B · weakens

Serileştirilmiş müşteri çözümleyici çağrısı yerine kilitsiz "bul, yoksa ekle"; aynı yeni iletişim bilgisiyle eşzamanlı iki randevu iki ayrı müşteri kaydı oluşturur (telefon/e-posta için benzersiz indeks yok).

Fonksiyon: `public.create_appointment` (`supabase/migrations/20260914110200_f10_customer_authority_repair.sql`)

Olgular: `{"lock_context":false,"version_guard":false,"changed_inside_locked_region":false,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

```diff
@@ -245,15 +245,20 @@ begin
     raise exception 'SLOT_UNAVAILABLE';
   end if;
 
-  v_customer_id := public.f10_resolve_or_create_customer(
-    p_business_id,
-    v_customer_name,
-    v_customer_phone,
-    v_customer_email,
-    null,
-    auth.uid(),
-    true
-  );
+  select c.id into v_customer_id
+  from public.customers c
+  where c.business_id = p_business_id
+    and (
+      (v_customer_phone is not null and c.phone = v_customer_phone)
+      or (v_customer_email is not null and c.email = v_customer_email)
+    )
+  limit 1;
+
+  if v_customer_id is null then
+    insert into public.customers(business_id, name, phone, email, created_by)
+    values (p_business_id, v_customer_name, v_customer_phone, v_customer_email, auth.uid())
+    returning id into v_customer_id;
+  end if;
 
   begin
     insert into public.appointments(
```

## C01 · hücre C · no_effect · eş: A01

Personel adı büyük harfle başlatılıyor; yalnız kaydedilen değer değişir.

Fonksiyon: `public.create_staff_guarded` (`supabase/migrations/20260914111500_f10_catalog_hours_management.sql`)

Olgular: `{"lock_context":true,"version_guard":false,"changed_inside_locked_region":true,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

```diff
@@ -251,7 +251,7 @@ begin
   if v_count >= 100 then raise exception 'CATALOG_STAFF_LIMIT_EXCEEDED'; end if;
 
   insert into public.staff_profiles(business_id, name, phone)
-  values(p_business_id, trim(p_name), v_phone)
+  values(p_business_id, initcap(trim(p_name)), v_phone)
   returning * into v_row;
   return v_row;
 end
```

## C02 · hücre C · no_effect · eş: A02

Hata kodu yeniden adlandırıldı; yalnız çıktı değişir.

Fonksiyon: `public.revoke_business_invitation` (`supabase/migrations/20260914033000_f10_team_access.sql`)

Olgular: `{"lock_context":true,"version_guard":false,"changed_inside_locked_region":true,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

```diff
@@ -293,7 +293,7 @@ begin
     raise exception 'OWNER_ROLE_REQUIRES_OWNER' using errcode = '42501';
   end if;
   if v_invitation.accepted_at is not null then
-    raise exception 'INVITATION_ALREADY_USED';
+    raise exception 'INVITATION_ALREADY_ACCEPTED';
   end if;
   if v_invitation.revoked_at is not null then
     return;
```

## C03 · hücre C · no_effect · eş: A03

Dönen JSON'a arşiv alanları eklendi (kilit altında okunan satırdan); yalnız çıktı değişir.

Fonksiyon: `public.archive_product_guarded` (`supabase/migrations/20260923051000_f15_product_stock_ledger.sql`)

Olgular: `{"lock_context":true,"version_guard":false,"changed_inside_locked_region":true,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

```diff
@@ -738,6 +738,11 @@ begin
   end if;
 
   v_result := public.f15_product_projection(p_business_id, v_product.id);
+  v_result := v_result || jsonb_build_object(
+    'archived', not v_product.active,
+    'archivedAt', v_product.archived_at,
+    'archivedBy', v_product.archived_by_membership_id
+  );
   perform public.f15_finish_product_command(
     p_business_id, v_actor.id, 'archive_product', p_idempotency_key, v_product.id, v_result
   );
```

## C04 · hücre C · no_effect · eş: A04

Hata kodu yeniden adlandırıldı; yalnız çıktı değişir.

Fonksiyon: `public.update_team_membership` (`supabase/migrations/20260914033000_f10_team_access.sql`)

Olgular: `{"lock_context":true,"version_guard":false,"changed_inside_locked_region":true,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

```diff
@@ -434,7 +434,7 @@ begin
   where m.business_id = p_business_id and m.id = p_membership_id
   for update;
   if v_target.id is null then
-    raise exception 'MEMBERSHIP_NOT_FOUND';
+    raise exception 'TEAM_MEMBER_NOT_FOUND';
   end if;
 
   if v_actor.role = 'manager' and (v_target.role = 'owner' or p_role = 'owner') then
```

## C05 · hücre C · no_effect · eş: A05

Yeni hizmetin varsayılan kategorisi değişti; yalnız kaydedilen değer değişir.

Fonksiyon: `public.create_service_guarded` (`supabase/migrations/20260915150000_f12_service_price_range.sql`)

Olgular: `{"lock_context":true,"version_guard":false,"changed_inside_locked_region":true,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

```diff
@@ -178,7 +178,7 @@ begin
     price_policy_version, currency
   ) values (
     p_business_id, trim(p_name), p_duration_minutes, p_buffer_before_minutes, p_buffer_after_minutes,
-    'Genel', v_sort, p_price_minor, 'fixed', p_price_minor, p_price_minor, 1, 'TRY'
+    'Diğer', v_sort, p_price_minor, 'fixed', p_price_minor, p_price_minor, 1, 'TRY'
   ) returning * into v_row;
   return v_row;
 end
```

## C06 · hücre C · no_effect · eş: A06

Tek doğrulama bloğu ayrı hata kodlarına bölündü ve alternatif metin sınırı 200 oldu; hepsi kilit altında, yalnız doğrulama ve çıktı değişir.

Fonksiyon: `public.begin_business_public_media_upload` (`supabase/migrations/20260914110500_f12_salon_profile_media.sql`)

Olgular: `{"lock_context":true,"version_guard":false,"changed_inside_locked_region":true,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

```diff
@@ -310,13 +310,19 @@ begin
   if not found then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
 
   if p_media_id is null
-     or p_storage_path <> p_business_id::text || '/' || p_media_id::text || '.webp'
-     or p_mime_type <> 'image/webp'
-     or p_size_bytes is null or p_size_bytes < 1 or p_size_bytes > 5242880
+     or p_storage_path <> p_business_id::text || '/' || p_media_id::text || '.webp' then
+    raise exception 'INVALID_PUBLIC_MEDIA_PATH';
+  end if;
+  if p_mime_type <> 'image/webp' then
+    raise exception 'INVALID_PUBLIC_MEDIA_TYPE';
+  end if;
+  if p_size_bytes is null or p_size_bytes < 1 or p_size_bytes > 5242880
      or p_width is null or p_width < 1 or p_width > 2000
-     or p_height is null or p_height < 1 or p_height > 2000
-     or v_alt is not null and char_length(v_alt) > 160 then
-    raise exception 'INVALID_PUBLIC_MEDIA';
+     or p_height is null or p_height < 1 or p_height > 2000 then
+    raise exception 'INVALID_PUBLIC_MEDIA_SIZE';
+  end if;
+  if v_alt is not null and char_length(v_alt) > 200 then
+    raise exception 'INVALID_PUBLIC_MEDIA_ALT';
   end if;
 
   select count(*), coalesce(max(m.sort_order), -1) + 1
```

## C07 · hücre C · no_effect · eş: A07

Olay kaydının payload'u yeniden kuruldu (kaynak ve önceki durum eklendi); yalnız yazılan olay içeriği değişir.

Fonksiyon: `public.set_appointment_status` (`supabase/migrations/20260911121000_phase5_booking_hardening.sql`)

Olgular: `{"lock_context":true,"version_guard":false,"changed_inside_locked_region":true,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

```diff
@@ -503,7 +503,11 @@ begin
     business_id, appointment_id, event_type, actor_user_id, from_status, to_status, payload
   ) values (
     p_business_id, p_appointment_id, p_status, auth.uid(), v_current.status, p_status,
-    case when p_status = 'cancelled' then jsonb_build_object('reason', v_reason) else '{}'::jsonb end
+    jsonb_strip_nulls(jsonb_build_object(
+      'reason', case when p_status = 'cancelled' then v_reason end,
+      'source', 'operator',
+      'previousStatus', v_current.status
+    ))
   );
 
   return v_row;
```

## C08 · hücre C · no_effect · eş: A08

Kalıcı hata sınıfı metni zenginleştirildi ve 120 karakterle sınırlandı; yalnız kaydedilen hata metni değişir.

Fonksiyon: `public.release_notification_job_v2` (`supabase/migrations/20260912123000_s03_notification_consistency.sql`)

Olgular: `{"lock_context":true,"version_guard":false,"changed_inside_locked_region":true,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

```diff
@@ -795,8 +795,10 @@ begin
     and now() + make_interval(secs => v_delay) >= v_job.provider_idempotency_expires_at;
   v_error := case
     when v_window_expired then 'idempotency_window_expired_ambiguous'
+    when v_certainty = 'rejected' then 'rejected:' || p_error_class
     else p_error_class
   end;
+  v_error := left(v_error, 120);
 
   if not v_job.is_current
      or not coalesce(p_retryable, false)
```

## C09 · hücre C · no_effect · eş: A09

Varlık kontrolü ayrı hata kodlarına bölündü; aynı okumalar aynı kilit altında kalıyor, yalnız çıktı değişir.

Fonksiyon: `public.set_staff_service_guarded` (`supabase/migrations/20260914111700_f10_catalog_stale_hardening.sql`)

Olgular: `{"lock_context":true,"version_guard":false,"changed_inside_locked_region":true,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

```diff
@@ -198,11 +198,14 @@ begin
     if not exists (
       select 1 from public.staff_profiles sp
       where sp.business_id = p_business_id and sp.id = p_staff_id
-    ) or not exists (
+    ) then
+      raise exception 'ASSIGNMENT_STAFF_NOT_FOUND';
+    end if;
+    if not exists (
       select 1 from public.services s
       where s.business_id = p_business_id and s.id = p_service_id
     ) then
-      raise exception 'ASSIGNMENT_NOT_FOUND';
+      raise exception 'ASSIGNMENT_SERVICE_NOT_FOUND';
     end if;
     select count(*) into v_count
     from public.staff_services ss where ss.business_id = p_business_id;
```

## C10 · hücre C · no_effect · eş: A10

Hata kodu yeniden adlandırıldı; yalnız çıktı değişir.

Fonksiyon: `public.cancel_ticket_guarded` (`supabase/migrations/20260922111500_f14_ticket_model.sql`)

Olgular: `{"lock_context":true,"version_guard":false,"changed_inside_locked_region":true,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

```diff
@@ -1027,7 +1027,7 @@ begin
   where t.business_id = p_business_id and t.id = p_ticket_id
   for update;
   if v_ticket.id is null then raise exception 'TICKET_NOT_FOUND'; end if;
-  if v_ticket.status <> 'open' then raise exception 'TICKET_NOT_OPEN'; end if;
+  if v_ticket.status <> 'open' then raise exception 'TICKET_NOT_CANCELLABLE'; end if;
   if p_expected_version is null or v_ticket.version <> p_expected_version then
     raise exception 'STALE_WRITE';
   end if;
```

## D01 · hücre D · no_effect

Açıklama üst sınırı 500 oldu ve yalnız TRY para birimi kabul ediliyor; yalnız girdi doğrulaması değişir.

Fonksiyon: `public.create_expense_guarded` (`supabase/migrations/20260923074000_f15_expense_ledger.sql`)

Olgular: `{"lock_context":false,"version_guard":false,"changed_inside_locked_region":false,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

```diff
@@ -359,9 +359,12 @@ begin
   if v_replay is not null then return v_replay; end if;
 
   if char_length(v_category) not between 1 and 80 then raise exception 'INVALID_EXPENSE_CATEGORY'; end if;
-  if v_description is not null and char_length(v_description) not between 2 and 240 then raise exception 'INVALID_EXPENSE_DESCRIPTION'; end if;
+  if v_description is not null and char_length(v_description) not between 2 and 500 then raise exception 'INVALID_EXPENSE_DESCRIPTION'; end if;
   if p_amount_minor is null or p_amount_minor not between 1 and 100000000 then raise exception 'INVALID_EXPENSE_AMOUNT'; end if;
   if v_currency !~ '^[A-Z]{3}$' then raise exception 'INVALID_CURRENCY'; end if;
+  if v_currency <> 'TRY' then
+    raise exception 'UNSUPPORTED_CURRENCY';
+  end if;
   if p_payment_method not in ('cash','card') then raise exception 'INVALID_PAYMENT_METHOD'; end if;
   if p_occurred_local is null then raise exception 'INVALID_EXPENSE_TIME'; end if;
 
```

## D02 · hücre D · no_effect

Fişteki müşteri anlık görüntüsü normalize ediliyor (kırpma, boşsa null, e-posta küçük harf); yalnız kaydedilen değerler değişir.

Fonksiyon: `public.open_walk_in_ticket_guarded` (`supabase/migrations/20260922111500_f14_ticket_model.sql`)

Olgular: `{"lock_context":false,"version_guard":false,"changed_inside_locked_region":false,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

```diff
@@ -647,7 +647,10 @@ begin
     created_by_membership_id
   ) values (
     p_business_id, null, v_customer.id, 'walk_in', 'open', null,
-    v_customer.name, v_customer.phone, v_customer.email, v_actor.id
+    btrim(v_customer.name),
+    nullif(btrim(coalesce(v_customer.phone, '')), ''),
+    lower(nullif(btrim(coalesce(v_customer.email, '')), '')),
+    v_actor.id
   )
   returning * into v_ticket;
 
```

## D03 · hücre D · no_effect

Ürün adı/kodu/birimi doğrulaması ayrıntılı hata kodlarına bölündü, ad sınırı 160 ve "pack" birimi eklendi; yalnız girdi doğrulaması değişir.

Fonksiyon: `public.create_product_guarded` (`supabase/migrations/20260923051000_f15_product_stock_ledger.sql`)

Olgular: `{"lock_context":false,"version_guard":false,"changed_inside_locked_region":false,"guard_delta":"unchanged","retry_path":true,"transaction_boundary":"unchanged"}`

```diff
@@ -576,11 +576,20 @@ begin
   );
   if v_replay is not null then return v_replay; end if;
 
-  if char_length(v_name) not between 1 and 120 then raise exception 'INVALID_PRODUCT_NAME'; end if;
-  if v_code is not null and (char_length(v_code) not between 1 and 64 or v_code !~ '^[A-Z0-9][A-Z0-9._-]*$') then
-    raise exception 'INVALID_PRODUCT_CODE';
+  if char_length(v_name) not between 1 and 160 then
+    raise exception 'INVALID_PRODUCT_NAME';
+  end if;
+  if v_code is not null then
+    if char_length(v_code) not between 1 and 64 then
+      raise exception 'INVALID_PRODUCT_CODE_LENGTH';
+    end if;
+    if v_code !~ '^[A-Z0-9][A-Z0-9._-]*$' then
+      raise exception 'INVALID_PRODUCT_CODE_FORMAT';
+    end if;
+  end if;
+  if v_unit not in ('piece', 'pack') then
+    raise exception 'INVALID_PRODUCT_UNIT';
   end if;
-  if v_unit <> 'piece' then raise exception 'INVALID_PRODUCT_UNIT'; end if;
   if p_sale_price_minor is null or p_sale_price_minor < 0 then raise exception 'INVALID_PRODUCT_PRICE'; end if;
   if v_currency !~ '^[A-Z]{3}$' then raise exception 'INVALID_CURRENCY'; end if;
   if p_initial_quantity is null or p_initial_quantity < 0 or p_initial_quantity > 1000000000 then
```

## D04 · hücre D · no_effect

Saat biçimi açıkça doğrulanıyor ve 15 dakikadan kısa aralık reddediliyor; yalnız girdi doğrulaması değişir.

Fonksiyon: `public.replace_business_hours` (`supabase/migrations/20260911110000_phase4_availability.sql`)

Olgular: `{"lock_context":false,"version_guard":false,"changed_inside_locked_region":false,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

```diff
@@ -160,16 +160,19 @@ begin
 
   for v_item in select value from jsonb_array_elements(p_intervals)
   loop
-    begin
-      v_start := (v_item ->> 'start')::time;
-      v_end := (v_item ->> 'end')::time;
-    exception when others then
+    if coalesce(v_item ->> 'start', '') !~ '^[0-9]{2}:[0-9]{2}$'
+       or coalesce(v_item ->> 'end', '') !~ '^[0-9]{2}:[0-9]{2}$' then
       raise exception 'INVALID_TIME';
-    end;
+    end if;
+    v_start := (v_item ->> 'start')::time;
+    v_end := (v_item ->> 'end')::time;
 
-    if v_start is null or v_end is null or v_start >= v_end then
+    if v_start >= v_end then
       raise exception 'INVALID_INTERVAL';
     end if;
+    if v_end - v_start < interval '15 minutes' then
+      raise exception 'INTERVAL_TOO_SHORT';
+    end if;
 
     if exists (
       select 1 from public.business_hours h
```

## D05 · hücre D · no_effect

Dönen satırlar yalnız aktif aralıklarla sınırlandı ve bitiş saatine göre de sıralandı; yalnız çıktı değişir.

Fonksiyon: `public.replace_staff_hours` (`supabase/migrations/20260911110000_phase4_availability.sql`)

Olgular: `{"lock_context":false,"version_guard":false,"changed_inside_locked_region":false,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

```diff
@@ -258,9 +258,13 @@ begin
   end loop;
 
   return query
-  select h.* from public.staff_hours h
-  where h.business_id = p_business_id and h.staff_id = p_staff_id and h.weekday = p_weekday
-  order by h.starts_local;
+  select h.*
+  from public.staff_hours h
+  where h.business_id = p_business_id
+    and h.staff_id = p_staff_id
+    and h.weekday = p_weekday
+    and h.active
+  order by h.starts_local, h.ends_local;
 end
 $$;
 
```

## D06 · hücre D · no_effect

Saat dilimi adı doğrulaması eklendi; yalnız girdi doğrulaması değişir.

Fonksiyon: `public.create_business_with_owner` (`supabase/migrations/20260911090000_phase2_auth_tenancy.sql`)

Olgular: `{"lock_context":false,"version_guard":false,"changed_inside_locked_region":false,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

```diff
@@ -140,6 +140,10 @@ begin
   if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
   if char_length(trim(p_name)) < 2 then raise exception 'INVALID_BUSINESS_NAME'; end if;
   if p_slug is null or p_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then raise exception 'INVALID_BUSINESS_SLUG'; end if;
+  if nullif(trim(p_timezone), '') is not null
+     and not exists (select 1 from pg_timezone_names z where z.name = trim(p_timezone)) then
+    raise exception 'INVALID_TIMEZONE';
+  end if;
 
   insert into public.businesses(name, slug, timezone, created_by)
   values(trim(p_name), lower(p_slug), coalesce(nullif(trim(p_timezone), ''), 'Europe/Istanbul'), v_user)
```

## D07 · hücre D · no_effect

Görünen ad için ikinci bir meta veri alanı yedek olarak eklendi ve ifade açıldı; yalnız kaydedilen değer değişir.

Fonksiyon: `public.handle_new_user` (`supabase/migrations/20260911090000_phase2_auth_tenancy.sql`)

Olgular: `{"lock_context":false,"version_guard":false,"changed_inside_locked_region":false,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

```diff
@@ -51,7 +51,14 @@ set search_path = public
 as $$
 begin
   insert into public.profiles(id, display_name)
-  values(new.id, nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, ''), '@', 1))), ''))
+  values(
+    new.id,
+    nullif(trim(coalesce(
+      new.raw_user_meta_data ->> 'full_name',
+      new.raw_user_meta_data ->> 'name',
+      split_part(coalesce(new.email, ''), '@', 1)
+    )), '')
+  )
   on conflict(id) do update set display_name = coalesce(excluded.display_name, public.profiles.display_name);
   return new;
 end $$;
```

## D08 · hücre D · no_effect

Telefon biçimi doğrulaması eklendi ve not sınırı 1000 oldu; yalnız girdi doğrulaması değişir.

Fonksiyon: `public.create_public_appointment` (`supabase/migrations/20260914110200_f10_customer_authority_repair.sql`)

Olgular: `{"lock_context":false,"version_guard":false,"changed_inside_locked_region":false,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

```diff
@@ -355,7 +355,10 @@ begin
   if v_customer_phone is null and v_customer_email is null then
     raise exception 'PUBLIC_CONTACT_REQUIRED';
   end if;
-  if v_notes is not null and char_length(v_notes) > 500 then
+  if v_customer_phone is not null and v_customer_phone !~ '^[0-9 +()-]+$' then
+    raise exception 'INVALID_CUSTOMER_PHONE';
+  end if;
+  if v_notes is not null and char_length(v_notes) > 1000 then
     raise exception 'NOTES_TOO_LONG';
   end if;
   if p_starts_at is null then
```

## D09 · hücre D · no_effect

Başlangıç okumasından komut kaynağı koşulu kaldırıldı (randevu kaynağı koşulu duruyor); yalnız hangi randevuların uygun sayıldığı (iş kuralı) değişir.

Fonksiyon: `public.provision_public_management_token` (`supabase/migrations/20260911140000_phase7_customer_manage.sql`)

Olgular: `{"lock_context":false,"version_guard":false,"changed_inside_locked_region":false,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

```diff
@@ -76,7 +76,6 @@ begin
   where bc.appointment_id = p_appointment_id
     and bc.idempotency_key = p_booking_idempotency_key
     and bc.command = 'public_create'
-    and bc.source = 'public'
   limit 1;
 
   if v_business_id is null then
```

## D10 · hücre D · no_effect · eş: B09

Girdi doğrulaması ayrıldı ve sonucun "id" alanı olan bir JSON nesnesi olması şartı eklendi; yalnız girdi doğrulaması değişir.

Fonksiyon: `public.f15_finish_product_command` (`supabase/migrations/20260923051000_f15_product_stock_ledger.sql`)

Olgular: `{"lock_context":false,"version_guard":false,"changed_inside_locked_region":false,"guard_delta":"unchanged","retry_path":false,"transaction_boundary":"unchanged"}`

```diff
@@ -356,9 +356,15 @@ security definer
 set search_path = ''
 as $$
 begin
-  if p_product_id is null or p_result is null then
+  if p_product_id is null then
     raise exception 'INVALID_PRODUCT_RESULT';
   end if;
+  if p_result is null or jsonb_typeof(p_result) <> 'object' then
+    raise exception 'INVALID_PRODUCT_RESULT';
+  end if;
+  if not (p_result ? 'id') then
+    raise exception 'INVALID_PRODUCT_RESULT_SHAPE';
+  end if;
 
   update public.product_commands
   set product_id = p_product_id,
```

## E01 · hücre E · weakens

Advisory kilit kaldırıldı; sayım ve ekleme serileşmiyor, eşzamanlı eklemeler limiti aşabilir.

Fonksiyon: `public.create_staff_guarded` (`supabase/migrations/20260914111500_f10_catalog_hours_management.sql`)

Olgular: `{"lock_context":true,"version_guard":false,"changed_inside_locked_region":true,"guard_delta":"removed","retry_path":false,"transaction_boundary":"unchanged"}`

```diff
@@ -246,7 +246,6 @@ begin
     raise exception 'INVALID_STAFF';
   end if;
 
-  perform pg_advisory_xact_lock(hashtextextended('f10-04:staff:' || p_business_id::text, 0));
   select count(*) into v_count from public.staff_profiles sp where sp.business_id = p_business_id;
   if v_count >= 100 then raise exception 'CATALOG_STAFF_LIMIT_EXCEEDED'; end if;
 
```

## E02 · hücre E · weakens

Satır kilidi kaldırıldı; bayat yazma (updated_at) kontrolü kilitsiz okumada, güncelleme koşulsuz: eşzamanlı iki düzenleme ikisi de geçer.

Fonksiyon: `public.update_staff_guarded` (`supabase/migrations/20260914111700_f10_catalog_stale_hardening.sql`)

Olgular: `{"lock_context":true,"version_guard":false,"changed_inside_locked_region":true,"guard_delta":"removed","retry_path":false,"transaction_boundary":"unchanged"}`

```diff
@@ -110,8 +110,7 @@ begin
 
   select * into v_row
   from public.staff_profiles sp
-  where sp.business_id = p_business_id and sp.id = p_staff_id
-  for update;
+  where sp.business_id = p_business_id and sp.id = p_staff_id;
   if not found then raise exception 'STAFF_NOT_FOUND'; end if;
   if p_expected_updated_at is null
      or v_row.updated_at is distinct from p_expected_updated_at then
```

## E03 · hücre E · weakens

Ürün satırı kilidi kaldırıldı; bakiye ve sürüm kilitsiz okumadan, güncelleme koşulsuz: eşzamanlı iki hareket kayıp güncelleme ve yanlış bakiye üretir.

Fonksiyon: `public.record_product_stock_movement_guarded` (`supabase/migrations/20260923051000_f15_product_stock_ledger.sql`)

Olgular: `{"lock_context":true,"version_guard":false,"changed_inside_locked_region":true,"guard_delta":"removed","retry_path":false,"transaction_boundary":"unchanged"}`

```diff
@@ -789,8 +789,7 @@ begin
 
   select * into v_product
   from public.products p
-  where p.business_id = p_business_id and p.id = p_product_id
-  for update;
+  where p.business_id = p_business_id and p.id = p_product_id;
 
   if v_product.id is null then raise exception 'PRODUCT_NOT_FOUND'; end if;
   if not v_product.active then raise exception 'PRODUCT_ARCHIVED'; end if;
```

## E04 · hücre E · weakens

İşletme düzeyi advisory kilit kaldırıldı (davet satırı kilidi duruyor); yetki okuması eşzamanlı rol değişiklikleriyle serileşmiyor.

Fonksiyon: `public.revoke_business_invitation` (`supabase/migrations/20260914033000_f10_team_access.sql`)

Olgular: `{"lock_context":true,"version_guard":false,"changed_inside_locked_region":true,"guard_delta":"removed","retry_path":false,"transaction_boundary":"unchanged"}`

```diff
@@ -275,7 +275,6 @@ begin
     raise exception 'AUTH_REQUIRED' using errcode = '42501';
   end if;
 
-  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text, 0));
   select * into v_actor from public.f10_team_actor(p_business_id);
   if v_actor.membership_id is null or v_actor.role not in ('owner', 'manager') then
     raise exception 'TEAM_FORBIDDEN' using errcode = '42501';
```

## E05 · hücre E · no_effect

Güncellemedeki sürüm koşulu kaldırıldı, ama aynı fonksiyon grup anahtarlı advisory kilit ve satır kilidi altında sürümü zaten kontrol ediyor; koşul gereksizdi. Kod kuralı "removed → weakens" burada yanlış.

Fonksiyon: `public.set_appointment_group_status` (`supabase/migrations/20260921043000_f13_group_lifecycle_partial_repair.sql`)

Olgular: `{"lock_context":true,"version_guard":true,"changed_inside_locked_region":true,"guard_delta":"removed","retry_path":false,"transaction_boundary":"unchanged"}`

```diff
@@ -118,7 +118,6 @@ begin
       version=g.version+1,
       updated_at=now()
   where g.business_id=p_business_id and g.id=p_group_id
-    and g.version=p_expected_version
   returning g.version into v_new_version;
   if v_new_version is null then raise exception 'BOOKING_GROUP_VERSION_CONFLICT'; end if;
 
```

## E06 · hücre E · strengthens

İşletme ve gün anahtarlı advisory kilit eklendi; eşzamanlı iki değiştirme artık serileşir, çakışan aralık kontrolü güvenilir olur.

Fonksiyon: `public.replace_business_hours` (`supabase/migrations/20260911110000_phase4_availability.sql`)

Olgular: `{"lock_context":false,"version_guard":false,"changed_inside_locked_region":true,"guard_delta":"added","retry_path":false,"transaction_boundary":"unchanged"}`

```diff
@@ -155,6 +155,8 @@ begin
     raise exception 'INVALID_INTERVALS';
   end if;
 
+  perform pg_advisory_xact_lock(hashtextextended('hours:' || p_business_id::text || ':' || p_weekday::text, 0));
+
   delete from public.business_hours
   where business_id = p_business_id and weekday = p_weekday;
 
```

## E07 · hücre E · strengthens

Başlangıç okumasına satır kilidi eklendi; aynı randevu için eşzamanlı kurulumlar serileşir, ikincisi mevcut belirteci görüp karşılaştırır.

Fonksiyon: `public.provision_public_management_token` (`supabase/migrations/20260911140000_phase7_customer_manage.sql`)

Olgular: `{"lock_context":false,"version_guard":false,"changed_inside_locked_region":true,"guard_delta":"added","retry_path":false,"transaction_boundary":"unchanged"}`

```diff
@@ -77,7 +77,8 @@ begin
     and bc.idempotency_key = p_booking_idempotency_key
     and bc.command = 'public_create'
     and bc.source = 'public'
-  limit 1;
+  limit 1
+  for update of bc;
 
   if v_business_id is null then
     raise exception 'INVALID_MANAGEMENT_BOOTSTRAP';
```

## E08 · hücre E · strengthens

Personel anahtarlı advisory kilit eklendi; aynı personele eşzamanlı randevular uygunluk kontrolü ile ekleme arasında serileşir.

Fonksiyon: `public.create_appointment` (`supabase/migrations/20260914110200_f10_customer_authority_repair.sql`)

Olgular: `{"lock_context":false,"version_guard":false,"changed_inside_locked_region":true,"guard_delta":"added","retry_path":false,"transaction_boundary":"unchanged"}`

```diff
@@ -235,6 +235,7 @@ begin
   if v_timezone is null then raise exception 'BUSINESS_NOT_FOUND'; end if;
 
   v_date := (p_starts_at at time zone v_timezone)::date;
+  perform pg_advisory_xact_lock(hashtextextended('staff-slot:' || p_staff_id::text, 0));
   if not exists (
     select 1
     from public.compute_availability_slots_internal(
```

## E09 · hücre E · no_effect

Güncellemeye sürüm koşulu eklendi, ama satır aynı fonksiyonda kilitli ve sürüm zaten kontrol edilmiş; koşul gereksiz. Kod kuralı "added → strengthens" burada yanlış.

Fonksiyon: `public.cancel_ticket_guarded` (`supabase/migrations/20260922111500_f14_ticket_model.sql`)

Olgular: `{"lock_context":true,"version_guard":false,"changed_inside_locked_region":true,"guard_delta":"added","retry_path":false,"transaction_boundary":"unchanged"}`

```diff
@@ -1038,7 +1038,8 @@ begin
       cancelled_by_membership_id = v_actor.id,
       cancelled_at = now(),
       cancellation_reason = v_reason
-  where business_id = p_business_id and id = p_ticket_id;
+  where business_id = p_business_id and id = p_ticket_id
+    and version = p_expected_version;
 
   v_result := public.f14_ticket_projection(p_business_id, p_ticket_id);
   perform public.f14_finish_ticket_command(
```

## E10 · hücre E · strengthens

Personel ve gün anahtarlı advisory kilit eklendi; eşzamanlı iki değiştirme serileşir, çakışan aralık kontrolü güvenilir olur.

Fonksiyon: `public.replace_staff_hours` (`supabase/migrations/20260911110000_phase4_availability.sql`)

Olgular: `{"lock_context":false,"version_guard":false,"changed_inside_locked_region":true,"guard_delta":"added","retry_path":false,"transaction_boundary":"unchanged"}`

```diff
@@ -225,6 +225,8 @@ begin
     raise exception 'INVALID_INTERVALS';
   end if;
 
+  perform pg_advisory_xact_lock(hashtextextended('staff-hours:' || p_staff_id::text || ':' || p_weekday::text, 0));
+
   delete from public.staff_hours
   where business_id = p_business_id and staff_id = p_staff_id and weekday = p_weekday;
 
```

