// H19t vaka tanımları (H19T-PROTOKOL v0.1, 58cf9ea). 80 yeni mutasyon; etiket, eksen(ler), yön (yalnız
// çeşitlilik kaydı), aile ve gerekçe Jev çağrısından önce yazıldı. R0/H19a, H19b, H19b′ ve H19d'deki hiçbir
// mutasyon tekrar kullanılmadı (kur.mjs üçlüyü ve değişen satır kümesini denetler); aynı fonksiyon yeni bir
// mutasyonla kullanıldıysa kur.mjs bunu işaretler.
//
// Katmanlar: PS = D5 tek eksen (20) · PP = D5 + başka eksen (20) · NS = D5 yok, tek eksen (20) ·
// NP = D5 yok, iki eksen (20). Etiket politikası H19b/H19d ile aynı: fonksiyon düzeyi.

const M = (find, replace) => ({ find, replace });
const F = {
  payment: '20260922144500_f14_payment_ledger.sql',
  sale: '20260923113600_f15_product_sale_atomicity.sql',
  ticket: '20260922111500_f14_ticket_model.sql',
  expense: '20260923074000_f15_expense_ledger.sql',
  customers: '20260914110000_f10_customer_records.sql',
  s03: '20260912123000_s03_notification_consistency.sql',
  outbox: '20260911170000_phase9_notification_outbox.sql',
  partialLine: '20260915160300_f11_partial_line_lifecycle.sql',
  lineContract: '20260915160000_f11_group_line_contract.sql',
  lifecycle: '20260921023000_f13_group_lifecycle.sql',
  dateRange: '20260921013000_f13_booking_date_range.sql',
  kc01: '20260916190000_kc01_core_platform_schema.sql',
  media: '20260914110500_f12_salon_profile_media.sql',
  mediaRepair: '20260914110600_f12_media_lifecycle_repair.sql',
  core: '20260911120000_phase5_booking_core.sql',
  retention: '20260911180200_phase9_public_abuse_retention.sql',
  abuse: '20260911180000_phase9_public_abuse_control.sql',
  hours4: '20260911110000_phase4_availability.sql',
  hoursLimits: '20260914111600_f10_catalog_hours_limits.sql',
  team: '20260914033000_f10_team_access.sql',
  teamSec: '20260914060000_f10_team_security_hardening.sql',
  groupInteg: '20260917160500_f11_group_integration_repair.sql',
  groupRepair: '20260917160200_f11_group_management_repair.sql',
  groupOld: '20260917120000_f11_multi_service_group_booking.sql',
  lockFinal: '20260918070000_f11_lock_order_final_repair.sql',
  publicGroup: '20260917160100_f11_public_group_management.sql',
  infoLinks: '20260921083000_f12_booking_information_links.sql',
  recovery: '20260911160000_phase9_booking_recovery.sql',
};

