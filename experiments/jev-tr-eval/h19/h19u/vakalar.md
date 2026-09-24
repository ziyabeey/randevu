# H19u vakaları (vakalar.v0.1.json, okunur liste)

## A01 · A · D1_ONLY · aile: command_identity [receipt_hash_replay]

İade komutu makbuzda "düzeltme" komut kimliğiyle açılıp kapanıyor; aynı anahtarla gelen iade ve düzeltme artık aynı makbuzu paylaşır (tekrar/çakışma kapsamı değişir). Kilitler aynı.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":2,"removed":2,"changed":4,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.record_ticket_refund_guarded` (`supabase/migrations/20260922144500_f14_payment_ledger.sql`)

```diff
@@ -595,7 +595,7 @@ declare
 begin
   v_actor := public.f14_payment_actor(p_business_id);
   v_replay := public.f14_claim_ticket_command(
-    p_business_id, v_actor.id, 'record_refund',
+    p_business_id, v_actor.id, 'record_correction',
     p_idempotency_key, p_request_hash
   );
   if v_replay is not null then return v_replay; end if;
@@ -643,7 +643,7 @@ begin
 
   v_result := public.f14_ticket_projection(p_business_id, p_ticket_id);
   perform public.f14_finish_ticket_command(
-    p_business_id, v_actor.id, 'record_refund',
+    p_business_id, v_actor.id, 'record_correction',
     p_idempotency_key, p_ticket_id, v_result
   );
   return v_result;
```

## A02 · A · D1_ONLY · aile: stale_receipt_result [receipt_hash_replay] · fonksiyon yeniden kullanıldı

Makbuza ödeme sonrası değil ödeme öncesi fiş görünümü kaydediliyor; tekrar eden istek ödemenin etkisini göstermeyen eski sonucu alır (tekrar semantiği).

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":1,"changed":2,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.record_ticket_payment_guarded` (`supabase/migrations/20260922144500_f14_payment_ledger.sql`)

```diff
@@ -472,7 +472,7 @@ begin
   v_result := public.f14_ticket_projection(p_business_id, p_ticket_id);
   perform public.f14_finish_ticket_command(
     p_business_id, v_actor.id, 'record_payment',
-    p_idempotency_key, p_ticket_id, v_result
+    p_idempotency_key, p_ticket_id, v_before
   );
 
   return v_result;
```

## A03 · A · D1_ONLY · aile: replay_skipped [receipt_hash_replay] · fonksiyon yeniden kullanıldı

Kayıtlı makbuz sonucu döndürülmüyor; tekrar eden indirim isteği komutu yeniden çalıştırır (fiş sürümü artmış olduğundan bayat yazma hatası alır).

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":0,"removed":2,"changed":2,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.set_ticket_service_discount_guarded` (`supabase/migrations/20260922144500_f14_payment_ledger.sql`)

```diff
@@ -682,8 +682,6 @@ begin
     p_business_id, v_actor.id, 'set_service_discount',
     p_idempotency_key, p_request_hash
   );
-  if v_replay is not null then return v_replay; end if;
-
   v_reason := nullif(btrim(coalesce(p_reason, '')), '');
   if p_discount_minor is null
      or p_discount_minor not between 0 and 100000000
```

## A04 · A · D1_ONLY · aile: receipt_not_finished [receipt_hash_replay]

Komut makbuzu sonuçla kapatılmıyor; tekrar eden kapatma isteği kayıtlı sonucu bulamayıp komutu yeniden çalıştırır ve "fiş açık değil" hatası alır.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":0,"removed":4,"changed":4,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

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

## A05 · A · D1_ONLY · aile: command_identity [receipt_hash_replay]

Fiyat kesinleştirme makbuzda "indirim" komut kimliğiyle açılıp kapanıyor; aynı anahtarla gelen iki farklı komut aynı makbuzu paylaşır.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":2,"removed":2,"changed":4,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.finalize_ticket_service_price_guarded` (`supabase/migrations/20260922111500_f14_ticket_model.sql`)

```diff
@@ -796,7 +796,7 @@ declare
 begin
   v_actor := public.f14_financial_actor(p_business_id);
   v_replay := public.f14_claim_ticket_command(
-    p_business_id, v_actor.id, 'finalize_service_price',
+    p_business_id, v_actor.id, 'set_service_discount',
     p_idempotency_key, p_request_hash
   );
   if v_replay is not null then return v_replay; end if;
@@ -842,7 +842,7 @@ begin
 
   v_result := public.f14_ticket_projection(p_business_id, p_ticket_id);
   perform public.f14_finish_ticket_command(
-    p_business_id, v_actor.id, 'finalize_service_price',
+    p_business_id, v_actor.id, 'set_service_discount',
     p_idempotency_key, p_ticket_id, v_result
   );
   return v_result;
```

## A06 · A · D1_ONLY · aile: receipt_not_finished [receipt_hash_replay] · fonksiyon yeniden kullanıldı

Komut makbuzu sonuçla kapatılmıyor; yanıtı kaybolan istemcinin aynı anahtarla tekrarı ikinci bir fiş açar.

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":true,"added":0,"removed":4,"changed":4,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.open_walk_in_ticket_guarded` (`supabase/migrations/20260922111500_f14_ticket_model.sql`)

```diff
@@ -652,10 +652,6 @@ begin
   returning * into v_ticket;
 
   v_result := public.f14_ticket_projection(p_business_id, v_ticket.id);
-  perform public.f14_finish_ticket_command(
-    p_business_id, v_actor.id, 'open_walk_in',
-    p_idempotency_key, v_ticket.id, v_result
-  );
   return v_result;
 end
 $$;
```

## A07 · A · D1_ONLY · aile: command_identity [receipt_hash_replay] · fonksiyon yeniden kullanıldı

Ürün iadesi makbuzda "para iadesi" komut kimliğiyle açılıp kapanıyor; aynı anahtarla gelen ürün iadesi ve para iadesi aynı makbuzu paylaşır (tekrar/çakışma kapsamı değişir).

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":2,"removed":2,"changed":4,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.record_product_return_refund_guarded` (`supabase/migrations/20260923113600_f15_product_sale_atomicity.sql`)

```diff
@@ -929,7 +929,7 @@ declare
 begin
   v_actor := public.f15_product_return_actor(p_business_id);
   v_replay := public.f14_claim_ticket_command(
-    p_business_id,v_actor.id,'product_return_refund',p_idempotency_key,p_request_hash
+    p_business_id,v_actor.id,'record_refund',p_idempotency_key,p_request_hash
   );
   if v_replay is not null then return v_replay; end if;
 
@@ -1028,7 +1028,7 @@ begin
 
   v_result := public.f14_ticket_projection(p_business_id,p_ticket_id);
   perform public.f14_finish_ticket_command(
-    p_business_id,v_actor.id,'product_return_refund',p_idempotency_key,p_ticket_id,v_result
+    p_business_id,v_actor.id,'record_refund',p_idempotency_key,p_ticket_id,v_result
   );
   return v_result;
 end
```

## A08 · A · D1_ONLY · aile: command_identity [receipt_hash_replay] · fonksiyon yeniden kullanıldı

Arşivleme makbuzda "ürün güncelleme" komut kimliğiyle açılıp kapanıyor; aynı anahtarla gelen güncelleme ile arşivleme aynı makbuzu paylaşır.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":2,"removed":2,"changed":4,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

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

## A09 · A · D1_ONLY · aile: receipt_not_finished [receipt_hash_replay] · fonksiyon yeniden kullanıldı

Komut makbuzu sonuçla kapatılmıyor; tekrar eden ters kayıt isteği kayıtlı sonucu değil "zaten ters kaydedilmiş" hatasını alır.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":0,"removed":3,"changed":3,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.reverse_expense_guarded` (`supabase/migrations/20260923074000_f15_expense_ledger.sql`)

```diff
@@ -453,9 +453,6 @@ begin
   returning * into v_event;
 
   v_result:=public.f15_expense_event_projection(p_business_id,v_event.id);
-  perform public.f15_finish_expense_command(
-    p_business_id,v_actor.id,'reverse_expense',p_idempotency_key,v_result
-  );
   return v_result;
 end
 $$;
```

## A10 · A · D1_ONLY · aile: hash_conflict_relaxed [receipt_hash_replay] · fonksiyon yeniden kullanıldı

Aynı anahtarla farklı içerikli platform komutu artık çakışma sayılmıyor; önceki komutun sonucu döndürülür (istek özeti yok sayılır).

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":true,"added":1,"removed":1,"changed":2,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.core_apply_platform_command` (`supabase/migrations/20260916190000_kc01_core_platform_schema.sql`)

