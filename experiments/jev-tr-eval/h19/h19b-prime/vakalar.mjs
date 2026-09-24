// H19b′ vaka tanımları (H19B-PRIME-PROTOKOL v0.1, 5bc1aed). Her vaka gerçek bir migration fonksiyonuna
// (gerekirse eski bir sürümüne) uygulanan, elle yazılmış yeni bir mutasyondur. Etiket, yön, eksen, aile ve
// gerekçe Jev çağrısından önce yazıldı. H19b'deki hiçbir mutasyon tekrar kullanılmadı.
//
// Hücreler (protokol §2): A′ = kilitli, gerçek D5 · B′ = kilitsiz ve ipucusuz, gerçek D5 ·
// C′ = kilitli, D5 değil, başka eksen · D′ = kilitsiz, D5 değil, başka eksen. Kimliklerde AP/BP/CP/DP.
// Etiket politikası H19b ile aynı: fonksiyon düzeyi; çağıranların kilitleri sayılmaz, fonksiyonun kendi
// çağırdığı yardımcının koruması sayılır.
//
// Aileler (protokol §10, önceden işaretlenir):
//   stale_token        bayat yazma belirtecinin zorunlu/isteğe bağlı olması
//   key_scope          advisory kilit anahtarının kapsamı
//   check_before_lock  kontrolün kilit öncesine taşınması
//   snapshot_refresh   kilit alınıp satırın yeniden okunmaması
//   clock_after_wait   kilit beklemesinden sonra zaman kaynağı
//   share_fence        FOR SHARE ile okuma çiti (dondurulmuş kilit tanımında sayılmaz)
//   window_boundary    sayaç penceresi sınırında eşzamanlı istekler
//   lease_guard        kiralanmış işin bakım tarafından ezilmesi
//   cas_predicate      koşullu güncellemenin durum koşulu
//   check_then_act     tek ifadenin "önce bak sonra yaz"a bölünmesi
//   upsert_semantics   upsert ile "güncelle, yoksa ekle" arasındaki fark
//   helper_delegation  seri hale getiren yardımcıya devretme / yardımcıdan çıkma
//   surface_protective yüzeyde koruyucu görünen (A05/B08 benzeri)
//   removed_predicate  koşul satırı siliniyor (D09 benzeri)

const M = (find, replace) => ({ find, replace });
const F = {
  cancelPublic: '20260911140000_phase7_customer_manage.sql',
  catalog500: '20260914111500_f10_catalog_hours_management.sql',
  catalog600: '20260914111600_f10_catalog_hours_limits.sql',
  catalog700: '20260914111700_f10_catalog_stale_hardening.sql',
  price: '20260915150000_f12_service_price_range.sql',
  media: '20260914110500_f12_salon_profile_media.sql',
  team: '20260914033000_f10_team_access.sql',
  customers: '20260914110000_f10_customer_records.sql',
  s03: '20260912123000_s03_notification_consistency.sql',
  hardening: '20260911121000_phase5_booking_hardening.sql',
  core: '20260911120000_phase5_booking_core.sql',
  public6: '20260911130000_phase6_public_booking.sql',
  authority: '20260914110200_f10_customer_authority_repair.sql',
  abuse9: '20260911180000_phase9_public_abuse_control.sql',
  s04: '20260913030912_s04_resource_limits.sql',
  maint9: '20260911170100_phase9_notification_maintenance.sql',
  s07: '20260913120601_s07_public_booking_resolution.sql',
};

const RESOLVER = (business, createdBy) => `  v_customer_id := public.f10_resolve_or_create_customer(
    ${business},
    v_customer_name,
    v_customer_phone,
    v_customer_email,
    null,
    ${createdBy},
    true
  );`;

