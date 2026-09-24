# H19t kör ikinci okuyucu kontrolü (16 vaka)

Her vaka için üç cevap yaz:
1. **D5 maddi olarak etkileniyor mu?** (eşzamanlılık, kilit, yarış sırası, bayat yazma, iyimser sürüm, iç içe geçmeye duyarlı davranış) `yes` · `no` · `undetermined`
2. **`yes` ise** D5 dışında maddi olarak değişen eksen(ler): `D0` kiracı/yetki · `D1` atomiklik/tekrar · `D2` anlık görüntü/politika · `D3` personel/kapasite · `D4` zaman/sınır · ya da `yok`
3. **`no` ise** maddi olarak değişen eksen(ler)

Etiket fonksiyon düzeyindedir: çağıranların kilitleri sayılmaz, fonksiyonun kendi çağırdığı yardımcının koruması sayılır. Yön (zayıflatma/güçlendirme) sorulmuyor.
Cevaplardan sonra [`ikinci-okuyucu-anahtar.md`](ikinci-okuyucu-anahtar.md) ile karşılaştır. Uyuşmazlıkta vaka düşer (`dusen.json`); etiket değiştirilmez.

## Vaka 1

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

D5: `____` · eksen(ler): `________`

## Vaka 2

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

D5: `____` · eksen(ler): `________`

## Vaka 3

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

D5: `____` · eksen(ler): `________`

## Vaka 4

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

D5: `____` · eksen(ler): `________`

## Vaka 5

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

D5: `____` · eksen(ler): `________`

## Vaka 6

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

D5: `____` · eksen(ler): `________`

## Vaka 7

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

D5: `____` · eksen(ler): `________`

## Vaka 8

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

D5: `____` · eksen(ler): `________`

## Vaka 9

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

D5: `____` · eksen(ler): `________`

## Vaka 10

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

D5: `____` · eksen(ler): `________`

## Vaka 11

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

D5: `____` · eksen(ler): `________`

## Vaka 12

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

D5: `____` · eksen(ler): `________`

## Vaka 13

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

D5: `____` · eksen(ler): `________`

## Vaka 14

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

D5: `____` · eksen(ler): `________`

## Vaka 15

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

D5: `____` · eksen(ler): `________`

## Vaka 16

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

D5: `____` · eksen(ler): `________`