```diff
@@ -932,7 +932,7 @@ begin
       select * into v_existing
       from core.platform_commands c
       where c.principal_id = v_principal_id and c.idempotency_key = p_idempotency_key;
-      if v_existing.command <> p_command or v_existing.request_hash <> v_request_hash then
+      if v_existing.command <> p_command then
         raise exception 'PLATFORM_IDEMPOTENCY_CONFLICT';
       end if;
       if v_existing.result is null then
```

## A11 · A · D1_ONLY · aile: request_hash_field [receipt_hash_replay]

Tekrar özeti iptal gerekçesini içermiyor; aynı anahtarla farklı gerekçeli istek, öncekinin tekrarı sayılır.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":false,"added":1,"removed":2,"changed":3,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.set_appointment_status` (`supabase/migrations/20260911120000_phase5_booking_core.sql`)

```diff
@@ -703,8 +703,7 @@ begin
 
   v_hash := md5(jsonb_build_object(
     'appointmentId', p_appointment_id,
-    'status', p_status,
-    'reason', v_reason
+    'status', p_status
   )::text);
 
   select * into v_claim
```

## A12 · A · D1_ONLY · aile: request_hash_field [receipt_hash_replay] · fonksiyon yeniden kullanıldı

Tekrar özeti iptal edilen satırı içermiyor; aynı anahtarla başka bir satırın iptali, öncekinin tekrarı sayılır.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":0,"removed":1,"changed":1,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.cancel_appointment_group_line` (`supabase/migrations/20260917160200_f11_group_management_repair.sql`)

```diff
@@ -221,7 +221,6 @@ begin
 
   v_hash := md5(jsonb_build_object(
     'groupId',p_group_id,
-    'appointmentId',p_appointment_id,
     'expectedVersion',p_expected_version,
     'reason',v_reason
   )::text);
```

## A13 · A · D1_ONLY · aile: request_hash_field [receipt_hash_replay] · fonksiyon yeniden kullanıldı

Tekrar özeti yeni başlangıç zamanını içermiyor; aynı anahtarla farklı zamana taşıma isteği, öncekinin tekrarı sayılır.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":false,"added":1,"removed":2,"changed":3,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.reschedule_appointment` (`supabase/migrations/20260911120000_phase5_booking_core.sql`)

```diff
@@ -598,8 +598,7 @@ begin
 
   v_hash := md5(jsonb_build_object(
     'appointmentId', p_appointment_id,
-    'staffId', p_staff_id,
-    'startsAt', p_starts_at
+    'staffId', p_staff_id
   )::text);
 
   select * into v_claim
```

## A14 · A · D1_ONLY · aile: request_hash_field [receipt_hash_replay] · fonksiyon yeniden kullanıldı

Tekrar özeti grup satırlarını içermiyor; aynı anahtarla farklı hizmet satırlarıyla gelen istek, öncekinin tekrarı sayılır.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":false,"added":0,"removed":1,"changed":1,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.create_appointment_group` (`supabase/migrations/20260917120000_f11_multi_service_group_booking.sql`)

```diff
@@ -530,7 +530,6 @@ begin
     'customerName', v_customer_name,
     'customerPhone', v_customer_phone,
     'customerEmail', v_customer_email,
-    'lines', p_lines,
     'startsAt', p_starts_at,
     'notes', v_notes
   )::text);
```

## A15 · A · D1_ONLY · aile: retry_conflict [receipt_hash_replay]

Kurtarma kaydı eklemesi çakışmada artık hiçbir şey yapmıyor değil; yanıtı kaybolan istemcinin aynı anahtarla meşru tekrarı benzersizlik hatası üzerinden "idempotency çakışması" alır (tekrar semantiği).

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":0,"removed":1,"changed":1,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.create_public_appointment_with_recovery` (`supabase/migrations/20260911160000_phase9_booking_recovery.sql`)

```diff
@@ -124,7 +124,6 @@ begin
       p_management_token_ciphertext, p_management_token_iv, p_key_version,
       now() + interval '72 hours'
     )
-    on conflict (business_id, idempotency_key) do nothing;
   exception when unique_violation then
     -- A recovery UUID already belongs to a different booking intent.
     raise exception 'IDEMPOTENCY_CONFLICT';
```

## A16 · A · D1_ONLY · aile: noop_repeat · fonksiyon yeniden kullanıldı

Aynı duruma ikinci geçiş artık etkisiz sayılmıyor: tekrar "onayla" yeni bir olay yazar, tekrar "iptal/tamamla" geçersiz geçiş hatası verir (tekrarlanan komutun işlenişi).

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":0,"removed":1,"changed":1,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

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

## A17 · A · D1_ONLY · aile: provider_idempotency_key

Sağlayıcı tekilleştirme anahtarı olay başına değil randevu başına üretiliyor; yeniden planlama sonrası yeni onay bildirimi sağlayıcı tarafında önceki gönderimin tekrarı sayılıp bastırılır.

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":true,"added":1,"removed":1,"changed":2,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

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

## A18 · A · D1_ONLY · aile: relink_replay · fonksiyon yeniden kullanıldı

Aynı dış kimliğin aynı kullanıcıya yeniden bağlanması artık "zaten bağlı" diye başarılı dönmüyor, çakışma hatası veriyor (tekrar semantiği). Kilit aynı.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":false,"added":1,"removed":9,"changed":10,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `core.command_link_identity_alias` (`supabase/migrations/20260916190000_kc01_core_platform_schema.sql`)

```diff
@@ -453,15 +453,7 @@ begin
   where a.provider = v_provider and a.external_subject = v_subject;
 
   if found then
-    if v_existing.user_id <> v_user_id then
-      raise exception 'IDENTITY_ALIAS_CONFLICT';
-    end if;
-    return jsonb_build_object(
-      'user_id', v_existing.user_id,
-      'provider', v_existing.provider,
-      'external_subject', v_existing.external_subject,
-      'linked', false
-    );
+    raise exception 'IDENTITY_ALIAS_CONFLICT';
   end if;
 
   if exists (
```

## A19 · A · D1_ONLY · aile: claim_atomicity · fonksiyon yeniden kullanıldı

Tekrar talebi, komut etkileriyle birlikte geri alınan alt işlemin dışına alındı: komut hata verirse talep sonuçsuz kalır ve aynı anahtarla her tekrar "sürüyor" hatası alır (hep-ya-hiç tekrar semantiği).

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":true,"added":6,"removed":5,"changed":11,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.core_apply_platform_command` (`supabase/migrations/20260916190000_kc01_core_platform_schema.sql`)

```diff
@@ -921,12 +921,13 @@ begin
 
   v_request_hash := core.hash_secret(p_command || E'\n' || p_payload::text);
 
+  -- Idempotency claim. Concurrent callers with the same key serialize on the PK.
+  insert into core.platform_commands (principal_id, idempotency_key, command, request_hash)
+  values (v_principal_id, p_idempotency_key, p_command, v_request_hash)
+  on conflict (principal_id, idempotency_key) do nothing;
+  get diagnostics v_inserted = row_count;
+
   begin
-    -- Idempotency claim. Concurrent callers with the same key serialize on the PK.
-    insert into core.platform_commands (principal_id, idempotency_key, command, request_hash)
-    values (v_principal_id, p_idempotency_key, p_command, v_request_hash)
-    on conflict (principal_id, idempotency_key) do nothing;
-    get diagnostics v_inserted = row_count;
 
     if v_inserted = 0 then
       select * into v_existing
```

## A20 · A · D1_ONLY · aile: result_binding [receipt_hash_replay] · fonksiyon yeniden kullanıldı

Kurtarma kaydına önceden bağlanmış randevu ile bu çağrının döndürdüğü randevunun aynı olması artık denetlenmiyor; tekrar, farklı bir randevu sonucuyla eşleşebilir.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":0,"removed":5,"changed":5,"removed_where_and":1,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `public.create_public_appointment_with_recovery` (`supabase/migrations/20260911160000_phase9_booking_recovery.sql`)

```diff
@@ -160,11 +160,6 @@ begin
     raise exception 'IDEMPOTENCY_RESULT_MISSING';
   end if;
 
-  if v_bootstrap.appointment_id is not null
-     and v_bootstrap.appointment_id <> v_created.appointment_id then
-    raise exception 'IDEMPOTENCY_CONFLICT';
-  end if;
-
   -- Management capability is born inside the same outer transaction as the
   -- appointment. A failure here rolls back a newly-created appointment.
   begin
```

## B01 · B · D5_ONLY · weakens · aile: lock_removal · fonksiyon yeniden kullanıldı

Fiş ve kaynak ödeme satırı kilitleri kaldırıldı; aynı kaynak ödemeye eşzamanlı iki iade aynı kalan tutarı görüp birlikte geçer.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":2,"removed":4,"changed":6,"removed_where_and":2,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `public.record_ticket_refund_guarded` (`supabase/migrations/20260922144500_f14_payment_ledger.sql`)

