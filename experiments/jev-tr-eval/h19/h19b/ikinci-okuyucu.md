# H19b ikinci okuyucu kontrolü (kör)

Her vaka için yalnız şu soruyu cevapla: **Eklenen/silinen satırlar, bu fonksiyonda eşzamanlı isteklerin birbirine karışmasına karşı korumayı nasıl değiştiriyor?**
`weakens` (zayıflatıyor) · `strengthens` (güçlendiriyor) · `no_effect` (yalnız iş mantığı/çıktı/doğrulama) · `undetermined` (belirlenemez).
Etiket fonksiyon düzeyindedir: çağıranların tuttuğu kilitler hesaba katılmaz, fonksiyonun kendi çağırdığı yardımcıların koruması sayılır.
Cevapları yazdıktan sonra [`ikinci-okuyucu-anahtar.md`](ikinci-okuyucu-anahtar.md) ile karşılaştır. Anlaşmazlıkta vaka düşer; etiket değiştirilmez.

## Vaka 1

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

Senin etiketin: `________`

## Vaka 2

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

Senin etiketin: `________`

## Vaka 3

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

Senin etiketin: `________`

## Vaka 4

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

Senin etiketin: `________`

## Vaka 5

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

Senin etiketin: `________`

## Vaka 6

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

Senin etiketin: `________`

## Vaka 7

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

Senin etiketin: `________`

## Vaka 8

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

Senin etiketin: `________`

## Vaka 9

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

Senin etiketin: `________`

## Vaka 10

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

Senin etiketin: `________`

## Vaka 11

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

Senin etiketin: `________`

## Vaka 12

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

Senin etiketin: `________`

