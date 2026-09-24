// H19u vaka tanımları (H19U-PROTOKOL v0.1, d39e388). 80 yeni mutasyon; etiket, yön (yalnız kayıt), aile ve
// gerekçe Jev çağrısından önce yazıldı. R0/H19a, H19b, H19b′, H19d ve H19t'deki hiçbir mutasyon tekrar
// kullanılmadı (kur.mjs üçlüyü ve değişen satır kümesini denetler).
//
// Katmanlar: A = D1_ONLY (20) · B = D5_ONLY (20) · C = BOTH (20) · D = NEITHER_OR_OTHER (20; D0/D2/D3/D4
// beşer). Etiket politikası H19b–H19t ile aynı: fonksiyon düzeyi. A'da `group: 'receipt_hash_replay'`
// protokolün "receipt/request-hash/replay ailesi"ni işaretler.

const M = (find, replace) => ({ find, replace });
const F = {
  payment: '20260922144500_f14_payment_ledger.sql',
  sale: '20260923113600_f15_product_sale_atomicity.sql',
  ticket: '20260922111500_f14_ticket_model.sql',
  product: '20260923051000_f15_product_stock_ledger.sql',
  expense: '20260923074000_f15_expense_ledger.sql',
  s03: '20260912123000_s03_notification_consistency.sql',
  kc01: '20260916190000_kc01_core_platform_schema.sql',
  core: '20260911120000_phase5_booking_core.sql',
  hardening: '20260911121000_phase5_booking_hardening.sql',
  recovery: '20260911160000_phase9_booking_recovery.sql',
  hours4: '20260911110000_phase4_availability.sql',
  hoursLimits: '20260914111600_f10_catalog_hours_limits.sql',
  teamSec: '20260914060000_f10_team_security_hardening.sql',
  infoLinks: '20260921083000_f12_booking_information_links.sql',
  groupOld: '20260917120000_f11_multi_service_group_booking.sql',
  msRepair: '20260917133000_f11_multi_service_final_repair.sql',
  bhFinal: '20260917150000_f11_business_hours_final_repair.sql',
  groupCompat: '20260917160000_f11_group_management_compat.sql',
  publicGroup: '20260917160100_f11_public_group_management.sql',
  groupRepair: '20260917160200_f11_group_management_repair.sql',
  groupInteg: '20260917160500_f11_group_integration_repair.sql',
  race: '20260917170000_f11_schedule_authority_race_repair.sql',
  lockFinal: '20260918070000_f11_lock_order_final_repair.sql',
};
const R = 'receipt_hash_replay';