```diff
@@ -611,8 +611,7 @@ begin
   select * into v_ticket
   from public.tickets t
   where t.business_id = p_business_id
-    and t.id = p_ticket_id
-  for update;
+    and t.id = p_ticket_id;
   if v_ticket.id is null then raise exception 'TICKET_NOT_FOUND'; end if;
 
   select * into v_source
@@ -620,8 +619,7 @@ begin
   where e.business_id = p_business_id
     and e.ticket_id = p_ticket_id
     and e.id = p_source_payment_event_id
-    and e.event_type = 'payment'
-  for update;
+    and e.event_type = 'payment';
   if v_source.id is null then raise exception 'SOURCE_PAYMENT_NOT_FOUND'; end if;
 
   v_source_net := public.f14_source_payment_net(
```

## B02 · B · D5_ONLY · weakens · aile: lock_downgrade · fonksiyon yeniden kullanıldı

Fiş ve fiş satırı kilitleri FOR UPDATE yerine FOR KEY SHARE oldu; aynı fişe eşzamanlı iki indirim birlikte kilit alır, ikisi de toplam/ödenen kontrolünü eski toplamla geçer.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":2,"removed":2,"changed":4,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

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

## B03 · B · D5_ONLY · weakens · aile: stale_check_relaxed · fonksiyon yeniden kullanıldı

Fiş satırı kilidi FOR KEY SHARE'e indi ve bayat yazma kontrolü yalnız istemci sürümü ilerideyse reddediyor; aynı fişe eşzamanlı ya da bayat görünümle gelen kesinleştirmeler birlikte geçer.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":2,"removed":2,"changed":4,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.finalize_ticket_service_price_guarded` (`supabase/migrations/20260922111500_f14_ticket_model.sql`)

```diff
@@ -812,10 +812,10 @@ begin
   select * into v_ticket
   from public.tickets t
   where t.business_id = p_business_id and t.id = p_ticket_id
-  for update;
+  for key share of t;
   if v_ticket.id is null then raise exception 'TICKET_NOT_FOUND'; end if;
   if v_ticket.status <> 'open' then raise exception 'TICKET_NOT_OPEN'; end if;
-  if p_expected_version is null or v_ticket.version <> p_expected_version then
+  if p_expected_version is null or v_ticket.version < p_expected_version then
     raise exception 'STALE_WRITE';
   end if;
 
```

## B04 · B · D5_ONLY · weakens · aile: lock_downgrade · fonksiyon yeniden kullanıldı

Randevu satırı kilidi FOR UPDATE yerine FOR KEY SHARE oldu; eşzamanlı iki durum geçişi birlikte kilit alır, ikisi de eski durumu görüp geçer.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":1,"changed":2,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.set_appointment_status` (`supabase/migrations/20260911120000_phase5_booking_core.sql`)

```diff
@@ -718,7 +718,7 @@ begin
   select * into v_current
   from public.appointments
   where business_id = p_business_id and id = p_appointment_id
-  for update;
+  for key share of appointments;
 
   if v_current.id is null then raise exception 'APPOINTMENT_NOT_FOUND'; end if;
   if v_current.status = p_status then return v_current; end if;
```

## B05 · B · D5_ONLY · weakens · aile: lock_removal

İşletme ve abonelik kilitleri kaldırıldı; eşzamanlı plan değişikliği, yetki listesini bu yazımdan habersiz hesaplayıp onu ezebilir.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":0,"removed":3,"changed":3,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `core.command_set_entitlement` (`supabase/migrations/20260916190000_kc01_core_platform_schema.sql`)

```diff
@@ -846,9 +846,6 @@ begin
     raise exception 'INVALID_ENTITLEMENT_VALIDITY';
   end;
 
-  perform core.lock_business(v_business_id);
-  perform 1 from core.subscriptions s where s.business_id = v_business_id for update;
-
   insert into core.subscription_events (
     business_id, event_type, payload, principal_id, idempotency_key
   ) values (
```

## B06 · B · D5_ONLY · weakens · aile: lock_removal · fonksiyon yeniden kullanıldı

İşletme kilidi ve abonelik satırı kilidi kaldırıldı; eşzamanlı iki plan değişikliği aynı aboneliği okuyup birbirinin yetki değişikliklerini ezer, ilk abonelikte ikisi birden eklemeye çalışır.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":2,"changed":3,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `core.command_change_subscription` (`supabase/migrations/20260916190000_kc01_core_platform_schema.sql`)

```diff
@@ -749,9 +749,8 @@ begin
   end if;
 
   -- K04 §17 lock order: business advisory lock -> subscriptions row -> event -> entitlements.
-  perform core.lock_business(v_business_id);
   select * into v_subscription
-  from core.subscriptions s where s.business_id = v_business_id for update;
+  from core.subscriptions s where s.business_id = v_business_id;
   v_exists := found;
 
   if v_grant is not null then
```

## B07 · B · D5_ONLY · weakens · aile: lock_order_removed · fonksiyon yeniden kullanıldı

Blok ve atama ad alanlarının advisory kilitleri personel satırı kilitlerinden önce alınmıyor; bu kilitler artık yalnız işlem sonundaki doğrulamada alınır ve korumalı blok/atama yazımlarıyla satır/advisory kilit terslenmesi (kilitlenme) geri gelir.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":0,"removed":6,"changed":6,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.f11_create_group_internal` (`supabase/migrations/20260918070000_f11_lock_order_final_repair.sql`)

```diff
@@ -142,12 +142,6 @@ begin
     ));
   end loop;
 
-  perform pg_advisory_xact_lock(hashtextextended(
-    'f10-04:availability-blocks:'||p_business_id::text,0
-  ));
-  perform pg_advisory_xact_lock(hashtextextended(
-    'f10-04:assignments:'||p_business_id::text,0
-  ));
 
   for v_authority_staff_day in
     select distinct
```

## B08 · B · D5_ONLY · weakens · aile: lock_removal

Tetikleyicideki işletme satırı kilidi kaldırıldı; iletişim bilgisini kaldıran yazım, eşzamanlı rezervasyon açma kararıyla serileşmez.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":0,"removed":3,"changed":3,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

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

## B09 · B · D5_ONLY · weakens · aile: version_check_removed · fonksiyon yeniden kullanıldı

Beklenen grup sürümü artık hiç karşılaştırılmıyor (ön kontrol ve güncellemedeki sürüm koşulu kaldırıldı); eski görünümle gelen iptal, arada değişmiş grubu iptal eder.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":0,"removed":4,"changed":4,"removed_where_and":1,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `public.f11_cancel_group_core` (`supabase/migrations/20260917160200_f11_group_management_repair.sql`)

```diff
@@ -82,9 +82,6 @@ begin
     return public.f11_group_management_payload(p_business_id,p_group_id);
   end if;
 
-  if v_group.version <> p_expected_version then
-    raise exception 'BOOKING_GROUP_VERSION_CONFLICT';
-  end if;
   if exists (
     select 1 from public.appointments a
     where a.business_id=p_business_id and a.group_id=p_group_id
@@ -130,7 +127,6 @@ begin
       version=g.version+1,
       updated_at=now()
   where g.business_id=p_business_id and g.id=p_group_id
-    and g.version=p_expected_version
   returning g.version into v_new_version;
   if v_new_version is null then raise exception 'BOOKING_GROUP_VERSION_CONFLICT'; end if;
 
```

## B10 · B · D5_ONLY · weakens · aile: lock_removal · fonksiyon yeniden kullanıldı

Kiralanan iş satırı kilitsiz okunuyor; okuma ile id üzerinden güncelleme arasında süresi dolan kiralama başka işçiye geçerse, bu bırakma yeni kiralamayı ezer.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":2,"changed":3,"removed_where_and":1,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `public.release_notification_job_v2` (`supabase/migrations/20260912123000_s03_notification_consistency.sql`)

```diff
@@ -775,8 +775,7 @@ begin
   from public.appointment_notification_jobs j
   where j.id = p_job_id
     and j.state = 'leased'
-    and j.lease_token = p_lease_token
-  for update;
+    and j.lease_token = p_lease_token;
 
   if v_job.id is null then raise exception 'NOTIFICATION_LEASE_LOST'; end if;
 
```

## B11 · B · D5_ONLY · strengthens · aile: lock_added · fonksiyon yeniden kullanıldı

Blok ad alanında işletme anahtarlı advisory kilit eklendi; blok ekleme, aynı kilidi alan grup randevusu doğrulamasıyla serileşir.

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":true,"added":1,"removed":0,"changed":1,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.create_availability_block_local` (`supabase/migrations/20260911110000_phase4_availability.sql`)

