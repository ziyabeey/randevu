// H19d vaka tanımları (H19D-PROTOKOL v0.1, 6992921). 80 yeni mutasyon; etiket, eksen(ler), yön (yalnız
// çeşitlilik kaydı), aile ve gerekçe Jev çağrısından önce yazıldı. R0/H19a, H19b ve H19b′'deki hiçbir
// mutasyon tekrar kullanılmadı; aynı fonksiyon yeni bir mutasyonla kullanıldıysa kur.mjs bunu işaretler.
//
// Katmanlar: PS = D5 tek eksen (20) · PP = D5 + başka eksen (20) · NS = D5 yok, tek eksen (20) ·
// NP = D5 yok, iki eksen (20). Etiket politikası H19b ile aynı: fonksiyon düzeyi.

const M = (find, replace) => ({ find, replace });
const F = {
  product: '20260923051000_f15_product_stock_ledger.sql',
  expense: '20260923074000_f15_expense_ledger.sql',
  ticket: '20260922111500_f14_ticket_model.sql',
  hardening: '20260911121000_phase5_booking_hardening.sql',
  core: '20260911120000_phase5_booking_core.sql',
  public6: '20260911130000_phase6_public_booking.sql',
  authority: '20260914110200_f10_customer_authority_repair.sql',
  manage: '20260911140000_phase7_customer_manage.sql',
  outbox: '20260911170000_phase9_notification_outbox.sql',
  maint9: '20260911170100_phase9_notification_maintenance.sql',
  s03: '20260912123000_s03_notification_consistency.sql',
  media: '20260914110500_f12_salon_profile_media.sql',
  team: '20260914033000_f10_team_access.sql',
  customers: '20260914110000_f10_customer_records.sql',
  catalog500: '20260914111500_f10_catalog_hours_management.sql',
  catalog700: '20260914111700_f10_catalog_stale_hardening.sql',
  price: '20260915150000_f12_service_price_range.sql',
  hours4: '20260911110000_phase4_availability.sql',
  readiness: '20260914090000_f10_onboarding_readiness.sql',
  s04: '20260913030912_s04_resource_limits.sql',
  group: '20260921043000_f13_group_lifecycle_partial_repair.sql',
  groupLock: '20260917171000_f11_schedule_authority_lock_order.sql',
  tenancy: '20260911090000_phase2_auth_tenancy.sql',
};
const BUSINESS_ROW = '  perform 1 from public.businesses b where b.id = p_business_id for update;\n';