export const CASES = [
  // ======================= A: D1_ONLY =======================
  { id: 'A01', layer: 'A', group: R, file: F.payment, fn: 'record_ticket_refund_guarded', family: 'command_identity', fnFamily: 'payment',
    rationale: 'İade komutu makbuzda "düzeltme" komut kimliğiyle açılıp kapanıyor; aynı anahtarla gelen iade ve düzeltme artık aynı makbuzu paylaşır (tekrar/çakışma kapsamı değişir). Kilitler aynı.',
    mutations: [
      M(`    p_business_id, v_actor.id, 'record_refund',
    p_idempotency_key, p_request_hash`, `    p_business_id, v_actor.id, 'record_correction',
    p_idempotency_key, p_request_hash`),
      M(`    p_business_id, v_actor.id, 'record_refund',
    p_idempotency_key, p_ticket_id, v_result`, `    p_business_id, v_actor.id, 'record_correction',
    p_idempotency_key, p_ticket_id, v_result`),
    ] },
  { id: 'A02', layer: 'A', group: R, file: F.payment, fn: 'record_ticket_payment_guarded', family: 'stale_receipt_result', fnFamily: 'payment',
    rationale: 'Makbuza ödeme sonrası değil ödeme öncesi fiş görünümü kaydediliyor; tekrar eden istek ödemenin etkisini göstermeyen eski sonucu alır (tekrar semantiği).',
    mutations: [M(`  perform public.f14_finish_ticket_command(
    p_business_id, v_actor.id, 'record_payment',
    p_idempotency_key, p_ticket_id, v_result
  );`, `  perform public.f14_finish_ticket_command(
    p_business_id, v_actor.id, 'record_payment',
    p_idempotency_key, p_ticket_id, v_before
  );`)] },
  { id: 'A03', layer: 'A', group: R, file: F.payment, fn: 'set_ticket_service_discount_guarded', family: 'replay_skipped', fnFamily: 'payment',
    rationale: 'Kayıtlı makbuz sonucu döndürülmüyor; tekrar eden indirim isteği komutu yeniden çalıştırır (fiş sürümü artmış olduğundan bayat yazma hatası alır).',
    mutations: [M(`  if v_replay is not null then return v_replay; end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if p_discount_minor is null`, `  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if p_discount_minor is null`)] },
  { id: 'A04', layer: 'A', group: R, file: F.ticket, fn: 'close_ticket_guarded', family: 'receipt_not_finished', fnFamily: 'ticket',
    rationale: 'Komut makbuzu sonuçla kapatılmıyor; tekrar eden kapatma isteği kayıtlı sonucu bulamayıp komutu yeniden çalıştırır ve "fiş açık değil" hatası alır.',
    mutations: [M(`  v_result := public.f14_ticket_projection(p_business_id, p_ticket_id);
  perform public.f14_finish_ticket_command(
    p_business_id, v_actor.id, 'close_ticket',
    p_idempotency_key, p_ticket_id, v_result
  );
  return v_result;`, `  v_result := public.f14_ticket_projection(p_business_id, p_ticket_id);
  return v_result;`)] },
  { id: 'A05', layer: 'A', group: R, file: F.ticket, fn: 'finalize_ticket_service_price_guarded', family: 'command_identity', fnFamily: 'ticket',
    rationale: 'Fiyat kesinleştirme makbuzda "indirim" komut kimliğiyle açılıp kapanıyor; aynı anahtarla gelen iki farklı komut aynı makbuzu paylaşır.',
    mutations: [
      M(`    p_business_id, v_actor.id, 'finalize_service_price',
    p_idempotency_key, p_request_hash`, `    p_business_id, v_actor.id, 'set_service_discount',
    p_idempotency_key, p_request_hash`),
      M(`    p_business_id, v_actor.id, 'finalize_service_price',
    p_idempotency_key, p_ticket_id, v_result`, `    p_business_id, v_actor.id, 'set_service_discount',
    p_idempotency_key, p_ticket_id, v_result`),
    ] },
  { id: 'A06', layer: 'A', group: R, file: F.ticket, fn: 'open_walk_in_ticket_guarded', family: 'receipt_not_finished', fnFamily: 'ticket',
    rationale: 'Komut makbuzu sonuçla kapatılmıyor; yanıtı kaybolan istemcinin aynı anahtarla tekrarı ikinci bir fiş açar.',
    mutations: [M(`  v_result := public.f14_ticket_projection(p_business_id, v_ticket.id);
  perform public.f14_finish_ticket_command(
    p_business_id, v_actor.id, 'open_walk_in',
    p_idempotency_key, v_ticket.id, v_result
  );
  return v_result;`, `  v_result := public.f14_ticket_projection(p_business_id, v_ticket.id);
  return v_result;`)] },
  { id: 'A07', layer: 'A', group: R, file: F.sale, fn: 'record_product_return_refund_guarded', family: 'command_identity', fnFamily: 'sale',
    rationale: 'Ürün iadesi makbuzda "para iadesi" komut kimliğiyle açılıp kapanıyor; aynı anahtarla gelen ürün iadesi ve para iadesi aynı makbuzu paylaşır (tekrar/çakışma kapsamı değişir).',
    mutations: [
      M(`    p_business_id,v_actor.id,'product_return_refund',p_idempotency_key,p_request_hash`, `    p_business_id,v_actor.id,'record_refund',p_idempotency_key,p_request_hash`),
      M(`    p_business_id,v_actor.id,'product_return_refund',p_idempotency_key,p_ticket_id,v_result`, `    p_business_id,v_actor.id,'record_refund',p_idempotency_key,p_ticket_id,v_result`),
    ] },
  { id: 'A08', layer: 'A', group: R, file: F.product, fn: 'archive_product_guarded', family: 'command_identity', fnFamily: 'product',
    rationale: 'Arşivleme makbuzda "ürün güncelleme" komut kimliğiyle açılıp kapanıyor; aynı anahtarla gelen güncelleme ile arşivleme aynı makbuzu paylaşır.',
    mutations: [
      M(`    p_business_id, v_actor.id, 'archive_product', p_idempotency_key, p_request_hash`, `    p_business_id, v_actor.id, 'update_product', p_idempotency_key, p_request_hash`),
      M(`    p_business_id, v_actor.id, 'archive_product', p_idempotency_key, v_product.id, v_result`, `    p_business_id, v_actor.id, 'update_product', p_idempotency_key, v_product.id, v_result`),
    ] },
  { id: 'A09', layer: 'A', group: R, file: F.expense, fn: 'reverse_expense_guarded', family: 'receipt_not_finished', fnFamily: 'expense',
    rationale: 'Komut makbuzu sonuçla kapatılmıyor; tekrar eden ters kayıt isteği kayıtlı sonucu değil "zaten ters kaydedilmiş" hatasını alır.',
    mutations: [M(`  v_result:=public.f15_expense_event_projection(p_business_id,v_event.id);
  perform public.f15_finish_expense_command(
    p_business_id,v_actor.id,'reverse_expense',p_idempotency_key,v_result
  );
  return v_result;`, `  v_result:=public.f15_expense_event_projection(p_business_id,v_event.id);
  return v_result;`)] },
  { id: 'A10', layer: 'A', group: R, file: F.kc01, fn: 'public.core_apply_platform_command', family: 'hash_conflict_relaxed', fnFamily: 'platform',
    rationale: 'Aynı anahtarla farklı içerikli platform komutu artık çakışma sayılmıyor; önceki komutun sonucu döndürülür (istek özeti yok sayılır).',
    mutations: [M(`      if v_existing.command <> p_command or v_existing.request_hash <> v_request_hash then`, `      if v_existing.command <> p_command then`)] },
  { id: 'A11', layer: 'A', group: R, file: F.core, fn: 'set_appointment_status', family: 'request_hash_field', fnFamily: 'booking',
    rationale: 'Tekrar özeti iptal gerekçesini içermiyor; aynı anahtarla farklı gerekçeli istek, öncekinin tekrarı sayılır.',
    mutations: [M(`    'status', p_status,
    'reason', v_reason
  )::text);`, `    'status', p_status
  )::text);`)] },
  { id: 'A12', layer: 'A', group: R, file: F.groupRepair, fn: 'cancel_appointment_group_line', family: 'request_hash_field', fnFamily: 'group',
    rationale: 'Tekrar özeti iptal edilen satırı içermiyor; aynı anahtarla başka bir satırın iptali, öncekinin tekrarı sayılır.',
    mutations: [M(`    'groupId',p_group_id,
    'appointmentId',p_appointment_id,
    'expectedVersion',p_expected_version,`, `    'groupId',p_group_id,
    'expectedVersion',p_expected_version,`)] },
  { id: 'A13', layer: 'A', group: R, file: F.core, fn: 'reschedule_appointment', family: 'request_hash_field', fnFamily: 'booking',
    rationale: 'Tekrar özeti yeni başlangıç zamanını içermiyor; aynı anahtarla farklı zamana taşıma isteği, öncekinin tekrarı sayılır.',
    mutations: [M(`    'staffId', p_staff_id,
    'startsAt', p_starts_at
  )::text);`, `    'staffId', p_staff_id
  )::text);`)] },
  { id: 'A14', layer: 'A', group: R, file: F.groupOld, fn: 'create_appointment_group', family: 'request_hash_field', fnFamily: 'group',
    rationale: 'Tekrar özeti grup satırlarını içermiyor; aynı anahtarla farklı hizmet satırlarıyla gelen istek, öncekinin tekrarı sayılır.',
    mutations: [M(`    'customerEmail', v_customer_email,
    'lines', p_lines,
    'startsAt', p_starts_at,`, `    'customerEmail', v_customer_email,
    'startsAt', p_starts_at,`)] },
  { id: 'A15', layer: 'A', group: R, file: F.recovery, fn: 'create_public_appointment_with_recovery', family: 'retry_conflict', fnFamily: 'public',
    rationale: 'Kurtarma kaydı eklemesi çakışmada artık hiçbir şey yapmıyor değil; yanıtı kaybolan istemcinin aynı anahtarla meşru tekrarı benzersizlik hatası üzerinden "idempotency çakışması" alır (tekrar semantiği).',
    mutations: [M(`    on conflict (business_id, idempotency_key) do nothing;
  exception when unique_violation then`, `  exception when unique_violation then`)] },
  { id: 'A16', layer: 'A', file: F.core, fn: 'set_appointment_status', family: 'noop_repeat', fnFamily: 'booking',
    rationale: 'Aynı duruma ikinci geçiş artık etkisiz sayılmıyor: tekrar "onayla" yeni bir olay yazar, tekrar "iptal/tamamla" geçersiz geçiş hatası verir (tekrarlanan komutun işlenişi).',
    mutations: [M(`  if v_current.id is null then raise exception 'APPOINTMENT_NOT_FOUND'; end if;
  if v_current.status = p_status then return v_current; end if;
`, `  if v_current.id is null then raise exception 'APPOINTMENT_NOT_FOUND'; end if;
`)] },
  { id: 'A17', layer: 'A', file: F.s03, fn: 'create_public_booking_confirmation_event', family: 'provider_idempotency_key', fnFamily: 'notification',
    rationale: 'Sağlayıcı tekilleştirme anahtarı olay başına değil randevu başına üretiliyor; yeniden planlama sonrası yeni onay bildirimi sağlayıcı tarafında önceki gönderimin tekrarı sayılıp bastırılır.',
    mutations: [M(`    'public-booking-confirmation/' || v_event_id::text,`, `    'public-booking-confirmation/' || p_appointment_id::text,`)] },
  { id: 'A18', layer: 'A', file: F.kc01, fn: 'core.command_link_identity_alias', family: 'relink_replay', fnFamily: 'platform',
    rationale: 'Aynı dış kimliğin aynı kullanıcıya yeniden bağlanması artık "zaten bağlı" diye başarılı dönmüyor, çakışma hatası veriyor (tekrar semantiği). Kilit aynı.',
    mutations: [M(`  if found then
    if v_existing.user_id <> v_user_id then
      raise exception 'IDENTITY_ALIAS_CONFLICT';
    end if;
    return jsonb_build_object(
      'user_id', v_existing.user_id,
      'provider', v_existing.provider,
      'external_subject', v_existing.external_subject,
      'linked', false
    );
  end if;`, `  if found then
    raise exception 'IDENTITY_ALIAS_CONFLICT';
  end if;`)] },
  { id: 'A19', layer: 'A', file: F.kc01, fn: 'public.core_apply_platform_command', family: 'claim_atomicity', fnFamily: 'platform',
    rationale: 'Tekrar talebi, komut etkileriyle birlikte geri alınan alt işlemin dışına alındı: komut hata verirse talep sonuçsuz kalır ve aynı anahtarla her tekrar "sürüyor" hatası alır (hep-ya-hiç tekrar semantiği).',
    mutations: [
      M(`  v_request_hash := core.hash_secret(p_command || E'\\n' || p_payload::text);

  begin
    -- Idempotency claim. Concurrent callers with the same key serialize on the PK.
    insert into core.platform_commands (principal_id, idempotency_key, command, request_hash)
    values (v_principal_id, p_idempotency_key, p_command, v_request_hash)
    on conflict (principal_id, idempotency_key) do nothing;
    get diagnostics v_inserted = row_count;
`, `  v_request_hash := core.hash_secret(p_command || E'\\n' || p_payload::text);

  -- Idempotency claim. Concurrent callers with the same key serialize on the PK.
  insert into core.platform_commands (principal_id, idempotency_key, command, request_hash)
  values (v_principal_id, p_idempotency_key, p_command, v_request_hash)
  on conflict (principal_id, idempotency_key) do nothing;
  get diagnostics v_inserted = row_count;

  begin
`),
    ] },
  { id: 'A20', layer: 'A', group: R, file: F.recovery, fn: 'create_public_appointment_with_recovery', family: 'result_binding', fnFamily: 'public',
    rationale: 'Kurtarma kaydına önceden bağlanmış randevu ile bu çağrının döndürdüğü randevunun aynı olması artık denetlenmiyor; tekrar, farklı bir randevu sonucuyla eşleşebilir.',
    mutations: [M(`  if v_bootstrap.appointment_id is not null
     and v_bootstrap.appointment_id <> v_created.appointment_id then
    raise exception 'IDEMPOTENCY_CONFLICT';
  end if;

`, ``)] },

  // ======================= B: D5_ONLY (10 weakens + 10 strengthens) =======================
  { id: 'B01', layer: 'B', file: F.payment, fn: 'record_ticket_refund_guarded', direction: 'weakens', family: 'lock_removal', fnFamily: 'payment',
    rationale: 'Fiş ve kaynak ödeme satırı kilitleri kaldırıldı; aynı kaynak ödemeye eşzamanlı iki iade aynı kalan tutarı görüp birlikte geçer.',
    mutations: [
      M(`    and t.id = p_ticket_id
  for update;
  if v_ticket.id is null then raise exception 'TICKET_NOT_FOUND'; end if;`, `    and t.id = p_ticket_id;
  if v_ticket.id is null then raise exception 'TICKET_NOT_FOUND'; end if;`),
      M(`    and e.event_type = 'payment'
  for update;
  if v_source.id is null then raise exception 'SOURCE_PAYMENT_NOT_FOUND'; end if;`, `    and e.event_type = 'payment';
  if v_source.id is null then raise exception 'SOURCE_PAYMENT_NOT_FOUND'; end if;`),
    ] },
  { id: 'B02', layer: 'B', file: F.payment, fn: 'set_ticket_service_discount_guarded', direction: 'weakens', family: 'lock_downgrade', fnFamily: 'payment',
    rationale: 'Fiş ve fiş satırı kilitleri FOR UPDATE yerine FOR KEY SHARE oldu; aynı fişe eşzamanlı iki indirim birlikte kilit alır, ikisi de toplam/ödenen kontrolünü eski toplamla geçer.',
    mutations: [
      M(`  where t.business_id = p_business_id and t.id = p_ticket_id
  for update;
  if v_ticket.id is null then raise exception 'TICKET_NOT_FOUND'; end if;
  if v_ticket.status <> 'open' then raise exception 'TICKET_NOT_OPEN'; end if;
  if p_expected_version is null or v_ticket.version <> p_expected_version then
    raise exception 'STALE_WRITE';
  end if;

  select * into v_line`, `  where t.business_id = p_business_id and t.id = p_ticket_id
  for key share of t;
  if v_ticket.id is null then raise exception 'TICKET_NOT_FOUND'; end if;
  if v_ticket.status <> 'open' then raise exception 'TICKET_NOT_OPEN'; end if;
  if p_expected_version is null or v_ticket.version <> p_expected_version then
    raise exception 'STALE_WRITE';
  end if;

  select * into v_line`),
      M(`    and l.id = p_line_id
  for update;`, `    and l.id = p_line_id
  for key share of l;`),
    ] },
  { id: 'B03', layer: 'B', file: F.ticket, fn: 'finalize_ticket_service_price_guarded', direction: 'weakens', family: 'stale_check_relaxed', fnFamily: 'ticket',
    rationale: 'Fiş satırı kilidi FOR KEY SHARE\'e indi ve bayat yazma kontrolü yalnız istemci sürümü ilerideyse reddediyor; aynı fişe eşzamanlı ya da bayat görünümle gelen kesinleştirmeler birlikte geçer.',
    mutations: [
      M(`  where t.business_id = p_business_id and t.id = p_ticket_id
  for update;
  if v_ticket.id is null then raise exception 'TICKET_NOT_FOUND'; end if;`, `  where t.business_id = p_business_id and t.id = p_ticket_id
  for key share of t;
  if v_ticket.id is null then raise exception 'TICKET_NOT_FOUND'; end if;`),
      M(`  if p_expected_version is null or v_ticket.version <> p_expected_version then
    raise exception 'STALE_WRITE';`, `  if p_expected_version is null or v_ticket.version < p_expected_version then
    raise exception 'STALE_WRITE';`),
    ] },
  { id: 'B04', layer: 'B', file: F.core, fn: 'set_appointment_status', direction: 'weakens', family: 'lock_downgrade', fnFamily: 'booking',
    rationale: 'Randevu satırı kilidi FOR UPDATE yerine FOR KEY SHARE oldu; eşzamanlı iki durum geçişi birlikte kilit alır, ikisi de eski durumu görüp geçer.',
    mutations: [M(`  where business_id = p_business_id and id = p_appointment_id
  for update;

  if v_current.id is null then raise exception 'APPOINTMENT_NOT_FOUND'; end if;
  if v_current.status = p_status`, `  where business_id = p_business_id and id = p_appointment_id
  for key share of appointments;

  if v_current.id is null then raise exception 'APPOINTMENT_NOT_FOUND'; end if;
  if v_current.status = p_status`)] },
  { id: 'B05', layer: 'B', file: F.kc01, fn: 'core.command_set_entitlement', direction: 'weakens', family: 'lock_removal', fnFamily: 'platform',
    rationale: 'İşletme ve abonelik kilitleri kaldırıldı; eşzamanlı plan değişikliği, yetki listesini bu yazımdan habersiz hesaplayıp onu ezebilir.',
    mutations: [M(`  perform core.lock_business(v_business_id);
  perform 1 from core.subscriptions s where s.business_id = v_business_id for update;

`, ``)] },
  { id: 'B06', layer: 'B', file: F.kc01, fn: 'core.command_change_subscription', direction: 'weakens', family: 'lock_removal', fnFamily: 'platform',
    rationale: 'İşletme kilidi ve abonelik satırı kilidi kaldırıldı; eşzamanlı iki plan değişikliği aynı aboneliği okuyup birbirinin yetki değişikliklerini ezer, ilk abonelikte ikisi birden eklemeye çalışır.',
    mutations: [M(`  perform core.lock_business(v_business_id);
  select * into v_subscription
  from core.subscriptions s where s.business_id = v_business_id for update;`, `  select * into v_subscription
  from core.subscriptions s where s.business_id = v_business_id;`)] },
  { id: 'B07', layer: 'B', file: F.lockFinal, fn: 'f11_create_group_internal', direction: 'weakens', family: 'lock_order_removed', fnFamily: 'group',
    rationale: 'Blok ve atama ad alanlarının advisory kilitleri personel satırı kilitlerinden önce alınmıyor; bu kilitler artık yalnız işlem sonundaki doğrulamada alınır ve korumalı blok/atama yazımlarıyla satır/advisory kilit terslenmesi (kilitlenme) geri gelir.',
    mutations: [M(`  perform pg_advisory_xact_lock(hashtextextended(
    'f10-04:availability-blocks:'||p_business_id::text,0
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    'f10-04:assignments:'||p_business_id::text,0
  ));
`, ``)] },
  { id: 'B08', layer: 'B', file: F.infoLinks, fn: 'f12_require_public_support_contact', direction: 'weakens', family: 'lock_removal', fnFamily: 'settings',
    rationale: 'Tetikleyicideki işletme satırı kilidi kaldırıldı; iletişim bilgisini kaldıran yazım, eşzamanlı rezervasyon açma kararıyla serileşmez.',
    mutations: [M(`  perform 1 from public.businesses b where b.id = new.business_id for update;
  if not found then raise exception 'BUSINESS_NOT_FOUND'; end if;

`, ``)] },
  { id: 'B09', layer: 'B', file: F.groupRepair, fn: 'f11_cancel_group_core', direction: 'weakens', family: 'version_check_removed', fnFamily: 'group',
    rationale: 'Beklenen grup sürümü artık hiç karşılaştırılmıyor (ön kontrol ve güncellemedeki sürüm koşulu kaldırıldı); eski görünümle gelen iptal, arada değişmiş grubu iptal eder.',
    mutations: [
      M(`  if v_group.version <> p_expected_version then
    raise exception 'BOOKING_GROUP_VERSION_CONFLICT';
  end if;
  if exists (`, `  if exists (`),
      M(`  where g.business_id=p_business_id and g.id=p_group_id
    and g.version=p_expected_version
  returning g.version into v_new_version;`, `  where g.business_id=p_business_id and g.id=p_group_id
  returning g.version into v_new_version;`),
    ] },
  { id: 'B10', layer: 'B', file: F.s03, fn: 'release_notification_job_v2', direction: 'weakens', family: 'lock_removal', fnFamily: 'notification',
    rationale: 'Kiralanan iş satırı kilitsiz okunuyor; okuma ile id üzerinden güncelleme arasında süresi dolan kiralama başka işçiye geçerse, bu bırakma yeni kiralamayı ezer.',
    mutations: [M(`    and j.lease_token = p_lease_token
  for update;

  if v_job.id is null then raise exception 'NOTIFICATION_LEASE_LOST'; end if;`, `    and j.lease_token = p_lease_token;

  if v_job.id is null then raise exception 'NOTIFICATION_LEASE_LOST'; end if;`)] },
  { id: 'B11', layer: 'B', file: F.hours4, fn: 'create_availability_block_local', direction: 'strengthens', family: 'lock_added', fnFamily: 'availability',
    rationale: 'Blok ad alanında işletme anahtarlı advisory kilit eklendi; blok ekleme, aynı kilidi alan grup randevusu doğrulamasıyla serileşir.',
    mutations: [M(`  v_end_date := case when p_end_local <= p_start_local then p_date + 1 else p_date end;`, `  perform pg_advisory_xact_lock(hashtextextended('f10-04:availability-blocks:' || p_business_id::text, 0));
  v_end_date := case when p_end_local <= p_start_local then p_date + 1 else p_date end;`)] },
  { id: 'B12', layer: 'B', file: F.bhFinal, fn: 'f11_create_group_internal', direction: 'strengthens', family: 'lock_added', fnFamily: 'group',
    rationale: 'Personel satırı kilitlerinden önce blok ve atama ad alanlarının advisory kilitleri alınıyor; grup oluşturma eşzamanlı blok ve atama yazımlarıyla serileşir.',
    mutations: [M(`  );

  perform 1
  from public.staff_profiles sp`, `  );

  perform pg_advisory_xact_lock(hashtextextended('f10-04:availability-blocks:'||p_business_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('f10-04:assignments:'||p_business_id::text,0));
  perform 1
  from public.staff_profiles sp`)] },
  { id: 'B13', layer: 'B', file: F.product, fn: 'f15_inventory_actor', direction: 'strengthens', family: 'share_fence', fnFamily: 'product',
    rationale: 'Envanter aktörünün üyelik okumasına paylaşımlı satır kilidi eklendi; eşzamanlı üyelik pasifleştirme bu işlem bitene kadar bekler.',
    mutations: [M(`    and m.active
  limit 1;`, `    and m.active
  limit 1 for share of m;`)] },
  { id: 'B14', layer: 'B', file: F.expense, fn: 'f15_expense_actor', direction: 'strengthens', family: 'share_fence', fnFamily: 'expense',
    rationale: 'Gider aktörünün üyelik okumasına paylaşımlı satır kilidi eklendi; eşzamanlı üyelik pasifleştirme bu işlem bitene kadar bekler.',
    mutations: [M(`    and m.active
  limit 1;`, `    and m.active
  limit 1 for share;`)] },
  { id: 'B15', layer: 'B', file: F.hardening, fn: 'reschedule_appointment', direction: 'strengthens', family: 'lock_added', fnFamily: 'booking',
    rationale: 'Personel okumasına paylaşımlı satır kilidi ve işletme + personel anahtarlı advisory kilit eklendi; aynı personele eşzamanlı yeniden planlamalar ve personel düzenlemeleri uygunluk kontrolü ile güncelleme arasında serileşir.',
    mutations: [M(`  where sp.business_id = p_business_id and sp.id = p_staff_id and sp.active;
  if v_staff.id is null then raise exception 'STAFF_NOT_ELIGIBLE'; end if;

  select b.timezone into v_timezone`, `  where sp.business_id = p_business_id and sp.id = p_staff_id and sp.active
  for share of sp;
  if v_staff.id is null then raise exception 'STAFF_NOT_ELIGIBLE'; end if;
  perform pg_advisory_xact_lock(hashtextextended('staff-slot:' || p_business_id::text || ':' || p_staff_id::text, 0));

  select b.timezone into v_timezone`)] },
  { id: 'B16', layer: 'B', file: F.race, fn: 'f11_validate_native_group_schedule_authority', direction: 'strengthens', family: 'lock_mode_order', fnFamily: 'group',
    rationale: 'Hizmet ve personel satırları FOR UPDATE yerine FOR NO KEY UPDATE ile kilitleniyor; başka rezervasyonun tuttuğu yabancı anahtar paylaşımlı kilitleriyle satır/advisory kilit terslenmesi (kilitlenme) ortadan kalkar.',
    mutations: [
      M(`  order by s.id
  for update;`, `  order by s.id
  for no key update;`),
      M(`  order by sp.id
  for update;`, `  order by sp.id
  for no key update;`),
    ] },
  { id: 'B17', layer: 'B', file: F.groupCompat, fn: 'f11_reschedule_group_core', direction: 'strengthens', family: 'lock_mode_order', fnFamily: 'group',
    rationale: 'Katılan personel satırları FOR UPDATE yerine FOR KEY SHARE ile kilitleniyor; korumalı personel saati yazımlarıyla satır/advisory kilit terslenmesi (kilitlenme) ortadan kalkar.',
    mutations: [M(`    )
  order by sp.id
  for update;`, `    )
  order by sp.id
  for key share;`)] },
  { id: 'B18', layer: 'B', file: F.core, fn: 'create_appointment', direction: 'strengthens', family: 'share_fence', fnFamily: 'booking',
    rationale: 'Personel-hizmet ataması okumasına paylaşımlı satır kilidi eklendi; eşzamanlı atama kaldırma bu randevu oluşturmayla serileşir.',
    mutations: [M(`  where sp.business_id = p_business_id and sp.id = p_staff_id and sp.active;
  if v_staff.id is null then raise exception 'STAFF_NOT_ELIGIBLE'; end if;

  select timezone into v_timezone`, `  where sp.business_id = p_business_id and sp.id = p_staff_id and sp.active
  for share of ss;
  if v_staff.id is null then raise exception 'STAFF_NOT_ELIGIBLE'; end if;

  select timezone into v_timezone`)] },
  { id: 'B19', layer: 'B', file: F.msRepair, fn: 'f11_create_group_internal', direction: 'strengthens', family: 'lock_added', fnFamily: 'group',
    rationale: 'Personel satırı kilitlerinden önce atama ad alanı advisory kilidi alınıyor; grup oluşturma eşzamanlı personel-hizmet ataması yazımlarıyla serileşir.',
    mutations: [M(`  );

  perform 1
  from public.staff_profiles sp`, `  );

  perform pg_advisory_xact_lock(hashtextextended('f10-04:assignments:'||p_business_id::text,0));
  perform 1
  from public.staff_profiles sp`)] },
  { id: 'B20', layer: 'B', file: F.groupOld, fn: 'create_appointment_group', direction: 'strengthens', family: 'lock_added', fnFamily: 'group',
    rationale: 'Personel satırı kilitlerinden önce blok ve atama ad alanlarının advisory kilitleri alınıyor; grup oluşturma bu yazımlarla serileşir.',
    mutations: [M(`  -- Multi-staff locks are taken in a stable ascending staff order so two`, `  perform pg_advisory_xact_lock(hashtextextended('f10-04:availability-blocks:' || p_business_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('f10-04:assignments:' || p_business_id::text, 0));

  -- Multi-staff locks are taken in a stable ascending staff order so two`)] },

  // ======================= C: BOTH =======================
  { id: 'C01', layer: 'C', file: F.ticket, fn: 'add_ticket_service_line_guarded', direction: 'weakens', family: 'compound', fnFamily: 'ticket',
    rationale: 'D5: fiş satırı kilidi FOR KEY SHARE\'e indi (aynı fişe eşzamanlı iki satır ekleme aynı sürümü ve sıra numarasını görür). D1: kayıtlı makbuz sonucu döndürülmüyor; tekrar eden istek komutu yeniden çalıştırır.',
    mutations: [
      M(`  if v_replay is not null then return v_replay; end if;

  select * into v_ticket`, `
  select * into v_ticket`),
      M(`  where t.business_id = p_business_id and t.id = p_ticket_id
  for update;

  if v_ticket.id is null then raise exception 'TICKET_NOT_FOUND'; end if;`, `  where t.business_id = p_business_id and t.id = p_ticket_id
  for key share of t;

  if v_ticket.id is null then raise exception 'TICKET_NOT_FOUND'; end if;`),
    ] },
  { id: 'C02', layer: 'C', file: F.publicGroup, fn: 'reschedule_public_managed_group', direction: 'weakens', family: 'probe_lock_removed', fnFamily: 'group',
    rationale: 'Sarmalayıcıdaki grup advisory kilidi kaldırıldı: "komut zaten var mı" yoklaması çekirdekle serileşmez (D5); aynı anahtarla eşzamanlı iki istek komutu yok görür ve ikisi de yeniden planlama bildirimi üretir (D1).',
    mutations: [M(`  perform pg_advisory_xact_lock(hashtextextended(
    'f11:group-management:'||v_ref.business_id::text||':'||v_ref.group_id::text,0
  ));
  v_hash := md5(`, `  v_hash := md5(`)] },
  { id: 'C03', layer: 'C', file: F.expense, fn: 'correct_expense_guarded', direction: 'weakens', family: 'compound', fnFamily: 'expense',
    rationale: 'D5: kaynak gider satırı kilidi FOR KEY SHARE\'e indi (eşzamanlı iki düzeltme "zaten ters kaydedilmiş" kontrolünü birlikte geçer). D1: kayıtlı makbuz sonucu döndürülmüyor; tekrar eden düzeltme kayıtlı sonucu değil hata alır.',
    mutations: [
      M(`  if v_replay is not null then return v_replay; end if;

  if char_length(v_reason) not between 2 and 240 then raise exception 'INVALID_EXPENSE_REASON'; end if;`, `
  if char_length(v_reason) not between 2 and 240 then raise exception 'INVALID_EXPENSE_REASON'; end if;`),
      M(`    and e.event_type='expense'
  for update;`, `    and e.event_type='expense'
  for key share of e;`),
    ] },
  { id: 'C04', layer: 'C', file: F.lockFinal, fn: 'f11_create_group_internal', direction: 'weakens', family: 'command_key_lock', fnFamily: 'group',
    rationale: 'İstek anahtarı advisory kilidi kaldırıldı: henüz satırı olmayan yeni bir anahtarla eşzamanlı iki istek tekrar yoklamasını kilitsiz geçer (D5); ikincisi tekrar olarak dönmeden önce dondurulmuş sonuç yerine güncel katalog doğrulamasından geçer (D1).',
    mutations: [M(`  perform pg_advisory_xact_lock(hashtextextended(
    'f11:group-command:' || p_business_id::text || ':' || p_idempotency_key, 0
  ));
`, ``)] },
  { id: 'C05', layer: 'C', file: F.recovery, fn: 'create_public_appointment_with_recovery', direction: 'weakens', family: 'command_key_lock', fnFamily: 'public',
    rationale: 'Kurtarma kimliği advisory kilidi kaldırıldı: yanıtı kaybolan istemcinin kurtarma sorgusu, sürmekte olan oluşturmayı beklemez (D5) ve geçici "yok" sonucu görüp isteği yeniden dener (D1: yanıt kaybı tekrarı).',
    mutations: [M(`  perform pg_advisory_xact_lock(hashtextextended(p_recovery_id::text, 0));

  select b.id into v_business_id`, `
  select b.id into v_business_id`)] },
  { id: 'C06', layer: 'C', file: F.ticket, fn: 'close_ticket_guarded', direction: 'weakens', family: 'compound', fnFamily: 'ticket',
    rationale: 'D5: fiş satırı kilidi kaldırıldı (kapatma, bakiyeyi değiştiren eşzamanlı ödeme/iadeyle serileşmez; bakiyesi sıfır olmayan fiş kapanabilir). D1: kayıtlı makbuz sonucu döndürülmüyor; tekrar eden kapatma "fiş açık değil" hatası alır.',
    mutations: [
      M(`  if v_replay is not null then return v_replay; end if;

  select * into v_ticket`, `
  select * into v_ticket`),
      M(`  where t.business_id = p_business_id and t.id = p_ticket_id
  for update;
  if v_ticket.id is null then raise exception 'TICKET_NOT_FOUND'; end if;`, `  where t.business_id = p_business_id and t.id = p_ticket_id;
  if v_ticket.id is null then raise exception 'TICKET_NOT_FOUND'; end if;`),
    ] },
  { id: 'C07', layer: 'C', file: F.expense, fn: 'reverse_expense_guarded', direction: 'weakens', family: 'compound', fnFamily: 'expense',
    rationale: 'D5: kaynak gider satırı kilidi FOR SHARE\'e indi (eşzamanlı iki ters kayıt "zaten ters kaydedilmiş" kontrolünü birlikte geçer). D1: kayıtlı makbuz sonucu döndürülmüyor; tekrar eden ters kayıt kayıtlı sonucu değil hata alır.',
    mutations: [
      M(`  if v_replay is not null then return v_replay; end if;

  if char_length(v_reason) not between 2 and 240 then raise exception 'INVALID_EXPENSE_REASON'; end if;`, `
  if char_length(v_reason) not between 2 and 240 then raise exception 'INVALID_EXPENSE_REASON'; end if;`),
      M(`    and e.event_type='expense'
  for update;`, `    and e.event_type='expense'
  for share of e;`),
    ] },
  { id: 'C08', layer: 'C', file: F.product, fn: 'update_product_guarded', direction: 'weakens', family: 'compound', fnFamily: 'product',
    rationale: 'D5: bayat yazma kontrolü yalnız istemci sürümü ilerideyse reddediyor (geride kalan sürümle güncelleme geçer). D1: kayıtlı makbuz sonucu döndürülmüyor; tekrar eden güncelleme komutu yeniden çalıştırır.',
    mutations: [
      M(`  if v_replay is not null then return v_replay; end if;

  select * into v_product`, `
  select * into v_product`),
      M(`  if p_expected_version is null or v_product.version <> p_expected_version then raise exception 'STALE_WRITE'; end if;`, `  if p_expected_version is null or v_product.version < p_expected_version then raise exception 'STALE_WRITE'; end if;`),
    ] },
  { id: 'C09', layer: 'C', file: F.payment, fn: 'record_ticket_correction_guarded', direction: 'weakens', family: 'compound', fnFamily: 'payment',
    rationale: 'D5: fiş satırı kilidi FOR SHARE\'e indi (farklı kaynak ödemelere eşzamanlı iki artırma düzeltmesi toplam kontrolünü birlikte geçer). D1: kayıtlı makbuz sonucu döndürülmüyor; tekrar eden düzeltme ikinci kez kaydedilir.',
    mutations: [
      M(`  if v_replay is not null then return v_replay; end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if p_direction not in ('increase','decrease')`, `
  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if p_direction not in ('increase','decrease')`),
      M(`    and t.id = p_ticket_id
  for update;
  if v_ticket.id is null then raise exception 'TICKET_NOT_FOUND'; end if;`, `    and t.id = p_ticket_id
  for share of t;
  if v_ticket.id is null then raise exception 'TICKET_NOT_FOUND'; end if;`),
    ] },
  { id: 'C10', layer: 'C', file: F.ticket, fn: 'cancel_ticket_guarded', direction: 'weakens', family: 'compound', fnFamily: 'ticket',
    rationale: 'D5: bayat yazma kontrolü yalnız istemci sürümü ilerideyse reddediyor (geride kalan sürümle iptal geçer). D1: kayıtlı makbuz sonucu döndürülmüyor; tekrar eden iptal "fiş açık değil" hatası alır.',
    mutations: [
      M(`  if v_replay is not null then return v_replay; end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null or char_length(v_reason) > 240 then`, `
  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null or char_length(v_reason) > 240 then`),
      M(`  if p_expected_version is null or v_ticket.version <> p_expected_version then
    raise exception 'STALE_WRITE';`, `  if p_expected_version is null or v_ticket.version < p_expected_version then
    raise exception 'STALE_WRITE';`),
    ] },
  { id: 'C11', layer: 'C', file: F.groupInteg, fn: 'reschedule_appointment_group_line', direction: 'weakens', family: 'compound', fnFamily: 'group',
    rationale: 'D5: beklenen grup sürümü artık karşılaştırılmıyor (ön kontrol ve güncelleme koşulu kaldırıldı). D1: tekrar özeti beklenen sürümü içermiyor; farklı sürüme dayanan istek öncekinin tekrarı sayılır.',
    mutations: [
      M(`    'expectedVersion',p_expected_version,'staffId',p_staff_id,'startsAt',p_starts_at`, `    'staffId',p_staff_id,'startsAt',p_starts_at`),
      M(`  if v_group.version<>p_expected_version then raise exception 'BOOKING_GROUP_VERSION_CONFLICT'; end if;
  if v_line.status not in ('scheduled','confirmed') then
    raise exception 'BOOKING_GROUP_LINE_NOT_RESCHEDULABLE';`, `  if v_line.status not in ('scheduled','confirmed') then
    raise exception 'BOOKING_GROUP_LINE_NOT_RESCHEDULABLE';`),
      M(`  where g.business_id=p_business_id and g.id=p_group_id and g.version=p_expected_version
  returning g.version into v_new_version;`, `  where g.business_id=p_business_id and g.id=p_group_id
  returning g.version into v_new_version;`),
    ] },
  { id: 'C12', layer: 'C', file: F.core, fn: 'reschedule_appointment', direction: 'weakens', family: 'compound', fnFamily: 'booking',
    rationale: 'D5: randevu satırı kilidi FOR KEY SHARE\'e indi (eşzamanlı iptal ile yeniden planlama birlikte geçer). D1: tekrar özeti randevuyu içermiyor; aynı anahtarla başka randevunun taşınması öncekinin tekrarı sayılır.',
    mutations: [
      M(`    'appointmentId', p_appointment_id,
    'staffId', p_staff_id,`, `    'staffId', p_staff_id,`),
      M(`  where business_id = p_business_id and id = p_appointment_id
  for update;`, `  where business_id = p_business_id and id = p_appointment_id
  for key share of appointments;`),
    ] },
  { id: 'C13', layer: 'C', file: F.kc01, fn: 'core.command_provision_business', direction: 'weakens', family: 'replay_probe_unlocked', fnFamily: 'platform',
    rationale: 'Takma ad kilidi kaldırıldı: aynı takma adla eşzamanlı iki kurulum tekrar yoklamasını birlikte geçer (D5); ikisi de işletme açmaya çalışır, ikincisi mevcut işletmeye eşlenmek yerine hata alır (D1: belirlenimci tekrar).',
    mutations: [M(`    perform core.lock_tenant_alias(v_alias_provider, v_alias_external_id);
`, ``)] },
  { id: 'C14', layer: 'C', file: F.kc01, fn: 'core.command_link_identity_alias', direction: 'weakens', family: 'replay_probe_unlocked', fnFamily: 'platform',
    rationale: 'Dış kimlik advisory kilidi kaldırıldı: aynı kimliği eşzamanlı bağlayan iki istek "zaten bağlı mı" yoklamasını birlikte geçer (D5); ikincisi "zaten bağlı" sonucu yerine benzersizlik hatası alır (D1).',
    mutations: [M(`  perform pg_advisory_xact_lock(hashtextextended('identity_alias:' || v_provider || ':' || v_subject, 0));

`, ``)] },
  { id: 'C15', layer: 'C', file: F.sale, fn: 'open_product_sale_guarded', direction: 'weakens', family: 'compound', fnFamily: 'sale',
    rationale: 'D5: ürün satırı kilidi FOR KEY SHARE\'e indi (farklı müşterilere eşzamanlı satışlar aynı stoku görür). D1: kayıtlı makbuz sonucu döndürülmüyor; tekrar eden istek ikinci bir satış açar.',
    mutations: [
      M(`  if v_replay is not null then return v_replay; end if;
  if p_quantity is null`, `  if p_quantity is null`),
      M(`  where p.business_id=p_business_id and p.id=p_product_id
  for update;`, `  where p.business_id=p_business_id and p.id=p_product_id
  for key share of p;`),
    ] },
  { id: 'C16', layer: 'C', file: F.sale, fn: 'record_product_return_refund_guarded', direction: 'weakens', family: 'compound', fnFamily: 'sale',
    rationale: 'D5: ürün satırı kilidi FOR KEY SHARE\'e indi (stoka dönüş, aynı ürünün eşzamanlı satışıyla kayıp güncelleme yaşar). D1: makbuza iade sonrası değil iade öncesi fiş görünümü kaydediliyor; tekrar eden istek eski sonucu alır.',
    mutations: [
      M(`  where p.business_id=p_business_id and p.id=v_line.product_id
  for update;
  if v_product.id is null then raise exception 'PRODUCT_NOT_FOUND'; end if;`, `  where p.business_id=p_business_id and p.id=v_line.product_id
  for key share of p;
  if v_product.id is null then raise exception 'PRODUCT_NOT_FOUND'; end if;`),
      M(`    p_business_id,v_actor.id,'product_return_refund',p_idempotency_key,p_ticket_id,v_result`, `    p_business_id,v_actor.id,'product_return_refund',p_idempotency_key,p_ticket_id,v_before`),
    ] },
  { id: 'C17', layer: 'C', file: F.payment, fn: 'record_ticket_payment_guarded', direction: 'weakens', family: 'compound', fnFamily: 'payment',
    rationale: 'D5: fiş satırı kilidi FOR SHARE\'e indi (eşzamanlı iki ödeme bakiye kontrolünü birlikte geçer). D1: kayıtlı makbuz sonucu döndürülmüyor; tekrar eden ödeme isteği ikinci bir ödeme kaydeder (bakiye yetiyorsa).',
    mutations: [
      M(`  if v_replay is not null then return v_replay; end if;

  if p_payment_method not in ('cash','card')`, `
  if p_payment_method not in ('cash','card')`),
      M(`    and t.id = p_ticket_id
  for update;

  if v_ticket.id is null`, `    and t.id = p_ticket_id
  for share;

  if v_ticket.id is null`),
    ] },
  { id: 'C18', layer: 'C', file: F.groupOld, fn: 'create_appointment_group', direction: 'weakens', family: 'compound', fnFamily: 'group',
    rationale: 'D5: personel satırları FOR UPDATE yerine FOR KEY SHARE ile kilitleniyor (kilit altındaki yeniden planlama eşzamanlı personel pasifleştirmesini artık dışarıda tutmaz). D1: tekrar özeti müşteri telefonunu içermiyor; farklı telefonlu istek öncekinin tekrarı sayılır.',
    mutations: [
      M(`    'customerName', v_customer_name,
    'customerPhone', v_customer_phone,
    'customerEmail', v_customer_email,`, `    'customerName', v_customer_name,
    'customerEmail', v_customer_email,`),
      M(`  order by sp.id
  for update;`, `  order by sp.id
  for key share;`),
    ] },
  { id: 'C19', layer: 'C', file: F.msRepair, fn: 'f11_create_group_internal', direction: 'weakens', family: 'compound', fnFamily: 'group',
    rationale: 'D5: katılan personel satırları FOR UPDATE yerine FOR KEY SHARE ile kilitleniyor (kilit altındaki yeniden planlama eşzamanlı personel pasifleştirmesini dışarıda tutmaz). D1: tekrar özeti müşteri e-postasını içermiyor; farklı e-postalı istek öncekinin tekrarı sayılır.',
    mutations: [
      M(`    'customerPhone', v_customer_phone,
    'customerEmail', v_customer_email,
    'lines', p_lines,`, `    'customerPhone', v_customer_phone,
    'lines', p_lines,`),
      M(`  order by sp.id
  for update;

  v_plan := public.f11_plan_group_at(p_business_id, p_lines, p_starts_at, null);`, `  order by sp.id
  for key share of sp;

  v_plan := public.f11_plan_group_at(p_business_id, p_lines, p_starts_at, null);`),
    ] },
  { id: 'C20', layer: 'C', file: F.ticket, fn: 'open_ticket_from_booking_group_guarded', direction: 'weakens', family: 'get_or_create_unlocked', fnFamily: 'ticket',
    rationale: 'Grup anahtarlı advisory kilit kaldırıldı: aynı grup için eşzamanlı iki fiş açma "fiş var mı" yoklamasını birlikte geçer (D5); ikincisi mevcut fişi döndürmek yerine benzersizlik hatası alır (D1: "varsa getir, yoksa oluştur" tekrar semantiği).',
    mutations: [M(`  perform pg_advisory_xact_lock(hashtextextended(
    p_business_id::text || ':ticket-group:' || coalesce(p_group_id::text, ''), 0
  ));
`, ``)] },
  // ======================= D: NEITHER_OR_OTHER (D0/D2/D3/D4 beşer) =======================
  { id: 'D01', layer: 'D', axes: ['D0'], file: F.payment, fn: 'record_ticket_refund_guarded', family: 'authority_scope', fnFamily: 'payment',
    rationale: 'İade ödeme yetkisi yerine fiyat düzeltme yetkisi istiyor (yetki kapsamı).',
    mutations: [M(`  v_actor := public.f14_payment_actor(p_business_id);`, `  v_actor := public.f14_financial_actor(p_business_id);`)] },
  { id: 'D02', layer: 'D', axes: ['D0'], file: F.expense, fn: 'reverse_expense_guarded', family: 'authority_scope', fnFamily: 'expense',
    rationale: 'Gider ters kaydı gider yetkisi yerine envanter yetkisiyle yapılabiliyor (yetki kapsamı).',
    mutations: [M(`  v_actor:=public.f15_expense_actor(p_business_id);`, `  v_actor:=public.f15_inventory_actor(p_business_id);`)] },
  { id: 'D03', layer: 'D', axes: ['D0'], file: F.product, fn: 'archive_product_guarded', family: 'authority_scope', fnFamily: 'product',
    rationale: 'Ürün arşivleme envanter yetkisi yerine gider yetkisiyle yapılabiliyor (yetki kapsamı).',
    mutations: [M(`  v_actor := public.f15_inventory_actor(p_business_id);`, `  v_actor := public.f15_expense_actor(p_business_id);`)] },
  { id: 'D04', layer: 'D', axes: ['D0'], file: F.groupRepair, fn: 'cancel_appointment_group_line', family: 'authority_scope', fnFamily: 'group',
    rationale: 'Grup satırı iptali her aktif üye yerine yalnız yöneticilere açık (yetki kapsamı).',
    mutations: [M(`  if auth.uid() is null or not public.is_active_member(p_business_id) then`, `  if auth.uid() is null or not public.can_manage_business(p_business_id) then`)] },
  { id: 'D05', layer: 'D', axes: ['D0'], file: F.sale, fn: 'open_product_sale_guarded', family: 'authority_scope', fnFamily: 'sale',
    rationale: 'Ürün satışı açmak fiyatlandırma yetkisi istemiyor, envanter yetkisi yetiyor (yetki kapsamı).',
    mutations: [M(`  v_actor := public.f15_product_sale_actor(p_business_id);`, `  v_actor := public.f15_inventory_actor(p_business_id);`)] },
  { id: 'D06', layer: 'D', axes: ['D2'], file: F.groupInteg, fn: 'change_appointment_group_line_service', family: 'history', fnFamily: 'group',
    rationale: 'Hizmet değişikliği olayı eski ve yeni hizmet adlarını kaydetmiyor (geçmiş kaydı).',
    mutations: [M(`      'scope','line','oldServiceId',v_line.service_id,'newServiceId',p_service_id,
      'oldServiceName',v_line.service_name_snapshot,'newServiceName',v_service.service_name
    )`, `      'scope','line','oldServiceId',v_line.service_id,'newServiceId',p_service_id
    )`)] },
  { id: 'D07', layer: 'D', axes: ['D2'], file: F.groupRepair, fn: 'cancel_appointment_group_line', family: 'history', fnFamily: 'group',
    rationale: 'Satır iptali olayı, iptalin hangi grup sürümünde gerçekleştiğini kaydetmiyor (geçmiş kaydı).',
    mutations: [M(`      'groupId',p_group_id,
      'groupVersion',v_new_version,
      'lineOrdinal',v_line.line_ordinal,`, `      'groupId',p_group_id,
      'lineOrdinal',v_line.line_ordinal,`)] },
  { id: 'D08', layer: 'D', axes: ['D2'], file: F.groupInteg, fn: 'change_appointment_group_line_service', family: 'snapshot', fnFamily: 'group',
    rationale: 'Hizmet değişince satırın en yüksek fiyat anlık görüntüsü güncellenmiyor; aralıklı fiyatta eski hizmetin üst sınırı kalır.',
    mutations: [M(`      price_max_minor_snapshot=v_service.price_max_minor,
`, ``)] },
  { id: 'D09', layer: 'D', axes: ['D2'], file: F.kc01, fn: 'core.command_change_subscription', family: 'history', fnFamily: 'platform',
    rationale: 'Abonelik olayı uygulanan yetki değişikliklerinin listesini kaydetmiyor (olay geçmişi değişikliği tarif etmez).',
    mutations: [M(`      'source', coalesce(p_payload->'source', 'null'::jsonb),
      'entitlements', coalesce(v_changes, 'null'::jsonb)
    ),`, `      'source', coalesce(p_payload->'source', 'null'::jsonb)
    ),`)] },
  { id: 'D10', layer: 'D', axes: ['D2'], file: F.sale, fn: 'open_product_sale_guarded', family: 'snapshot', fnFamily: 'sale',
    rationale: 'Satış satırı en yüksek fiyat anlık görüntüsünü yakalamıyor.',
    mutations: [M(`    p_quantity,'fixed',v_product.sale_price_minor,v_product.sale_price_minor,`, `    p_quantity,'fixed',v_product.sale_price_minor,null,`)] },
  { id: 'D11', layer: 'D', axes: ['D3'], file: F.lockFinal, fn: 'f11_validate_native_group_schedule_authority', family: 'availability', fnFamily: 'group',
    rationale: 'Personel uygunluk denetiminde pasif bloklar da müsaitliği engelliyor (blok etkinlik koşulu kaldırıldı).',
    mutations: [M(`          where ab.business_id=a.business_id and ab.active
            and (ab.staff_id is null or ab.staff_id=a.staff_id)`, `          where ab.business_id=a.business_id
            and (ab.staff_id is null or ab.staff_id=a.staff_id)`)] },
  { id: 'D12', layer: 'D', axes: ['D3'], file: F.lockFinal, fn: 'f11_validate_native_group_schedule_authority', family: 'availability', fnFamily: 'group',
    rationale: 'İşletme geneli blok denetiminde pasif bloklar da müşteri aralığını engelliyor (blok etkinlik koşulu kaldırıldı).',
    mutations: [M(`          where ab.business_id=a.business_id and ab.staff_id is null and ab.active`, `          where ab.business_id=a.business_id and ab.staff_id is null`)] },
  { id: 'D13', layer: 'D', axes: ['D3'], file: F.sale, fn: 'open_product_sale_guarded', family: 'resource_limit', fnFamily: 'sale',
    rationale: 'Tek satışta adet üst sınırı 1000\'den 10000\'e çıktı (kaynak sınırı).',
    mutations: [M(`  if p_quantity is null or p_quantity not between 1 and 1000 then raise exception 'INVALID_PRODUCT_QUANTITY'; end if;`, `  if p_quantity is null or p_quantity not between 1 and 10000 then raise exception 'INVALID_PRODUCT_QUANTITY'; end if;`)] },
  { id: 'D14', layer: 'D', axes: ['D3'], file: F.product, fn: 'record_product_stock_movement_guarded', family: 'resource_limit', fnFamily: 'product',
    rationale: 'Tek stok hareketinin büyüklük sınırı bir milyardan bir milyona indi (kaynak sınırı).',
    mutations: [M(`     or p_quantity_delta < -1000000000 or p_quantity_delta > 1000000000 then`, `     or p_quantity_delta < -1000000 or p_quantity_delta > 1000000 then`)] },
  { id: 'D15', layer: 'D', axes: ['D3'], file: F.teamSec, fn: 'create_business_invitation', family: 'resource_limit', fnFamily: 'team',
    rationale: 'Kabul edilmiş davetler de bekleyen davet sınırına sayılıyor (kapasite kuralı); sayım aynı kilit altında.',
    mutations: [M(`    and i.revoked_at is null
    and i.accepted_at is null
    and i.expires_at > now();`, `    and i.revoked_at is null
    and i.expires_at > now();`)] },
  { id: 'D16', layer: 'D', axes: ['D4'], file: F.s03, fn: 'create_public_booking_confirmation_event', family: 'time_window', fnFamily: 'notification',
    rationale: 'Onay bildiriminin yeniden deneme bitişi kurtarma kaydının bitişiyle sınırlanmıyor; kurtarma süresi dolduktan sonra da denenebiliyor (zaman sınırı).',
    mutations: [M(`    least(v_recovery.expires_at, now() + interval '72 hours'),`, `    now() + interval '72 hours',`)] },
  { id: 'D17', layer: 'D', axes: ['D4'], file: F.lockFinal, fn: 'f11_validate_native_group_schedule_authority', family: 'local_day', fnFamily: 'group',
    rationale: 'Personel çalışma saatleri denetiminde haftanın günü yerel tarih yerine UTC tarihinden hesaplanıyor.',
    mutations: [M(`            and bh.weekday=extract(dow from (a.starts_at at time zone v_timezone)::date)::smallint
            and bh.active
            and ((((a.starts_at at time zone v_timezone)::date)+greatest(bh.starts_local,sh.starts_local))`, `            and bh.weekday=extract(dow from a.starts_at::date)::smallint
            and bh.active
            and ((((a.starts_at at time zone v_timezone)::date)+greatest(bh.starts_local,sh.starts_local))`)] },
  { id: 'D18', layer: 'D', axes: ['D4'], file: F.recovery, fn: 'create_public_appointment_with_recovery', family: 'time_window', fnFamily: 'public',
    rationale: 'Kurtarma kaydının geçerlilik süresi 72 saatten 24 saate indi (zaman sınırı).',
    mutations: [M(`      now() + interval '72 hours'
    )`, `      now() + interval '24 hours'
    )`)] },
  { id: 'D19', layer: 'D', axes: ['D4'], file: F.publicGroup, fn: 'reschedule_public_managed_group', family: 'time_window', fnFamily: 'group',
    rationale: 'Müşteri yeniden planlamasında asgari önceden bildirim süresi artık uygulanmıyor; yalnız gün aralığı denetleniyor.',
    mutations: [M(`  if v_date < v_today or v_date > v_today+v_horizon_days
     or p_starts_at < now()+make_interval(mins=>v_min_notice_minutes) then`, `  if v_date < v_today or v_date > v_today+v_horizon_days then`)] },
  { id: 'D20', layer: 'D', axes: ['D4'], file: F.expense, fn: 'create_expense_guarded', family: 'local_day', fnFamily: 'expense',
    rationale: 'Giderin iş günü işletmenin yerel tarihi yerine UTC tarihinden alınıyor (yerel gün dönüşümü).',
    mutations: [M(`    p_amount_minor,v_currency,p_payment_method,v_occurred_at,p_occurred_local::date,v_timezone,`, `    p_amount_minor,v_currency,p_payment_method,v_occurred_at,(v_occurred_at at time zone 'UTC')::date,v_timezone,`)] },
];