```diff
@@ -307,6 +307,7 @@ begin
     raise exception 'BUSINESS_NOT_FOUND';
   end if;
 
+  perform pg_advisory_xact_lock(hashtextextended('f10-04:availability-blocks:' || p_business_id::text, 0));
   v_end_date := case when p_end_local <= p_start_local then p_date + 1 else p_date end;
   v_start_at := (p_date + p_start_local) at time zone v_timezone;
   v_end_at := (v_end_date + p_end_local) at time zone v_timezone;
```

## B12 · B · D5_ONLY · strengthens · aile: lock_added

Personel satırı kilitlerinden önce blok ve atama ad alanlarının advisory kilitleri alınıyor; grup oluşturma eşzamanlı blok ve atama yazımlarıyla serileşir.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":2,"removed":0,"changed":2,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.f11_create_group_internal` (`supabase/migrations/20260917150000_f11_business_hours_final_repair.sql`)

```diff
@@ -328,6 +328,8 @@ begin
     null, v_actor, true
   );
 
+  perform pg_advisory_xact_lock(hashtextextended('f10-04:availability-blocks:'||p_business_id::text,0));
+  perform pg_advisory_xact_lock(hashtextextended('f10-04:assignments:'||p_business_id::text,0));
   perform 1
   from public.staff_profiles sp
   where sp.business_id = p_business_id
```

## B13 · B · D5_ONLY · strengthens · aile: share_fence

Envanter aktörünün üyelik okumasına paylaşımlı satır kilidi eklendi; eşzamanlı üyelik pasifleştirme bu işlem bitene kadar bekler.

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":false,"added":1,"removed":1,"changed":2,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.f15_inventory_actor` (`supabase/migrations/20260923051000_f15_product_stock_ledger.sql`)

```diff
@@ -257,7 +257,7 @@ begin
   where m.business_id = p_business_id
     and m.user_id = auth.uid()
     and m.active
-  limit 1;
+  limit 1 for share of m;
 
   if v_actor.id is null then
     raise exception 'NOT_ALLOWED' using errcode = '42501';
```

## B14 · B · D5_ONLY · strengthens · aile: share_fence

Gider aktörünün üyelik okumasına paylaşımlı satır kilidi eklendi; eşzamanlı üyelik pasifleştirme bu işlem bitene kadar bekler.

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":false,"added":1,"removed":1,"changed":2,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.f15_expense_actor` (`supabase/migrations/20260923074000_f15_expense_ledger.sql`)

```diff
@@ -148,7 +148,7 @@ begin
   where m.business_id=p_business_id
     and m.user_id=auth.uid()
     and m.active
-  limit 1;
+  limit 1 for share;
 
   if v_actor.id is null then
     raise exception 'NOT_ALLOWED' using errcode='42501';
```

## B15 · B · D5_ONLY · strengthens · aile: lock_added · fonksiyon yeniden kullanıldı

Personel okumasına paylaşımlı satır kilidi ve işletme + personel anahtarlı advisory kilit eklendi; aynı personele eşzamanlı yeniden planlamalar ve personel düzenlemeleri uygunluk kontrolü ile güncelleme arasında serileşir.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":3,"removed":1,"changed":4,"removed_where_and":1,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `public.reschedule_appointment` (`supabase/migrations/20260911121000_phase5_booking_hardening.sql`)

```diff
@@ -371,8 +371,10 @@ begin
    and ss.staff_id = sp.id
    and ss.service_id = v_current.service_id
    and ss.active
-  where sp.business_id = p_business_id and sp.id = p_staff_id and sp.active;
+  where sp.business_id = p_business_id and sp.id = p_staff_id and sp.active
+  for share of sp;
   if v_staff.id is null then raise exception 'STAFF_NOT_ELIGIBLE'; end if;
+  perform pg_advisory_xact_lock(hashtextextended('staff-slot:' || p_business_id::text || ':' || p_staff_id::text, 0));
 
   select b.timezone into v_timezone
   from public.businesses b
```

## B16 · B · D5_ONLY · strengthens · aile: lock_mode_order

Hizmet ve personel satırları FOR UPDATE yerine FOR NO KEY UPDATE ile kilitleniyor; başka rezervasyonun tuttuğu yabancı anahtar paylaşımlı kilitleriyle satır/advisory kilit terslenmesi (kilitlenme) ortadan kalkar.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":2,"removed":2,"changed":4,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

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

## B17 · B · D5_ONLY · strengthens · aile: lock_mode_order

Katılan personel satırları FOR UPDATE yerine FOR KEY SHARE ile kilitleniyor; korumalı personel saati yazımlarıyla satır/advisory kilit terslenmesi (kilitlenme) ortadan kalkar.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":1,"changed":2,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

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

## B18 · B · D5_ONLY · strengthens · aile: share_fence · fonksiyon yeniden kullanıldı

Personel-hizmet ataması okumasına paylaşımlı satır kilidi eklendi; eşzamanlı atama kaldırma bu randevu oluşturmayla serileşir.

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":false,"added":2,"removed":1,"changed":3,"removed_where_and":1,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `public.create_appointment` (`supabase/migrations/20260911120000_phase5_booking_core.sql`)

```diff
@@ -467,7 +467,8 @@ begin
    and ss.staff_id = sp.id
    and ss.service_id = p_service_id
    and ss.active
-  where sp.business_id = p_business_id and sp.id = p_staff_id and sp.active;
+  where sp.business_id = p_business_id and sp.id = p_staff_id and sp.active
+  for share of ss;
   if v_staff.id is null then raise exception 'STAFF_NOT_ELIGIBLE'; end if;
 
   select timezone into v_timezone
```

## B19 · B · D5_ONLY · strengthens · aile: lock_added

Personel satırı kilitlerinden önce atama ad alanı advisory kilidi alınıyor; grup oluşturma eşzamanlı personel-hizmet ataması yazımlarıyla serileşir.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":0,"changed":1,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.f11_create_group_internal` (`supabase/migrations/20260917133000_f11_multi_service_final_repair.sql`)

```diff
@@ -785,6 +785,7 @@ begin
     null, v_actor, true
   );
 
+  perform pg_advisory_xact_lock(hashtextextended('f10-04:assignments:'||p_business_id::text,0));
   perform 1
   from public.staff_profiles sp
   where sp.business_id = p_business_id
```

## B20 · B · D5_ONLY · strengthens · aile: lock_added · fonksiyon yeniden kullanıldı

Personel satırı kilitlerinden önce blok ve atama ad alanlarının advisory kilitleri alınıyor; grup oluşturma bu yazımlarla serileşir.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":3,"removed":0,"changed":3,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.create_appointment_group` (`supabase/migrations/20260917120000_f11_multi_service_group_booking.sql`)

```diff
@@ -558,6 +558,9 @@ begin
     p_business_id, v_customer_name, v_customer_phone, v_customer_email, null, auth.uid(), true
   );
 
+  perform pg_advisory_xact_lock(hashtextextended('f10-04:availability-blocks:' || p_business_id::text, 0));
+  perform pg_advisory_xact_lock(hashtextextended('f10-04:assignments:' || p_business_id::text, 0));
+
   -- Multi-staff locks are taken in a stable ascending staff order so two
   -- concurrent groups over the same staff set serialize instead of deadlocking.
   perform 1
```

## C01 · C · BOTH · weakens · aile: compound · fonksiyon yeniden kullanıldı

D5: fiş satırı kilidi FOR KEY SHARE'e indi (aynı fişe eşzamanlı iki satır ekleme aynı sürümü ve sıra numarasını görür). D1: kayıtlı makbuz sonucu döndürülmüyor; tekrar eden istek komutu yeniden çalıştırır.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":2,"changed":3,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.add_ticket_service_line_guarded` (`supabase/migrations/20260922111500_f14_ticket_model.sql`)

```diff
@@ -688,12 +688,11 @@ begin
     p_business_id, v_actor.id, 'add_service_line',
     p_idempotency_key, p_request_hash
   );
-  if v_replay is not null then return v_replay; end if;
 
   select * into v_ticket
   from public.tickets t
   where t.business_id = p_business_id and t.id = p_ticket_id
-  for update;
+  for key share of t;
 
   if v_ticket.id is null then raise exception 'TICKET_NOT_FOUND'; end if;
   if v_ticket.status <> 'open' then raise exception 'TICKET_NOT_OPEN'; end if;
```

## C02 · C · BOTH · weakens · aile: probe_lock_removed · fonksiyon yeniden kullanıldı

Sarmalayıcıdaki grup advisory kilidi kaldırıldı: "komut zaten var mı" yoklaması çekirdekle serileşmez (D5); aynı anahtarla eşzamanlı iki istek komutu yok görür ve ikisi de yeniden planlama bildirimi üretir (D1).

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":0,"removed":3,"changed":3,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.reschedule_public_managed_group` (`supabase/migrations/20260917160100_f11_public_group_management.sql`)

