// H19b vaka tanımları (H19B-PROTOKOL v0.2). Her vaka gerçek bir migration fonksiyonuna uygulanan küçük,
// elle yazılmış mutasyondur. Etiket ve gerekçe Jev çağrısından önce yazıldı.
//
// Etiket politikası (ölçümden önce): etiket FONKSİYON DÜZEYİNDEDİR. Soru "bu fonksiyonda" korumanın nasıl
// değiştiğini sorar; çağıranların tuttuğu kilitler hesaba katılmaz. Fonksiyonun kendi çağırdığı yardımcıların
// sağladığı koruma ise fonksiyonun davranışının parçasıdır.
//
// Etiketler: weakens | strengthens | no_effect. Hücre: A B C D (birincil) ve E (koruma değişimi, ayrı rapor).

export const LABEL_POLICY = 'function-level: caller-held locks are ignored; protection provided by helpers the function itself calls counts';

const M = (find, replace) => ({ find, replace });

export const CASES = [
  // ---------------- A: kilit duruyor, güvence deliniyor ----------------
  {
    id: 'A01', cell: 'A', pair: 'C01', file: '20260914111500_f10_catalog_hours_management.sql', fn: 'create_staff_guarded', label: 'weakens',
    rationale: 'Sayım ve limit kontrolü advisory kilitten önceye taşındı; eşzamanlı iki ekleme 99 kaydı görüp limiti (100) aşabilir.',
    mutations: [M(
      `  perform pg_advisory_xact_lock(hashtextextended('f10-04:staff:' || p_business_id::text, 0));
  select count(*) into v_count from public.staff_profiles sp where sp.business_id = p_business_id;
  if v_count >= 100 then raise exception 'CATALOG_STAFF_LIMIT_EXCEEDED'; end if;
`,
      `  select count(*) into v_count from public.staff_profiles sp where sp.business_id = p_business_id;
  if v_count >= 100 then raise exception 'CATALOG_STAFF_LIMIT_EXCEEDED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('f10-04:staff:' || p_business_id::text, 0));
`)],
  },
  {
    id: 'A02', cell: 'A', pair: 'C02', file: '20260914033000_f10_team_access.sql', fn: 'revoke_business_invitation', label: 'weakens',
    rationale: 'Yetki okuması işletme kilidinden önceye taşındı; aynı kilidi alan eşzamanlı bir rol düşürme arada tamamlanırsa iptal eski yetkiyle yürür.',
    mutations: [M(
      `  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text, 0));
  select * into v_actor from public.f10_team_actor(p_business_id);
  if v_actor.membership_id is null or v_actor.role not in ('owner', 'manager') then
    raise exception 'TEAM_FORBIDDEN' using errcode = '42501';
  end if;
`,
      `  select * into v_actor from public.f10_team_actor(p_business_id);
  if v_actor.membership_id is null or v_actor.role not in ('owner', 'manager') then
    raise exception 'TEAM_FORBIDDEN' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text, 0));
`)],
  },
  {
    id: 'A03', cell: 'A', pair: 'C03', file: '20260923051000_f15_product_stock_ledger.sql', fn: 'archive_product_guarded', label: 'weakens',
    rationale: 'Sürüm kontrolü kilitsiz okumaya taşındı, satır kilidi sonra alınıyor ve güncelleme sürüm koşulu taşımıyor; aynı beklenen sürümle gelen eşzamanlı yazmalar birlikte geçer (kayıp güncelleme).',
    mutations: [M(
      `  select * into v_product
  from public.products p
  where p.business_id = p_business_id and p.id = p_product_id
  for update;

  if v_product.id is null then raise exception 'PRODUCT_NOT_FOUND'; end if;
  if p_expected_version is null or v_product.version <> p_expected_version then raise exception 'STALE_WRITE'; end if;
`,
      `  select * into v_product
  from public.products p
  where p.business_id = p_business_id and p.id = p_product_id;

  if v_product.id is null then raise exception 'PRODUCT_NOT_FOUND'; end if;
  if p_expected_version is null or v_product.version <> p_expected_version then raise exception 'STALE_WRITE'; end if;

  perform 1
  from public.products p
  where p.business_id = p_business_id and p.id = p_product_id
  for update;
`)],
  },
  {
    id: 'A04', cell: 'A', pair: 'C04', file: '20260914033000_f10_team_access.sql', fn: 'update_team_membership', label: 'weakens',
    rationale: 'Advisory kilit anahtarı işletmeden üyeliğe daraltıldı; son aktif sahip kontrolü artık serileşmiyor. İki sahip eşzamanlı düşürülürse ikisi de "başka sahip var" görür, işletme sahipsiz kalır.',
    mutations: [M(
      `  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text, 0));`,
      `  perform pg_advisory_xact_lock(hashtextextended(p_membership_id::text, 0));`)],
  },
  {
    id: 'A05', cell: 'A', pair: 'C05', file: '20260915150000_f12_service_price_range.sql', fn: 'create_service_guarded', label: 'weakens',
    rationale: 'Advisory kilit anahtarı hizmet adına daraltıldı; farklı adlı eşzamanlı eklemeler 100 limitini ve sort_order hesabını birlikte geçer.',
    mutations: [M(
      `  perform pg_advisory_xact_lock(hashtextextended('f10-04:services:' || p_business_id::text, 0));`,
      `  perform pg_advisory_xact_lock(hashtextextended('f10-04:services:' || p_business_id::text || ':' || lower(trim(p_name)), 0));`)],
  },
  {
    id: 'A06', cell: 'A', pair: 'C06', file: '20260914110500_f12_salon_profile_media.sql', fn: 'begin_business_public_media_upload', label: 'weakens',
    rationale: 'İşletme satırı kilidi sayım ve eklemeden sonraya taşındı; eşzamanlı yüklemeler 20 limitini ve sort_order hesabını birlikte geçer.',
    mutations: [
      M(`  perform 1 from public.businesses b where b.id = p_business_id for update;
  if not found then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;

  if p_media_id is null`, `  if p_media_id is null`),
      M(`    p_mime_type, p_size_bytes, p_width, p_height, auth.uid()
  );
`, `    p_mime_type, p_size_bytes, p_width, p_height, auth.uid()
  );

  perform 1 from public.businesses b where b.id = p_business_id for update;
  if not found then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
`),
    ],
  },
  {
    id: 'A07', cell: 'A', pair: 'C07', file: '20260911121000_phase5_booking_hardening.sql', fn: 'set_appointment_status', label: 'weakens',
    rationale: 'Durum geçişi kilitsiz okumayla doğrulanıyor, satır kilidi sonra alınıyor ve güncelleme durum koşulu taşımıyor; eşzamanlı iki geçiş eski durumdan geçerli görünür, son yazan kazanır ve olay kaydı tutarsızlaşır.',
    mutations: [
      M(`  select * into v_current
  from public.appointments
  where business_id = p_business_id and id = p_appointment_id
  for update;
`, `  select * into v_current
  from public.appointments
  where business_id = p_business_id and id = p_appointment_id;
`),
      M(`  if v_current.status in ('cancelled','completed','no_show') then
    raise exception 'INVALID_STATUS_TRANSITION';
  end if;
`, `  if v_current.status in ('cancelled','completed','no_show') then
    raise exception 'INVALID_STATUS_TRANSITION';
  end if;

  perform 1
  from public.appointments
  where business_id = p_business_id and id = p_appointment_id
  for update;
`),
    ],
  },
  {
    id: 'A08', cell: 'A', pair: 'C08', file: '20260912123000_s03_notification_consistency.sql', fn: 'release_notification_job_v2', label: 'weakens',
    rationale: 'Kilitli okumadan kiralama belirteci (lease_token) koşulu kaldırıldı; kiralaması düşmüş eski bir işçi, işi yeniden kiralamış başka bir işçinin işini serbest bırakabilir.',
    mutations: [M(`  where j.id = p_job_id
    and j.state = 'leased'
    and j.lease_token = p_lease_token
  for update;`, `  where j.id = p_job_id
    and j.state = 'leased'
  for update;`)],
  },
  {
    id: 'A09', cell: 'A', pair: 'C09', file: '20260914111700_f10_catalog_stale_hardening.sql', fn: 'set_staff_service_guarded', label: 'weakens',
    rationale: 'Pasifleştirme için kilidi ve bayat yazma kontrolünü atlayan erken bir yazma yolu eklendi; eşzamanlı bir etkinleştirmeyle sırası belirsizleşir, eski görünümle yapılan pasifleştirme sessizce yazılır.',
    mutations: [M(`  if p_active is null then raise exception 'INVALID_ASSIGNMENT'; end if;
`, `  if p_active is null then raise exception 'INVALID_ASSIGNMENT'; end if;

  if not p_active then
    update public.staff_services ss
    set active = false
    where ss.business_id = p_business_id
      and ss.staff_id = p_staff_id
      and ss.service_id = p_service_id
    returning * into v_row;
    if found then return v_row; end if;
  end if;
`)],
  },
  {
    id: 'A10', cell: 'A', pair: 'C10', file: '20260922111500_f14_ticket_model.sql', fn: 'cancel_ticket_guarded', label: 'weakens',
    rationale: 'Durum ve sürüm kontrolü kilitsiz okumaya taşındı, kilit sonra alınıyor; eşzamanlı kapatma ve iptal ikisi de "open" görür, koşulsuz güncelleme kapanmış fişi iptal edebilir.',
    mutations: [M(`  select * into v_ticket
  from public.tickets t
  where t.business_id = p_business_id and t.id = p_ticket_id
  for update;
  if v_ticket.id is null then raise exception 'TICKET_NOT_FOUND'; end if;
  if v_ticket.status <> 'open' then raise exception 'TICKET_NOT_OPEN'; end if;
  if p_expected_version is null or v_ticket.version <> p_expected_version then
    raise exception 'STALE_WRITE';
  end if;
`, `  select * into v_ticket
  from public.tickets t
  where t.business_id = p_business_id and t.id = p_ticket_id;
  if v_ticket.id is null then raise exception 'TICKET_NOT_FOUND'; end if;
  if v_ticket.status <> 'open' then raise exception 'TICKET_NOT_OPEN'; end if;
  if p_expected_version is null or v_ticket.version <> p_expected_version then
    raise exception 'STALE_WRITE';
  end if;
  perform 1 from public.tickets t
  where t.business_id = p_business_id and t.id = p_ticket_id
  for update;
`)],
  },

  // ---------------- B: yapı yok, yarış yaratılıyor ----------------
  {
    id: 'B01', cell: 'B', file: '20260922111500_f14_ticket_model.sql', fn: 'f14_finish_ticket_command', label: 'weakens',
    rationale: 'Koşullu "ilk yazan kazanır" güncellemesinin boşluk koşulları kaldırıldı; aynı komutu eşzamanlı bitiren ikinci istek sonucu sessizce ezer, çakışma hatası artık oluşmaz.',
    mutations: [M(`    and idempotency_key = p_idempotency_key
    and ticket_id is null
    and result_payload is null;`, `    and idempotency_key = p_idempotency_key;`)],
  },
  {
    id: 'B02', cell: 'B', file: '20260923074000_f15_expense_ledger.sql', fn: 'f15_finish_expense_command', label: 'weakens',
    rationale: 'Tek koşullu güncelleme "önce kontrol et, sonra yaz"a bölündü; eşzamanlı iki bitirme kontrolü birlikte geçer, ikincisi sonucu ezer.',
    mutations: [M(`  update public.expense_commands
  set result_payload=p_result
  where business_id=p_business_id
    and actor_membership_id=p_actor_membership_id
    and command=p_command
    and idempotency_key=p_idempotency_key
    and result_payload is null;`, `  if exists (
    select 1 from public.expense_commands
    where business_id=p_business_id
      and actor_membership_id=p_actor_membership_id
      and command=p_command
      and idempotency_key=p_idempotency_key
      and result_payload is not null
  ) then
    raise exception 'EXPENSE_COMMAND_RESULT_CONFLICT';
  end if;

  update public.expense_commands
  set result_payload=p_result
  where business_id=p_business_id
    and actor_membership_id=p_actor_membership_id
    and command=p_command
    and idempotency_key=p_idempotency_key;`)],
  },
  {
    id: 'B03', cell: 'B', file: '20260912123000_s03_notification_consistency.sql', fn: 'complete_notification_job_v2', label: 'weakens',
    rationale: 'Sağlayıcı mesaj kimliği koşulu kaldırıldı; aynı iş için eşzamanlı iki tamamlama farklı kimliklerle gelirse ikincisi ilkini ezer (önceden çakışma hatası veriyordu).',
    mutations: [M(`    and j.request_fingerprint = p_request_fingerprint
    and (j.provider_message_id is null or j.provider_message_id = p_provider_message_id);`,
    `    and j.request_fingerprint = p_request_fingerprint;`)],
  },
  {
    id: 'B04', cell: 'B', file: '20260911130000_phase6_public_booking.sql', fn: 'claim_booking_command', label: 'weakens',
    rationale: 'ON CONFLICT yerine "var mı bak, yoksa ekle"; aynı anahtarla eşzamanlı iki istek kontrolü birlikte geçer, ikincisi idempotent yanıt yerine benzersizlik hatası alır.',
    mutations: [M(`  insert into public.booking_commands(
    business_id, idempotency_key, command, request_hash, appointment_id, created_by, source
  ) values (
    p_business_id, p_idempotency_key, p_command, p_request_hash, p_appointment_id, auth.uid(), v_source
  )
  on conflict (business_id, idempotency_key) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 1 then
    return query select true, p_appointment_id;
    return;
  end if;`, `  if not exists (
    select 1 from public.booking_commands
    where business_id = p_business_id
      and idempotency_key = p_idempotency_key
  ) then
    insert into public.booking_commands(
      business_id, idempotency_key, command, request_hash, appointment_id, created_by, source
    ) values (
      p_business_id, p_idempotency_key, p_command, p_request_hash, p_appointment_id, auth.uid(), v_source
    );
    return query select true, p_appointment_id;
    return;
  end if;`)],
  },
  {
    id: 'B05', cell: 'B', file: '20260920200000_f13_appointment_page_revision.sql', fn: 'f13_bump_appointment_page_revision', label: 'weakens',
    rationale: 'Tek ifadelik upsert "güncelle, bulamazsan ekle"ye bölündü; işletmenin ilk iki randevusu eşzamanlı eklenirse ikisi de satırı bulamaz, ikincisi benzersizlik hatasıyla randevu eklemesini düşürür.',
    mutations: [M(`  if tg_op = 'INSERT' then
    insert into private.appointment_page_revisions(business_id, revision)
    values (new.business_id, gen_random_uuid())
    on conflict (business_id) do update
      set revision = excluded.revision;
    return new;
  end if;`, `  if tg_op = 'INSERT' then
    update private.appointment_page_revisions
    set revision = gen_random_uuid()
    where business_id = new.business_id;
    if not found then
      insert into private.appointment_page_revisions(business_id, revision)
      values (new.business_id, gen_random_uuid());
    end if;
    return new;
  end if;`)],
  },
  {
    id: 'B06', cell: 'B', file: '20260914033000_f10_team_access.sql', fn: 'f10_revoke_financial_permissions', label: 'weakens',
    rationale: 'Değişen satırları kaydeden tek ifade (CTE) iki ifadeye bölündü; olaylar ayrı bir okumadan yazılıyor. Eşzamanlı iki iptal ikisi de olay yazar; arada verilen bir izin olay kaydı olmadan kapanır.',
    mutations: [M(`  with changed as (
    update public.membership_financial_permissions p
    set active = false,
        revoked_by_membership_id = p_actor_membership_id,
        revoked_at = now()
    where p.business_id = p_business_id
      and p.membership_id = p_membership_id
      and p.active
    returning p.permission
  )
  insert into public.membership_financial_permission_events(
    business_id, membership_id, permission, action, actor_membership_id
  )
  select p_business_id, p_membership_id, c.permission, 'revoke'::public.financial_permission_action,
         p_actor_membership_id
  from changed c;`, `  insert into public.membership_financial_permission_events(
    business_id, membership_id, permission, action, actor_membership_id
  )
  select p_business_id, p_membership_id, p.permission, 'revoke'::public.financial_permission_action,
         p_actor_membership_id
  from public.membership_financial_permissions p
  where p.business_id = p_business_id
    and p.membership_id = p_membership_id
    and p.active;

  update public.membership_financial_permissions p
  set active = false,
      revoked_by_membership_id = p_actor_membership_id,
      revoked_at = now()
  where p.business_id = p_business_id
    and p.membership_id = p_membership_id
    and p.active;`)],
  },
  {
    id: 'B07', cell: 'B', file: '20260911170000_phase9_notification_outbox.sql', fn: 'complete_notification_job', label: 'weakens',
    rationale: 'Kiralama kontrolü ayrı bir okumaya taşındı, güncelleme yalnız id ile yapılıyor; kontrol ile yazma arasında kiralama başka işçiye geçerse eski işçi işi "gönderildi" yapar.',
    mutations: [
      M(`  update public.appointment_notification_jobs j
  set state = 'sent',`, `  if not exists (
    select 1 from public.appointment_notification_jobs j
    where j.id = p_job_id
      and j.state = 'leased'
      and j.lease_token = p_lease_token
  ) then
    raise exception 'NOTIFICATION_LEASE_LOST';
  end if;

  update public.appointment_notification_jobs j
  set state = 'sent',`),
      M(`  where j.id = p_job_id
    and j.state = 'leased'
    and j.lease_token = p_lease_token
  returning j.recovery_id into v_recovery_id;`, `  where j.id = p_job_id
  returning j.recovery_id into v_recovery_id;`),
    ],
  },
  {
    id: 'B08', cell: 'B', file: '20260911140000_phase7_customer_manage.sql', fn: 'provision_public_management_token', label: 'weakens',
    rationale: 'Ekleme, çakışmada belirteci ezen upsert oldu; eşzamanlı iki kurulum kontrolü birlikte geçerse ikincisi hata almak yerine ilk belirteci ezer, ilk müşterinin yönetim bağlantısı sessizce geçersizleşir.',
    mutations: [M(`  ) values (
    p_appointment_id, v_business_id, v_hash
  );`, `  ) values (
    p_appointment_id, v_business_id, v_hash
  )
  on conflict (appointment_id) do update
    set token_hash = excluded.token_hash;`)],
  },
  {
    id: 'B09', cell: 'B', pair: 'D10', file: '20260923051000_f15_product_stock_ledger.sql', fn: 'f15_finish_product_command', label: 'weakens',
    rationale: '"İlk yazan kazanır" koşulu gevşetildi (sonuç boşluğu koşulu kaldırıldı); aynı ürün için eşzamanlı ikinci bitirme sonucu ezer.',
    mutations: [M(`    and product_id is null
    and result_payload is null;`, `    and (product_id is null or product_id = p_product_id);`)],
  },
  {
    id: 'B10', cell: 'B', file: '20260914110200_f10_customer_authority_repair.sql', fn: 'create_appointment', label: 'weakens',
    rationale: 'Serileştirilmiş müşteri çözümleyici çağrısı yerine kilitsiz "bul, yoksa ekle"; aynı yeni iletişim bilgisiyle eşzamanlı iki randevu iki ayrı müşteri kaydı oluşturur (telefon/e-posta için benzersiz indeks yok).',
    mutations: [M(`  v_customer_id := public.f10_resolve_or_create_customer(
    p_business_id,
    v_customer_name,
    v_customer_phone,
    v_customer_email,
    null,
    auth.uid(),
    true
  );`, `  select c.id into v_customer_id
  from public.customers c
  where c.business_id = p_business_id
    and (
      (v_customer_phone is not null and c.phone = v_customer_phone)
      or (v_customer_email is not null and c.email = v_customer_email)
    )
  limit 1;

  if v_customer_id is null then
    insert into public.customers(business_id, name, phone, email, created_by)
    values (p_business_id, v_customer_name, v_customer_phone, v_customer_email, auth.uid())
    returning id into v_customer_id;
  end if;`)],
  },

  // ---------------- C: kilitli bölgede yalnız iş mantığı ----------------
  {
    id: 'C01', cell: 'C', pair: 'A01', file: '20260914111500_f10_catalog_hours_management.sql', fn: 'create_staff_guarded', label: 'no_effect',
    rationale: 'Personel adı büyük harfle başlatılıyor; yalnız kaydedilen değer değişir.',
    mutations: [M(`  values(p_business_id, trim(p_name), v_phone)`, `  values(p_business_id, initcap(trim(p_name)), v_phone)`)],
  },
  {
    id: 'C02', cell: 'C', pair: 'A02', file: '20260914033000_f10_team_access.sql', fn: 'revoke_business_invitation', label: 'no_effect',
    rationale: 'Hata kodu yeniden adlandırıldı; yalnız çıktı değişir.',
    mutations: [M(`    raise exception 'INVITATION_ALREADY_USED';`, `    raise exception 'INVITATION_ALREADY_ACCEPTED';`)],
  },
  {
    id: 'C03', cell: 'C', pair: 'A03', file: '20260923051000_f15_product_stock_ledger.sql', fn: 'archive_product_guarded', label: 'no_effect',
    rationale: 'Dönen JSON\'a arşiv alanları eklendi (kilit altında okunan satırdan); yalnız çıktı değişir.',
    mutations: [M(`  v_result := public.f15_product_projection(p_business_id, v_product.id);
  perform public.f15_finish_product_command(
    p_business_id, v_actor.id, 'archive_product'`, `  v_result := public.f15_product_projection(p_business_id, v_product.id);
  v_result := v_result || jsonb_build_object(
    'archived', not v_product.active,
    'archivedAt', v_product.archived_at,
    'archivedBy', v_product.archived_by_membership_id
  );
  perform public.f15_finish_product_command(
    p_business_id, v_actor.id, 'archive_product'`)],
  },
  {
    id: 'C04', cell: 'C', pair: 'A04', file: '20260914033000_f10_team_access.sql', fn: 'update_team_membership', label: 'no_effect',
    rationale: 'Hata kodu yeniden adlandırıldı; yalnız çıktı değişir.',
    mutations: [M(`    raise exception 'MEMBERSHIP_NOT_FOUND';`, `    raise exception 'TEAM_MEMBER_NOT_FOUND';`)],
  },
  {
    id: 'C05', cell: 'C', pair: 'A05', file: '20260915150000_f12_service_price_range.sql', fn: 'create_service_guarded', label: 'no_effect',
    rationale: 'Yeni hizmetin varsayılan kategorisi değişti; yalnız kaydedilen değer değişir.',
    mutations: [M(`'Genel', v_sort`, `'Diğer', v_sort`)],
  },
  {
    id: 'C06', cell: 'C', pair: 'A06', file: '20260914110500_f12_salon_profile_media.sql', fn: 'begin_business_public_media_upload', label: 'no_effect',
    rationale: 'Tek doğrulama bloğu ayrı hata kodlarına bölündü ve alternatif metin sınırı 200 oldu; hepsi kilit altında, yalnız doğrulama ve çıktı değişir.',
    mutations: [M(`  if p_media_id is null
     or p_storage_path <> p_business_id::text || '/' || p_media_id::text || '.webp'
     or p_mime_type <> 'image/webp'
     or p_size_bytes is null or p_size_bytes < 1 or p_size_bytes > 5242880
     or p_width is null or p_width < 1 or p_width > 2000
     or p_height is null or p_height < 1 or p_height > 2000
     or v_alt is not null and char_length(v_alt) > 160 then
    raise exception 'INVALID_PUBLIC_MEDIA';
  end if;`, `  if p_media_id is null
     or p_storage_path <> p_business_id::text || '/' || p_media_id::text || '.webp' then
    raise exception 'INVALID_PUBLIC_MEDIA_PATH';
  end if;
  if p_mime_type <> 'image/webp' then
    raise exception 'INVALID_PUBLIC_MEDIA_TYPE';
  end if;
  if p_size_bytes is null or p_size_bytes < 1 or p_size_bytes > 5242880
     or p_width is null or p_width < 1 or p_width > 2000
     or p_height is null or p_height < 1 or p_height > 2000 then
    raise exception 'INVALID_PUBLIC_MEDIA_SIZE';
  end if;
  if v_alt is not null and char_length(v_alt) > 200 then
    raise exception 'INVALID_PUBLIC_MEDIA_ALT';
  end if;`)],
  },
  {
    id: 'C07', cell: 'C', pair: 'A07', file: '20260911121000_phase5_booking_hardening.sql', fn: 'set_appointment_status', label: 'no_effect',
    rationale: 'Olay kaydının payload\'u yeniden kuruldu (kaynak ve önceki durum eklendi); yalnız yazılan olay içeriği değişir.',
    mutations: [M(`    case when p_status = 'cancelled' then jsonb_build_object('reason', v_reason) else '{}'::jsonb end`,
      `    jsonb_strip_nulls(jsonb_build_object(
      'reason', case when p_status = 'cancelled' then v_reason end,
      'source', 'operator',
      'previousStatus', v_current.status
    ))`)],
  },
  {
    id: 'C08', cell: 'C', pair: 'A08', file: '20260912123000_s03_notification_consistency.sql', fn: 'release_notification_job_v2', label: 'no_effect',
    rationale: 'Kalıcı hata sınıfı metni zenginleştirildi ve 120 karakterle sınırlandı; yalnız kaydedilen hata metni değişir.',
    mutations: [M(`  v_error := case
    when v_window_expired then 'idempotency_window_expired_ambiguous'
    else p_error_class
  end;`, `  v_error := case
    when v_window_expired then 'idempotency_window_expired_ambiguous'
    when v_certainty = 'rejected' then 'rejected:' || p_error_class
    else p_error_class
  end;
  v_error := left(v_error, 120);`)],
  },
  {
    id: 'C09', cell: 'C', pair: 'A09', file: '20260914111700_f10_catalog_stale_hardening.sql', fn: 'set_staff_service_guarded', label: 'no_effect',
    rationale: 'Varlık kontrolü ayrı hata kodlarına bölündü; aynı okumalar aynı kilit altında kalıyor, yalnız çıktı değişir.',
    mutations: [M(`    if not exists (
      select 1 from public.staff_profiles sp
      where sp.business_id = p_business_id and sp.id = p_staff_id
    ) or not exists (
      select 1 from public.services s
      where s.business_id = p_business_id and s.id = p_service_id
    ) then
      raise exception 'ASSIGNMENT_NOT_FOUND';
    end if;`, `    if not exists (
      select 1 from public.staff_profiles sp
      where sp.business_id = p_business_id and sp.id = p_staff_id
    ) then
      raise exception 'ASSIGNMENT_STAFF_NOT_FOUND';
    end if;
    if not exists (
      select 1 from public.services s
      where s.business_id = p_business_id and s.id = p_service_id
    ) then
      raise exception 'ASSIGNMENT_SERVICE_NOT_FOUND';
    end if;`)],
  },
  {
    id: 'C10', cell: 'C', pair: 'A10', file: '20260922111500_f14_ticket_model.sql', fn: 'cancel_ticket_guarded', label: 'no_effect',
    rationale: 'Hata kodu yeniden adlandırıldı; yalnız çıktı değişir.',
    mutations: [M(`  if v_ticket.status <> 'open' then raise exception 'TICKET_NOT_OPEN'; end if;`, `  if v_ticket.status <> 'open' then raise exception 'TICKET_NOT_CANCELLABLE'; end if;`)],
  },

  // ---------------- D: yapısız fonksiyonda yalnız iş mantığı ----------------
  {
    id: 'D01', cell: 'D', file: '20260923074000_f15_expense_ledger.sql', fn: 'create_expense_guarded', label: 'no_effect',
    rationale: 'Açıklama üst sınırı 500 oldu ve yalnız TRY para birimi kabul ediliyor; yalnız girdi doğrulaması değişir.',
    mutations: [
      M(`char_length(v_description) not between 2 and 240`, `char_length(v_description) not between 2 and 500`),
      M(`  if v_currency !~ '^[A-Z]{3}$' then raise exception 'INVALID_CURRENCY'; end if;
`, `  if v_currency !~ '^[A-Z]{3}$' then raise exception 'INVALID_CURRENCY'; end if;
  if v_currency <> 'TRY' then
    raise exception 'UNSUPPORTED_CURRENCY';
  end if;
`),
    ],
  },
  {
    id: 'D02', cell: 'D', file: '20260922111500_f14_ticket_model.sql', fn: 'open_walk_in_ticket_guarded', label: 'no_effect',
    rationale: 'Fişteki müşteri anlık görüntüsü normalize ediliyor (kırpma, boşsa null, e-posta küçük harf); yalnız kaydedilen değerler değişir.',
    mutations: [M(`    v_customer.name, v_customer.phone, v_customer.email, v_actor.id`, `    btrim(v_customer.name),
    nullif(btrim(coalesce(v_customer.phone, '')), ''),
    lower(nullif(btrim(coalesce(v_customer.email, '')), '')),
    v_actor.id`)],
  },
  {
    id: 'D03', cell: 'D', file: '20260923051000_f15_product_stock_ledger.sql', fn: 'create_product_guarded', label: 'no_effect',
    rationale: 'Ürün adı/kodu/birimi doğrulaması ayrıntılı hata kodlarına bölündü, ad sınırı 160 ve "pack" birimi eklendi; yalnız girdi doğrulaması değişir.',
    mutations: [M(`  if char_length(v_name) not between 1 and 120 then raise exception 'INVALID_PRODUCT_NAME'; end if;
  if v_code is not null and (char_length(v_code) not between 1 and 64 or v_code !~ '^[A-Z0-9][A-Z0-9._-]*$') then
    raise exception 'INVALID_PRODUCT_CODE';
  end if;
  if v_unit <> 'piece' then raise exception 'INVALID_PRODUCT_UNIT'; end if;`, `  if char_length(v_name) not between 1 and 160 then
    raise exception 'INVALID_PRODUCT_NAME';
  end if;
  if v_code is not null then
    if char_length(v_code) not between 1 and 64 then
      raise exception 'INVALID_PRODUCT_CODE_LENGTH';
    end if;
    if v_code !~ '^[A-Z0-9][A-Z0-9._-]*$' then
      raise exception 'INVALID_PRODUCT_CODE_FORMAT';
    end if;
  end if;
  if v_unit not in ('piece', 'pack') then
    raise exception 'INVALID_PRODUCT_UNIT';
  end if;`)],
  },
  {
    id: 'D04', cell: 'D', file: '20260911110000_phase4_availability.sql', fn: 'replace_business_hours', label: 'no_effect',
    rationale: 'Saat biçimi açıkça doğrulanıyor ve 15 dakikadan kısa aralık reddediliyor; yalnız girdi doğrulaması değişir.',
    mutations: [M(`    begin
      v_start := (v_item ->> 'start')::time;
      v_end := (v_item ->> 'end')::time;
    exception when others then
      raise exception 'INVALID_TIME';
    end;

    if v_start is null or v_end is null or v_start >= v_end then
      raise exception 'INVALID_INTERVAL';
    end if;`, `    if coalesce(v_item ->> 'start', '') !~ '^[0-9]{2}:[0-9]{2}$'
       or coalesce(v_item ->> 'end', '') !~ '^[0-9]{2}:[0-9]{2}$' then
      raise exception 'INVALID_TIME';
    end if;
    v_start := (v_item ->> 'start')::time;
    v_end := (v_item ->> 'end')::time;

    if v_start >= v_end then
      raise exception 'INVALID_INTERVAL';
    end if;
    if v_end - v_start < interval '15 minutes' then
      raise exception 'INTERVAL_TOO_SHORT';
    end if;`)],
  },
  {
    id: 'D05', cell: 'D', file: '20260911110000_phase4_availability.sql', fn: 'replace_staff_hours', label: 'no_effect',
    rationale: 'Dönen satırlar yalnız aktif aralıklarla sınırlandı ve bitiş saatine göre de sıralandı; yalnız çıktı değişir.',
    mutations: [M(`  return query
  select h.* from public.staff_hours h
  where h.business_id = p_business_id and h.staff_id = p_staff_id and h.weekday = p_weekday
  order by h.starts_local;`, `  return query
  select h.*
  from public.staff_hours h
  where h.business_id = p_business_id
    and h.staff_id = p_staff_id
    and h.weekday = p_weekday
    and h.active
  order by h.starts_local, h.ends_local;`)],
  },
  {
    id: 'D06', cell: 'D', file: '20260911090000_phase2_auth_tenancy.sql', fn: 'create_business_with_owner', label: 'no_effect',
    rationale: 'Saat dilimi adı doğrulaması eklendi; yalnız girdi doğrulaması değişir.',
    mutations: [M(`then raise exception 'INVALID_BUSINESS_SLUG'; end if;
`, `then raise exception 'INVALID_BUSINESS_SLUG'; end if;
  if nullif(trim(p_timezone), '') is not null
     and not exists (select 1 from pg_timezone_names z where z.name = trim(p_timezone)) then
    raise exception 'INVALID_TIMEZONE';
  end if;
`)],
  },
  {
    id: 'D07', cell: 'D', file: '20260911090000_phase2_auth_tenancy.sql', fn: 'handle_new_user', label: 'no_effect',
    rationale: 'Görünen ad için ikinci bir meta veri alanı yedek olarak eklendi ve ifade açıldı; yalnız kaydedilen değer değişir.',
    mutations: [M(`  values(new.id, nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, ''), '@', 1))), ''))`, `  values(
    new.id,
    nullif(trim(coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(coalesce(new.email, ''), '@', 1)
    )), '')
  )`)],
  },
  {
    id: 'D08', cell: 'D', file: '20260914110200_f10_customer_authority_repair.sql', fn: 'create_public_appointment', label: 'no_effect',
    rationale: 'Telefon biçimi doğrulaması eklendi ve not sınırı 1000 oldu; yalnız girdi doğrulaması değişir.',
    mutations: [M(`  if v_notes is not null and char_length(v_notes) > 500 then
    raise exception 'NOTES_TOO_LONG';
  end if;`, `  if v_customer_phone is not null and v_customer_phone !~ '^[0-9 +()-]+$' then
    raise exception 'INVALID_CUSTOMER_PHONE';
  end if;
  if v_notes is not null and char_length(v_notes) > 1000 then
    raise exception 'NOTES_TOO_LONG';
  end if;`)],
  },
  {
    id: 'D09', cell: 'D', file: '20260911140000_phase7_customer_manage.sql', fn: 'provision_public_management_token', label: 'no_effect',
    rationale: 'Başlangıç okumasından komut kaynağı koşulu kaldırıldı (randevu kaynağı koşulu duruyor); yalnız hangi randevuların uygun sayıldığı (iş kuralı) değişir.',
    mutations: [M(`    and bc.command = 'public_create'
    and bc.source = 'public'
  limit 1;`, `    and bc.command = 'public_create'
  limit 1;`)],
  },
  {
    id: 'D10', cell: 'D', pair: 'B09', file: '20260923051000_f15_product_stock_ledger.sql', fn: 'f15_finish_product_command', label: 'no_effect',
    rationale: 'Girdi doğrulaması ayrıldı ve sonucun "id" alanı olan bir JSON nesnesi olması şartı eklendi; yalnız girdi doğrulaması değişir.',
    mutations: [M(`  if p_product_id is null or p_result is null then
    raise exception 'INVALID_PRODUCT_RESULT';
  end if;`, `  if p_product_id is null then
    raise exception 'INVALID_PRODUCT_RESULT';
  end if;
  if p_result is null or jsonb_typeof(p_result) <> 'object' then
    raise exception 'INVALID_PRODUCT_RESULT';
  end if;
  if not (p_result ? 'id') then
    raise exception 'INVALID_PRODUCT_RESULT_SHAPE';
  end if;`)],
  },

  // ---------------- E: koruma kaldırma / ekleme (ayrı rapor; kod kuralı yalnız karşılaştırma noktası) ----------------
  {
    id: 'E01', cell: 'E', file: '20260914111500_f10_catalog_hours_management.sql', fn: 'create_staff_guarded', label: 'weakens',
    rationale: 'Advisory kilit kaldırıldı; sayım ve ekleme serileşmiyor, eşzamanlı eklemeler limiti aşabilir.',
    mutations: [M(`  perform pg_advisory_xact_lock(hashtextextended('f10-04:staff:' || p_business_id::text, 0));
`, ``)],
  },
  {
    id: 'E02', cell: 'E', file: '20260914111700_f10_catalog_stale_hardening.sql', fn: 'update_staff_guarded', label: 'weakens',
    rationale: 'Satır kilidi kaldırıldı; bayat yazma (updated_at) kontrolü kilitsiz okumada, güncelleme koşulsuz: eşzamanlı iki düzenleme ikisi de geçer.',
    mutations: [M(`  where sp.business_id = p_business_id and sp.id = p_staff_id
  for update;`, `  where sp.business_id = p_business_id and sp.id = p_staff_id;`)],
  },
  {
    id: 'E03', cell: 'E', file: '20260923051000_f15_product_stock_ledger.sql', fn: 'record_product_stock_movement_guarded', label: 'weakens',
    rationale: 'Ürün satırı kilidi kaldırıldı; bakiye ve sürüm kilitsiz okumadan, güncelleme koşulsuz: eşzamanlı iki hareket kayıp güncelleme ve yanlış bakiye üretir.',
    mutations: [M(`  where p.business_id = p_business_id and p.id = p_product_id
  for update;

  if v_product.id is null then raise exception 'PRODUCT_NOT_FOUND'; end if;
  if not v_product.active`, `  where p.business_id = p_business_id and p.id = p_product_id;

  if v_product.id is null then raise exception 'PRODUCT_NOT_FOUND'; end if;
  if not v_product.active`)],
  },
  {
    id: 'E04', cell: 'E', file: '20260914033000_f10_team_access.sql', fn: 'revoke_business_invitation', label: 'weakens',
    rationale: 'İşletme düzeyi advisory kilit kaldırıldı (davet satırı kilidi duruyor); yetki okuması eşzamanlı rol değişiklikleriyle serileşmiyor.',
    mutations: [M(`  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text, 0));
  select * into v_actor`, `  select * into v_actor`)],
  },
  {
    id: 'E05', cell: 'E', file: '20260921043000_f13_group_lifecycle_partial_repair.sql', fn: 'set_appointment_group_status', label: 'no_effect',
    rationale: 'Güncellemedeki sürüm koşulu kaldırıldı, ama aynı fonksiyon grup anahtarlı advisory kilit ve satır kilidi altında sürümü zaten kontrol ediyor; koşul gereksizdi. Kod kuralı "removed → weakens" burada yanlış.',
    mutations: [M(`  where g.business_id=p_business_id and g.id=p_group_id
    and g.version=p_expected_version
  returning g.version into v_new_version;`, `  where g.business_id=p_business_id and g.id=p_group_id
  returning g.version into v_new_version;`)],
  },
  {
    id: 'E06', cell: 'E', file: '20260911110000_phase4_availability.sql', fn: 'replace_business_hours', label: 'strengthens',
    rationale: 'İşletme ve gün anahtarlı advisory kilit eklendi; eşzamanlı iki değiştirme artık serileşir, çakışan aralık kontrolü güvenilir olur.',
    mutations: [M(`  delete from public.business_hours
  where business_id = p_business_id and weekday = p_weekday;`, `  perform pg_advisory_xact_lock(hashtextextended('hours:' || p_business_id::text || ':' || p_weekday::text, 0));

  delete from public.business_hours
  where business_id = p_business_id and weekday = p_weekday;`)],
  },
  {
    id: 'E07', cell: 'E', file: '20260911140000_phase7_customer_manage.sql', fn: 'provision_public_management_token', label: 'strengthens',
    rationale: 'Başlangıç okumasına satır kilidi eklendi; aynı randevu için eşzamanlı kurulumlar serileşir, ikincisi mevcut belirteci görüp karşılaştırır.',
    mutations: [M(`    and bc.source = 'public'
  limit 1;`, `    and bc.source = 'public'
  limit 1
  for update of bc;`)],
  },
  {
    id: 'E08', cell: 'E', file: '20260914110200_f10_customer_authority_repair.sql', fn: 'create_appointment', label: 'strengthens',
    rationale: 'Personel anahtarlı advisory kilit eklendi; aynı personele eşzamanlı randevular uygunluk kontrolü ile ekleme arasında serileşir.',
    mutations: [M(`  v_date := (p_starts_at at time zone v_timezone)::date;
  if not exists (`, `  v_date := (p_starts_at at time zone v_timezone)::date;
  perform pg_advisory_xact_lock(hashtextextended('staff-slot:' || p_staff_id::text, 0));
  if not exists (`)],
  },
  {
    id: 'E09', cell: 'E', file: '20260922111500_f14_ticket_model.sql', fn: 'cancel_ticket_guarded', label: 'no_effect',
    rationale: 'Güncellemeye sürüm koşulu eklendi, ama satır aynı fonksiyonda kilitli ve sürüm zaten kontrol edilmiş; koşul gereksiz. Kod kuralı "added → strengthens" burada yanlış.',
    mutations: [M(`      cancellation_reason = v_reason
  where business_id = p_business_id and id = p_ticket_id;`, `      cancellation_reason = v_reason
  where business_id = p_business_id and id = p_ticket_id
    and version = p_expected_version;`)],
  },
  {
    id: 'E10', cell: 'E', file: '20260911110000_phase4_availability.sql', fn: 'replace_staff_hours', label: 'strengthens',
    rationale: 'Personel ve gün anahtarlı advisory kilit eklendi; eşzamanlı iki değiştirme serileşir, çakışan aralık kontrolü güvenilir olur.',
    mutations: [M(`  delete from public.staff_hours
  where business_id = p_business_id and staff_id = p_staff_id and weekday = p_weekday;`, `  perform pg_advisory_xact_lock(hashtextextended('staff-hours:' || p_staff_id::text || ':' || p_weekday::text, 0));

  delete from public.staff_hours
  where business_id = p_business_id and staff_id = p_staff_id and weekday = p_weekday;`)],
  },
];