export const CASES = [
  // ================= A′ / C′: kilitli fonksiyonlar, 16 eş =================
  {
    id: 'AP01', cell: 'A', pair: 'CP01', file: F.cancelPublic, fn: 'cancel_public_managed_appointment', label: 'weakens', families: ['check_before_lock'],
    rationale: 'Durum ve zaman kontrolü kilitsiz yetenek okumasının hemen arkasına taşındı; satır kilidiyle yeniden okunan randevu artık kontrol edilmiyor. Eşzamanlı bir iptal/yeniden planlama arada tamamlanırsa ikinci iptal yine yazılır.',
    mutations: [
      M(`  if v_current.id is null then raise exception 'MANAGEMENT_NOT_FOUND'; end if;
`, `  if v_current.id is null then raise exception 'MANAGEMENT_NOT_FOUND'; end if;
  if v_current.status not in ('scheduled','confirmed') or v_current.starts_at <= now() then
    raise exception 'APPOINTMENT_NOT_MANAGEABLE';
  end if;
`),
      M(`  for update;

  if v_current.status not in ('scheduled','confirmed') or v_current.starts_at <= now() then
    raise exception 'APPOINTMENT_NOT_MANAGEABLE';
  end if;
`, `  for update;
`),
    ],
  },
  {
    id: 'CP01', cell: 'C', axis: 'D4', pair: 'AP01', file: F.cancelPublic, fn: 'cancel_public_managed_appointment', label: 'no_effect', families: [],
    rationale: 'Müşteri iptali randevudan en geç 2 saat önce ve aynı yerel gün içinde olmamak koşuluyla yapılabiliyor (zaman sınırı, yerel gün); kontrol aynı kilit altında.',
    mutations: [M(`  if v_current.status not in ('scheduled','confirmed') or v_current.starts_at <= now() then
    raise exception 'APPOINTMENT_NOT_MANAGEABLE';
  end if;`, `  if v_current.status not in ('scheduled','confirmed')
     or v_current.starts_at <= now() + interval '2 hours'
     or (v_current.starts_at at time zone v_current.timezone)::date
        = (now() at time zone v_current.timezone)::date then
    raise exception 'APPOINTMENT_NOT_MANAGEABLE';
  end if;`)],
  },
  {
    id: 'AP02', cell: 'A', pair: 'CP02', file: F.catalog500, fn: 'update_staff_guarded', label: 'strengthens', families: ['stale_token'],
    rationale: 'Bayat yazma belirteci zorunlu oldu; belirteç vermeyen eşzamanlı bir düzenleme artık başka bir düzenlemenin üstüne sessizce yazamaz.',
    mutations: [M(`  if p_expected_updated_at is not null and v_row.updated_at is distinct from p_expected_updated_at then`,
      `  if p_expected_updated_at is null or v_row.updated_at is distinct from p_expected_updated_at then`)],
  },
  {
    id: 'CP02', cell: 'C', axis: 'D2', pair: 'AP02', file: F.catalog500, fn: 'update_staff_guarded', label: 'no_effect', families: [],
    rationale: 'Personel adı değişince gelecekteki randevuların personel adı anlık görüntüsü de yeniden yazılıyor (sonraki durum önceki anlamı değiştiriyor).',
    mutations: [M(`  returning * into v_row;
  return v_row;`, `  returning * into v_row;

  update public.appointments a
  set staff_name_snapshot = v_row.name
  where a.business_id = p_business_id
    and a.staff_id = p_staff_id
    and a.status in ('scheduled','confirmed')
    and a.starts_at > now();
  return v_row;`)],
  },
  {
    id: 'AP03', cell: 'A', pair: 'CP03', file: F.catalog700, fn: 'update_staff_guarded', label: 'weakens', families: ['stale_token', 'surface_protective'],
    rationale: 'Bayat yazma belirteci isteğe bağlı oldu; belirteç göndermeyen eşzamanlı düzenleme başka bir düzenlemenin üstüne sessizce yazar (kayıp güncelleme).',
    mutations: [M(`  if p_expected_updated_at is null
     or v_row.updated_at is distinct from p_expected_updated_at then`, `  if p_expected_updated_at is not null
     and v_row.updated_at is distinct from p_expected_updated_at then`)],
  },
  {
    id: 'CP03', cell: 'C', axis: 'D0', pair: 'AP03', file: F.catalog700, fn: 'update_staff_guarded', label: 'no_effect', families: [],
    rationale: 'Yöneticiye ek olarak, personel kaydına bağlı aktif üye kendi personel profilini düzenleyebiliyor (yetki kapsamı).',
    mutations: [M(`  if not public.can_manage_business(p_business_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;`, `  if not public.can_manage_business(p_business_id)
     and not exists (
       select 1
       from public.staff_profiles sp
       join public.memberships m on m.id = sp.membership_id
       where sp.business_id = p_business_id
         and sp.id = p_staff_id
         and m.user_id = auth.uid()
         and m.active
     ) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;`)],
  },
  {
    id: 'AP04', cell: 'A', pair: 'CP04', file: F.catalog500, fn: 'update_service_guarded', label: 'strengthens', families: ['stale_token'],
    rationale: 'Bayat yazma belirteci zorunlu oldu; eşzamanlı hizmet düzenlemeleri birbirinin üstüne sessizce yazamaz.',
    mutations: [M(`  if p_expected_updated_at is not null and v_row.updated_at is distinct from p_expected_updated_at then`,
      `  if p_expected_updated_at is null or v_row.updated_at is distinct from p_expected_updated_at then`)],
  },
  {
    id: 'CP04', cell: 'C', axis: 'D2', pair: 'AP04', file: F.catalog500, fn: 'update_service_guarded', label: 'no_effect', families: [],
    rationale: 'Hizmet fiyatı oluşturulduktan sonra bu fonksiyonla değiştirilemiyor; fiyat alanı yamadan, hesaplamadan ve güncellemeden çıkarıldı (yakalanan fiyat politikası).',
    mutations: [
      M(`       where k not in ('name','durationMinutes','bufferBeforeMinutes','bufferAfterMinutes','priceMinor','active')`,
        `       where k not in ('name','durationMinutes','bufferBeforeMinutes','bufferAfterMinutes','active')`),
      M(`    v_price := case when p_patch ? 'priceMinor' then (p_patch->>'priceMinor')::integer else v_row.price_minor end;
`, ``),
      M(`     or v_price not between 0 and 100000000
`, ``),
      M(`      price_minor = v_price,
`, ``),
    ],
  },
  {
    id: 'AP05', cell: 'A', pair: 'CP05', file: F.price, fn: 'update_service_guarded', label: 'weakens', families: ['stale_token', 'surface_protective'],
    rationale: 'Bayat yazma belirteci isteğe bağlı oldu; belirteçsiz eşzamanlı düzenleme kayıp güncelleme üretir.',
    mutations: [M(`  if p_expected_updated_at is null
     or v_row.updated_at is distinct from p_expected_updated_at then`, `  if p_expected_updated_at is not null
     and v_row.updated_at is distinct from p_expected_updated_at then`)],
  },
  {
    id: 'CP05', cell: 'C', axis: 'D2', pair: 'AP05', file: F.price, fn: 'update_service_guarded', label: 'no_effect', families: [],
    rationale: 'Fiyat politikası yeniden yazıldı: eski tek fiyat alanı mevcut fiyat tipini koruyup aralığı kaydırıyor, para birimi oluşturulduktan sonra değişmiyor (politika seçimi).',
    mutations: [M(`    v_legacy_price := p_patch ? 'priceMinor';
    if v_legacy_price then
      v_type := 'fixed';
      v_min := (p_patch->>'priceMinor')::integer;
      v_max := v_min;
      v_currency := v_row.currency;
    else
      v_type := case when p_patch ? 'priceType' then lower(trim(p_patch->>'priceType')) else v_row.price_type end;
      v_min := case when p_patch ? 'priceMinMinor' then (p_patch->>'priceMinMinor')::integer else v_row.price_min_minor end;
      v_max := case when p_patch ? 'priceMaxMinor' then (p_patch->>'priceMaxMinor')::integer else v_row.price_max_minor end;
      v_currency := case when p_patch ? 'currency' then upper(trim(p_patch->>'currency')) else v_row.currency end;
    end if;`, `    v_legacy_price := p_patch ? 'priceMinor';
    v_currency := v_row.currency;
    if v_legacy_price then
      v_type := v_row.price_type;
      v_min := (p_patch->>'priceMinor')::integer;
      v_max := greatest(v_min, v_row.price_max_minor);
    else
      v_type := coalesce(lower(trim(p_patch->>'priceType')), v_row.price_type);
      v_min := coalesce((p_patch->>'priceMinMinor')::integer, v_row.price_min_minor);
      v_max := coalesce((p_patch->>'priceMaxMinor')::integer, v_row.price_max_minor);
    end if;`)],
  },
  {
    id: 'AP06', cell: 'A', pair: 'CP06', file: F.catalog600, fn: 'replace_business_hours_guarded', label: 'strengthens', families: ['stale_token'],
    rationale: 'Belirteçsiz istek, mevcut saatler boş değilse bayat sayılıyor; eşzamanlı iki değiştirmeden ikincisi ilkini körlemesine silemez.',
    mutations: [M(`  if p_expected_intervals is not null and v_current is distinct from p_expected_intervals then`,
      `  if p_expected_intervals is null and v_current <> '[]'::jsonb then
    raise exception 'STALE_WRITE';
  end if;
  if p_expected_intervals is not null and v_current is distinct from p_expected_intervals then`)],
  },
  {
    id: 'CP06', cell: 'C', axis: 'D4', pair: 'AP06', file: F.catalog600, fn: 'replace_business_hours_guarded', label: 'no_effect', families: [],
    rationale: '06:00\'dan önce başlayan aralıklar sessizce atlanıyor (zaman penceresi kuralı); çağrı aynı kilit altında.',
    mutations: [M(`  return query select * from public.replace_business_hours(p_business_id, p_weekday, p_intervals);`,
      `  return query select * from public.replace_business_hours(
    p_business_id,
    p_weekday,
    coalesce((
      select jsonb_agg(e order by e->>'start')
      from jsonb_array_elements(p_intervals) e
      where (e->>'start')::time >= time '06:00'
    ), '[]'::jsonb)
  );`)],
  },
  {
    id: 'AP07', cell: 'A', pair: 'CP07', file: F.catalog600, fn: 'replace_staff_hours_guarded', label: 'strengthens', families: ['stale_token'],
    rationale: 'Belirteçsiz istek, mevcut personel saatleri boş değilse bayat sayılıyor; eşzamanlı değiştirmeler birbirini körlemesine ezemez.',
    mutations: [M(`  if p_expected_intervals is not null and v_current is distinct from p_expected_intervals then`,
      `  if p_expected_intervals is null and v_current <> '[]'::jsonb then
    raise exception 'STALE_WRITE';
  end if;
  if p_expected_intervals is not null and v_current is distinct from p_expected_intervals then`)],
  },
  {
    id: 'CP07', cell: 'C', axis: 'D4', pair: 'AP07', file: F.catalog600, fn: 'replace_staff_hours_guarded', label: 'no_effect', families: [],
    rationale: 'Personel aralıklarının bitişi 23:00\'e kırpılıyor (zaman penceresi kuralı); çağrı aynı kilit altında.',
    mutations: [M(`  return query select * from public.replace_staff_hours(
    p_business_id, p_staff_id, p_weekday, p_intervals
  );`, `  return query select * from public.replace_staff_hours(
    p_business_id, p_staff_id, p_weekday,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'start', e->>'start',
        'end', to_char(least((e->>'end')::time, time '23:00'), 'HH24:MI')
      ))
      from jsonb_array_elements(p_intervals) e
    ), '[]'::jsonb)
  );`)],
  },
  {
    id: 'AP08', cell: 'A', pair: 'CP08', file: F.catalog500, fn: 'replace_staff_hours_guarded', label: 'strengthens', families: ['stale_token'],
    rationale: 'Beklenen aralıklar belirteci zorunlu oldu; belirteçsiz eşzamanlı değiştirme artık reddediliyor.',
    mutations: [M(`  if p_expected_intervals is not null and v_current is distinct from p_expected_intervals then`,
      `  if p_expected_intervals is null or v_current is distinct from p_expected_intervals then`)],
  },
  {
    id: 'CP08', cell: 'C', axis: 'D4', pair: 'AP08', file: F.catalog500, fn: 'replace_staff_hours_guarded', label: 'no_effect', families: [],
    rationale: 'ISO hafta günü 7 (pazar) 0\'a çevriliyor; gün sınırı/takvim yorumu değişir. Eşleme en başta yapıldığı için kilit anahtarı ve veri aynı günü kullanır.',
    mutations: [M(`  if p_expected_intervals is not null and jsonb_typeof(p_expected_intervals) <> 'array' then`,
      `  p_weekday := case when p_weekday = 7 then 0 else p_weekday end;
  if p_expected_intervals is not null and jsonb_typeof(p_expected_intervals) <> 'array' then`)],
  },
  {
    id: 'AP09', cell: 'A', pair: 'CP09', file: F.catalog700, fn: 'set_staff_service_guarded', label: 'weakens', families: ['key_scope', 'surface_protective'],
    rationale: 'Advisory kilit anahtarı işletmeden personele daraltıldı; işletme geneli atama sayısı limiti artık serileşmiyor, farklı personel için eşzamanlı atamalar limiti birlikte aşar.',
    mutations: [M(`  perform pg_advisory_xact_lock(hashtextextended('f10-04:assignments:' || p_business_id::text, 0));`,
      `  perform pg_advisory_xact_lock(hashtextextended('f10-04:assignments:' || p_business_id::text || ':' || p_staff_id::text, 0));`)],
  },
  {
    id: 'CP09', cell: 'C', axis: 'D3', pair: 'AP09', file: F.catalog700, fn: 'set_staff_service_guarded', label: 'no_effect', families: ['removed_predicate'],
    rationale: 'Etkinleştirmede personelin aktif olması şartı kalktı; pasif personele hizmet atanabilir (personel/atama kuralı).',
    mutations: [M(`      where sp.business_id = p_business_id and sp.id = p_staff_id and sp.active
    ) then
    raise exception 'STAFF_NOT_FOUND';`, `      where sp.business_id = p_business_id and sp.id = p_staff_id
    ) then
    raise exception 'STAFF_NOT_FOUND';`)],
  },
  {
    id: 'AP10', cell: 'A', pair: 'CP10', file: F.catalog500, fn: 'set_staff_service_guarded', label: 'strengthens', families: ['stale_token'],
    rationale: 'Var olan atama için bayat yazma belirteci zorunlu oldu; eşzamanlı düzenlemeler birbirinin üstüne sessizce yazamaz.',
    mutations: [M(`  if v_exists and p_expected_updated_at is not null
     and v_row.updated_at is distinct from p_expected_updated_at then`, `  if v_exists and (
       p_expected_updated_at is null
       or v_row.updated_at is distinct from p_expected_updated_at
     ) then`)],
  },
  {
    id: 'CP10', cell: 'C', axis: 'D3', pair: 'AP10', file: F.catalog500, fn: 'set_staff_service_guarded', label: 'no_effect', families: [],
    rationale: 'Atama limitine yalnız aktif atamalar sayılıyor (kapasite kuralı); sayım aynı kilit altında.',
    mutations: [M(`    from public.staff_services ss where ss.business_id = p_business_id;`,
      `    from public.staff_services ss where ss.business_id = p_business_id and ss.active;`)],
  },
  {
    id: 'AP11', cell: 'A', pair: 'CP11', file: F.media, fn: 'begin_business_public_media_upload', label: 'weakens', families: ['check_before_lock'],
    rationale: 'Sayım ve limit kontrolü işletme satırı kilidinden önceye taşındı; eşzamanlı yüklemeler 20 limitini ve sort_order hesabını birlikte geçer.',
    mutations: [
      M(`  select count(*), coalesce(max(m.sort_order), -1) + 1
    into v_count, v_order
  from public.business_public_media m
  where m.business_id = p_business_id;

  if v_count >= 20 then raise exception 'PUBLIC_MEDIA_LIMIT_EXCEEDED'; end if;

`, ``),
      M(`  perform 1 from public.businesses b where b.id = p_business_id for update;`, `  select count(*), coalesce(max(m.sort_order), -1) + 1
    into v_count, v_order
  from public.business_public_media m
  where m.business_id = p_business_id;

  if v_count >= 20 then raise exception 'PUBLIC_MEDIA_LIMIT_EXCEEDED'; end if;

  perform 1 from public.businesses b where b.id = p_business_id for update;`),
    ],
  },
  {
    id: 'CP11', cell: 'C', axis: 'D3', pair: 'AP11', file: F.media, fn: 'begin_business_public_media_upload', label: 'no_effect', families: [],
    rationale: 'Görsel limiti kapak görseli seçilmiş işletmeler için 30, diğerleri için 20 (kaynak sınırı); kontrol kilit altında.',
    mutations: [M(`  if v_count >= 20 then raise exception 'PUBLIC_MEDIA_LIMIT_EXCEEDED'; end if;`, `  if v_count >= case
       when exists (
         select 1 from public.business_public_profiles p
         where p.business_id = p_business_id and p.cover_media_id is not null
       ) then 30
       else 20
     end then
    raise exception 'PUBLIC_MEDIA_LIMIT_EXCEEDED';
  end if;`)],
  },
  {
    id: 'AP12', cell: 'A', pair: 'CP12', file: F.team, fn: 'accept_business_invitation', label: 'weakens', families: ['snapshot_refresh', 'surface_protective'],
    rationale: 'Davet satırı kilitleniyor ama yeniden okunmuyor; iptal/kabul/süre kontrolleri kilit öncesi anlık görüntüde çalışıyor. Aynı işletme kilidini alan eşzamanlı bir iptal gözden kaçar.',
    mutations: [M(`  select * into v_invitation
  from public.business_invitations i
  where i.id = v_invitation.id
  for update;`, `  perform 1
  from public.business_invitations i
  where i.id = v_invitation.id
  for update;`)],
  },
  {
    id: 'CP12', cell: 'C', axis: 'D0', pair: 'AP12', file: F.team, fn: 'accept_business_invitation', label: 'no_effect', families: [],
    rationale: 'Davet e-postasının tam eşleşmesi yerine yalnız alan adı eşleşmesi aranıyor ve yeniden etkinleşen üye eski rolünü koruyor (yetki kapsamı ve rol).',
    mutations: [
      M(`  if v_invitation.email_normalized <> v_email then
    raise exception 'INVITATION_EMAIL_MISMATCH' using errcode = '42501';
  end if;`, `  if split_part(v_invitation.email_normalized, '@', 2) <> split_part(v_email, '@', 2) then
    raise exception 'INVITATION_DOMAIN_MISMATCH' using errcode = '42501';
  end if;`),
      M(`    set role = v_invitation.role,
        active = true`, `    set active = true`),
    ],
  },
  {
    id: 'AP13', cell: 'A', pair: 'CP13', file: F.customers, fn: 'update_business_customer', label: 'weakens', families: ['key_scope', 'surface_protective'],
    rationale: 'Advisory kilit anahtarı işletmeden müşteriye daraltıldı; iletişim bilgisi çakışma kontrolü, aynı işletme anahtarını kullanan müşteri oluşturma ile artık serileşmiyor, yinelenen iletişim oluşabilir.',
    mutations: [M(`  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text, 0));`,
      `  perform pg_advisory_xact_lock(hashtextextended(p_customer_id::text, 0));`)],
  },
  {
    id: 'CP13', cell: 'C', axis: 'D0', pair: 'AP13', file: F.customers, fn: 'update_business_customer', label: 'no_effect', families: [],
    rationale: 'Müşteri düzenleme yetkisi her aktif üyeden yöneticilere ve müşteriyi oluşturan üyeye daraldı (yetki kapsamı).',
    mutations: [M(`  if not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;`, `  if not public.can_manage_business(p_business_id)
     and not exists (
       select 1
       from public.customers c
       where c.business_id = p_business_id
         and c.id = p_customer_id
         and c.created_by = auth.uid()
     ) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;`)],
  },
  {
    id: 'AP14', cell: 'A', pair: 'CP14', file: F.s03, fn: 'lock_notification_request_v2', label: 'weakens', families: ['clock_after_wait'],
    rationale: 'Kilit beklemesinden sonraki zaman kaynağı clock_timestamp() yerine işlem başı now() oldu; uzun satır kilidi beklemesinden çıkan istek süresi dolmuş kiralamayla gönderim izni alabilir, işi geri alan başka işçiyle çakışır.',
    mutations: [M(`  v_now := clock_timestamp();`, `  v_now := now();`)],
  },
  {
    id: 'CP14', cell: 'C', axis: 'D2', pair: 'AP14', file: F.s03, fn: 'lock_notification_request_v2', label: 'no_effect', families: [],
    rationale: 'Gönderen ve köken anlık görüntüleri ilk yakalanan değerde kalıyor (yakalanan durum politikası); güncelleme aynı kilit altında.',
    mutations: [M(`  set sender_snapshot = btrim(p_sender),
      origin_snapshot = p_origin,`, `  set sender_snapshot = coalesce(sender_snapshot, btrim(p_sender)),
      origin_snapshot = coalesce(origin_snapshot, p_origin),`)],
  },
  {
    id: 'AP15', cell: 'A', pair: 'CP15', file: F.cancelPublic, fn: 'reschedule_public_managed_appointment', label: 'strengthens', families: ['share_fence'],
    rationale: 'Personel uygunluk okumasına paylaşımlı satır kilidi eklendi; personeli pasifleştiren veya atamayı kaldıran eşzamanlı işlemler (bu satırları FOR UPDATE ile kilitler) bu yeniden planlamayla serileşir.',
    mutations: [M(`  where sp.business_id = v_current.business_id
    and sp.id = p_staff_id
    and sp.active;`, `  where sp.business_id = v_current.business_id
    and sp.id = p_staff_id
    and sp.active
  for share of sp, ss;`)],
  },
  {
    id: 'CP15', cell: 'C', axis: 'D3', pair: 'AP15', file: F.cancelPublic, fn: 'reschedule_public_managed_appointment', label: 'no_effect', families: ['removed_predicate'],
    rationale: 'Personel uygunluğunda atamanın aktif olması şartı kalktı; pasif atamayla yeniden planlanabilir (atama kuralı).',
    mutations: [M(`   and ss.service_id = v_current.service_id
   and ss.active
`, `   and ss.service_id = v_current.service_id
`)],
  },
  {
    id: 'AP16', cell: 'A', pair: 'CP16', file: F.hardening, fn: 'reschedule_appointment', label: 'strengthens', families: ['share_fence'],
    rationale: 'Personel uygunluk okumasına paylaşımlı satır kilidi eklendi; eşzamanlı personel pasifleştirme veya atama kaldırma bu yeniden planlamayla serileşir.',
    mutations: [M(`  where sp.business_id = p_business_id and sp.id = p_staff_id and sp.active;`,
      `  where sp.business_id = p_business_id and sp.id = p_staff_id and sp.active
  for share of sp, ss;`)],
  },
  {
    id: 'CP16', cell: 'C', axis: 'D0', pair: 'AP16', file: F.hardening, fn: 'reschedule_appointment', label: 'no_effect', families: [],
    rationale: 'Yeniden planlama yetkisi her aktif üyeden yöneticilere ve randevuya atanmış personelin üyesine daraldı (yetki kapsamı).',
    mutations: [M(`  if auth.uid() is null or not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED';
  end if;`, `  if auth.uid() is null
     or not (
       public.can_manage_business(p_business_id)
       or exists (
         select 1
         from public.appointments a
         join public.staff_profiles sp on sp.id = a.staff_id
         join public.memberships m on m.id = sp.membership_id
         where a.business_id = p_business_id
           and a.id = p_appointment_id
           and m.user_id = auth.uid()
           and m.active
       )
     ) then
    raise exception 'NOT_ALLOWED';
  end if;`)],
  },

  // ================= B′ / D′: kilitsiz, ipucusuz fonksiyonlar, 16 eş =================
  {
    id: 'BP01', cell: 'B', pair: 'DP01', file: F.s04, fn: 'consume_public_booking_rate', label: 'weakens', families: ['window_boundary'],
    rationale: 'Pencere karşılaştırması ">=" yerine "=" oldu (s04 onarımının geri alınması); pencere sınırında geç kalan eski bir istek sayacı eski pencereye döndürüp sıfırlar, eşzamanlı istekler limiti aşar.',
    mutations: [M(`  set window_started_at = case
        when public.public_booking_rate_counters.window_started_at >= v_window_start
          then public.public_booking_rate_counters.window_started_at
        else v_window_start
      end,
      count = case
        when public.public_booking_rate_counters.window_started_at >= v_window_start`, `  set window_started_at = case
        when public.public_booking_rate_counters.window_started_at = v_window_start
          then public.public_booking_rate_counters.window_started_at
        else v_window_start
      end,
      count = case
        when public.public_booking_rate_counters.window_started_at = v_window_start`)],
  },
  {
    id: 'DP01', cell: 'D', axis: 'D3', pair: 'BP01', file: F.s04, fn: 'consume_public_booking_rate', label: 'no_effect', families: [],
    rationale: 'Limit sınırı bir eksildi ("> limit" yerine ">= limit"); pencere başına izin verilen istek sayısı (kaynak sınırı) değişir.',
    mutations: [M(`  if v_count > p_limit then`, `  if v_count >= p_limit then`)],
  },
  {
    id: 'BP02', cell: 'B', pair: 'DP02', file: F.abuse9, fn: 'consume_public_booking_rate', label: 'strengthens', families: ['window_boundary'],
    rationale: 'Pencere karşılaştırması "=" yerine ">=" oldu (gerçek s04 onarımı); pencere sınırında geç kalan eski istek sayacı geri sarıp sıfırlayamaz, yeni pencereyi artırır.',
    mutations: [M(`  set window_started_at = case
        when public.public_booking_rate_counters.window_started_at = v_window_start
          then public.public_booking_rate_counters.window_started_at
        else v_window_start
      end,
      count = case
        when public.public_booking_rate_counters.window_started_at = v_window_start`, `  set window_started_at = case
        when public.public_booking_rate_counters.window_started_at >= v_window_start
          then public.public_booking_rate_counters.window_started_at
        else v_window_start
      end,
      count = case
        when public.public_booking_rate_counters.window_started_at >= v_window_start`)],
  },
  {
    id: 'DP02', cell: 'D', axis: 'D4', pair: 'BP02', file: F.abuse9, fn: 'consume_public_booking_rate', label: 'no_effect', families: [],
    rationale: 'Pencere başlangıcı pencere uzunluğuna göre değil dakikaya göre hizalanıyor (zaman penceresi sınırı değişir).',
    mutations: [M(`  v_window_start := to_timestamp(
    floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds
  );`, `  v_window_start := date_trunc('minute', v_now);`)],
  },
  {
    id: 'BP03', cell: 'B', pair: 'DP03', file: F.maint9, fn: 'maintain_notification_jobs', label: 'weakens', families: ['lease_guard', 'removed_predicate'],
    rationale: 'Deneme bütçesi dalında etkin kiralama koruması kaldırıldı; bakım, bir işçi gönderim yaparken işi sonlandırıp kiralama belirtecini siler.',
    mutations: [M(`      or (
        j.attempt_count >= j.max_attempts
        and (j.state <> 'leased' or j.lease_expires_at <= now())
      )`, `      or j.attempt_count >= j.max_attempts`)],
  },
  {
    id: 'DP03', cell: 'D', axis: 'D4', pair: 'BP03', file: F.maint9, fn: 'maintain_notification_jobs', label: 'no_effect', families: [],
    rationale: 'Onay bildirimleri için yeniden deneme süresi dolumuna 5 dakikalık tolerans tanındı (iş türüne göre zaman sınırı).',
    mutations: [M(`      j.retry_until <= now()`, `      j.retry_until <= now() - case
        when j.kind = 'public_booking_confirmation' then interval '5 minutes'
        else interval '0 minutes'
      end`)],
  },
  {
    id: 'BP04', cell: 'B', pair: 'DP04', file: F.s03, fn: 'maintain_notification_jobs', label: 'strengthens', families: ['lease_guard'],
    rationale: 'Süre dolumu dalına etkin kiralama koruması eklendi; bakım, gönderim yapan bir işçinin işini artık altından sonlandırmaz.',
    mutations: [M(`      or j.retry_until <= now()
`, `      or (j.retry_until <= now() and (j.state <> 'leased' or j.lease_expires_at <= now()))
`)],
  },
  {
    id: 'DP04', cell: 'D', axis: 'D2', pair: 'BP04', file: F.s03, fn: 'maintain_notification_jobs', label: 'no_effect', families: [],
    rationale: 'Sonlandırmada daha önce yakalanmış hata sınıfı ve ayrıntılı nedenler korunmuyor, hepsi tek sabit etiketle ezilir (geçmiş değerin yeniden yazılması).',
    mutations: [M(`      last_error_class = case
        when not j.is_current then 'stale_notification_event'
        when j.delivery_certainty = 'ambiguous'
          and j.provider_idempotency_expires_at <= now()
          then 'idempotency_window_expired_ambiguous'
        else coalesce(j.last_error_class, 'retry_budget_exhausted')
      end,`, `      last_error_class = 'retry_budget_exhausted',`)],
  },
  {
    id: 'BP05', cell: 'B', pair: 'DP05', file: F.s07, fn: 'maintain_notification_jobs', label: 'strengthens', families: ['lease_guard'],
    rationale: 'Süre dolumu dalına etkin kiralama koruması eklendi; bakım, gönderim yapan işçinin işini altından sonlandırmaz.',
    mutations: [M(`      or j.retry_until <= now()
`, `      or (j.retry_until <= now() and (j.state <> 'leased' or j.lease_expires_at <= now()))
`)],
  },
  {
    id: 'DP05', cell: 'D', axis: 'D4', pair: 'BP05', file: F.s07, fn: 'maintain_notification_jobs', label: 'no_effect', families: [],
    rationale: 'Belirsiz teslimatlarda sağlayıcı tekilleştirme penceresi 1 dakika tolerans sonrası kapanmış sayılıyor (zaman sınırı).',
    mutations: [M(`      or (j.delivery_certainty = 'ambiguous' and j.provider_idempotency_expires_at <= now())`,
      `      or (j.delivery_certainty = 'ambiguous' and j.provider_idempotency_expires_at <= now() - interval '1 minute')`)],
  },
  {
    id: 'BP06', cell: 'B', pair: 'DP06', file: F.media, fn: 'finalize_business_public_media_upload', label: 'weakens', families: ['cas_predicate', 'removed_predicate'],
    rationale: 'Koşullu geçişin "pending" durum koşulu kaldırıldı; eşzamanlı silme/temizleme sürecindeki görsel tekrar "ready" yapılabilir.',
    mutations: [M(`  where m.business_id = p_business_id and m.id = p_media_id and m.status = 'pending'`, `  where m.business_id = p_business_id and m.id = p_media_id`)],
  },
  {
    id: 'DP06', cell: 'D', axis: 'D0', pair: 'BP06', file: F.media, fn: 'finalize_business_public_media_upload', label: 'no_effect', families: [],
    rationale: 'Yüklemeyi sonlandırma yetkisi yöneticiye ek olarak görseli yükleyen aktif üyeye de verildi (yetki kapsamı).',
    mutations: [M(`  if not public.can_manage_business(p_business_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;`,
      `  if not public.can_manage_business(p_business_id)
     and not exists (
       select 1 from public.business_public_media m
       where m.business_id = p_business_id
         and m.id = p_media_id
         and m.created_by = auth.uid()
     ) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;`)],
  },
  {
    id: 'BP07', cell: 'B', pair: 'DP07', file: F.media, fn: 'finish_business_public_media_delete', label: 'weakens', families: ['check_then_act'],
    rationale: 'Koşullu silme "önce bak, sonra id ile sil"e bölündü; kontrolle silme arasında eşzamanlı bir geri yükleme görseli "ready" yaparsa görsel yine silinir.',
    mutations: [M(`  delete from public.business_public_media m
  where m.business_id = p_business_id and m.id = p_media_id and m.status in ('deleting','cleanup');`, `  if not exists (
    select 1 from public.business_public_media m
    where m.business_id = p_business_id and m.id = p_media_id and m.status in ('deleting','cleanup')
  ) then
    return false;
  end if;
  delete from public.business_public_media m
  where m.business_id = p_business_id and m.id = p_media_id;`)],
  },
  {
    id: 'DP07', cell: 'D', axis: 'D0', pair: 'BP07', file: F.media, fn: 'finish_business_public_media_delete', label: 'no_effect', families: ['removed_predicate'],
    rationale: 'Silme koşulundan işletme kapsamı kaldırıldı; başka işletmenin görseli id ile silinebilir (kiracı yalıtımı).',
    mutations: [M(`  where m.business_id = p_business_id and m.id = p_media_id and m.status in ('deleting','cleanup');`,
      `  where m.id = p_media_id and m.status in ('deleting','cleanup');`)],
  },
  {
    id: 'BP08', cell: 'B', pair: 'DP08', file: F.media, fn: 'mark_business_public_media_cleanup', label: 'weakens', families: ['check_then_act'],
    rationale: 'Koşullu geçiş "önce oku, uygunsa id ile güncelle"ye bölündü; okuma ile yazma arasında eşzamanlı bir geri yükleme görseli "ready" yaparsa temizlemeye yine alınır.',
    mutations: [M(`  update public.business_public_media m
  set status = 'cleanup'
  where m.business_id = p_business_id and m.id = p_media_id and m.status in ('pending','deleting')
  returning * into v_row;`, `  select * into v_row from public.business_public_media m
  where m.business_id = p_business_id and m.id = p_media_id;
  if v_row.status in ('pending','deleting') then
    update public.business_public_media m
    set status = 'cleanup'
    where m.business_id = p_business_id and m.id = p_media_id
    returning * into v_row;
  else
    v_row := null;
  end if;`)],
  },
  {
    id: 'DP08', cell: 'D', axis: 'D0', pair: 'BP08', file: F.media, fn: 'mark_business_public_media_cleanup', label: 'no_effect', families: ['removed_predicate'],
    rationale: 'Yedek okumadan işletme kapsamı kaldırıldı; başka işletmenin temizlemedeki görseli döndürülebilir (kiracı yalıtımı).',
    mutations: [M(`    where m.business_id = p_business_id and m.id = p_media_id and m.status = 'cleanup';`,
      `    where m.id = p_media_id and m.status = 'cleanup';`)],
  },
  {
    id: 'BP09', cell: 'B', pair: 'DP09', file: F.media, fn: 'restore_business_public_media_delete', label: 'strengthens', families: ['upsert_semantics'],
    rationale: 'Kapak geri yükleme yalnız kapak boşsa yazıyor; arada eşzamanlı bir profil güncellemesinin seçtiği yeni kapak artık ezilmez.',
    mutations: [M(`    on conflict (business_id) do update set cover_media_id = excluded.cover_media_id;`,
      `    on conflict (business_id) do update set cover_media_id = excluded.cover_media_id
    where public.business_public_profiles.cover_media_id is null;`)],
  },
  {
    id: 'DP09', cell: 'D', axis: 'D2', pair: 'BP09', file: F.media, fn: 'restore_business_public_media_delete', label: 'no_effect', families: [],
    rationale: 'Kapak geri yükleme varsayılan politikası "hayır"dan "evet"e döndü (politika seçimi).',
    mutations: [M(`  if coalesce(p_restore_cover, false) then`, `  if coalesce(p_restore_cover, true) then`)],
  },
  {
    id: 'BP10', cell: 'B', pair: 'DP10', file: F.cancelPublic, fn: 'provision_public_management_token', label: 'strengthens', families: ['check_then_act'],
    rationale: 'Ön kontrolden sonraki ekleme çakışmada hiçbir şey yapmıyor ve mevcut belirteci yeniden karşılaştırıyor; kontrol ile ekleme arasındaki yarışta ikinci eşzamanlı kurulum ham hata yerine doğru sonuca ulaşır.',
    mutations: [M(`  ) values (
    p_appointment_id, v_business_id, v_hash
  );

  return true;`, `  ) values (
    p_appointment_id, v_business_id, v_hash
  )
  on conflict (appointment_id) do nothing;

  if not found then
    select c.token_hash into v_existing
    from public.appointment_management_capabilities c
    where c.appointment_id = p_appointment_id;
    if v_existing <> v_hash then
      raise exception 'MANAGEMENT_TOKEN_ALREADY_PROVISIONED';
    end if;
  end if;

  return true;`)],
  },
  {
    id: 'DP10', cell: 'D', axis: 'D0', pair: 'BP10', file: F.cancelPublic, fn: 'provision_public_management_token', label: 'no_effect', families: ['removed_predicate'],
    rationale: 'Başlangıç koşulundan randevu kaynağı şartı kaldırıldı; işletme tarafından oluşturulmuş randevulara da herkese açık yönetim belirteci kurulabilir (yetki kapsamı).',
    mutations: [M(`   and a.source = 'public'
`, ``)],
  },
  {
    id: 'BP11', cell: 'B', pair: 'DP11', file: F.authority, fn: 'create_public_appointment', label: 'weakens', families: ['helper_delegation'],
    rationale: 'Seri hale getiren müşteri çözümleyici çağrısı yerine kilitsiz "bul, yoksa ekle"; aynı yeni iletişim bilgisiyle eşzamanlı iki herkese açık randevu iki ayrı müşteri kaydı oluşturur.',
    mutations: [M(RESOLVER('v_business_id', 'null'), `  select c.id into v_customer_id
  from public.customers c
  where c.business_id = v_business_id
    and (
      (v_customer_phone is not null and c.phone = v_customer_phone)
      or (v_customer_email is not null and c.email = v_customer_email)
    )
  limit 1;

  if v_customer_id is null then
    insert into public.customers(business_id, name, phone, email, created_by)
    values (v_business_id, v_customer_name, v_customer_phone, v_customer_email, null)
    returning id into v_customer_id;
  end if;`)],
  },
  {
    id: 'DP11', cell: 'D', axis: 'D3', pair: 'BP11', file: F.authority, fn: 'create_public_appointment', label: 'no_effect', families: ['removed_predicate'],
    rationale: 'Personel uygunluğunda personelin aktif olması şartı kalktı; pasif personele herkese açık randevu alınabilir (personel kuralı).',
    mutations: [M(`  where sp.business_id = v_business_id
    and sp.id = p_staff_id
    and sp.active;`, `  where sp.business_id = v_business_id
    and sp.id = p_staff_id;`)],
  },
  {
    id: 'BP12', cell: 'B', pair: 'DP12', file: F.media, fn: 'update_business_public_profile', label: 'weakens', families: ['upsert_semantics'],
    rationale: 'Tek ifadelik upsert "güncelle, bulamazsan ekle"ye bölündü; profil satırı otomatik oluşturulmadığı için ilk kaydı yapan eşzamanlı iki istekten ikincisi benzersizlik hatası alır.',
    mutations: [
      M(`  insert into public.business_public_profiles(
    business_id, public_name, short_description, long_description,`, `  update public.business_public_profiles
  set public_name = v_public_name,
      short_description = v_short,
      long_description = v_long,
      public_phone = v_phone,
      public_email = v_email,
      public_website = v_website,
      public_whatsapp = v_whatsapp,
      address_text = v_address,
      show_work_hours = coalesce(p_show_work_hours, true),
      cover_media_id = p_cover_media_id
  where business_id = p_business_id;

  if not found then
  insert into public.business_public_profiles(
    business_id, public_name, short_description, long_description,`),
      M(`    coalesce(p_show_work_hours, true), p_cover_media_id
  )
  on conflict (business_id) do update
  set public_name = excluded.public_name,
      short_description = excluded.short_description,
      long_description = excluded.long_description,
      public_phone = excluded.public_phone,
      public_email = excluded.public_email,
      public_website = excluded.public_website,
      public_whatsapp = excluded.public_whatsapp,
      address_text = excluded.address_text,
      show_work_hours = excluded.show_work_hours,
      cover_media_id = excluded.cover_media_id;`, `    coalesce(p_show_work_hours, true), p_cover_media_id
  );
  end if;`),
    ],
  },
  {
    id: 'DP12', cell: 'D', axis: 'D2', pair: 'BP12', file: F.media, fn: 'update_business_public_profile', label: 'no_effect', families: [],
    rationale: 'Varsayılan politikalar değişti: çalışma saatleri varsayılan olarak gizli, boş herkese açık ad işletme adıyla dolduruluyor (politika seçimi).',
    mutations: [M(`    p_business_id, v_public_name, v_short, v_long,
    v_phone, v_email, v_website, v_whatsapp, v_address,
    coalesce(p_show_work_hours, true), p_cover_media_id`, `    p_business_id,
    coalesce(v_public_name, (select b.name from public.businesses b where b.id = p_business_id)),
    v_short, v_long,
    v_phone, v_email, v_website, v_whatsapp, v_address,
    coalesce(p_show_work_hours, false), p_cover_media_id`)],
  },
  {
    id: 'BP13', cell: 'B', pair: 'DP13', file: F.s03, fn: 'complete_notification_job_v2', label: 'weakens', families: ['cas_predicate', 'removed_predicate'],
    rationale: 'Tamamlamanın gönderim makbuzu koşulu kaldırıldı; aynı iş için başka bir kiralama altında üretilmiş eski bir tamamlama isteği de işi "gönderildi" yapabilir.',
    mutations: [M(`    and j.receipt_token = p_receipt_token
`, ``)],
  },
  {
    id: 'DP13', cell: 'D', axis: 'D2', pair: 'BP13', file: F.s03, fn: 'complete_notification_job_v2', label: 'no_effect', families: [],
    rationale: 'Gönderim zamanı ve sağlayıcı mesaj kimliği ilk kaydedilen değerde kalıyor (geçmiş değer semantiği).',
    mutations: [M(`      provider_message_id = p_provider_message_id,
      sent_at = now(),`, `      provider_message_id = coalesce(j.provider_message_id, p_provider_message_id),
      sent_at = coalesce(j.sent_at, now()),`)],
  },
  {
    id: 'BP14', cell: 'B', pair: 'DP14', file: F.hardening, fn: 'create_appointment', label: 'strengthens', families: ['helper_delegation'],
    rationale: 'Hızlı arama korunuyor, ama müşteri bulunamazsa yarışa açık doğrudan ekleme yerine seri hale getiren müşteri çözümleyici çağrılıyor; aynı yeni iletişim bilgisiyle gelen eşzamanlı randevular yinelenen müşteri oluşturamaz.',
    mutations: [M(`  if v_customer_id is null then
    insert into public.customers(business_id, name, phone, email, created_by)
    values(p_business_id, v_customer_name, v_customer_phone, v_customer_email, auth.uid())
    returning id into v_customer_id;`, `  if v_customer_id is null then
    v_customer_id := public.f10_resolve_or_create_customer(
      p_business_id, v_customer_name, v_customer_phone, v_customer_email, null, auth.uid(), true
    );`)],
  },
  {
    id: 'DP14', cell: 'D', axis: 'D4', pair: 'BP14', file: F.hardening, fn: 'create_appointment', label: 'no_effect', families: [],
    rationale: 'Randevunun takvim günü işletme saat diliminde değil UTC\'de hesaplanıyor (yerel gün dönüşümü).',
    mutations: [M(`  v_date := (p_starts_at at time zone v_timezone)::date;`, `  v_date := (p_starts_at at time zone 'UTC')::date;`)],
  },
  {
    id: 'BP15', cell: 'B', pair: 'DP15', file: F.core, fn: 'create_appointment', label: 'strengthens', families: ['helper_delegation'],
    rationale: 'Hızlı arama korunuyor, ama müşteri bulunamazsa yarışa açık doğrudan ekleme yerine seri hale getiren müşteri çözümleyici çağrılıyor; aynı yeni iletişim bilgisiyle gelen eşzamanlı randevular yinelenen müşteri oluşturamaz.',
    mutations: [M(`  if v_customer_id is null then
    insert into public.customers(business_id, name, phone, email, created_by)
    values(p_business_id, v_customer_name, v_customer_phone, v_customer_email, auth.uid())
    returning id into v_customer_id;`, `  if v_customer_id is null then
    v_customer_id := public.f10_resolve_or_create_customer(
      p_business_id, v_customer_name, v_customer_phone, v_customer_email, null, auth.uid(), true
    );`)],
  },
  {
    id: 'DP15', cell: 'D', axis: 'D3', pair: 'BP15', file: F.core, fn: 'create_appointment', label: 'no_effect', families: ['removed_predicate'],
    rationale: 'Personel uygunluğunda atamanın aktif olması şartı kalktı; pasif atamayla randevu alınabilir (atama kuralı).',
    mutations: [M(`   and ss.service_id = p_service_id
   and ss.active
  where sp.business_id = p_business_id and sp.id = p_staff_id and sp.active;`, `   and ss.service_id = p_service_id
  where sp.business_id = p_business_id and sp.id = p_staff_id and sp.active;`)],
  },
  {
    id: 'BP16', cell: 'B', pair: 'DP16', file: F.public6, fn: 'create_public_appointment', label: 'strengthens', families: ['helper_delegation'],
    rationale: 'Hızlı arama korunuyor, ama müşteri bulunamazsa yarışa açık doğrudan ekleme yerine seri hale getiren müşteri çözümleyici çağrılıyor; aynı yeni iletişim bilgisiyle gelen eşzamanlı randevular yinelenen müşteri oluşturamaz.',
    mutations: [M(`  if v_customer_id is null then
    insert into public.customers(business_id, name, phone, email, created_by)
    values(v_business_id, v_customer_name, v_customer_phone, v_customer_email, null)
    returning id into v_customer_id;`, `  if v_customer_id is null then
    v_customer_id := public.f10_resolve_or_create_customer(
      v_business_id, v_customer_name, v_customer_phone, v_customer_email, null, null, true
    );`)],
  },
  {
    id: 'DP16', cell: 'D', axis: 'D3', pair: 'BP16', file: F.public6, fn: 'create_public_appointment', label: 'no_effect', families: ['removed_predicate'],
    rationale: 'Personel uygunluğunda atamanın bu hizmete ait olması şartı kalktı; personelin herhangi bir aktif ataması yeterli (personel/hizmet eşleşme kuralı).',
    mutations: [M(`   and ss.staff_id = sp.id
   and ss.service_id = p_service_id
   and ss.active
  where sp.business_id = v_business_id`, `   and ss.staff_id = sp.id
   and ss.active
  where sp.business_id = v_business_id`)],
  },
];