```diff
@@ -199,9 +199,6 @@ begin
 
   -- Serialize the wrapper with the core so only the transaction that creates
   -- the command emits the one frozen reschedule notification.
-  perform pg_advisory_xact_lock(hashtextextended(
-    'f11:group-management:'||v_ref.business_id::text||':'||v_ref.group_id::text,0
-  ));
   v_hash := md5(jsonb_build_object(
     'groupId',v_ref.group_id,
     'expectedVersion',p_expected_version,
```

## C03 · C · BOTH · weakens · aile: compound · fonksiyon yeniden kullanıldı

D5: kaynak gider satırı kilidi FOR KEY SHARE'e indi (eşzamanlı iki düzeltme "zaten ters kaydedilmiş" kontrolünü birlikte geçer). D1: kayıtlı makbuz sonucu döndürülmüyor; tekrar eden düzeltme kayıtlı sonucu değil hata alır.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":2,"changed":3,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.correct_expense_guarded` (`supabase/migrations/20260923074000_f15_expense_ledger.sql`)

```diff
@@ -498,7 +498,6 @@ begin
   v_replay:=public.f15_claim_expense_command(
     p_business_id,v_actor.id,'correct_expense',p_idempotency_key,p_request_hash
   );
-  if v_replay is not null then return v_replay; end if;
 
   if char_length(v_reason) not between 2 and 240 then raise exception 'INVALID_EXPENSE_REASON'; end if;
   if char_length(v_category) not between 1 and 80 then raise exception 'INVALID_EXPENSE_CATEGORY'; end if;
@@ -518,7 +517,7 @@ begin
   where e.business_id=p_business_id
     and e.id=p_source_event_id
     and e.event_type='expense'
-  for update;
+  for key share of e;
 
   if v_source.id is null then raise exception 'EXPENSE_NOT_FOUND'; end if;
   if exists (
```

## C04 · C · BOTH · weakens · aile: command_key_lock · fonksiyon yeniden kullanıldı

İstek anahtarı advisory kilidi kaldırıldı: henüz satırı olmayan yeni bir anahtarla eşzamanlı iki istek tekrar yoklamasını kilitsiz geçer (D5); ikincisi tekrar olarak dönmeden önce dondurulmuş sonuç yerine güncel katalog doğrulamasından geçer (D1).

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":0,"removed":3,"changed":3,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

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

## C05 · C · BOTH · weakens · aile: command_key_lock · fonksiyon yeniden kullanıldı

Kurtarma kimliği advisory kilidi kaldırıldı: yanıtı kaybolan istemcinin kurtarma sorgusu, sürmekte olan oluşturmayı beklemez (D5) ve geçici "yok" sonucu görüp isteği yeniden dener (D1: yanıt kaybı tekrarı).

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":0,"removed":1,"changed":1,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.create_public_appointment_with_recovery` (`supabase/migrations/20260911160000_phase9_booking_recovery.sql`)

```diff
@@ -99,7 +99,6 @@ begin
   -- A recovery request using the same ID waits for this transaction to resolve.
   -- This prevents a response-loss retry from observing a transient "not found"
   -- while the original booking is still committing.
-  perform pg_advisory_xact_lock(hashtextextended(p_recovery_id::text, 0));
 
   select b.id into v_business_id
   from public.businesses b
```

## C06 · C · BOTH · weakens · aile: compound · fonksiyon yeniden kullanıldı

D5: fiş satırı kilidi kaldırıldı (kapatma, bakiyeyi değiştiren eşzamanlı ödeme/iadeyle serileşmez; bakiyesi sıfır olmayan fiş kapanabilir). D1: kayıtlı makbuz sonucu döndürülmüyor; tekrar eden kapatma "fiş açık değil" hatası alır.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":3,"changed":4,"removed_where_and":1,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `public.close_ticket_guarded` (`supabase/migrations/20260922111500_f14_ticket_model.sql`)

```diff
@@ -952,12 +952,10 @@ begin
     p_business_id, v_actor.id, 'close_ticket',
     p_idempotency_key, p_request_hash
   );
-  if v_replay is not null then return v_replay; end if;
 
   select * into v_ticket
   from public.tickets t
-  where t.business_id = p_business_id and t.id = p_ticket_id
-  for update;
+  where t.business_id = p_business_id and t.id = p_ticket_id;
   if v_ticket.id is null then raise exception 'TICKET_NOT_FOUND'; end if;
   if v_ticket.status <> 'open' then raise exception 'TICKET_NOT_OPEN'; end if;
   if p_expected_version is null or v_ticket.version <> p_expected_version then
```

## C07 · C · BOTH · weakens · aile: compound · fonksiyon yeniden kullanıldı

D5: kaynak gider satırı kilidi FOR SHARE'e indi (eşzamanlı iki ters kayıt "zaten ters kaydedilmiş" kontrolünü birlikte geçer). D1: kayıtlı makbuz sonucu döndürülmüyor; tekrar eden ters kayıt kayıtlı sonucu değil hata alır.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":2,"changed":3,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.reverse_expense_guarded` (`supabase/migrations/20260923074000_f15_expense_ledger.sql`)

```diff
@@ -415,7 +415,6 @@ begin
   v_replay:=public.f15_claim_expense_command(
     p_business_id,v_actor.id,'reverse_expense',p_idempotency_key,p_request_hash
   );
-  if v_replay is not null then return v_replay; end if;
 
   if char_length(v_reason) not between 2 and 240 then raise exception 'INVALID_EXPENSE_REASON'; end if;
   if p_occurred_local is null then raise exception 'INVALID_EXPENSE_TIME'; end if;
@@ -429,7 +428,7 @@ begin
   where e.business_id=p_business_id
     and e.id=p_source_event_id
     and e.event_type='expense'
-  for update;
+  for share of e;
 
   if v_source.id is null then raise exception 'EXPENSE_NOT_FOUND'; end if;
   if exists (
```

## C08 · C · BOTH · weakens · aile: compound · fonksiyon yeniden kullanıldı

D5: bayat yazma kontrolü yalnız istemci sürümü ilerideyse reddediyor (geride kalan sürümle güncelleme geçer). D1: kayıtlı makbuz sonucu döndürülmüyor; tekrar eden güncelleme komutu yeniden çalıştırır.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":2,"changed":3,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.update_product_guarded` (`supabase/migrations/20260923051000_f15_product_stock_ledger.sql`)

```diff
@@ -649,7 +649,6 @@ begin
   v_replay := public.f15_claim_product_command(
     p_business_id, v_actor.id, 'update_product', p_idempotency_key, p_request_hash
   );
-  if v_replay is not null then return v_replay; end if;
 
   select * into v_product
   from public.products p
@@ -658,7 +657,7 @@ begin
 
   if v_product.id is null then raise exception 'PRODUCT_NOT_FOUND'; end if;
   if not v_product.active then raise exception 'PRODUCT_ARCHIVED'; end if;
-  if p_expected_version is null or v_product.version <> p_expected_version then raise exception 'STALE_WRITE'; end if;
+  if p_expected_version is null or v_product.version < p_expected_version then raise exception 'STALE_WRITE'; end if;
 
   if char_length(v_name) not between 1 and 120 then raise exception 'INVALID_PRODUCT_NAME'; end if;
   if v_code is not null and (char_length(v_code) not between 1 and 64 or v_code !~ '^[A-Z0-9][A-Z0-9._-]*$') then
```

## C09 · C · BOTH · weakens · aile: compound · fonksiyon yeniden kullanıldı

D5: fiş satırı kilidi FOR SHARE'e indi (farklı kaynak ödemelere eşzamanlı iki artırma düzeltmesi toplam kontrolünü birlikte geçer). D1: kayıtlı makbuz sonucu döndürülmüyor; tekrar eden düzeltme ikinci kez kaydedilir.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":2,"changed":3,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.record_ticket_correction_guarded` (`supabase/migrations/20260922144500_f14_payment_ledger.sql`)

```diff
@@ -509,7 +509,6 @@ begin
     p_business_id, v_actor.id, 'record_correction',
     p_idempotency_key, p_request_hash
   );
-  if v_replay is not null then return v_replay; end if;
 
   v_reason := nullif(btrim(coalesce(p_reason, '')), '');
   if p_direction not in ('increase','decrease')
@@ -524,7 +523,7 @@ begin
   from public.tickets t
   where t.business_id = p_business_id
     and t.id = p_ticket_id
-  for update;
+  for share of t;
   if v_ticket.id is null then raise exception 'TICKET_NOT_FOUND'; end if;
 
   select * into v_source
```

## C10 · C · BOTH · weakens · aile: compound · fonksiyon yeniden kullanıldı

D5: bayat yazma kontrolü yalnız istemci sürümü ilerideyse reddediyor (geride kalan sürümle iptal geçer). D1: kayıtlı makbuz sonucu döndürülmüyor; tekrar eden iptal "fiş açık değil" hatası alır.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":2,"changed":3,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.cancel_ticket_guarded` (`supabase/migrations/20260922111500_f14_ticket_model.sql`)