export const CASES = [
  // ======================= PS: D5 tek eksen (10 weakens + 10 strengthens) =======================
  { id: 'PS01', layer: 'PS', file: F.payment, fn: 'record_ticket_payment_guarded', direction: 'weakens', family: 'lock_removal', fnFamily: 'payment',
    rationale: 'Fiş satırı kilidi kaldırıldı; kalan bakiye kontrolü serileşmiyor: aynı fişe eşzamanlı iki ödeme aynı bakiyeyi görüp birlikte geçer, fiş fazla ödenir.',
    mutations: [M(`    and t.id = p_ticket_id
  for update;

  if v_ticket.id is null then raise exception 'TICKET_NOT_FOUND'; end if;
  if v_ticket.status = 'cancelled' then raise exception 'TICKET_CANCELLED'; end if;`, `    and t.id = p_ticket_id;

  if v_ticket.id is null then raise exception 'TICKET_NOT_FOUND'; end if;
  if v_ticket.status = 'cancelled' then raise exception 'TICKET_CANCELLED'; end if;`)] },
  { id: 'PS02', layer: 'PS', file: F.payment, fn: 'record_ticket_correction_guarded', direction: 'weakens', family: 'lock_downgrade', fnFamily: 'payment',
    rationale: 'Fiş satırı kilidi FOR UPDATE yerine FOR SHARE oldu; aynı fişe eşzamanlı iki artırma düzeltmesi birlikte paylaşımlı kilit alır, ikisi de "toplamı aşma" kontrolünü geçer.',
    mutations: [M(`    and t.id = p_ticket_id
  for update;
  if v_ticket.id is null then raise exception 'TICKET_NOT_FOUND'; end if;

  select * into v_source`, `    and t.id = p_ticket_id
  for share of t;
  if v_ticket.id is null then raise exception 'TICKET_NOT_FOUND'; end if;

  select * into v_source`)] },
  { id: 'PS03', layer: 'PS', file: F.sale, fn: 'add_ticket_product_line_guarded', direction: 'weakens', family: 'stale_token', fnFamily: 'sale',
    rationale: 'Ürün sürüm belirteci isteğe bağlı oldu; belirteç göndermeyen istemci, eşzamanlı bir ürün düzenlemesinden sonra bayat fiyat/ad görünümüyle satış satırı ekler.',
    mutations: [M(`  if p_expected_product_version is null or v_product.version <> p_expected_product_version then raise exception 'STALE_PRODUCT_WRITE'; end if;
  if v_product.stock_on_hand < p_quantity then raise exception 'INSUFFICIENT_STOCK'; end if;
  if v_ticket.currency`, `  if p_expected_product_version is not null and v_product.version <> p_expected_product_version then raise exception 'STALE_PRODUCT_WRITE'; end if;
  if v_product.stock_on_hand < p_quantity then raise exception 'INSUFFICIENT_STOCK'; end if;
  if v_ticket.currency`)] },
  { id: 'PS04', layer: 'PS', file: F.expense, fn: 'correct_expense_guarded', direction: 'weakens', family: 'lock_downgrade', fnFamily: 'expense',
    rationale: 'Kaynak gider satırı kilidi FOR UPDATE yerine FOR SHARE oldu; aynı gidere eşzamanlı iki düzeltme birlikte paylaşımlı kilit alır, ikisi de "zaten ters kaydedilmiş" kontrolünü geçer ve gider iki kez ters kaydedilir.',
    mutations: [M(`    and e.event_type='expense'
  for update;

  if v_source.id is null then raise exception 'EXPENSE_NOT_FOUND'; end if;`, `    and e.event_type='expense'
  for share;

  if v_source.id is null then raise exception 'EXPENSE_NOT_FOUND'; end if;`)] },
  { id: 'PS05', layer: 'PS', file: F.customers, fn: 'create_business_customer', direction: 'weakens', family: 'lock_key_narrowed', fnFamily: 'customer',
    rationale: 'Advisory kilit anahtarı işletmeden işletme + telefona daraltıldı; aynı e-postayla farklı telefonlu eşzamanlı iki ekleme serileşmez, ikisi de "iletişim zaten var mı" kontrolünü geçer.',
    mutations: [M(`  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text, 0));

  if exists (`, `  perform pg_advisory_xact_lock(hashtextextended(
    p_business_id::text || ':' || coalesce(v_phone_normalized, ''), 0
  ));

  if exists (`)] },
  { id: 'PS06', layer: 'PS', file: F.s03, fn: 'claim_notification_jobs_v2', direction: 'weakens', family: 'skip_locked_removed', fnFamily: 'notification',
    rationale: 'Aday işlerin FOR UPDATE SKIP LOCKED kilidi kaldırıldı; eşzamanlı iki işçi aynı adayları seçer, güncelleme yalnız id eşleşmesini yeniden denetlediği için aynı iş iki kez kiralanıp gönderilebilir.',
    mutations: [M(`    order by j.available_at, j.created_at, j.id
    for update skip locked
    limit v_limit`, `    order by j.available_at, j.created_at, j.id
    limit v_limit`)] },
  { id: 'PS07', layer: 'PS', file: F.partialLine, fn: 'f11_aggregate_group_status_from_line', direction: 'weakens', family: 'lock_removal', fnFamily: 'group',
    rationale: 'Tetikleyicideki grup satırı kilidi kaldırıldı; aynı grubun iki satırı eşzamanlı güncellenirse her tetikleyici özet durumu kendi anlık görüntüsünden hesaplar, son yazan diğerinin sonucunu ezer.',
    mutations: [M(`    and g.id = new.group_id
  for update;

  if not found then`, `    and g.id = new.group_id;

  if not found then`)] },
  { id: 'PS08', layer: 'PS', file: F.groupRepair, fn: 'cancel_appointment_group_line', direction: 'weakens', family: 'version_check_removed', fnFamily: 'group',
    rationale: 'Beklenen grup sürümü artık hiç doğrulanmıyor (ön kontrol ve güncelleme sonrası sürüm kontrolü kaldırıldı); eski görünüme dayanan istemci, arada değişmiş grubun satırını iptal edebilir.',
    mutations: [
      M(`  if v_group.version <> p_expected_version then
    raise exception 'BOOKING_GROUP_VERSION_CONFLICT';
  end if;
  if v_line.status not in ('scheduled','confirmed') then`, `  if v_line.status not in ('scheduled','confirmed') then`),
      M(`  where g.business_id=p_business_id and g.id=p_group_id;
  if v_new_version <> p_expected_version+1 then
    raise exception 'BOOKING_GROUP_VERSION_CONFLICT';
  end if;
`, `  where g.business_id=p_business_id and g.id=p_group_id;
`),
    ] },
  { id: 'PS09', layer: 'PS', file: F.dateRange, fn: 'list_appointments_page_v3', direction: 'weakens', family: 'revision_check_removed', fnFamily: 'booking',
    rationale: 'Sayfa revizyonu karşılaştırması kaldırıldı; sayfalar arasında eşzamanlı ekleme/silme olursa istemci bayat imleçle devam eder, satırlar atlanır ya da tekrarlanır (iyimser revizyon belirteci).',
    mutations: [M(`  if p_expected_revision is not null
     and p_expected_revision is distinct from v_revision then
    raise exception 'STALE_APPOINTMENT_PAGE';
  end if;

  return query`, `  return query`)] },
  { id: 'PS10', layer: 'PS', file: F.lineContract, fn: 'f11_sync_legacy_group_from_line', direction: 'weakens', family: 'version_bump_removed', fnFamily: 'group',
    rationale: 'Eski tip grupta satır değişince grup sürümü artık artmıyor; grup sürüm belirteciyle çalışan eşzamanlı istemciler arada olan değişikliği fark etmez (iyimser sürüm).',
    mutations: [M(`  set status = new.status,
      version = g.version + 1,
      updated_at = new.updated_at`, `  set status = new.status,
      updated_at = new.updated_at`)] },
  { id: 'PS11', layer: 'PS', file: F.kc01, fn: 'core.command_link_identity_alias', direction: 'strengthens', family: 'lock_added', fnFamily: 'platform',
    rationale: 'Kullanıcı + sağlayıcı anahtarlı ikinci advisory kilit eklendi; aynı kullanıcıya farklı dış kimliklerin eşzamanlı bağlanması serileşir, "kullanıcı zaten bağlı" kontrolü yarışa açık kalmaz.',
    mutations: [M(`  perform pg_advisory_xact_lock(hashtextextended('identity_alias:' || v_provider || ':' || v_subject, 0));
`, `  perform pg_advisory_xact_lock(hashtextextended('identity_alias:' || v_provider || ':' || v_subject, 0));
  perform pg_advisory_xact_lock(hashtextextended('identity_user:' || v_user_id::text || ':' || v_provider, 0));
`)] },
  { id: 'PS12', layer: 'PS', file: F.media, fn: 'update_business_public_profile', direction: 'strengthens', family: 'share_fence', fnFamily: 'media',
    rationale: 'Kapak görselinin "ready" kontrolüne paylaşımlı satır kilidi eklendi; görsel satırını FOR UPDATE ile kilitleyen eşzamanlı silme başlatma, kontrol ile profil yazımı arasına giremez.',
    mutations: [M(`    where m.business_id = p_business_id and m.id = p_cover_media_id and m.status = 'ready'
  ) then`, `    where m.business_id = p_business_id and m.id = p_cover_media_id and m.status = 'ready'
    for share
  ) then`)] },
  { id: 'PS13', layer: 'PS', file: F.core, fn: 'reschedule_appointment', direction: 'strengthens', family: 'lock_added', fnFamily: 'booking',
    rationale: 'İşletme + personel anahtarlı advisory kilit eklendi; aynı personele eşzamanlı yeniden planlamalar uygunluk kontrolü ile güncelleme arasında serileşir.',
    mutations: [M(`  v_date := (p_starts_at at time zone v_current.timezone)::date;
  if not exists (`, `  v_date := (p_starts_at at time zone v_current.timezone)::date;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text || ':booking-staff:' || p_staff_id::text, 0));
  if not exists (`)] },
  { id: 'PS14', layer: 'PS', file: F.retention, fn: 'prune_public_booking_rate_counters', direction: 'strengthens', family: 'skip_locked_added', fnFamily: 'public',
    rationale: 'Silinecek eski sayaçlar FOR UPDATE SKIP LOCKED ile seçiliyor; eşzamanlı temizleyiciler birbirini beklemez, o anda başka işlemin kilitlediği sayaç atlanır.',
    mutations: [M(`    order by stale.updated_at
    limit 500
  );`, `    order by stale.updated_at
    limit 500
    for update skip locked
  );`)] },
  { id: 'PS15', layer: 'PS', file: F.hours4, fn: 'create_availability_block_local', direction: 'strengthens', family: 'share_fence', fnFamily: 'availability',
    rationale: 'Personel kontrolüne paylaşımlı satır kilidi eklendi; eşzamanlı personel pasifleştirme bu blok eklemesiyle serileşir.',
    mutations: [M(`    where s.business_id = p_business_id and s.id = p_staff_id and s.active
  ) then`, `    where s.business_id = p_business_id and s.id = p_staff_id and s.active
    for share of s
  ) then`)] },
  { id: 'PS16', layer: 'PS', file: F.ticket, fn: 'f14_financial_actor', direction: 'strengthens', family: 'share_fence', fnFamily: 'ticket',
    rationale: 'Finansal aktörün üyelik okumasına paylaşımlı satır kilidi eklendi; eşzamanlı üyelik pasifleştirme, bu fiş işlemi bitene kadar bekler.',
    mutations: [M(`    and m.active
  limit 1;`, `    and m.active
  limit 1
  for share of m;`)] },
  { id: 'PS17', layer: 'PS', file: F.lifecycle, fn: 'set_appointment_group_status', direction: 'strengthens', family: 'lock_before_check', fnFamily: 'group',
    rationale: 'Grup satırlarının kilidi durum sayımından önceye alındı; "bütün satırlar aynı durumda mı" kontrolü artık kilitli satırlar üzerinde yapılır, sayım ile toplu güncelleme arasına eşzamanlı satır değişikliği giremez.',
    mutations: [
      M(`  select
    count(*)::integer,
    count(*) filter (where a.status=v_from_status)::integer`, `  perform 1
  from public.appointments a
  where a.business_id=p_business_id and a.group_id=p_group_id
  order by a.line_ordinal,a.id
  for update;

  select
    count(*)::integer,
    count(*) filter (where a.status=v_from_status)::integer`),
      M(`    raise exception 'BOOKING_GROUP_PARTIAL_STATUS';
  end if;

  perform 1
  from public.appointments a
  where a.business_id=p_business_id and a.group_id=p_group_id
  order by a.line_ordinal,a.id
  for update;

`, `    raise exception 'BOOKING_GROUP_PARTIAL_STATUS';
  end if;

`),
    ] },
  { id: 'PS18', layer: 'PS', file: F.payment, fn: 'f14_payment_actor', direction: 'strengthens', family: 'share_fence', fnFamily: 'payment',
    rationale: 'Ödeme aktörünün üyelik okumasına paylaşımlı satır kilidi eklendi; eşzamanlı üyelik pasifleştirme, bu ödeme işlemi bitene kadar bekler.',
    mutations: [M(`    and m.active
  limit 1;`, `    and m.active
  limit 1
  for share;`)] },
  { id: 'PS19', layer: 'PS', file: F.kc01, fn: 'core.command_change_subscription', direction: 'strengthens', family: 'stale_token', fnFamily: 'platform',
    rationale: 'İstek beklenen abonelik sürümünü taşıyorsa kilit altında karşılaştırılıyor; eski görünüme dayanan eşzamanlı plan değişikliği reddedilir (iyimser sürüm).',
    mutations: [M(`  from core.subscriptions s where s.business_id = v_business_id for update;
  v_exists := found;`, `  from core.subscriptions s where s.business_id = v_business_id for update;
  v_exists := found;
  if p_payload ? 'expected_version'
     and v_subscription.version is distinct from (p_payload->>'expected_version')::integer then
    raise exception 'SUBSCRIPTION_VERSION_CONFLICT';
  end if;`)] },
  { id: 'PS20', layer: 'PS', file: F.ticket, fn: 'open_walk_in_ticket_guarded', direction: 'strengthens', family: 'share_fence', fnFamily: 'ticket',
    rationale: 'Müşteri okumasına paylaşımlı satır kilidi eklendi; aynı müşteriyi kilitleyen eşzamanlı düzenleme, fiş açma bitene kadar bekler.',
    mutations: [M(`    and c.id = p_customer_id;

  if v_customer.id is null then raise exception 'CUSTOMER_NOT_FOUND'; end if;`, `    and c.id = p_customer_id
  for share;

  if v_customer.id is null then raise exception 'CUSTOMER_NOT_FOUND'; end if;`)] },
  // ======================= PP: D5 + başka eksen (4 × D0..D4) =======================
  { id: 'PP01', layer: 'PP', axes: ['D0'], file: F.team, fn: 'set_membership_financial_permission', direction: 'weakens', family: 'check_before_lock', fnFamily: 'team',
    rationale: 'D5: yetki okuması işletme kilidinden önceye taşındı (aynı kilidi alan eşzamanlı rol düşürme gözden kaçar). D0: finansal yetki yalnız personel değil yönetici üyelere de verilebiliyor.',
    mutations: [
      M(`  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text, 0));
  select * into v_actor from public.f10_team_actor(p_business_id);
  if v_actor.membership_id is null or v_actor.role <> 'owner' then
    raise exception 'FINANCIAL_PERMISSION_OWNER_REQUIRED' using errcode = '42501';
  end if;`, `  select * into v_actor from public.f10_team_actor(p_business_id);
  if v_actor.membership_id is null or v_actor.role <> 'owner' then
    raise exception 'FINANCIAL_PERMISSION_OWNER_REQUIRED' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text, 0));`),
      M(`  if v_target.role <> 'staff' then`, `  if v_target.role not in ('staff', 'manager') then`),
    ] },
  { id: 'PP02', layer: 'PP', axes: ['D0'], file: F.hoursLimits, fn: 'create_availability_block_local_guarded', direction: 'weakens', family: 'lock_removal', fnFamily: 'availability',
    rationale: 'D5: blok sayımını serileştiren advisory kilit kaldırıldı (eşzamanlı eklemeler 100 sınırını birlikte geçer; aynı ad alanını kilitleyen grup randevusuyla da serileşmez). D0: blok eklemeyi yönetici yerine her aktif üye yapabiliyor.',
    mutations: [M(`  if not public.can_manage_business(p_business_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'f10-04:availability-blocks:' || p_business_id::text, 0
  ));
`, `  if not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
`)] },
  { id: 'PP03', layer: 'PP', axes: ['D0'], file: F.groupInteg, fn: 'change_appointment_group_line_service', direction: 'weakens', family: 'version_check_removed', fnFamily: 'group',
    rationale: 'D5: beklenen grup sürümü artık karşılaştırılmıyor (ön kontrol ve güncelleme koşulu kaldırıldı; eski görünümle hizmet değiştirilebilir). D0: işlem her aktif üye yerine yalnız yöneticilere açık.',
    mutations: [
      M(`  if auth.uid() is null or not public.is_active_member(p_business_id) then`, `  if auth.uid() is null or not public.can_manage_business(p_business_id) then`),
      M(`  if v_group.version<>p_expected_version then raise exception 'BOOKING_GROUP_VERSION_CONFLICT'; end if;
  if v_line.status not in ('scheduled','confirmed') then
    raise exception 'BOOKING_GROUP_LINE_NOT_CHANGEABLE';`, `  if v_line.status not in ('scheduled','confirmed') then
    raise exception 'BOOKING_GROUP_LINE_NOT_CHANGEABLE';`),
      M(`  where g.business_id=p_business_id and g.id=p_group_id and g.version=p_expected_version
  returning g.version into v_new_version;`, `  where g.business_id=p_business_id and g.id=p_group_id
  returning g.version into v_new_version;`),
    ] },
  { id: 'PP04', layer: 'PP', axes: ['D0'], file: F.mediaRepair, fn: 'begin_business_public_media_delete', direction: 'weakens', family: 'lock_removal', fnFamily: 'media',
    rationale: 'D5: işletme satırı kilidi düz okumaya indi (aynı kilidi alan profil kapak güncellemesiyle serileşmez; silinmekte olan görsel kapak olarak kalabilir). D0: görsel silmeyi yönetici yerine her aktif üye başlatabiliyor.',
    mutations: [M(`  if not public.can_manage_business(p_business_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  perform 1 from public.businesses b where b.id = p_business_id for update;`, `  if not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  perform 1 from public.businesses b where b.id = p_business_id;`)] },
  { id: 'PP05', layer: 'PP', axes: ['D1'], file: F.publicGroup, fn: 'reschedule_public_managed_group', direction: 'weakens', family: 'check_before_lock', fnFamily: 'group',
    rationale: '"Komut zaten var mı" yoklaması advisory kilitten önceye taşındı: aynı anahtarla eşzamanlı iki istek kilitten önce komutu yok görür (D5); ikincisi çekirdekte tekrar olarak döner ama yeniden planlama bildirimini yine üretir (D1: tekrar eden istek ikinci yan etki).',
    mutations: [
      M(`  -- Serialize the wrapper with the core so only the transaction that creates`, `  select exists(
    select 1 from public.booking_commands bc
    where bc.business_id=v_ref.business_id and bc.idempotency_key=p_idempotency_key
  ) into v_preexisting;

  -- Serialize the wrapper with the core so only the transaction that creates`),
      M(`  )::text);
  select exists(
    select 1 from public.booking_commands bc
    where bc.business_id=v_ref.business_id and bc.idempotency_key=p_idempotency_key
  ) into v_preexisting;
`, `  )::text);
`),
    ] },
  { id: 'PP06', layer: 'PP', axes: ['D1'], file: F.kc01, fn: 'public.core_apply_platform_command', direction: 'weakens', family: 'check_then_insert', fnFamily: 'platform',
    rationale: 'Tekrar talebi ON CONFLICT DO NOTHING yerine "önce oku, yoksa ekle" oldu: aynı anahtarla eşzamanlı iki çağrı birlikte "yok" görür (D5); ikincisi kayıtlı sonucu döndürmek yerine benzersizlik hatası alır (D1: tekrar semantiği).',
    mutations: [
      M(`    insert into core.platform_commands (principal_id, idempotency_key, command, request_hash)
    values (v_principal_id, p_idempotency_key, p_command, v_request_hash)
    on conflict (principal_id, idempotency_key) do nothing;
    get diagnostics v_inserted = row_count;

    if v_inserted = 0 then
      select * into v_existing
      from core.platform_commands c
      where c.principal_id = v_principal_id and c.idempotency_key = p_idempotency_key;
`, `    select * into v_existing
    from core.platform_commands c
    where c.principal_id = v_principal_id and c.idempotency_key = p_idempotency_key;
    v_inserted := case when found then 0 else 1 end;

    if v_inserted = 0 then
`),
      M(`    case p_command
      when 'LinkTenantAlias' then`, `    insert into core.platform_commands (principal_id, idempotency_key, command, request_hash)
    values (v_principal_id, p_idempotency_key, p_command, v_request_hash);

    case p_command
      when 'LinkTenantAlias' then`),
    ] },
  { id: 'PP07', layer: 'PP', axes: ['D1'], file: F.kc01, fn: 'core.command_link_tenant_alias', direction: 'weakens', family: 'lock_removal', fnFamily: 'platform',
    rationale: 'D5: işletme ve takma ad kilitleri kaldırıldı (aynı işletmeye eşzamanlı iki farklı takma ad bağlama "işletme zaten bağlı" kontrolünü birlikte geçer). D1: aynı takma adın aynı işletmeye yeniden bağlanması artık "zaten bağlı" diye başarılı dönmüyor, çakışma hatası veriyor (tekrar semantiği).',
    mutations: [
      M(`  perform core.lock_business(v_business_id);
  perform core.lock_tenant_alias(v_provider, v_external_id);

`, ``),
      M(`  if found then
    if v_existing.business_id <> v_business_id then
      raise exception 'TENANT_ALIAS_CONFLICT';
    end if;
    return jsonb_build_object(
      'business_id', v_existing.business_id,
      'provider', v_existing.provider,
      'external_id', v_existing.external_id,
      'linked', false
    );
  end if;`, `  if found then
    raise exception 'TENANT_ALIAS_CONFLICT';
  end if;`),
    ] },
  { id: 'PP08', layer: 'PP', axes: ['D1'], file: F.sale, fn: 'cancel_ticket_guarded', direction: 'weakens', family: 'lock_removal', fnFamily: 'sale',
    rationale: 'D5: iptal döngüsündeki ürün satırı kilidi kaldırıldı (stok iadesi aynı ürünün eşzamanlı satışıyla kayıp güncelleme yaşar). D1: tekrar eden istek kayıtlı sonucu döndürmüyor, iptali yeniden çalıştırıyor.',
    mutations: [
      M(`  if v_replay is not null then return v_replay; end if;
  if v_reason is null`, `  if v_reason is null`),
      M(`    where p.business_id=p_business_id and p.id=v_line.product_id
    for update;`, `    where p.business_id=p_business_id and p.id=v_line.product_id;`),
    ] },
  { id: 'PP09', layer: 'PP', axes: ['D2'], file: F.sale, fn: 'open_product_sale_guarded', direction: 'weakens', family: 'share_fence_removed', fnFamily: 'sale',
    rationale: 'D5: müşteri okumasındaki paylaşımlı kilit kaldırıldı (eşzamanlı müşteri düzenlemesi okuma ile fiş eklemesi arasına girebilir). D2: fiş müşteri e-posta anlık görüntüsünü yakalamıyor.',
    mutations: [
      M(`  where c.business_id=p_business_id and c.id=p_customer_id
  for share;`, `  where c.business_id=p_business_id and c.id=p_customer_id
  limit 1;`),
      M(`    v_customer.name,v_customer.phone,v_customer.email,v_actor.id`, `    v_customer.name,v_customer.phone,null,v_actor.id`),
    ] },
  { id: 'PP10', layer: 'PP', axes: ['D2'], file: F.payment, fn: 'set_ticket_service_discount_guarded', direction: 'weakens', family: 'version_bump_removed', fnFamily: 'payment',
    rationale: 'D5: indirim artık fiş sürümünü artırmıyor (fişin sürüm belirteciyle çalışan eşzamanlı istemciler indirimi görmeden yazar). D2: indirim gerekçesi satırda saklanmıyor (geçmiş kaydı).',
    mutations: [
      M(`      discount_reason = case when p_discount_minor > 0 then v_reason else null end`, `      discount_reason = null`),
      M(`  update public.tickets
  set version = version + 1
  where business_id = p_business_id and id = p_ticket_id;

  v_result`, `  v_result`),
    ] },
  { id: 'PP11', layer: 'PP', axes: ['D2'], file: F.ticket, fn: 'open_ticket_from_booking_group_guarded', direction: 'weakens', family: 'share_fence_removed', fnFamily: 'ticket',
    rationale: 'D5: grup okumasındaki paylaşımlı kilit kaldırıldı (grubu FOR UPDATE ile kilitleyen eşzamanlı iptal, fiş açmayla serileşmez; iptal edilmekte olan gruba fiş açılabilir). D2: fiş müşteri telefon anlık görüntüsünü yakalamıyor.',
    mutations: [
      M(`    and g.id = p_group_id
  for share;`, `    and g.id = p_group_id
  limit 1;`),
      M(`      a.customer_phone_snapshot,
      a.customer_email_snapshot,
      v_actor.id`, `      null,
      a.customer_email_snapshot,
      v_actor.id`),
    ] },
  { id: 'PP12', layer: 'PP', axes: ['D2'], file: F.groupOld, fn: 'create_appointment_group', direction: 'weakens', family: 'lock_order_removed', fnFamily: 'group',
    rationale: 'D5: personel satırı kilitleri artık sabit artan sırayla alınmıyor (aynı personel kümesine eşzamanlı iki grup kilitlenmede birbirini bekleyip çıkmaza girebilir). D2: oluşturma olayı planlanan satırların anlık kaydını tutmuyor.',
    mutations: [
      M(`  order by sp.id
  for update;`, `  for update;`),
      M(`      'lineCount', jsonb_array_length(v_plan->'lines'),
      'lines', v_plan->'lines'
    )`, `      'lineCount', jsonb_array_length(v_plan->'lines')
    )`),
    ] },
  { id: 'PP13', layer: 'PP', axes: ['D3'], file: F.teamSec, fn: 'create_business_invitation', direction: 'weakens', family: 'lock_removal', fnFamily: 'team',
    rationale: 'D5: bekleyen davet sayımını serileştiren advisory kilit kaldırıldı (eşzamanlı davetler sınırı birlikte geçer). D3: bekleyen davet sınırı 100\'den 200\'e çıktı.',
    mutations: [
      M(`  perform public.f10_require_standard_session();
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text, 0));
`, `  perform public.f10_require_standard_session();
`),
      M(`  if v_pending_count >= 100 then`, `  if v_pending_count >= 200 then`),
    ] },
  { id: 'PP14', layer: 'PP', axes: ['D3'], file: F.outbox, fn: 'claim_notification_jobs', direction: 'weakens', family: 'nowait', fnFamily: 'notification',
    rationale: 'D5: aday iş kilitliyse atlanmıyor, NOWAIT ile hata veriliyor (eşzamanlı ikinci işçi talep turunu kaybeder). D3: tek talepte alınabilecek iş sayısı 50\'den 200\'e çıktı.',
    mutations: [
      M(`  v_limit := greatest(1, least(coalesce(p_limit, 10), 50));`, `  v_limit := greatest(1, least(coalesce(p_limit, 10), 200));`),
      M(`    for update skip locked
    limit v_limit`, `    for update nowait
    limit v_limit`),
    ] },
  { id: 'PP15', layer: 'PP', axes: ['D3'], file: F.sale, fn: 'add_ticket_product_line_guarded', direction: 'weakens', family: 'lock_removal', fnFamily: 'sale',
    rationale: 'D5: fiş satırı kilidi kaldırıldı (aynı fişe eşzamanlı satır eklemeleri aynı sıra numarasını ve sürümü görür). D3: stok yeterliliği denetlenmiyor; eldeki stoktan fazlası satılabiliyor.',
    mutations: [
      M(`  where t.business_id = p_business_id and t.id = p_ticket_id
  for update;
  if v_ticket.id is null then raise exception 'TICKET_NOT_FOUND'; end if;
  if v_ticket.status <> 'open' then raise exception 'TICKET_NOT_OPEN'; end if;
  if p_expected_ticket_version`, `  where t.business_id = p_business_id and t.id = p_ticket_id;
  if v_ticket.id is null then raise exception 'TICKET_NOT_FOUND'; end if;
  if v_ticket.status <> 'open' then raise exception 'TICKET_NOT_OPEN'; end if;
  if p_expected_ticket_version`),
      M(`  if v_product.stock_on_hand < p_quantity then raise exception 'INSUFFICIENT_STOCK'; end if;
  if v_ticket.currency`, `  if v_ticket.currency`),
    ] },
  { id: 'PP16', layer: 'PP', axes: ['D3'], file: F.core, fn: 'reschedule_appointment', direction: 'strengthens', family: 'share_fence', fnFamily: 'booking',
    rationale: 'D5: personel okumasına paylaşımlı satır kilidi eklendi (eşzamanlı personel düzenlemesi yeniden planlamayla serileşir). D3: personelin aktif olması şartı kalktı; pasif personele yeniden planlanabiliyor.',
    mutations: [M(`  where sp.business_id = p_business_id and sp.id = p_staff_id and sp.active;
  if v_staff.id is null then raise exception 'STAFF_NOT_ELIGIBLE'; end if;`, `  where sp.business_id = p_business_id and sp.id = p_staff_id
  for share of sp;
  if v_staff.id is null then raise exception 'STAFF_NOT_ELIGIBLE'; end if;`)] },
  { id: 'PP17', layer: 'PP', axes: ['D4'], file: F.infoLinks, fn: 'update_public_booking_settings', direction: 'weakens', family: 'lock_removal', fnFamily: 'settings',
    rationale: 'D5: işletme satırı kilidi düz okumaya indi (yayına alma hazırlık kontrolü, iletişim bilgisini kaldıran eşzamanlı profil yazımıyla serileşmez). D4: asgari önceden bildirim üst sınırı 7 günden 30 güne çıktı.',
    mutations: [
      M(`     or p_min_notice_minutes < 0 or p_min_notice_minutes > 10080`, `     or p_min_notice_minutes < 0 or p_min_notice_minutes > 43200`),
      M(`  perform 1 from public.businesses b where b.id = p_business_id for update;`, `  perform 1 from public.businesses b where b.id = p_business_id;`),
    ] },
  { id: 'PP18', layer: 'PP', axes: ['D4'], file: F.outbox, fn: 'release_notification_job', direction: 'weakens', family: 'fencing_token_removed', fnFamily: 'notification',
    rationale: 'D5: kilitli okumadan kiralama belirteci koşulu kaldırıldı (kiralaması düşmüş eski bir işçi, işi yeniden kiralamış başka işçinin kiralamasını bırakabilir). D4: yeniden deneme gecikmesi üst sınırı 1 günden 7 güne çıktı.',
    mutations: [
      M(`    and j.state = 'leased'
    and j.lease_token = p_lease_token
  for update;`, `    and j.state = 'leased'
  for update;`),
      M(`  v_delay := greatest(1, least(coalesce(p_retry_after_seconds, 60), 86400));`, `  v_delay := greatest(1, least(coalesce(p_retry_after_seconds, 60), 604800));`),
    ] },
  { id: 'PP19', layer: 'PP', axes: ['D4'], file: F.dateRange, fn: 'list_appointments_page_v3', direction: 'weakens', family: 'share_fence_removed', fnFamily: 'booking',
    rationale: 'D5: sayfa revizyonu okumasındaki paylaşımlı kilit kaldırıldı (revizyonu yenileyen eşzamanlı randevu yazımı beklenmiyor; sayfa, verisiyle uyuşmayan revizyonla dönebilir). D4: tarih aralığının bitişi dahil oldu (bitiş gününün 00:00 randevusu da listeleniyor).',
    mutations: [
      M(`  where r.business_id = p_business_id
  for share;`, `  where r.business_id = p_business_id;`),
      M(`      or (a.starts_at >= v_from and a.starts_at < v_to)`, `      or (a.starts_at >= v_from and a.starts_at <= v_to)`),
    ] },
  { id: 'PP20', layer: 'PP', axes: ['D4'], file: F.recovery, fn: 'recover_public_appointment', direction: 'weakens', family: 'lock_removal', fnFamily: 'public',
    rationale: 'D5: sürmekte olan oluşturmayı bekleten advisory kilit kaldırıldı (aynı kurtarma kimliğiyle oluşturma bitmeden sorgu "yok" döner). D4: kurtarma bilgisi süresi dolduktan sonra 10 dakika daha geçerli ve o süre boyunca silinmiyor.',
    mutations: [
      M(`  -- If create is still in-flight for this recovery ID, wait for its transaction
  -- outcome before deciding whether the booking exists.
  perform pg_advisory_xact_lock(hashtextextended(p_recovery_id::text, 0));

`, ``),
      M(`    and r.expires_at <= now();`, `    and r.expires_at <= now() - interval '10 minutes';`),
      M(`    and r.expires_at > now()
  limit 1;`, `    and r.expires_at > now() - interval '10 minutes'
  limit 1;`),
    ] },

  // ======================= NS: D5 yok, tek eksen (4 × D0..D4) =======================
  { id: 'NS01', layer: 'NS', axes: ['D0'], file: F.team, fn: 'set_membership_financial_permission', family: 'authority_scope', fnFamily: 'team',
    rationale: 'Finansal yetki verme/geri alma sahibe ek olarak yöneticiye de açıldı (yetki kapsamı); kontrol aynı kilit altında.',
    mutations: [M(`  if v_actor.membership_id is null or v_actor.role <> 'owner' then`, `  if v_actor.membership_id is null or v_actor.role not in ('owner', 'manager') then`)] },
  { id: 'NS02', layer: 'NS', axes: ['D0'], file: F.mediaRepair, fn: 'restore_business_public_media_delete', family: 'authority_scope', fnFamily: 'media',
    rationale: 'Silinmekte olan görseli geri yüklemeyi yönetici yerine her aktif üye yapabiliyor (yetki kapsamı); işletme kilidi yerinde.',
    mutations: [M(`  if not public.can_manage_business(p_business_id) then`, `  if not public.is_active_member(p_business_id) then`)] },
  { id: 'NS03', layer: 'NS', axes: ['D0'], file: F.kc01, fn: 'core.authorize_service_principal', family: 'authority_scope', fnFamily: 'platform',
    rationale: 'Pasifleştirilmiş servis kimlikleri de yetkilendiriliyor (etkinlik koşulu kaldırıldı).',
    mutations: [M(`  where p.name = p_name
    and p.active
    and p_secret is not null`, `  where p.name = p_name
    and p_secret is not null`)] },
  { id: 'NS04', layer: 'NS', axes: ['D0'], file: F.s03, fn: 'claim_notification_jobs_v2', family: 'authority_scope', fnFamily: 'notification',
    rationale: 'Gönderim sırrı doğrulaması kaldırıldı; iş talebini ve alıcı/yönetim verisini yetkisiz çağıran da alabilir.',
    mutations: [M(`  if not public.notification_dispatch_authorized(p_dispatch_secret) then
    raise exception 'NOTIFICATION_DISPATCH_UNAUTHORIZED';
  end if;

  v_limit`, `  v_limit`)] },
  { id: 'NS05', layer: 'NS', axes: ['D1'], file: F.lifecycle, fn: 'set_appointment_group_status', family: 'request_hash', fnFamily: 'group',
    rationale: 'Tekrar özeti hedef durumu içermiyor; aynı anahtarla farklı durum isteyen çağrı, öncekinin tekrarı sayılıp önceki sonucu alır.',
    mutations: [M(`    'expectedVersion',p_expected_version,
    'status',p_status
  )::text);`, `    'expectedVersion',p_expected_version
  )::text);`)] },
  { id: 'NS06', layer: 'NS', axes: ['D1'], file: F.groupInteg, fn: 'change_appointment_group_line_service', family: 'request_hash', fnFamily: 'group',
    rationale: 'Tekrar özeti yeni hizmeti içermiyor; aynı anahtarla farklı hizmet isteyen çağrı, öncekinin tekrarı sayılır.',
    mutations: [M(`    'expectedVersion',p_expected_version,'serviceId',p_service_id
  )::text);`, `    'expectedVersion',p_expected_version
  )::text);`)] },
  { id: 'NS07', layer: 'NS', axes: ['D1'], file: F.groupRepair, fn: 'f11_cancel_group_core', family: 'request_hash', fnFamily: 'group',
    rationale: 'Tekrar özeti iptal gerekçesini içermiyor; aynı anahtarla farklı gerekçeli istek, öncekinin tekrarı sayılır.',
    mutations: [M(`    'expectedVersion',p_expected_version,
    'reason',v_reason
  )::text);`, `    'expectedVersion',p_expected_version
  )::text);`)] },
  { id: 'NS08', layer: 'NS', axes: ['D1'], file: F.payment, fn: 'f14_claim_ticket_command', family: 'receipt_conflict', fnFamily: 'payment',
    rationale: 'Aynı anahtarla farklı içerikli istek, önceki komut tamamlandıysa reddedilmiyor ve önceki sonucu alıyor (tekrar semantiği).',
    mutations: [M(`  if v_hash is distinct from p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT';`, `  if v_hash is distinct from p_request_hash and v_result is null then
    raise exception 'IDEMPOTENCY_CONFLICT';`)] },
  { id: 'NS09', layer: 'NS', axes: ['D2'], file: F.groupInteg, fn: 'change_appointment_group_line_service', family: 'snapshot', fnFamily: 'group',
    rationale: 'Hizmet değişince satırın fiyat politikası sürümü anlık görüntüsü güncellenmiyor; yeni fiyat alanları eski politika sürümüyle etiketli kalır.',
    mutations: [M(`      price_policy_version_snapshot=v_service.price_policy_version,
`, ``)] },
  { id: 'NS10', layer: 'NS', axes: ['D2'], file: F.kc01, fn: 'core.command_change_subscription', family: 'history', fnFamily: 'platform',
    rationale: 'Abonelik olayı, değişikliğin hangi plan politikası sürümüyle hesaplandığını kaydetmiyor (yakalanan politika).',
    mutations: [M(`    p_idempotency_key,
    v_policy_version
  )
  returning id into v_event_id;`, `    p_idempotency_key,
    null
  )
  returning id into v_event_id;`)] },
  { id: 'NS11', layer: 'NS', axes: ['D2'], file: F.sale, fn: 'add_ticket_product_line_guarded', family: 'snapshot', fnFamily: 'sale',
    rationale: 'Satış satırı ürün kodu anlık görüntüsünü yakalamıyor (kod sonradan değişirse satırdan izlenemez).',
    mutations: [M(`    v_product.id,v_product.name,v_product.code,`, `    v_product.id,v_product.name,null,`)] },
  { id: 'NS12', layer: 'NS', axes: ['D2'], file: F.sale, fn: 'open_product_sale_guarded', family: 'snapshot', fnFamily: 'sale',
    rationale: 'Satış satırı, fiyatın hangi ürün sürümünden alındığını (fiyat politikası sürümü anlık görüntüsü) yakalamıyor.',
    mutations: [M(`    v_product.currency,v_product.version,`, `    v_product.currency,null,`)] },
  { id: 'NS13', layer: 'NS', axes: ['D3'], file: F.lockFinal, fn: 'f11_validate_native_group_schedule_authority', family: 'service_availability', fnFamily: 'group',
    rationale: 'Yeni oluşturulan ya da hizmeti değiştirilen grup satırında arşivlenmiş (pasif) hizmet de kabul ediliyor (hizmet uygunluğu).',
    mutations: [M(`    where s.business_id=new.business_id and s.id=new.service_id and s.active`, `    where s.business_id=new.business_id and s.id=new.service_id`)] },
  { id: 'NS14', layer: 'NS', axes: ['D3'], file: F.lockFinal, fn: 'f11_validate_native_group_schedule_authority', family: 'staff_eligibility', fnFamily: 'group',
    rationale: 'Grup satırlarının personel uygunluk denetimi pasif personeli de kabul ediyor (personel etkinlik koşulu kaldırıldı).',
    mutations: [M(`          where sp.business_id=a.business_id and sp.id=a.staff_id and sp.active`, `          where sp.business_id=a.business_id and sp.id=a.staff_id`)] },
  { id: 'NS15', layer: 'NS', axes: ['D3'], file: F.hoursLimits, fn: 'create_availability_block_local_guarded', family: 'resource_limit', fnFamily: 'availability',
    rationale: 'Blok limitine pasif bloklar da sayılıyor (kapasite kuralı); sayım aynı kilit altında.',
    mutations: [M(`  where b.business_id = p_business_id and b.active;`, `  where b.business_id = p_business_id;`)] },
  { id: 'NS16', layer: 'NS', axes: ['D3'], file: F.groupInteg, fn: 'reschedule_appointment_group_line', family: 'staff_eligibility', fnFamily: 'group',
    rationale: 'Grup satırı pasif personele de taşınabiliyor (personel etkinlik koşulu kaldırıldı).',
    mutations: [M(`  where sp.business_id=p_business_id and sp.id=p_staff_id and sp.active;`, `  where sp.business_id=p_business_id and sp.id=p_staff_id;`)] },
  { id: 'NS17', layer: 'NS', axes: ['D4'], file: F.lockFinal, fn: 'f11_validate_native_group_schedule_authority', family: 'time_boundary', fnFamily: 'group',
    rationale: 'Tam kapanış saatinde biten grup satırı artık işletme saatleri dışında sayılıyor (pencere sonu dışlayıcı oldu).',
    mutations: [M(`            and ((((a.starts_at at time zone v_timezone)::date)+bh.ends_local) at time zone v_timezone) >= a.ends_at`, `            and ((((a.starts_at at time zone v_timezone)::date)+bh.ends_local) at time zone v_timezone) > a.ends_at`)] },
  { id: 'NS18', layer: 'NS', axes: ['D4'], file: F.groupInteg, fn: 'reschedule_appointment_group_line', family: 'time_boundary', fnFamily: 'group',
    rationale: 'İşletme saatleri kontrolü yalnız başlangıcın pencere içinde olmasını istiyor; hizmet kapanış saatini aşabiliyor (zaman penceresi sınırı).',
    mutations: [M(`      and ((((p_starts_at at time zone v_timezone)::date)+bh.ends_local) at time zone v_timezone) >= v_ends_at`, `      and ((((p_starts_at at time zone v_timezone)::date)+bh.ends_local) at time zone v_timezone) >= p_starts_at`)] },
  { id: 'NS19', layer: 'NS', axes: ['D4'], file: F.hours4, fn: 'create_availability_block_local', family: 'time_boundary', fnFamily: 'availability',
    rationale: 'Gece yarısını aşan bloklar artık ertesi güne taşınmıyor; bitişi başlangıçtan önce olan yerel saatler geçersiz blok sayılıyor (yerel gün sınırı).',
    mutations: [M(`  v_end_date := case when p_end_local <= p_start_local then p_date + 1 else p_date end;`, `  v_end_date := p_date;`)] },
  { id: 'NS20', layer: 'NS', axes: ['D4'], file: F.retention, fn: 'prune_public_booking_rate_counters', family: 'time_boundary', fnFamily: 'public',
    rationale: 'Eski sayaçların silinme eşiği 48 saatten 72 saate çıktı (saklama süresi sınırı).',
    mutations: [M(`    where stale.updated_at < clock_timestamp() - interval '48 hours'`, `    where stale.updated_at < clock_timestamp() - interval '72 hours'`)] },
  // ======================= NP: D5 yok, iki eksen (10 çift × 2) =======================
  { id: 'NP01', layer: 'NP', axes: ['D0', 'D1'], file: F.publicGroup, fn: 'reschedule_public_managed_group', family: 'authority_scope+replay', fnFamily: 'group',
    rationale: 'D0: herkese açık yönetim bağlantısı işletme tarafından oluşturulmuş grupları da yeniden planlayabiliyor (kaynak koşulu kaldırıldı). D1: tekrar eden istek de yeniden planlama bildirimini yeniden üretiyor.',
    mutations: [
      M(`  if v_group.id is null or v_group.legacy_appointment_id is not null or v_group.source<>'public' then`, `  if v_group.id is null or v_group.legacy_appointment_id is not null then`),
      M(`  if not v_preexisting and v_ref.recovery_id is not null then`, `  if v_ref.recovery_id is not null then`),
    ] },
  { id: 'NP02', layer: 'NP', axes: ['D0', 'D1'], file: F.groupInteg, fn: 'reschedule_appointment_group_line', family: 'authority_scope+request_hash', fnFamily: 'group',
    rationale: 'D0: işlem için işletme üyeliği aranmıyor; oturum açmış herhangi bir kullanıcı yeterli. D1: tekrar özeti personeli içermiyor (farklı personelli istek aynı istek sayılır).',
    mutations: [
      M(`  if auth.uid() is null or not public.is_active_member(p_business_id) then`, `  if auth.uid() is null then`),
      M(`    'expectedVersion',p_expected_version,'staffId',p_staff_id,'startsAt',p_starts_at`, `    'expectedVersion',p_expected_version,'startsAt',p_starts_at`),
    ] },
  { id: 'NP03', layer: 'NP', axes: ['D0', 'D2'], file: F.payment, fn: 'close_ticket_guarded', family: 'authority_scope+history', fnFamily: 'payment',
    rationale: 'D0: fiş kapatma fiyat düzeltme yetkisi yerine ödeme yetkisi istiyor. D2: kapatan üye kaydedilmiyor (geçmiş kaydı).',
    mutations: [
      M(`  v_actor := public.f14_financial_actor(p_business_id);`, `  v_actor := public.f14_payment_actor(p_business_id);`),
      M(`      closed_by_membership_id = v_actor.id,
`, ``),
    ] },
  { id: 'NP04', layer: 'NP', axes: ['D0', 'D2'], file: F.sale, fn: 'record_product_return_refund_guarded', family: 'authority_scope+history', fnFamily: 'sale',
    rationale: 'D0: ürün iadesi artık ödeme yetkisi istemiyor, envanter yetkisi yetiyor. D2: stoka dönüş hareketi iade gerekçesini değil sabit bir etiketi kaydediyor (geçmiş kaydı).',
    mutations: [
      M(`  v_actor := public.f15_product_return_actor(p_business_id);`, `  v_actor := public.f15_inventory_actor(p_business_id);`),
      M(`      p_business_id,v_product.id,'return',p_quantity,v_new_balance,v_reason,`, `      p_business_id,v_product.id,'return',p_quantity,v_new_balance,'product_return',`),
    ] },
  { id: 'NP05', layer: 'NP', axes: ['D0', 'D3'], file: F.abuse, fn: 'create_public_appointment_with_recovery_guarded', family: 'authority_scope+rate_limit', fnFamily: 'public',
    rationale: 'D0: herkese açık rezervasyon kapısı sırrı doğrulanmıyor. D3: oluşturma istekleri artık istek sınırına (kişi/ağ başı kota) tabi değil.',
    mutations: [
      M(`  if not public.public_booking_gate_authorized(p_gate_secret) then
    raise exception 'PUBLIC_BOOKING_GATE_UNAVAILABLE';
  end if;

`, ``),
      M(`  if not v_safe_retry then
    perform public.enforce_public_booking_rate(
      'create', p_actor_hash, p_network_hash, v_business_id
    );
  end if;

`, ``),
    ] },
  { id: 'NP06', layer: 'NP', axes: ['D0', 'D3'], file: F.sale, fn: 'add_ticket_product_line_guarded', family: 'authority_scope+resource_limit', fnFamily: 'sale',
    rationale: 'D0: ürün satırı eklemek fiyatlandırma yetkisi istemiyor, envanter yetkisi yetiyor. D3: fiş başına satır sınırı 100\'den 500\'e çıktı.',
    mutations: [
      M(`  v_actor := public.f15_product_sale_actor(p_business_id);`, `  v_actor := public.f15_inventory_actor(p_business_id);`),
      M(`  if v_ordinal > 100 then raise exception 'TICKET_LINE_LIMIT_EXCEEDED'; end if;`, `  if v_ordinal > 500 then raise exception 'TICKET_LINE_LIMIT_EXCEEDED'; end if;`),
    ] },
  { id: 'NP07', layer: 'NP', axes: ['D0', 'D4'], file: F.dateRange, fn: 'list_appointments_page_v3', family: 'authority_scope+local_day', fnFamily: 'booking',
    rationale: 'D0: standart oturum şartı kaldırıldı (kısıtlı oturum türleri de listeleyebiliyor). D4: tarih aralığının başlangıcı işletmenin yerel gün başı yerine UTC gün başı.',
    mutations: [
      M(`  perform public.f10_require_standard_session();
  if auth.uid() is null or not public.is_active_member(p_business_id) then`, `  if auth.uid() is null or not public.is_active_member(p_business_id) then`),
      M(`    v_from := p_start_date::timestamp at time zone v_timezone;`, `    v_from := p_start_date::timestamptz;`),
    ] },
  { id: 'NP08', layer: 'NP', axes: ['D0', 'D4'], file: F.hours4, fn: 'create_availability_block_local', family: 'authority_scope+time_boundary', fnFamily: 'availability',
    rationale: 'D0: blok eklemeyi yönetici yerine her aktif üye yapabiliyor. D4: geçmişte başlayan blok artık reddediliyor (zaman sınırı).',
    mutations: [
      M(`  if auth.uid() is null or not public.can_manage_business(p_business_id) then`, `  if auth.uid() is null or not public.is_active_member(p_business_id) then`),
      M(`  if v_start_at >= v_end_at then
    raise exception 'INVALID_BLOCK';
  end if;`, `  if v_start_at >= v_end_at or v_start_at < now() then
    raise exception 'INVALID_BLOCK';
  end if;`),
    ] },
  { id: 'NP09', layer: 'NP', axes: ['D1', 'D2'], file: F.expense, fn: 'correct_expense_guarded', family: 'dedupe+snapshot', fnFamily: 'expense',
    rationale: 'D1: "zaten ters kaydedilmiş" kontrolü kaldırıldı; aynı gider sırayla ikinci kez düzeltilebilir (tekilleştirme). D2: yeni gider kaydı saat dilimi anlık görüntüsünü yakalamıyor.',
    mutations: [
      M(`  if exists (
    select 1 from public.expense_events r
    where r.business_id=p_business_id
      and r.source_expense_event_id=p_source_event_id
      and r.event_type='reversal'
  ) then
    raise exception 'EXPENSE_ALREADY_REVERSED';
  end if;

`, ``),
      M(`    p_amount_minor,v_currency,p_payment_method,v_occurred_at,p_occurred_local::date,v_timezone,`, `    p_amount_minor,v_currency,p_payment_method,v_occurred_at,p_occurred_local::date,null,`),
    ] },
  { id: 'NP10', layer: 'NP', axes: ['D1', 'D2'], file: F.lifecycle, fn: 'set_appointment_group_status', family: 'request_hash+history', fnFamily: 'group',
    rationale: 'D1: tekrar özeti beklenen sürümü içermiyor (farklı sürüme dayanan istek aynı istek sayılır). D2: satır olayları satır sırasını kaydetmiyor (geçmiş kaydı).',
    mutations: [
      M(`    'groupId',p_group_id,
    'expectedVersion',p_expected_version,
    'status',p_status`, `    'groupId',p_group_id,
    'status',p_status`),
      M(`      'groupVersion',v_new_version,
      'lineOrdinal',a.line_ordinal,
      'scope','group'`, `      'groupVersion',v_new_version,
      'scope','group'`),
    ] },
  { id: 'NP11', layer: 'NP', axes: ['D1', 'D3'], file: F.sale, fn: 'open_product_sale_guarded', family: 'receipt+resource_limit', fnFamily: 'sale',
    rationale: 'D1: komut makbuzu sonuçla kapatılmıyor; tekrar eden istek kayıtlı sonucu bulamayıp satışı yeniden açar. D3: stok yeterliliği denetlenmiyor; eldeki stoktan fazlası satılabiliyor.',
    mutations: [
      M(`  if v_product.stock_on_hand < p_quantity then raise exception 'INSUFFICIENT_STOCK'; end if;

  insert into public.tickets(`, `  insert into public.tickets(`),
      M(`  v_result := public.f14_ticket_projection(p_business_id,v_ticket.id);
  perform public.f14_finish_ticket_command(
    p_business_id,v_actor.id,'open_product_sale',p_idempotency_key,v_ticket.id,v_result
  );
  return v_result;`, `  v_result := public.f14_ticket_projection(p_business_id,v_ticket.id);
  return v_result;`),
    ] },
  { id: 'NP12', layer: 'NP', axes: ['D1', 'D3'], file: F.lockFinal, fn: 'f11_create_group_internal', family: 'request_hash+resource_limit', fnFamily: 'group',
    rationale: 'D1: tekrar özeti notları içermiyor (farklı notlu istek aynı istek sayılır). D3: grup başına satır sınırı denetlenmiyor.',
    mutations: [
      M(`  if v_requested_count > public.f11_group_line_limit() then
    raise exception 'GROUP_LINE_LIMIT_EXCEEDED';
  end if;
`, ``),
      M(`    'startsAt', p_starts_at,
    'notes', v_notes
  )::text);`, `    'startsAt', p_starts_at
  )::text);`),
    ] },
  { id: 'NP13', layer: 'NP', axes: ['D1', 'D4'], file: F.groupInteg, fn: 'reschedule_appointment_group_line', family: 'request_hash+local_day', fnFamily: 'group',
    rationale: 'D1: tekrar özeti yeni başlangıç zamanını içermiyor (farklı zamanlı istek aynı istek sayılır). D4: personel uygunluğu için gün, işletmenin yerel günü yerine UTC gününden alınıyor.',
    mutations: [
      M(`    'expectedVersion',p_expected_version,'staffId',p_staff_id,'startsAt',p_starts_at`, `    'expectedVersion',p_expected_version,'staffId',p_staff_id`),
      M(`  v_date := (p_starts_at at time zone v_timezone)::date;`, `  v_date := p_starts_at::date;`),
    ] },
  { id: 'NP14', layer: 'NP', axes: ['D1', 'D4'], file: F.kc01, fn: 'core.command_provision_business', family: 'replay+timezone', fnFamily: 'platform',
    rationale: 'D1: zaten bağlı takma adla tekrar gelen istek artık mevcut işletmeye eşlenmiyor, çakışma hatası veriyor (tekrar semantiği). D4: saat dilimi verilmezse işletme İstanbul yerine UTC ile açılıyor.',
    mutations: [
      M(`  v_timezone text := coalesce(nullif(btrim(p_payload->>'timezone'), ''), 'Europe/Istanbul');`, `  v_timezone text := coalesce(nullif(btrim(p_payload->>'timezone'), ''), 'UTC');`),
      M(`    if found then
      select m.id into v_membership_id
      from public.memberships m
      where m.business_id = v_existing_alias.business_id and m.user_id = v_owner and m.active
      limit 1;
      return jsonb_build_object(
        'business_id', v_existing_alias.business_id,
        'slug', (select b.slug from public.businesses b where b.id = v_existing_alias.business_id),
        'membership_id', v_membership_id,
        'created', false,
        'tenant_alias_linked', true
      );
    end if;`, `    if found then
      raise exception 'TENANT_ALIAS_CONFLICT';
    end if;`),
    ] },
  { id: 'NP15', layer: 'NP', axes: ['D2', 'D3'], file: F.groupInteg, fn: 'reschedule_appointment_group_line', family: 'snapshot+availability', fnFamily: 'group',
    rationale: 'D2: personel değişince satırın personel adı anlık görüntüsü güncellenmiyor. D3: yeni personelin o aralıkta müsait olup olmadığı denetlenmiyor.',
    mutations: [
      M(`    set staff_id=p_staff_id,staff_name_snapshot=v_staff_name,`, `    set staff_id=p_staff_id,`),
      M(`  if not public.f11_staff_slot_free(
    p_business_id,p_staff_id,v_line.service_id,v_date,
    v_occupied_start,v_occupied_end,p_group_id
  ) then
    raise exception 'SLOT_UNAVAILABLE';
  end if;

`, ``),
    ] },
  { id: 'NP16', layer: 'NP', axes: ['D2', 'D3'], file: F.groupInteg, fn: 'change_appointment_group_line_service', family: 'snapshot+availability', fnFamily: 'group',
    rationale: 'D2: hizmet değişince satırın sabit fiyat anlık görüntüsü güncellenmiyor (eski hizmetin fiyatı kalır). D3: personelin o aralıkta müsait olup olmadığı denetlenmiyor.',
    mutations: [
      M(`      price_minor_snapshot=case when v_service.price_type='fixed' then v_service.price_minor else null end,
`, ``),
      M(`  if not public.f11_staff_slot_free(
    p_business_id,v_line.staff_id,p_service_id,v_date,
    v_line.occupied_starts_at,v_line.occupied_ends_at,p_group_id
  ) then
    raise exception 'SLOT_UNAVAILABLE';
  end if;

`, ``),
    ] },
  { id: 'NP17', layer: 'NP', axes: ['D2', 'D4'], file: F.kc01, fn: 'core.plan_entitlement_changes', family: 'policy_selection+validity', fnFamily: 'platform',
    rationale: 'D2: plan değişikliği yalnız plandan gelen yetkileri değil elle verilmiş yetkileri de geri alıyor (hangi yetkinin plana ait sayıldığı politikası). D4: plandan gelen yetkiler dönem sonu geçerlilik tarihi taşımıyor, süresiz kalıyor.',
    mutations: [
      M(`      'limit_value', pe.limit_value,
      'valid_until', p_valid_until`, `      'limit_value', pe.limit_value,
      'valid_until', null`),
      M(`      and e.granted
      and se.event_type = 'subscription_changed'
      and not exists (`, `      and e.granted
      and not exists (`),
    ] },
  { id: 'NP18', layer: 'NP', axes: ['D2', 'D4'], file: F.outbox, fn: 'release_notification_job', family: 'history+time_boundary', fnFamily: 'notification',
    rationale: 'D2: sonlandırmada ilk kaydedilmiş hata sınıfı korunuyor, son hata onu ezmiyor (geçmiş değer semantiği). D4: yeniden deneme bitiş anına tam denk gelen deneme artık son sayılmıyor (sınır).',
    mutations: [
      M(`     or now() + make_interval(secs => v_delay) >= v_job.retry_until then`, `     or now() + make_interval(secs => v_delay) > v_job.retry_until then`),
      M(`        terminal_at = now(),
        last_error_class = p_error_class,`, `        terminal_at = now(),
        last_error_class = coalesce(last_error_class, p_error_class),`),
    ] },
  { id: 'NP19', layer: 'NP', axes: ['D3', 'D4'], file: F.lockFinal, fn: 'f11_validate_native_group_schedule_authority', family: 'availability+time_boundary', fnFamily: 'group',
    rationale: 'D3: personelin pasif çalışma saatleri de geçerli sayılıyor. D4: işletme açılış anında başlayan grup satırı artık saatlerin dışında sayılıyor (pencere başı dışlayıcı oldu).',
    mutations: [
      M(`           and sh.active
`, ``),
      M(`            and ((((a.starts_at at time zone v_timezone)::date)+bh.starts_local) at time zone v_timezone) <= a.starts_at`, `            and ((((a.starts_at at time zone v_timezone)::date)+bh.starts_local) at time zone v_timezone) < a.starts_at`),
    ] },
  { id: 'NP20', layer: 'NP', axes: ['D3', 'D4'], file: F.lockFinal, fn: 'f11_validate_native_group_schedule_authority', family: 'assignment+local_day', fnFamily: 'group',
    rationale: 'D3: pasif personel-hizmet ataması da geçerli sayılıyor. D4: işletme saatlerinin haftanın günü, yerel tarih yerine UTC tarihinden hesaplanıyor.',
    mutations: [
      M(`            and ss.service_id=a.service_id and ss.active`, `            and ss.service_id=a.service_id`),
      M(`            and bh.weekday=extract(dow from (a.starts_at at time zone v_timezone)::date)::smallint
            and bh.active
            and ((((a.starts_at at time zone v_timezone)::date)+bh.starts_local)`, `            and bh.weekday=extract(dow from a.starts_at::date)::smallint
            and bh.active
            and ((((a.starts_at at time zone v_timezone)::date)+bh.starts_local)`),
    ] },
];