export const CASES = [
  // ======================= PS: D5 tek eksen (10 weakens + 10 strengthens) =======================
  { id: 'PS01', layer: 'PS', file: F.product, fn: 'update_product_guarded', direction: 'weakens', family: 'stale_token', fnFamily: 'product',
    rationale: 'Sürüm belirteci isteğe bağlı oldu; belirteç göndermeyen eşzamanlı güncelleme başka bir güncellemenin üstüne sessizce yazar.',
    mutations: [M(`  if p_expected_version is null or v_product.version <> p_expected_version then raise exception 'STALE_WRITE'; end if;`,
      `  if p_expected_version is not null and v_product.version <> p_expected_version then raise exception 'STALE_WRITE'; end if;`)] },
  { id: 'PS02', layer: 'PS', file: F.product, fn: 'reverse_product_stock_movement_guarded', direction: 'weakens', family: 'lock_removal', fnFamily: 'product',
    rationale: 'Ürün satırı kilidi kaldırıldı; sürüm ve bakiye kilitsiz okunuyor, güncelleme koşulsuz: eşzamanlı iki ters kayıt aynı sürümü görüp bakiyeyi yanlış hesaplar.',
    mutations: [M(`  where p.business_id = p_business_id and p.id = p_product_id
  for update;

  if v_product.id is null then raise exception 'PRODUCT_NOT_FOUND'; end if;`, `  where p.business_id = p_business_id and p.id = p_product_id;

  if v_product.id is null then raise exception 'PRODUCT_NOT_FOUND'; end if;`)] },
  { id: 'PS03', layer: 'PS', file: F.hardening, fn: 'set_appointment_status', direction: 'weakens', family: 'lock_removal', fnFamily: 'booking',
    rationale: 'Randevu satırı kilidi kaldırıldı; durum geçişi kilitsiz okumayla doğrulanıyor ve güncelleme durum koşulu taşımıyor: eşzamanlı iki geçiş birlikte geçer.',
    mutations: [M(`  where business_id = p_business_id and id = p_appointment_id
  for update;

  if v_current.id is null then raise exception 'APPOINTMENT_NOT_FOUND'; end if;`, `  where business_id = p_business_id and id = p_appointment_id;

  if v_current.id is null then raise exception 'APPOINTMENT_NOT_FOUND'; end if;`)] },
  { id: 'PS04', layer: 'PS', file: F.ticket, fn: 'cancel_ticket_guarded', direction: 'weakens', family: 'lock_removal', fnFamily: 'ticket',
    rationale: 'Fiş satırı kilidi kaldırıldı; durum ve sürüm kilitsiz okunuyor, iptal güncellemesi koşulsuz: eşzamanlı kapatma ile iptal birlikte geçer.',
    mutations: [M(`  where t.business_id = p_business_id and t.id = p_ticket_id
  for update;
  if v_ticket.id is null then raise exception 'TICKET_NOT_FOUND'; end if;`, `  where t.business_id = p_business_id and t.id = p_ticket_id;
  if v_ticket.id is null then raise exception 'TICKET_NOT_FOUND'; end if;`)] },
  { id: 'PS05', layer: 'PS', file: F.price, fn: 'update_service_guarded', direction: 'weakens', family: 'lock_removal', fnFamily: 'catalog',
    rationale: 'Hizmet satırı kilidi kaldırıldı; bayat yazma kontrolü kilitsiz okumada ve güncelleme koşulsuz: aynı belirteçle eşzamanlı iki düzenleme birlikte geçer.',
    mutations: [M(`  where s.business_id = p_business_id and s.id = p_service_id
  for update;
  if not found then raise exception 'SERVICE_NOT_FOUND'; end if;`, `  where s.business_id = p_business_id and s.id = p_service_id;
  if not found then raise exception 'SERVICE_NOT_FOUND'; end if;`)] },
  { id: 'PS06', layer: 'PS', file: F.outbox, fn: 'complete_notification_job', direction: 'weakens', family: 'cas_predicate', fnFamily: 'notification',
    rationale: 'Tamamlamanın kiralama belirteci koşulu kaldırıldı; kiralaması düşmüş eski bir işçi, işi yeniden kiralamış başka işçinin işini "gönderildi" yapabilir.',
    mutations: [M(`    and j.lease_token = p_lease_token
  returning`, `  returning`)] },
  { id: 'PS07', layer: 'PS', file: F.media, fn: 'restore_business_public_media_delete', direction: 'weakens', family: 'cas_predicate', fnFamily: 'media',
    rationale: 'Geri yüklemenin "deleting" durum koşulu kaldırıldı; eşzamanlı olarak silinmesi bitirilen ya da temizlemeye alınan görsel tekrar "ready" yapılabilir.',
    mutations: [M(`  where m.business_id = p_business_id and m.id = p_media_id and m.status = 'deleting'`, `  where m.business_id = p_business_id and m.id = p_media_id`)] },
  { id: 'PS08', layer: 'PS', file: F.expense, fn: 'reverse_expense_guarded', direction: 'weakens', family: 'lock_removal', fnFamily: 'expense',
    rationale: 'Kaynak gider satırı kilidi kaldırıldı; "zaten ters kaydedilmiş" kontrolü serileşmiyor, eşzamanlı iki ters kayıt birlikte geçer.',
    mutations: [M(`    and e.event_type='expense'
  for update;`, `    and e.event_type='expense';`)] },
  { id: 'PS09', layer: 'PS', file: F.ticket, fn: 'add_ticket_service_line_guarded', direction: 'weakens', family: 'stale_token', fnFamily: 'ticket',
    rationale: 'Fiş sürüm belirteci isteğe bağlı oldu; belirteçsiz eşzamanlı satır eklemeleri bayat görünüm üzerinden yazar.',
    mutations: [M(`  if p_expected_version is null or v_ticket.version <> p_expected_version then
    raise exception 'STALE_WRITE';`, `  if p_expected_version is not null and v_ticket.version <> p_expected_version then
    raise exception 'STALE_WRITE';`)] },
  { id: 'PS10', layer: 'PS', file: '20260920200000_f13_appointment_page_revision.sql', fn: 'f13_bump_appointment_page_revision', direction: 'weakens', family: 'optimistic_revision', fnFamily: 'booking',
    rationale: 'Randevu silinince sayfa revizyonu artık yenilenmiyor (satır varsa hiçbir şey yapılmıyor); eşzamanlı sayfalayan okuyucu, beklediği revizyon değişmediği için silmeyi fark etmez (iyimser revizyon belirteci).',
    mutations: [M(`    values (old.business_id, gen_random_uuid())
    on conflict (business_id) do update
      set revision = excluded.revision;
    return old;`, `    values (old.business_id, gen_random_uuid())
    on conflict (business_id) do nothing;
    return old;`)] },
  { id: 'PS11', layer: 'PS', file: F.media, fn: 'finalize_business_public_media_upload', direction: 'strengthens', family: 'lock_added', fnFamily: 'media',
    rationale: 'İşletme satırı kilidi eklendi; yüklemeyi sonlandırma, aynı kilidi alan diğer görsel işlemleriyle serileşir.',
    mutations: [M(`  if not public.can_manage_business(p_business_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  update public.business_public_media m
  set status = 'ready'`, `  if not public.can_manage_business(p_business_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
${BUSINESS_ROW}  update public.business_public_media m
  set status = 'ready'`)] },
  { id: 'PS12', layer: 'PS', file: F.public6, fn: 'create_public_appointment', direction: 'strengthens', family: 'lock_added', fnFamily: 'booking',
    rationale: 'Personel anahtarlı advisory kilit eklendi; aynı personele eşzamanlı herkese açık randevular uygunluk kontrolü ile ekleme arasında serileşir.',
    mutations: [M(`  if not exists (
    select 1
    from public.compute_public_booking_slots(p_slug, p_service_id, v_date, p_staff_id) s`, `  perform pg_advisory_xact_lock(hashtextextended('booking-staff:' || p_staff_id::text, 0));

  if not exists (
    select 1
    from public.compute_public_booking_slots(p_slug, p_service_id, v_date, p_staff_id) s`)] },
  { id: 'PS13', layer: 'PS', file: F.catalog500, fn: 'replace_business_hours_guarded', direction: 'strengthens', family: 'stale_token', fnFamily: 'catalog',
    rationale: 'Beklenen aralıklar belirteci zorunlu oldu; belirteçsiz eşzamanlı değiştirme artık reddediliyor.',
    mutations: [M(`  if p_expected_intervals is not null and v_current is distinct from p_expected_intervals then`,
      `  if p_expected_intervals is null or v_current is distinct from p_expected_intervals then`)] },
  { id: 'PS14', layer: 'PS', file: F.media, fn: 'mark_business_public_media_cleanup', direction: 'strengthens', family: 'lock_added', fnFamily: 'media',
    rationale: 'İşletme satırı kilidi eklendi; temizlemeye alma, aynı kilidi alan geri yükleme ve silme işlemleriyle serileşir.',
    mutations: [M(`  if not public.can_manage_business(p_business_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  update public.business_public_media m
  set status = 'cleanup'`, `  if not public.can_manage_business(p_business_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
${BUSINESS_ROW}  update public.business_public_media m
  set status = 'cleanup'`)] },
  { id: 'PS15', layer: 'PS', file: F.media, fn: 'finish_business_public_media_delete', direction: 'strengthens', family: 'lock_added', fnFamily: 'media',
    rationale: 'İşletme satırı kilidi eklendi; silmeyi bitirme, aynı kilidi alan geri yükleme işlemiyle serileşir.',
    mutations: [M(`  if not public.can_manage_business(p_business_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  delete from public.business_public_media m`, `  if not public.can_manage_business(p_business_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
${BUSINESS_ROW}  delete from public.business_public_media m`)] },
  { id: 'PS16', layer: 'PS', file: F.ticket, fn: 'add_ticket_service_line_guarded', direction: 'strengthens', family: 'share_fence', fnFamily: 'ticket',
    rationale: 'Personel okumasına paylaşımlı satır kilidi eklendi; eşzamanlı personel pasifleştirme (satırı FOR UPDATE ile kilitler) bu satır eklemeyle serileşir.',
    mutations: [M(`    where sp.business_id = p_business_id
      and sp.id = p_staff_id
      and sp.active;`, `    where sp.business_id = p_business_id
      and sp.id = p_staff_id
      and sp.active
    for share;`)] },
  { id: 'PS17', layer: 'PS', file: F.manage, fn: 'provision_public_management_token', direction: 'strengthens', family: 'lock_added', fnFamily: 'public',
    rationale: 'Randevu anahtarlı advisory kilit eklendi; aynı randevu için eşzamanlı kurulumlar serileşir, ikincisi mevcut belirteci görüp karşılaştırır.',
    mutations: [M(`  select c.token_hash into v_existing
  from public.appointment_management_capabilities c
  where c.appointment_id = p_appointment_id;`, `  perform pg_advisory_xact_lock(hashtextextended(p_appointment_id::text, 0));

  select c.token_hash into v_existing
  from public.appointment_management_capabilities c
  where c.appointment_id = p_appointment_id;`)] },
  { id: 'PS18', layer: 'PS', file: F.authority, fn: 'create_appointment', direction: 'strengthens', family: 'share_fence', fnFamily: 'booking',
    rationale: 'Personel uygunluk okumasına paylaşımlı satır kilidi eklendi; eşzamanlı personel pasifleştirme veya atama kaldırma bu randevu oluşturmayla serileşir.',
    mutations: [M(`  where sp.business_id = p_business_id and sp.id = p_staff_id and sp.active;`,
      `  where sp.business_id = p_business_id and sp.id = p_staff_id and sp.active
  for share of sp, ss;`)] },
  { id: 'PS19', layer: 'PS', file: F.hardening, fn: 'create_appointment', direction: 'strengthens', family: 'share_fence', fnFamily: 'booking',
    rationale: 'Personel uygunluk okumasına paylaşımlı satır kilidi eklendi; eşzamanlı personel pasifleştirme veya atama kaldırma serileşir.',
    mutations: [M(`  where sp.business_id = p_business_id and sp.id = p_staff_id and sp.active;`,
      `  where sp.business_id = p_business_id and sp.id = p_staff_id and sp.active
  for share of sp, ss;`)] },
  { id: 'PS20', layer: 'PS', file: F.authority, fn: 'create_public_appointment', direction: 'strengthens', family: 'share_fence', fnFamily: 'booking',
    rationale: 'Personel uygunluk okumasına paylaşımlı satır kilidi eklendi; eşzamanlı personel pasifleştirme veya atama kaldırma herkese açık randevuyla serileşir.',
    mutations: [M(`  where sp.business_id = v_business_id
    and sp.id = p_staff_id
    and sp.active;`, `  where sp.business_id = v_business_id
    and sp.id = p_staff_id
    and sp.active
  for share of sp, ss;`)] },

  // ======================= PP: D5 + başka eksen (4 × D0..D4) =======================
  { id: 'PP01', layer: 'PP', axes: ['D0'], file: F.team, fn: 'set_staff_membership_link', direction: 'weakens', family: 'check_before_lock', fnFamily: 'team',
    rationale: 'D5: yetki okuması işletme kilidinden önceye taşındı (eşzamanlı rol düşürme gözden kaçar). D0: bağlanacak üyelik artık işletme kapsamıyla sınırlı değil.',
    mutations: [
      M(`  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text, 0));
  select * into v_actor from public.f10_team_actor(p_business_id);
  if v_actor.membership_id is null or v_actor.role not in ('owner', 'manager') then
    raise exception 'TEAM_FORBIDDEN' using errcode = '42501';
  end if;`, `  select * into v_actor from public.f10_team_actor(p_business_id);
  if v_actor.membership_id is null or v_actor.role not in ('owner', 'manager') then
    raise exception 'TEAM_FORBIDDEN' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text, 0));`),
      M(`    where m.business_id = p_business_id
      and m.id = p_membership_id`, `    where m.id = p_membership_id`),
    ] },
  { id: 'PP02', layer: 'PP', axes: ['D0'], file: F.customers, fn: 'update_business_customer', direction: 'weakens', family: 'check_before_lock', fnFamily: 'customer',
    rationale: 'D5: iletişim çakışma kontrolü işletme kilidinden önceye taşındı (eşzamanlı müşteri oluşturmayla serileşmez). D0: düzenlenen müşteri artık işletme kapsamıyla sınırlı değil.',
    mutations: [
      M(`  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text, 0));
`, `  if exists (
    select 1
    from public.customers c
    where c.business_id = p_business_id
      and c.id <> p_customer_id
      and (
        (v_phone_normalized is not null
          and public.f10_normalize_customer_phone(c.phone) = v_phone_normalized)
        or
        (v_email is not null
          and public.f10_normalize_customer_email(c.email) = v_email)
      )
  ) then
    raise exception 'CUSTOMER_CONTACT_EXISTS';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text, 0));
`),
      M(`  if exists (
    select 1
    from public.customers c
    where c.business_id = p_business_id
      and c.id <> p_customer_id
      and (
        (v_phone_normalized is not null
          and public.f10_normalize_customer_phone(c.phone) = v_phone_normalized)
        or
        (v_email is not null
          and public.f10_normalize_customer_email(c.email) = v_email)
      )
  ) then
    raise exception 'CUSTOMER_CONTACT_EXISTS';
  end if;

  update public.customers c`, `  update public.customers c`),
      M(`  where c.business_id = p_business_id
    and c.id = p_customer_id
  for update;`, `  where c.id = p_customer_id
  for update;`),
    ] },
  { id: 'PP03', layer: 'PP', axes: ['D0'], file: F.core, fn: 'create_appointment', direction: 'strengthens', family: 'lock_added', fnFamily: 'booking',
    rationale: 'D5: personel anahtarlı advisory kilit eklendi (uygunluk kontrolü ile ekleme serileşir). D0: randevu oluşturma yetkisi her aktif üyeden yöneticilere daraldı.',
    mutations: [
      M(`  if auth.uid() is null or not public.is_active_member(p_business_id) then`, `  if auth.uid() is null or not public.can_manage_business(p_business_id) then`),
      M(`  v_date := (p_starts_at at time zone v_timezone)::date;
`, `  v_date := (p_starts_at at time zone v_timezone)::date;
  perform pg_advisory_xact_lock(hashtextextended('booking-staff:' || p_staff_id::text, 0));
`),
    ] },
  { id: 'PP04', layer: 'PP', axes: ['D0'], file: F.authority, fn: 'create_public_appointment', direction: 'strengthens', family: 'lock_added', fnFamily: 'booking',
    rationale: 'D5: personel anahtarlı advisory kilit eklendi (uygunluk kontrolü ile ekleme serileşir). D0: hizmet araması artık işletme kapsamıyla sınırlı değil.',
    mutations: [
      M(`  where sv.business_id = v_business_id
    and sv.id = p_service_id`, `  where sv.id = p_service_id`),
      M(`  v_date := (p_starts_at at time zone v_timezone)::date;
`, `  v_date := (p_starts_at at time zone v_timezone)::date;
  perform pg_advisory_xact_lock(hashtextextended('booking-staff:' || p_staff_id::text, 0));
`),
    ] },
  { id: 'PP05', layer: 'PP', axes: ['D1'], file: F.core, fn: 'claim_booking_command', direction: 'weakens', family: 'upsert_semantics', fnFamily: 'booking',
    rationale: 'Çakışmada hiçbir şey yapmamak yerine istek özeti eziliyor ve satır "eklendi" sayılıyor: tekrar eden istek yeni komut gibi yürür (D1) ve aynı anahtarla eşzamanlı iki istek ikisi de yürütülür (D5).',
    mutations: [M(`  on conflict (business_id, idempotency_key) do nothing;`, `  on conflict (business_id, idempotency_key) do update
  set request_hash = excluded.request_hash;`)] },
  { id: 'PP06', layer: 'PP', axes: ['D1'], file: F.expense, fn: 'create_expense_guarded', direction: 'weakens', family: 'claim_order', fnFamily: 'expense',
    rationale: 'Tekrar koruması (komut talebi) gider eklemesinden sonraya taşındı: tekrar eden istek ikinci bir gider ekler (D1) ve eşzamanlı aynı istekler talep kilidinden önce birlikte ekler (D5).',
    mutations: [
      M(`  v_replay:=public.f15_claim_expense_command(
    p_business_id,v_actor.id,'create_expense',p_idempotency_key,p_request_hash
  );
  if v_replay is not null then return v_replay; end if;
`, ``),
      M(`  returning * into v_event;
`, `  returning * into v_event;

  v_replay:=public.f15_claim_expense_command(
    p_business_id,v_actor.id,'create_expense',p_idempotency_key,p_request_hash
  );
  if v_replay is not null then return v_replay; end if;
`),
    ] },
  { id: 'PP07', layer: 'PP', axes: ['D1'], file: F.ticket, fn: 'f14_claim_ticket_command', direction: 'weakens', family: 'check_then_act', fnFamily: 'ticket',
    rationale: 'Komut makbuzu ekleme "var mı bak, yoksa ekle"ye döndü: eşzamanlı aynı istekler kontrolü birlikte geçer (D5), ikincisi tekrar yanıtı yerine benzersizlik hatası alır (D1).',
    mutations: [M(`  insert into public.ticket_commands(
    business_id, actor_membership_id, command, idempotency_key, request_hash
  ) values (
    p_business_id, p_actor_membership_id, p_command, p_idempotency_key, p_request_hash
  )
  on conflict (business_id, actor_membership_id, command, idempotency_key) do nothing;`, `  if not exists (
    select 1 from public.ticket_commands c
    where c.business_id = p_business_id
      and c.actor_membership_id = p_actor_membership_id
      and c.command = p_command
      and c.idempotency_key = p_idempotency_key
  ) then
    insert into public.ticket_commands(
      business_id, actor_membership_id, command, idempotency_key, request_hash
    ) values (
      p_business_id, p_actor_membership_id, p_command, p_idempotency_key, p_request_hash
    );
  end if;`)] },
  { id: 'PP08', layer: 'PP', axes: ['D1'], file: F.product, fn: 'create_product_guarded', direction: 'weakens', family: 'claim_order', fnFamily: 'product',
    rationale: 'Tekrar koruması (komut talebi) ürün eklemesinden sonraya taşındı: tekrar eden istek ikinci ürün ekler (D1), eşzamanlı aynı istekler talep kilidinden önce birlikte ekler (D5).',
    mutations: [
      M(`  v_replay := public.f15_claim_product_command(
    p_business_id, v_actor.id, 'create_product', p_idempotency_key, p_request_hash
  );
  if v_replay is not null then return v_replay; end if;
`, ``),
      M(`  if p_initial_quantity > 0 then`, `  v_replay := public.f15_claim_product_command(
    p_business_id, v_actor.id, 'create_product', p_idempotency_key, p_request_hash
  );
  if v_replay is not null then return v_replay; end if;

  if p_initial_quantity > 0 then`),
    ] },
  { id: 'PP09', layer: 'PP', axes: ['D2'], file: F.ticket, fn: 'add_ticket_service_line_guarded', direction: 'weakens', family: 'share_fence', fnFamily: 'ticket',
    rationale: 'Hizmet okumasındaki paylaşımlı kilit kaldırıldı: eşzamanlı hizmet düzenlemesi okuma ile ekleme arasına girebilir (D5) ve satır o an geçerli olmayan fiyat/politika anlık görüntüsünü yakalar (D2).',
    mutations: [M(`    and s.active
  for share;
  if v_service.id is null then raise exception 'SERVICE_NOT_FOUND'; end if;`, `    and s.active;
  if v_service.id is null then raise exception 'SERVICE_NOT_FOUND'; end if;`)] },
  { id: 'PP10', layer: 'PP', axes: ['D2'], file: F.s03, fn: 'lock_notification_request_v2', direction: 'weakens', family: 'share_fence', fnFamily: 'notification',
    rationale: 'Randevu okumasındaki paylaşımlı kilit kaldırıldı: eşzamanlı iptal/yeniden planlama gönderim kapısıyla serileşmez (D5) ve anlık görüntü karşılaştırması bayat randevu verisiyle yapılır (D2).',
    mutations: [M(`  where a.id = (select j.appointment_id from public.appointment_notification_jobs j where j.id = p_job_id)
  for share;`, `  where a.id = (select j.appointment_id from public.appointment_notification_jobs j where j.id = p_job_id);`)] },
  { id: 'PP11', layer: 'PP', axes: ['D2'], file: F.hardening, fn: 'create_appointment', direction: 'strengthens', family: 'share_fence', fnFamily: 'booking',
    rationale: 'Hizmet okumasına paylaşımlı kilit eklendi: eşzamanlı hizmet düzenlemesiyle serileşir (D5) ve randevunun fiyat/süre anlık görüntüsü eklemeye kadar geçerli değeri yansıtır (D2).',
    mutations: [M(`  where business_id = p_business_id and id = p_service_id and active;`, `  where business_id = p_business_id and id = p_service_id and active
  for share;`)] },
  { id: 'PP12', layer: 'PP', axes: ['D2'], file: F.public6, fn: 'create_public_appointment', direction: 'strengthens', family: 'share_fence', fnFamily: 'booking',
    rationale: 'Hizmet okumasına paylaşımlı kilit eklendi: eşzamanlı hizmet düzenlemesiyle serileşir (D5) ve fiyat/süre anlık görüntüsü eklemeye kadar geçerli kalır (D2).',
    mutations: [M(`    and sv.active;
  if v_service.id is null then raise exception 'SERVICE_NOT_FOUND'; end if;`, `    and sv.active
  for share;
  if v_service.id is null then raise exception 'SERVICE_NOT_FOUND'; end if;`)] },
  { id: 'PP13', layer: 'PP', axes: ['D3'], file: F.catalog500, fn: 'create_staff_guarded', direction: 'weakens', family: 'key_scope', fnFamily: 'catalog',
    rationale: 'D5: advisory kilit anahtarı personel adına daraldı (farklı adlı eşzamanlı eklemeler sayımı birlikte geçer). D3: personel limiti 100\'den 200\'e çıktı.',
    mutations: [
      M(`  perform pg_advisory_xact_lock(hashtextextended('f10-04:staff:' || p_business_id::text, 0));`,
        `  perform pg_advisory_xact_lock(hashtextextended('f10-04:staff:' || p_business_id::text || ':' || lower(trim(p_name)), 0));`),
      M(`  if v_count >= 100 then raise exception 'CATALOG_STAFF_LIMIT_EXCEEDED'; end if;`, `  if v_count >= 200 then raise exception 'CATALOG_STAFF_LIMIT_EXCEEDED'; end if;`),
    ] },
  { id: 'PP14', layer: 'PP', axes: ['D3'], file: F.media, fn: 'begin_business_public_media_upload', direction: 'weakens', family: 'lock_removal', fnFamily: 'media',
    rationale: 'D5: işletme satırı kilidi kaldırıldı (eşzamanlı yüklemeler sayımı birlikte geçer). D3: görsel limiti 20\'den 25\'e çıktı.',
    mutations: [
      M(`  perform 1 from public.businesses b where b.id = p_business_id for update;`, `  perform 1 from public.businesses b where b.id = p_business_id;`),
      M(`  if v_count >= 20 then raise exception 'PUBLIC_MEDIA_LIMIT_EXCEEDED'; end if;`, `  if v_count >= 25 then raise exception 'PUBLIC_MEDIA_LIMIT_EXCEEDED'; end if;`),
    ] },
  { id: 'PP15', layer: 'PP', axes: ['D3'], file: F.hours4, fn: 'replace_staff_hours', direction: 'strengthens', family: 'lock_added', fnFamily: 'catalog',
    rationale: 'D5: personel satırı kilitleniyor (aynı personel için eşzamanlı saat değiştirmeleri serileşir). D3: pasif personele de saat tanımlanabiliyor.',
    mutations: [M(`  if not exists (
    select 1 from public.staff_profiles s
    where s.business_id = p_business_id and s.id = p_staff_id and s.active
  ) then
    raise exception 'STAFF_NOT_FOUND';
  end if;`, `  perform 1 from public.staff_profiles s
  where s.business_id = p_business_id and s.id = p_staff_id
  for update;
  if not found then
    raise exception 'STAFF_NOT_FOUND';
  end if;`)] },
  { id: 'PP16', layer: 'PP', axes: ['D3'], file: F.hours4, fn: 'replace_business_hours', direction: 'strengthens', family: 'lock_added', fnFamily: 'catalog',
    rationale: 'D5: işletme satırı kilitleniyor (eşzamanlı saat değiştirmeleri serileşir). D3: gün başına en fazla 4 çalışma aralığı.',
    mutations: [M(`  delete from public.business_hours
  where business_id = p_business_id and weekday = p_weekday;`, `  if jsonb_array_length(p_intervals) > 4 then
    raise exception 'TOO_MANY_INTERVALS';
  end if;
${BUSINESS_ROW}
  delete from public.business_hours
  where business_id = p_business_id and weekday = p_weekday;`)] },
  { id: 'PP17', layer: 'PP', axes: ['D4'], file: F.manage, fn: 'cancel_public_managed_appointment', direction: 'weakens', family: 'lock_removal', fnFamily: 'public',
    rationale: 'D5: randevu satırı kilidi kaldırıldı (eşzamanlı iptal/yeniden planlama ile ikinci iptal birlikte geçer). D4: iptal randevudan en geç 1 saat önce yapılabiliyor.',
    mutations: [M(`  where a.business_id = v_current.business_id and a.id = v_current.id
  for update;

  if v_current.status not in ('scheduled','confirmed') or v_current.starts_at <= now() then`, `  where a.business_id = v_current.business_id and a.id = v_current.id;

  if v_current.status not in ('scheduled','confirmed') or v_current.starts_at <= now() + interval '1 hour' then`)] },
  { id: 'PP18', layer: 'PP', axes: ['D4'], file: F.manage, fn: 'reschedule_public_managed_appointment', direction: 'weakens', family: 'lock_removal', fnFamily: 'public',
    rationale: 'D5: randevu satırı kilidi kaldırıldı (eşzamanlı yeniden planlamalar birlikte geçer). D4: asgari önceden bildirim 30 dakika uzadı.',
    mutations: [
      M(`  where a.business_id = v_current.business_id and a.id = v_current.id
  for update;`, `  where a.business_id = v_current.business_id and a.id = v_current.id;`),
      M(`  if p_starts_at < now() + make_interval(mins => v_min_notice_minutes) then`, `  if p_starts_at < now() + make_interval(mins => v_min_notice_minutes + 30) then`),
    ] },
  { id: 'PP19', layer: 'PP', axes: ['D4'], file: F.maint9, fn: 'maintain_notification_jobs', direction: 'strengthens', family: 'lease_guard', fnFamily: 'notification',
    rationale: 'Süre dolumu dalı artık etkin kiralamayı korumadan sonlandırmıyor (D5: bakım ile gönderen işçi çakışmaz) ve 1 dakikalık tolerans tanıyor (D4).',
    mutations: [M(`      j.retry_until <= now()`, `      (j.retry_until <= now() - interval '1 minute' and (j.state <> 'leased' or j.lease_expires_at <= now()))`)] },
  { id: 'PP20', layer: 'PP', axes: ['D4'], file: F.s03, fn: 'release_notification_job_v2', direction: 'strengthens', family: 'clock_after_wait', fnFamily: 'notification',
    rationale: 'Kilit beklemesinden sonraki süre hesapları işlem başı now() yerine clock_timestamp() kullanıyor: uzun satır kilidi beklemesi sonrası pencere ve yeniden deneme sınırı gerçek zamana göre değerlendirilir (D4) ve bekleme sırasında dolan süre gözden kaçmaz (D5).',
    mutations: [
      M(`    and now() + make_interval(secs => v_delay) >= v_job.provider_idempotency_expires_at;`, `    and clock_timestamp() + make_interval(secs => v_delay) >= v_job.provider_idempotency_expires_at;`),
      M(`     or now() + make_interval(secs => v_delay) >= v_job.retry_until`, `     or clock_timestamp() + make_interval(secs => v_delay) >= v_job.retry_until`),
    ] },

  // ======================= NS: D5 yok, tek eksen (4 × D0..D4) =======================
  { id: 'NS01', layer: 'NS', axes: ['D0'], file: F.team, fn: 'set_staff_membership_link', family: 'authz', fnFamily: 'team',
    rationale: 'Personel-üyelik bağlama yetkisi personel rolüne de verildi (yetki kapsamı).',
    mutations: [M(`  if v_actor.membership_id is null or v_actor.role not in ('owner', 'manager') then`, `  if v_actor.membership_id is null or v_actor.role not in ('owner', 'manager', 'staff') then`)] },
  { id: 'NS02', layer: 'NS', axes: ['D0'], file: F.team, fn: 'revoke_business_invitation', family: 'authz', fnFamily: 'team',
    rationale: 'Davet iptali için sahip/yönetici rolü aranmıyor; her aktif üye iptal edebiliyor (yetki kapsamı). İşletme kilidi yerinde.',
    mutations: [M(`  if v_actor.membership_id is null or v_actor.role not in ('owner', 'manager') then`, `  if v_actor.membership_id is null then`)] },
  { id: 'NS03', layer: 'NS', axes: ['D0'], file: F.groupLock, fn: 'f11_reschedule_group_core', family: 'authz', fnFamily: 'group',
    rationale: 'Grup yeniden planlamayı "system" aktör türü de yapabiliyor (aktör kapsamı).',
    mutations: [M(`  if p_actor_type not in ('member','public') then raise exception 'INVALID_ACTOR_TYPE'; end if;`, `  if p_actor_type not in ('member','public','system') then raise exception 'INVALID_ACTOR_TYPE'; end if;`)] },
  { id: 'NS04', layer: 'NS', axes: ['D0'], file: F.tenancy, fn: 'create_business_with_owner', family: 'authz', fnFamily: 'team',
    rationale: 'İşletmeyi oluşturan kullanıcı sahip değil yönetici rolüyle üye oluyor (yetki kapsamı).',
    mutations: [M(`  values(v_business.id, v_user, 'owner', true);`, `  values(v_business.id, v_user, 'manager', true);`)] },
  { id: 'NS05', layer: 'NS', axes: ['D1'], file: F.expense, fn: 'reverse_expense_guarded', family: 'duplicate_suppression', fnFamily: 'expense',
    rationale: '"Zaten ters kaydedilmiş" kontrolü kaldırıldı; aynı gider sırayla ikinci kez ters kaydedilebilir (tekilleştirme). Kaynak satır kilidi yerinde.',
    mutations: [M(`  if exists (
    select 1 from public.expense_events r
    where r.business_id=p_business_id
      and r.source_expense_event_id=p_source_event_id
      and r.event_type='reversal'
  ) then
    raise exception 'EXPENSE_ALREADY_REVERSED';
  end if;
`, ``)] },
  { id: 'NS06', layer: 'NS', axes: ['D1'], file: F.expense, fn: 'f15_claim_expense_command', family: 'replay', fnFamily: 'expense',
    rationale: 'Aynı anahtarla farklı içerikli istek artık reddedilmiyor, önceki sonuç döndürülüyor (tekrar semantiği).',
    mutations: [M(`  if v_hash is distinct from p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT';
  end if;
`, ``)] },
  { id: 'NS07', layer: 'NS', axes: ['D1'], file: F.public6, fn: 'claim_booking_command', family: 'replay', fnFamily: 'booking',
    rationale: 'Tekrar kontrolü artık yalnız komut türünü karşılaştırıyor; aynı anahtarla farklı içerikli istek önceki sonucu alır (tekrar semantiği).',
    mutations: [M(`  if v_existing.command <> p_command or v_existing.request_hash <> p_request_hash then`, `  if v_existing.command <> p_command then`)] },
  { id: 'NS08', layer: 'NS', axes: ['D1'], file: F.ticket, fn: 'open_walk_in_ticket_guarded', family: 'replay', fnFamily: 'ticket',
    rationale: 'Tekrar eden istek kayıtlı sonucu değil fişin güncel projeksiyonunu döndürüyor (tekrar semantiği).',
    mutations: [M(`  if v_replay is not null then return v_replay; end if;`, `  if v_replay is not null then
    return public.f14_ticket_projection(p_business_id, (v_replay->>'id')::uuid);
  end if;`)] },
  { id: 'NS09', layer: 'NS', axes: ['D2'], file: F.ticket, fn: 'add_ticket_service_line_guarded', family: 'snapshot', fnFamily: 'ticket',
    rationale: 'Fişin para birimi ilk satırdaki değerde kalmıyor, her yeni satırın hizmet para birimiyle ezilir (yakalanan durum). Fiş kilidi ve sürüm artışı yerinde.',
    mutations: [M(`  set currency = coalesce(currency, v_service.currency),`, `  set currency = v_service.currency,`)] },
  { id: 'NS10', layer: 'NS', axes: ['D2'], file: F.expense, fn: 'reverse_expense_guarded', family: 'policy', fnFamily: 'expense',
    rationale: 'Düzeltme kayıtları da ters kaydedilebiliyor (hangi kaydın kaynak olabileceği politikası); kaynak satır kilidi yerinde.',
    mutations: [M(`    and e.event_type='expense'
  for update;`, `    and e.event_type in ('expense','correction')
  for update;`)] },
  { id: 'NS11', layer: 'NS', axes: ['D2'], file: F.s03, fn: 'complete_notification_job_v2', family: 'history', fnFamily: 'notification',
    rationale: 'Başarılı tamamlamada son hata sınıfı artık temizlenmiyor; geçmiş hata kaydı korunuyor (geçmiş değer).',
    mutations: [M(`      last_error_class = null,
`, ``)] },
  { id: 'NS12', layer: 'NS', axes: ['D2'], file: F.group, fn: 'set_appointment_group_status', family: 'history', fnFamily: 'booking',
    rationale: 'Olay kaydındaki grup sürümü, yeni sürüm yerine istemcinin beklediği eski sürümü yazıyor (geçmiş kaydın anlamı).',
    mutations: [M(`      'groupVersion',v_new_version,`, `      'groupVersion',p_expected_version,`)] },
  { id: 'NS13', layer: 'NS', axes: ['D3'], file: F.price, fn: 'create_service_guarded', family: 'limit', fnFamily: 'catalog',
    rationale: 'Hizmet limitine yalnız aktif hizmetler sayılıyor (kapasite kuralı); sayım aynı kilit altında.',
    mutations: [M(`  select count(*), least(coalesce(max(s.sort_order), -10) + 10, 1000000)`, `  select count(*) filter (where s.active), least(coalesce(max(s.sort_order), -10) + 10, 1000000)`)] },
  { id: 'NS14', layer: 'NS', axes: ['D3'], file: F.s04, fn: 'enforce_public_booking_rate', family: 'limit', fnFamily: 'ratelimit',
    rationale: 'Yönetim değişikliği için kişi başı istek limiti 10\'dan 5\'e indi (kaynak sınırı).',
    mutations: [M(`    when 'manage_change' then v_window := 60; v_actor := 10; v_network := 100;`, `    when 'manage_change' then v_window := 60; v_actor := 5; v_network := 100;`)] },
  { id: 'NS15', layer: 'NS', axes: ['D3'], file: F.authority, fn: 'create_public_appointment', family: 'eligibility', fnFamily: 'booking',
    rationale: 'Pasif hizmetler de herkese açık randevuya açık (hizmet uygunluğu).',
    mutations: [M(`    and sv.id = p_service_id
    and sv.active;`, `    and sv.id = p_service_id;`)] },
  { id: 'NS16', layer: 'NS', axes: ['D3'], file: F.public6, fn: 'create_public_appointment', family: 'eligibility', fnFamily: 'booking',
    rationale: 'Personel uygunluğunda atamanın aktif olması şartı kalktı; pasif atamayla herkese açık randevu alınabilir (atama kuralı).',
    mutations: [M(`   and ss.service_id = p_service_id
   and ss.active
  where sp.business_id = v_business_id`, `   and ss.service_id = p_service_id
  where sp.business_id = v_business_id`)] },
  { id: 'NS17', layer: 'NS', axes: ['D4'], file: F.manage, fn: 'reschedule_public_managed_appointment', family: 'window', fnFamily: 'public',
    rationale: 'Müşteri yeniden planlaması randevudan en geç 3 saat önce yapılabiliyor (zaman sınırı); kontrol aynı kilit altında.',
    mutations: [M(`  if v_current.status not in ('scheduled','confirmed') or v_current.starts_at <= now() then`,
      `  if v_current.status not in ('scheduled','confirmed') or v_current.starts_at <= now() + interval '3 hours' then`)] },
  { id: 'NS18', layer: 'NS', axes: ['D4'], file: F.public6, fn: 'create_public_appointment', family: 'window', fnFamily: 'booking',
    rationale: 'Herkese açık randevu artık aynı gün için alınamıyor (yerel gün sınırı).',
    mutations: [M(`  if v_date < v_today or v_date > v_today + v_horizon_days then`, `  if v_date <= v_today or v_date > v_today + v_horizon_days then`)] },
  { id: 'NS19', layer: 'NS', axes: ['D4'], file: F.expense, fn: 'reverse_expense_guarded', family: 'local_day', fnFamily: 'expense',
    rationale: 'Ters kaydın iş günü işletmenin yerel günü yerine UTC günüyle hesaplanıyor (yerel gün dönüşümü).',
    mutations: [M(`    v_source.amount_minor,v_source.currency,v_source.payment_method,v_occurred_at,p_occurred_local::date,v_timezone,`,
      `    v_source.amount_minor,v_source.currency,v_source.payment_method,v_occurred_at,(v_occurred_at at time zone 'UTC')::date,v_timezone,`)] },
  { id: 'NS20', layer: 'NS', axes: ['D4'], file: F.groupLock, fn: 'f11_reschedule_group_core', family: 'window', fnFamily: 'group',
    rationale: 'Grup yeni başlangıç zamanı geçmişte olamıyor (zaman sınırı).',
    mutations: [M(`  if p_starts_at is null then raise exception 'INVALID_START'; end if;`, `  if p_starts_at is null or p_starts_at <= now() then raise exception 'INVALID_START'; end if;`)] },
  { id: 'NP01', layer: 'NP', axes: ['D0', 'D1'], file: F.product, fn: 'f15_claim_product_command', family: 'replay', fnFamily: 'product',
    rationale: 'Komut makbuzu okuması artık aktöre göre sınırlı değil: başka üyenin aynı anahtarlı komutu okunabilir (D0) ve onun sonucu tekrar olarak döner (D1).',
    mutations: [M(`    and c.actor_membership_id = p_actor_membership_id
    and c.command = p_command
    and c.idempotency_key = p_idempotency_key
  for update;`, `    and c.command = p_command
    and c.idempotency_key = p_idempotency_key
  for update;`)] },
  { id: 'NP02', layer: 'NP', axes: ['D0', 'D1'], file: F.core, fn: 'claim_booking_command', family: 'replay', fnFamily: 'booking',
    rationale: 'D1: tekrar kontrolü komut türünü karşılaştırmıyor. D0: komutu oluşturan kullanıcı kaydedilmiyor (aktör izi).',
    mutations: [
      M(`    p_business_id, p_idempotency_key, p_command, p_request_hash, p_appointment_id, auth.uid()`, `    p_business_id, p_idempotency_key, p_command, p_request_hash, p_appointment_id, null`),
      M(`  if v_existing.command <> p_command or v_existing.request_hash <> p_request_hash then`, `  if v_existing.request_hash <> p_request_hash then`),
    ] },
  { id: 'NP03', layer: 'NP', axes: ['D0', 'D2'], file: F.media, fn: 'update_business_public_profile', family: 'authz', fnFamily: 'media',
    rationale: 'D0: herkese açık profili her aktif üye düzenleyebiliyor. D2: kapak gönderilmezse önceki kapak korunuyor (yakalanan durum politikası).',
    mutations: [
      M(`  if not public.can_manage_business(p_business_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;`, `  if not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;`),
      M(`      cover_media_id = excluded.cover_media_id;`, `      cover_media_id = coalesce(excluded.cover_media_id, public.business_public_profiles.cover_media_id);`),
    ] },
  { id: 'NP04', layer: 'NP', axes: ['D0', 'D2'], file: F.product, fn: 'update_product_guarded', family: 'authz', fnFamily: 'product',
    rationale: 'D0: para birimi değişikliği artık fiyatlandırma yetkisi istemiyor. D2: ürün para birimi oluşturulduktan sonra korunuyor, istekteki değer yok sayılıyor (yakalanan politika).',
    mutations: [
      M(`  if v_product.sale_price_minor is distinct from p_sale_price_minor
      or v_product.currency is distinct from v_currency then`, `  if v_product.sale_price_minor is distinct from p_sale_price_minor then`),
      M(`        currency = v_currency,`, `        currency = v_product.currency,`),
    ] },
  { id: 'NP05', layer: 'NP', axes: ['D0', 'D3'], file: F.catalog500, fn: 'set_staff_service_guarded', family: 'authz', fnFamily: 'catalog',
    rationale: 'D0: atamayı her aktif üye yapabiliyor. D3: atama limiti 5000\'den 1000\'e indi.',
    mutations: [
      M(`  if not public.can_manage_business(p_business_id) then`, `  if not public.is_active_member(p_business_id) then`),
      M(`    if v_count >= 5000 then raise exception 'CATALOG_ASSIGNMENTS_LIMIT_EXCEEDED'; end if;`, `    if v_count >= 1000 then raise exception 'CATALOG_ASSIGNMENTS_LIMIT_EXCEEDED'; end if;`),
    ] },
  { id: 'NP06', layer: 'NP', axes: ['D0', 'D3'], file: F.hardening, fn: 'create_appointment', family: 'authz', fnFamily: 'booking',
    rationale: 'D0: randevu oluşturma yetkisi yöneticilere daraldı. D3: pasif personele randevu verilebiliyor.',
    mutations: [
      M(`  if auth.uid() is null or not public.is_active_member(p_business_id) then`, `  if auth.uid() is null or not public.can_manage_business(p_business_id) then`),
      M(`  where sp.business_id = p_business_id and sp.id = p_staff_id and sp.active;`, `  where sp.business_id = p_business_id and sp.id = p_staff_id;`),
    ] },
  { id: 'NP07', layer: 'NP', axes: ['D0', 'D4'], file: F.manage, fn: 'cancel_public_managed_appointment', family: 'authz', fnFamily: 'public',
    rationale: 'D0: iptal edilmiş yönetim bağlantısı da kullanılabiliyor. D4: iptal randevu başladıktan sonra 15 dakikaya kadar yapılabiliyor.',
    mutations: [
      M(`    and cap.revoked_at is null
`, ``),
      M(`  if v_current.status not in ('scheduled','confirmed') or v_current.starts_at <= now() then`,
        `  if v_current.status not in ('scheduled','confirmed') or v_current.starts_at <= now() - interval '15 minutes' then`),
    ] },
  { id: 'NP08', layer: 'NP', axes: ['D0', 'D4'], file: F.readiness, fn: 'update_public_booking_settings', family: 'authz', fnFamily: 'settings',
    rationale: 'D0: ayarları her aktif üye değiştirebiliyor. D4: rezervasyon ufku üst sınırı 366\'dan 730 güne çıktı.',
    mutations: [
      M(`  if not public.can_manage_business(p_business_id) then`, `  if not public.is_active_member(p_business_id) then`),
      M(`     or p_horizon_days < 1 or p_horizon_days > 366 then`, `     or p_horizon_days < 1 or p_horizon_days > 730 then`),
    ] },
  { id: 'NP09', layer: 'NP', axes: ['D1', 'D2'], file: F.product, fn: 'reverse_product_stock_movement_guarded', family: 'duplicate_suppression', fnFamily: 'product',
    rationale: 'D1: "zaten ters kaydedilmiş" kontrolü kaldırıldı (aynı hareket sırayla ikinci kez ters kaydedilebilir). D2: ters kayıt gerekçesi yakalanmıyor.',
    mutations: [
      M(`  if exists (
    select 1 from public.product_stock_movements r
    where r.business_id = p_business_id
      and r.product_id = p_product_id
      and r.reverses_movement_id = p_movement_id
  ) then
    raise exception 'STOCK_MOVEMENT_ALREADY_REVERSED';
  end if;
`, ``),
      M(`    v_reason, p_movement_id, v_actor.id`, `    null, p_movement_id, v_actor.id`),
    ] },
  { id: 'NP10', layer: 'NP', axes: ['D1', 'D2'], file: F.expense, fn: 'create_expense_guarded', family: 'replay', fnFamily: 'expense',
    rationale: 'D1: tekrar eden istek kayıtlı sonucu değil güncel projeksiyonu döndürüyor. D2: gider kaydı saat dilimi anlık görüntüsünü yakalamıyor.',
    mutations: [
      M(`  if v_replay is not null then return v_replay; end if;`, `  if v_replay is not null then return public.f15_expense_event_projection(p_business_id,(v_replay->>'id')::uuid); end if;`),
      M(`    p_amount_minor,v_currency,p_payment_method,v_occurred_at,p_occurred_local::date,v_timezone,`, `    p_amount_minor,v_currency,p_payment_method,v_occurred_at,p_occurred_local::date,null,`),
    ] },
  { id: 'NP11', layer: 'NP', axes: ['D1', 'D3'], file: F.product, fn: 'record_product_stock_movement_guarded', family: 'replay', fnFamily: 'product',
    rationale: 'D1: tekrar eden istek kayıtlı sonucu değil güncel projeksiyonu döndürüyor. D3: stok eksiye düşebiliyor (kaynak sınırı).',
    mutations: [
      M(`  if v_replay is not null then return v_replay; end if;`, `  if v_replay is not null then return public.f15_product_projection(p_business_id, p_product_id); end if;`),
      M(`  if v_new_balance < 0 then raise exception 'NEGATIVE_STOCK'; end if;
`, ``),
    ] },
  { id: 'NP12', layer: 'NP', axes: ['D1', 'D3'], file: F.product, fn: 'create_product_guarded', family: 'replay', fnFamily: 'product',
    rationale: 'D1: tekrar eden istek kayıtlı sonucu değil güncel projeksiyonu döndürüyor. D3: başlangıç stoku üst sınırı 1 milyara değil 1 milyona indi.',
    mutations: [
      M(`  if v_replay is not null then return v_replay; end if;`, `  if v_replay is not null then return public.f15_product_projection(p_business_id, (v_replay->>'id')::uuid); end if;`),
      M(`  if p_initial_quantity is null or p_initial_quantity < 0 or p_initial_quantity > 1000000000 then`, `  if p_initial_quantity is null or p_initial_quantity < 0 or p_initial_quantity > 1000000 then`),
    ] },
  { id: 'NP13', layer: 'NP', axes: ['D1', 'D4'], file: F.groupLock, fn: 'f11_reschedule_group_core', family: 'replay', fnFamily: 'group',
    rationale: 'D1: tekrar özeti yeni başlangıç zamanını içermiyor (farklı zamanlı istek aynı istek sayılır). D4: yeni başlangıç en fazla 180 gün ileride olabilir.',
    mutations: [
      M(`    'expectedVersion',p_expected_version,
    'startsAt',p_starts_at
`, `    'expectedVersion',p_expected_version
`),
      M(`  if p_starts_at is null then raise exception 'INVALID_START'; end if;`, `  if p_starts_at is null then raise exception 'INVALID_START'; end if;
  if p_starts_at > now() + interval '180 days' then raise exception 'INVALID_START'; end if;`),
    ] },
  { id: 'NP14', layer: 'NP', axes: ['D1', 'D4'], file: F.hardening, fn: 'reschedule_appointment', family: 'replay', fnFamily: 'booking',
    rationale: 'D1: tekrar özeti personeli içermiyor (farklı personelli istek aynı istek sayılır). D4: randevu günü UTC\'de hesaplanıyor.',
    mutations: [
      M(`    'staffId', p_staff_id,
`, ``),
      M(`  v_date := (p_starts_at at time zone v_timezone)::date;`, `  v_date := (p_starts_at at time zone 'UTC')::date;`),
    ] },
  { id: 'NP15', layer: 'NP', axes: ['D2', 'D3'], file: F.price, fn: 'create_service_priced_guarded', family: 'limit', fnFamily: 'catalog',
    rationale: 'D2: yeni hizmetler fiyat politikası sürüm 2 ile yakalanıyor. D3: hizmet limitine yalnız aktif hizmetler sayılıyor.',
    mutations: [
      M(`    1, v_currency`, `    2, v_currency`),
      M(`  select count(*), least(coalesce(max(s.sort_order), -10) + 10, 1000000)`, `  select count(*) filter (where s.active), least(coalesce(max(s.sort_order), -10) + 10, 1000000)`),
    ] },
  { id: 'NP16', layer: 'NP', axes: ['D2', 'D3'], file: F.core, fn: 'create_appointment', family: 'snapshot', fnFamily: 'booking',
    rationale: 'D2: randevu müşteri iletişim anlık görüntüsünü yakalamıyor. D3: pasif hizmet de randevuya açık.',
    mutations: [
      M(`  where business_id = p_business_id and id = p_service_id and active;`, `  where business_id = p_business_id and id = p_service_id;`),
      M(`      v_customer_name, v_customer_phone, v_customer_email,`, `      v_customer_name, null, null,`),
    ] },
  { id: 'NP17', layer: 'NP', axes: ['D2', 'D4'], file: F.s03, fn: 'lock_notification_request_v2', family: 'history', fnFamily: 'notification',
    rationale: 'D2: isteğin ilk kilitlenme zamanı her denemede yeniden yazılıyor (geçmiş değer). D4: varsayılan tekilleştirme penceresi 24 saatten 48 saate çıktı.',
    mutations: [
      M(`      request_locked_at = coalesce(request_locked_at, v_now),`, `      request_locked_at = v_now,`),
      M(`  v_window_end := coalesce(v_job.provider_idempotency_expires_at, v_now + interval '24 hours');`, `  v_window_end := coalesce(v_job.provider_idempotency_expires_at, v_now + interval '48 hours');`),
    ] },
  { id: 'NP18', layer: 'NP', axes: ['D2', 'D4'], file: F.public6, fn: 'create_public_appointment', family: 'snapshot', fnFamily: 'booking',
    rationale: 'D2: randevu personel adı anlık görüntüsünü yakalamıyor. D4: asgari önceden bildirim 15 dakika uzadı.',
    mutations: [
      M(`      v_service.name, v_staff.name,`, `      v_service.name, null,`),
      M(`  if p_starts_at < now() + make_interval(mins => v_min_notice_minutes) then`, `  if p_starts_at < now() + make_interval(mins => v_min_notice_minutes + 15) then`),
    ] },
  { id: 'NP19', layer: 'NP', axes: ['D3', 'D4'], file: F.catalog700, fn: 'replace_business_hours_guarded', family: 'limit', fnFamily: 'catalog',
    rationale: 'D3: gün başına en fazla 4 aralık. D4: ISO hafta günü 7 (pazar) 0\'a çevriliyor; eşleme kilit anahtarından önce yapıldığı için anahtar ve veri aynı günü kullanır.',
    mutations: [
      M(`  if p_weekday is null or p_weekday < 0 or p_weekday > 6
     or p_intervals is null or jsonb_typeof(p_intervals) <> 'array'
     or jsonb_array_length(p_intervals) > 8`, `  if p_weekday is null or p_weekday < 0 or p_weekday > 7
     or p_intervals is null or jsonb_typeof(p_intervals) <> 'array'
     or jsonb_array_length(p_intervals) > 4`),
      M(`  perform pg_advisory_xact_lock(hashtextextended(
    'f10-04:business-hours:'`, `  p_weekday := p_weekday % 7;
  perform pg_advisory_xact_lock(hashtextextended(
    'f10-04:business-hours:'`),
    ] },
  { id: 'NP20', layer: 'NP', axes: ['D3', 'D4'], file: F.hours4, fn: 'replace_staff_hours', family: 'eligibility', fnFamily: 'catalog',
    rationale: 'D3: personelin çakışan çalışma aralıkları artık reddedilmiyor (müsaitlik kuralı). D4: başlangıcı bitişinden sonra olan gece aralıkları kabul ediliyor.',
    mutations: [
      M(`    if v_start is null or v_end is null or v_start >= v_end then`, `    if v_start is null or v_end is null or v_start = v_end then`),
      M(`    if exists (
      select 1 from public.staff_hours h
      where h.business_id = p_business_id
        and h.staff_id = p_staff_id
        and h.weekday = p_weekday
        and h.active
        and h.starts_local < v_end
        and v_start < h.ends_local
    ) then
      raise exception 'OVERLAPPING_INTERVALS';
    end if;

`, ``),
    ] },
];