```diff
@@ -1015,7 +1015,6 @@ begin
     p_business_id, v_actor.id, 'cancel_ticket',
     p_idempotency_key, p_request_hash
   );
-  if v_replay is not null then return v_replay; end if;
 
   v_reason := nullif(btrim(coalesce(p_reason, '')), '');
   if v_reason is null or char_length(v_reason) > 240 then
@@ -1028,7 +1027,7 @@ begin
   for update;
   if v_ticket.id is null then raise exception 'TICKET_NOT_FOUND'; end if;
   if v_ticket.status <> 'open' then raise exception 'TICKET_NOT_OPEN'; end if;
-  if p_expected_version is null or v_ticket.version <> p_expected_version then
+  if p_expected_version is null or v_ticket.version < p_expected_version then
     raise exception 'STALE_WRITE';
   end if;
 
```

## C11 · C · BOTH · weakens · aile: compound · fonksiyon yeniden kullanıldı

D5: beklenen grup sürümü artık karşılaştırılmıyor (ön kontrol ve güncelleme koşulu kaldırıldı). D1: tekrar özeti beklenen sürümü içermiyor; farklı sürüme dayanan istek öncekinin tekrarı sayılır.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":2,"removed":3,"changed":5,"removed_where_and":1,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `public.reschedule_appointment_group_line` (`supabase/migrations/20260917160500_f11_group_integration_repair.sql`)

```diff
@@ -456,7 +456,7 @@ begin
 
   v_hash := md5(jsonb_build_object(
     'groupId',p_group_id,'appointmentId',p_appointment_id,
-    'expectedVersion',p_expected_version,'staffId',p_staff_id,'startsAt',p_starts_at
+    'staffId',p_staff_id,'startsAt',p_starts_at
   )::text);
   select * into v_claim
   from public.claim_booking_command(
@@ -466,7 +466,6 @@ begin
     return public.f11_group_management_payload(p_business_id,p_group_id);
   end if;
 
-  if v_group.version<>p_expected_version then raise exception 'BOOKING_GROUP_VERSION_CONFLICT'; end if;
   if v_line.status not in ('scheduled','confirmed') then
     raise exception 'BOOKING_GROUP_LINE_NOT_RESCHEDULABLE';
   end if;
@@ -562,7 +561,7 @@ begin
 
   update public.appointment_groups g
   set version=g.version+1,updated_at=now()
-  where g.business_id=p_business_id and g.id=p_group_id and g.version=p_expected_version
+  where g.business_id=p_business_id and g.id=p_group_id
   returning g.version into v_new_version;
   if v_new_version is null then raise exception 'BOOKING_GROUP_VERSION_CONFLICT'; end if;
 
```

## C12 · C · BOTH · weakens · aile: compound · fonksiyon yeniden kullanıldı

D5: randevu satırı kilidi FOR KEY SHARE'e indi (eşzamanlı iptal ile yeniden planlama birlikte geçer). D1: tekrar özeti randevuyu içermiyor; aynı anahtarla başka randevunun taşınması öncekinin tekrarı sayılır.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":2,"changed":3,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

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

## C13 · C · BOTH · weakens · aile: replay_probe_unlocked · fonksiyon yeniden kullanıldı

Takma ad kilidi kaldırıldı: aynı takma adla eşzamanlı iki kurulum tekrar yoklamasını birlikte geçer (D5); ikisi de işletme açmaya çalışır, ikincisi mevcut işletmeye eşlenmek yerine hata alır (D1: belirlenimci tekrar).

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":true,"added":0,"removed":1,"changed":1,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

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

## C14 · C · BOTH · weakens · aile: replay_probe_unlocked · fonksiyon yeniden kullanıldı

Dış kimlik advisory kilidi kaldırıldı: aynı kimliği eşzamanlı bağlayan iki istek "zaten bağlı mı" yoklamasını birlikte geçer (D5); ikincisi "zaten bağlı" sonucu yerine benzersizlik hatası alır (D1).

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":0,"removed":2,"changed":2,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `core.command_link_identity_alias` (`supabase/migrations/20260916190000_kc01_core_platform_schema.sql`)

```diff
@@ -446,8 +446,6 @@ begin
     raise exception 'USER_NOT_FOUND';
   end if;
 
-  perform pg_advisory_xact_lock(hashtextextended('identity_alias:' || v_provider || ':' || v_subject, 0));
-
   select * into v_existing
   from core.identity_aliases a
   where a.provider = v_provider and a.external_subject = v_subject;
```

## C15 · C · BOTH · weakens · aile: compound · fonksiyon yeniden kullanıldı

D5: ürün satırı kilidi FOR KEY SHARE'e indi (farklı müşterilere eşzamanlı satışlar aynı stoku görür). D1: kayıtlı makbuz sonucu döndürülmüyor; tekrar eden istek ikinci bir satış açar.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":2,"changed":3,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.open_product_sale_guarded` (`supabase/migrations/20260923113600_f15_product_sale_atomicity.sql`)

```diff
@@ -828,7 +828,6 @@ begin
   v_replay := public.f14_claim_ticket_command(
     p_business_id,v_actor.id,'open_product_sale',p_idempotency_key,p_request_hash
   );
-  if v_replay is not null then return v_replay; end if;
   if p_quantity is null or p_quantity not between 1 and 1000 then raise exception 'INVALID_PRODUCT_QUANTITY'; end if;
 
   select * into v_customer
@@ -840,7 +839,7 @@ begin
   select * into v_product
   from public.products p
   where p.business_id=p_business_id and p.id=p_product_id
-  for update;
+  for key share of p;
   if v_product.id is null then raise exception 'PRODUCT_NOT_FOUND'; end if;
   if not v_product.active then raise exception 'PRODUCT_ARCHIVED'; end if;
   if p_expected_product_version is null or v_product.version <> p_expected_product_version then raise exception 'STALE_PRODUCT_WRITE'; end if;
```

## C16 · C · BOTH · weakens · aile: compound · fonksiyon yeniden kullanıldı

D5: ürün satırı kilidi FOR KEY SHARE'e indi (stoka dönüş, aynı ürünün eşzamanlı satışıyla kayıp güncelleme yaşar). D1: makbuza iade sonrası değil iade öncesi fiş görünümü kaydediliyor; tekrar eden istek eski sonucu alır.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":2,"removed":2,"changed":4,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.record_product_return_refund_guarded` (`supabase/migrations/20260923113600_f15_product_sale_atomicity.sql`)

```diff
@@ -956,7 +956,7 @@ begin
   select * into v_product
   from public.products p
   where p.business_id=p_business_id and p.id=v_line.product_id
-  for update;
+  for key share of p;
   if v_product.id is null then raise exception 'PRODUCT_NOT_FOUND'; end if;
 
   select * into v_sale_movement
@@ -1028,7 +1028,7 @@ begin
 
   v_result := public.f14_ticket_projection(p_business_id,p_ticket_id);
   perform public.f14_finish_ticket_command(
-    p_business_id,v_actor.id,'product_return_refund',p_idempotency_key,p_ticket_id,v_result
+    p_business_id,v_actor.id,'product_return_refund',p_idempotency_key,p_ticket_id,v_before
   );
   return v_result;
 end
```

## C17 · C · BOTH · weakens · aile: compound · fonksiyon yeniden kullanıldı

D5: fiş satırı kilidi FOR SHARE'e indi (eşzamanlı iki ödeme bakiye kontrolünü birlikte geçer). D1: kayıtlı makbuz sonucu döndürülmüyor; tekrar eden ödeme isteği ikinci bir ödeme kaydeder (bakiye yetiyorsa).

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":2,"changed":3,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.record_ticket_payment_guarded` (`supabase/migrations/20260922144500_f14_payment_ledger.sql`)

```diff
@@ -429,7 +429,6 @@ begin
     p_business_id, v_actor.id, 'record_payment',
     p_idempotency_key, p_request_hash
   );
-  if v_replay is not null then return v_replay; end if;
 
   if p_payment_method not in ('cash','card')
      or p_amount_minor is null
@@ -441,7 +440,7 @@ begin
   from public.tickets t
   where t.business_id = p_business_id
     and t.id = p_ticket_id
-  for update;
+  for share;
 
   if v_ticket.id is null then raise exception 'TICKET_NOT_FOUND'; end if;
   if v_ticket.status = 'cancelled' then raise exception 'TICKET_CANCELLED'; end if;
```

## C18 · C · BOTH · weakens · aile: compound · fonksiyon yeniden kullanıldı

D5: personel satırları FOR UPDATE yerine FOR KEY SHARE ile kilitleniyor (kilit altındaki yeniden planlama eşzamanlı personel pasifleştirmesini artık dışarıda tutmaz). D1: tekrar özeti müşteri telefonunu içermiyor; farklı telefonlu istek öncekinin tekrarı sayılır.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":2,"changed":3,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.create_appointment_group` (`supabase/migrations/20260917120000_f11_multi_service_group_booking.sql`)

```diff
@@ -528,7 +528,6 @@ begin
   -- into N per-line commands.
   v_hash := md5(jsonb_build_object(
     'customerName', v_customer_name,
-    'customerPhone', v_customer_phone,
     'customerEmail', v_customer_email,
     'lines', p_lines,
     'startsAt', p_starts_at,
@@ -568,7 +567,7 @@ begin
       from jsonb_array_elements(v_plan->'lines') l
     )
   order by sp.id
-  for update;
+  for key share;
 
   -- Replan under the locks: a slot that filled between search and commit must
   -- surface as a conflict rather than a half group.
```

## C19 · C · BOTH · weakens · aile: compound · fonksiyon yeniden kullanıldı

D5: katılan personel satırları FOR UPDATE yerine FOR KEY SHARE ile kilitleniyor (kilit altındaki yeniden planlama eşzamanlı personel pasifleştirmesini dışarıda tutmaz). D1: tekrar özeti müşteri e-postasını içermiyor; farklı e-postalı istek öncekinin tekrarı sayılır.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":2,"changed":3,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.f11_create_group_internal` (`supabase/migrations/20260917133000_f11_multi_service_final_repair.sql`)

```diff
@@ -753,7 +753,6 @@ begin
     'source', p_source,
     'customerName', v_customer_name,
     'customerPhone', v_customer_phone,
-    'customerEmail', v_customer_email,
     'lines', p_lines,
     'startsAt', p_starts_at,
     'notes', v_notes
@@ -793,7 +792,7 @@ begin
       from jsonb_array_elements(v_plan->'lines') l
     )
   order by sp.id
-  for update;
+  for key share of sp;
 
   v_plan := public.f11_plan_group_at(p_business_id, p_lines, p_starts_at, null);
   if v_plan is null then raise exception 'GROUP_SLOT_UNAVAILABLE'; end if;
```

## C20 · C · BOTH · weakens · aile: get_or_create_unlocked · fonksiyon yeniden kullanıldı

Grup anahtarlı advisory kilit kaldırıldı: aynı grup için eşzamanlı iki fiş açma "fiş var mı" yoklamasını birlikte geçer (D5); ikincisi mevcut fişi döndürmek yerine benzersizlik hatası alır (D1: "varsa getir, yoksa oluştur" tekrar semantiği).

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":0,"removed":3,"changed":3,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

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

## D01 · D · NEITHER_OR_OTHER (D0) · aile: authority_scope · fonksiyon yeniden kullanıldı

İade ödeme yetkisi yerine fiyat düzeltme yetkisi istiyor (yetki kapsamı).

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":1,"changed":2,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

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

## D02 · D · NEITHER_OR_OTHER (D0) · aile: authority_scope · fonksiyon yeniden kullanıldı

Gider ters kaydı gider yetkisi yerine envanter yetkisiyle yapılabiliyor (yetki kapsamı).

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":1,"changed":2,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.reverse_expense_guarded` (`supabase/migrations/20260923074000_f15_expense_ledger.sql`)

```diff
@@ -411,7 +411,7 @@ declare
   v_replay jsonb;
   v_result jsonb;
 begin
-  v_actor:=public.f15_expense_actor(p_business_id);
+  v_actor:=public.f15_inventory_actor(p_business_id);
   v_replay:=public.f15_claim_expense_command(
     p_business_id,v_actor.id,'reverse_expense',p_idempotency_key,p_request_hash
   );
```

## D03 · D · NEITHER_OR_OTHER (D0) · aile: authority_scope · fonksiyon yeniden kullanıldı

Ürün arşivleme envanter yetkisi yerine gider yetkisiyle yapılabiliyor (yetki kapsamı).

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":1,"changed":2,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.archive_product_guarded` (`supabase/migrations/20260923051000_f15_product_stock_ledger.sql`)

```diff
@@ -713,7 +713,7 @@ declare
   v_replay jsonb;
   v_result jsonb;
 begin
-  v_actor := public.f15_inventory_actor(p_business_id);
+  v_actor := public.f15_expense_actor(p_business_id);
   v_replay := public.f15_claim_product_command(
     p_business_id, v_actor.id, 'archive_product', p_idempotency_key, p_request_hash
   );
```

## D04 · D · NEITHER_OR_OTHER (D0) · aile: authority_scope · fonksiyon yeniden kullanıldı

Grup satırı iptali her aktif üye yerine yalnız yöneticilere açık (yetki kapsamı).

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":1,"changed":2,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.cancel_appointment_group_line` (`supabase/migrations/20260917160200_f11_group_management_repair.sql`)

```diff
@@ -188,7 +188,7 @@ declare
   v_new_version integer;
 begin
   perform public.f10_require_standard_session();
-  if auth.uid() is null or not public.is_active_member(p_business_id) then
+  if auth.uid() is null or not public.can_manage_business(p_business_id) then
     raise exception 'NOT_ALLOWED';
   end if;
   if p_expected_version is null or p_expected_version < 1 then
```

## D05 · D · NEITHER_OR_OTHER (D0) · aile: authority_scope · fonksiyon yeniden kullanıldı

Ürün satışı açmak fiyatlandırma yetkisi istemiyor, envanter yetkisi yetiyor (yetki kapsamı).

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":1,"changed":2,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.open_product_sale_guarded` (`supabase/migrations/20260923113600_f15_product_sale_atomicity.sql`)

```diff
@@ -824,7 +824,7 @@ declare
   v_result jsonb;
   v_new_balance bigint;
 begin
-  v_actor := public.f15_product_sale_actor(p_business_id);
+  v_actor := public.f15_inventory_actor(p_business_id);
   v_replay := public.f14_claim_ticket_command(
     p_business_id,v_actor.id,'open_product_sale',p_idempotency_key,p_request_hash
   );
```

## D06 · D · NEITHER_OR_OTHER (D2) · aile: history · fonksiyon yeniden kullanıldı

Hizmet değişikliği olayı eski ve yeni hizmet adlarını kaydetmiyor (geçmiş kaydı).

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":2,"changed":3,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.change_appointment_group_line_service` (`supabase/migrations/20260917160500_f11_group_integration_repair.sql`)

```diff
@@ -378,8 +378,7 @@ begin
     p_business_id,p_appointment_id,'service_changed',auth.uid(),'member',v_line.status,v_line.status,
     jsonb_build_object(
       'groupId',p_group_id,'groupVersion',v_new_version,'lineOrdinal',v_line.line_ordinal,
-      'scope','line','oldServiceId',v_line.service_id,'newServiceId',p_service_id,
-      'oldServiceName',v_line.service_name_snapshot,'newServiceName',v_service.service_name
+      'scope','line','oldServiceId',v_line.service_id,'newServiceId',p_service_id
     )
   );
 
```

## D07 · D · NEITHER_OR_OTHER (D2) · aile: history · fonksiyon yeniden kullanıldı

Satır iptali olayı, iptalin hangi grup sürümünde gerçekleştiğini kaydetmiyor (geçmiş kaydı).

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":0,"removed":1,"changed":1,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.cancel_appointment_group_line` (`supabase/migrations/20260917160200_f11_group_management_repair.sql`)

```diff
@@ -264,7 +264,6 @@ begin
     v_line.status,'cancelled',
     jsonb_build_object(
       'groupId',p_group_id,
-      'groupVersion',v_new_version,
       'lineOrdinal',v_line.line_ordinal,
       'reason',v_reason,
       'scope','line'
```

## D08 · D · NEITHER_OR_OTHER (D2) · aile: snapshot · fonksiyon yeniden kullanıldı

Hizmet değişince satırın en yüksek fiyat anlık görüntüsü güncellenmiyor; aralıklı fiyatta eski hizmetin üst sınırı kalır.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":0,"removed":1,"changed":1,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.change_appointment_group_line_service` (`supabase/migrations/20260917160500_f11_group_integration_repair.sql`)

```diff
@@ -357,7 +357,6 @@ begin
       service_name_snapshot=v_service.service_name,
       price_type_snapshot=v_service.price_type,
       price_min_minor_snapshot=v_service.price_min_minor,
-      price_max_minor_snapshot=v_service.price_max_minor,
       price_minor_snapshot=case when v_service.price_type='fixed' then v_service.price_minor else null end,
       price_policy_version_snapshot=v_service.price_policy_version,
       currency_snapshot=v_service.currency,
```

## D09 · D · NEITHER_OR_OTHER (D2) · aile: history · fonksiyon yeniden kullanıldı

Abonelik olayı uygulanan yetki değişikliklerinin listesini kaydetmiyor (olay geçmişi değişikliği tarif etmez).

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":2,"changed":3,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `core.command_change_subscription` (`supabase/migrations/20260916190000_kc01_core_platform_schema.sql`)

```diff
@@ -768,8 +768,7 @@ begin
       'status', v_status,
       'current_period_start', v_period_start,
       'current_period_end', v_period_end,
-      'source', coalesce(p_payload->'source', 'null'::jsonb),
-      'entitlements', coalesce(v_changes, 'null'::jsonb)
+      'source', coalesce(p_payload->'source', 'null'::jsonb)
     ),
     p_principal_id,
     p_idempotency_key,
```

## D10 · D · NEITHER_OR_OTHER (D2) · aile: snapshot · fonksiyon yeniden kullanıldı

Satış satırı en yüksek fiyat anlık görüntüsünü yakalamıyor.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":1,"changed":2,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

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

## D11 · D · NEITHER_OR_OTHER (D3) · aile: availability · fonksiyon yeniden kullanıldı

Personel uygunluk denetiminde pasif bloklar da müsaitliği engelliyor (blok etkinlik koşulu kaldırıldı).

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":1,"changed":2,"removed_where_and":1,"added_exists_select":0,"removed_predicate":1}`

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

## D12 · D · NEITHER_OR_OTHER (D3) · aile: availability · fonksiyon yeniden kullanıldı

İşletme geneli blok denetiminde pasif bloklar da müşteri aralığını engelliyor (blok etkinlik koşulu kaldırıldı).

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":1,"changed":2,"removed_where_and":1,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `public.f11_validate_native_group_schedule_authority` (`supabase/migrations/20260918070000_f11_lock_order_final_repair.sql`)

```diff
@@ -421,7 +421,7 @@ begin
         )
         or exists (
           select 1 from public.availability_blocks ab
-          where ab.business_id=a.business_id and ab.staff_id is null and ab.active
+          where ab.business_id=a.business_id and ab.staff_id is null
             and ab.starts_at<a.ends_at and ab.ends_at>a.starts_at
         )
         or not exists (
```

## D13 · D · NEITHER_OR_OTHER (D3) · aile: resource_limit · fonksiyon yeniden kullanıldı

Tek satışta adet üst sınırı 1000'den 10000'e çıktı (kaynak sınırı).

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":1,"changed":2,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.open_product_sale_guarded` (`supabase/migrations/20260923113600_f15_product_sale_atomicity.sql`)

```diff
@@ -829,7 +829,7 @@ begin
     p_business_id,v_actor.id,'open_product_sale',p_idempotency_key,p_request_hash
   );
   if v_replay is not null then return v_replay; end if;
-  if p_quantity is null or p_quantity not between 1 and 1000 then raise exception 'INVALID_PRODUCT_QUANTITY'; end if;
+  if p_quantity is null or p_quantity not between 1 and 10000 then raise exception 'INVALID_PRODUCT_QUANTITY'; end if;
 
   select * into v_customer
   from public.customers c
```

## D14 · D · NEITHER_OR_OTHER (D3) · aile: resource_limit · fonksiyon yeniden kullanıldı

Tek stok hareketinin büyüklük sınırı bir milyardan bir milyona indi (kaynak sınırı).

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":1,"changed":2,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.record_product_stock_movement_guarded` (`supabase/migrations/20260923051000_f15_product_stock_ledger.sql`)

```diff
@@ -778,7 +778,7 @@ begin
     raise exception 'INVALID_STOCK_KIND';
   end if;
   if p_quantity_delta is null or p_quantity_delta = 0
-     or p_quantity_delta < -1000000000 or p_quantity_delta > 1000000000 then
+     or p_quantity_delta < -1000000 or p_quantity_delta > 1000000 then
     raise exception 'INVALID_STOCK_QUANTITY';
   end if;
   if p_kind = 'receipt' and p_quantity_delta < 1 then raise exception 'INVALID_STOCK_QUANTITY'; end if;
```

## D15 · D · NEITHER_OR_OTHER (D3) · aile: resource_limit · fonksiyon yeniden kullanıldı

Kabul edilmiş davetler de bekleyen davet sınırına sayılıyor (kapasite kuralı); sayım aynı kilit altında.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":false,"added":0,"removed":1,"changed":1,"removed_where_and":1,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `public.create_business_invitation` (`supabase/migrations/20260914060000_f10_team_security_hardening.sql`)

```diff
@@ -170,7 +170,6 @@ begin
   from public.business_invitations i
   where i.business_id = p_business_id
     and i.revoked_at is null
-    and i.accepted_at is null
     and i.expires_at > now();
 
   if v_pending_count >= 100 then
```

## D16 · D · NEITHER_OR_OTHER (D4) · aile: time_window · fonksiyon yeniden kullanıldı

Onay bildiriminin yeniden deneme bitişi kurtarma kaydının bitişiyle sınırlanmıyor; kurtarma süresi dolduktan sonra da denenebiliyor (zaman sınırı).

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":true,"added":1,"removed":1,"changed":2,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.create_public_booking_confirmation_event` (`supabase/migrations/20260912123000_s03_notification_consistency.sql`)

```diff
@@ -256,7 +256,7 @@ begin
     'resend',
     'pending',
     now(),
-    least(v_recovery.expires_at, now() + interval '72 hours'),
+    now() + interval '72 hours',
     'public-booking-confirmation/' || v_event_id::text,
     v_event_id,
     v_event_version,
```

## D17 · D · NEITHER_OR_OTHER (D4) · aile: local_day · fonksiyon yeniden kullanıldı

Personel çalışma saatleri denetiminde haftanın günü yerel tarih yerine UTC tarihinden hesaplanıyor.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":1,"changed":2,"removed_where_and":1,"added_exists_select":0,"removed_predicate":1}`

Fonksiyon: `public.f11_validate_native_group_schedule_authority` (`supabase/migrations/20260918070000_f11_lock_order_final_repair.sql`)

```diff
@@ -433,7 +433,7 @@ begin
            and sh.weekday=bh.weekday
            and sh.active
           where bh.business_id=a.business_id
-            and bh.weekday=extract(dow from (a.starts_at at time zone v_timezone)::date)::smallint
+            and bh.weekday=extract(dow from a.starts_at::date)::smallint
             and bh.active
             and ((((a.starts_at at time zone v_timezone)::date)+greatest(bh.starts_local,sh.starts_local)) at time zone v_timezone) <= a.occupied_starts_at
             and ((((a.starts_at at time zone v_timezone)::date)+least(bh.ends_local,sh.ends_local)) at time zone v_timezone) >= a.occupied_ends_at
```

## D18 · D · NEITHER_OR_OTHER (D4) · aile: time_window · fonksiyon yeniden kullanıldı

Kurtarma kaydının geçerlilik süresi 72 saatten 24 saate indi (zaman sınırı).

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":true,"added":1,"removed":1,"changed":2,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.create_public_appointment_with_recovery` (`supabase/migrations/20260911160000_phase9_booking_recovery.sql`)

```diff
@@ -122,7 +122,7 @@ begin
       p_recovery_id, v_business_id, p_idempotency_key,
       p_management_token_hash, p_recovery_secret_hash,
       p_management_token_ciphertext, p_management_token_iv, p_key_version,
-      now() + interval '72 hours'
+      now() + interval '24 hours'
     )
     on conflict (business_id, idempotency_key) do nothing;
   exception when unique_violation then
```

## D19 · D · NEITHER_OR_OTHER (D4) · aile: time_window · fonksiyon yeniden kullanıldı

Müşteri yeniden planlamasında asgari önceden bildirim süresi artık uygulanmıyor; yalnız gün aralığı denetleniyor.

Betimleyici (Jev'e verilmez): `{"lock_context":true,"cue":false,"added":1,"removed":2,"changed":3,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

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

## D20 · D · NEITHER_OR_OTHER (D4) · aile: local_day · fonksiyon yeniden kullanıldı

Giderin iş günü işletmenin yerel tarihi yerine UTC tarihinden alınıyor (yerel gün dönüşümü).

Betimleyici (Jev'e verilmez): `{"lock_context":false,"cue":false,"added":1,"removed":1,"changed":2,"removed_where_and":0,"added_exists_select":0,"removed_predicate":0}`

Fonksiyon: `public.create_expense_guarded` (`supabase/migrations/20260923074000_f15_expense_ledger.sql`)

```diff
@@ -375,7 +375,7 @@ begin
     reason,actor_membership_id
   ) values (
     p_business_id,'expense',null,null,v_category,v_description,
-    p_amount_minor,v_currency,p_payment_method,v_occurred_at,p_occurred_local::date,v_timezone,
+    p_amount_minor,v_currency,p_payment_method,v_occurred_at,(v_occurred_at at time zone 'UTC')::date,v_timezone,
     null,v_actor.id
   )
   returning * into v_event;
```

