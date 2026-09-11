# YZT Randevu — Teknik Kararlar

Bu dosya yalnız mimari gerekçeleri ve değişmemesi gereken kararları tutar. Güncel dosya/route/test haritası için önce `PROJECT_STATE.md` oku.

## Faz 2 — Auth ve tenant

- `Business` tenant köküdür.
- Supabase Auth kimliği sağlar; `Membership` tenant içindeki güncel rol/aktiflik kaynağıdır.
- İstemcinin business ID veya business cookie göndermesi yetki değildir. Her member isteği aktif membership + PostgreSQL RLS ile yeniden doğrulanır.
- Worker service-role key kullanmaz.
- Üyelik pasifleştirilirse aynı oturumun sonraki isteği tenant erişimini kaybeder.

## Faz 3 — Hizmet ve ekip

- `services`: ad, duration, buffer, fiyat, aktiflik.
- `staff_profiles`: randevu atanabilir personel; login hesabı zorunlu değildir.
- `staff_services`: personel-hizmet yetkinliği.
- Tenant kimliği ilişkilerin parçasıdır; composite FK cross-tenant staff/service bağını DB seviyesinde engeller.
- Owner/manager katalog mutasyonu yapabilir; staff read-only'dir.

## Faz 4 — Müsaitlik

- Haftalık açık pencereler `business_hours` + `staff_hours` ile kesişir.
- Mola ayrı tablo değildir; günün birden fazla açık pencereye bölünmesiyle temsil edilir.
- `availability_blocks` işletme veya staff için gerçek `timestamptz` kapalı aralıklarıdır.
- Slot ancak `buffer_before + duration + buffer_after` bütünü açık pencereye sığıyorsa geçerlidir.
- Local schedule işletmenin IANA timezone'uyla gerçek timeline'a çevrilir. DST spring-forward olmayan saati üretmez; fall-back tekrarlanan saati farklı gerçek instantlar olarak korur.

## Faz 5 — Booking çekirdeği

### Snapshot ve occupancy

Appointment oluşturulurken müşteri, hizmet, staff, duration, buffer, fiyat, currency ve timezone snapshot'ları saklanır. Sonraki katalog değişikliği tarihsel booking semantiğini değiştirmez.

`starts_at/end_at` hizmet zamanıdır; `occupied_starts_at/occupied_ends_at` buffer dahil staff kilididir.

### Concurrency

UI/API availability kontrolü yalnız ön kontroldür. Son doğruluk sınırı PostgreSQL `EXCLUDE USING gist` constraint'idir: aynı business + staff için non-cancelled occupied aralıkları overlap edemez.

`cancelled` slotu serbest bırakır. `completed` ve `no_show` tarihsel occupancy'yi korur.

### Idempotency ve lifecycle

`booking_commands` `(business_id,idempotency_key)` üzerinden mutation komutlarını claim eder.

- aynı key + aynı command/payload → önceki sonuç;
- aynı key + farklı payload → `IDEMPOTENCY_CONFLICT`.

Aktif durumlar `scheduled|confirmed`; terminal durumlar `cancelled|completed|no_show`. Terminal appointment tekrar aktif hale getirilemez.

Create/reschedule/status append-only `appointment_events` audit kaydı bırakır.

### Customer

Customer dedup tenant içinde normalize telefon veya lower-case e-posta exact match kolaylığıdır; global kimlik iddiası değildir. PII tenant RLS sınırındadır.

## Faz 6 — Public self-booking

### Opt-in public yüzey

Her business için `public_booking_settings` varsayılan `enabled=false` provision edilir. Owner/manager `enabled`, `step_minutes`, `min_notice_minutes`, `horizon_days` değerlerini yönetir.

Anon role tenant tablolarına doğrudan CRUD/read grant almaz. Public yüzey yalnız dar security-definer RPC'lerdir: sanitized business, bookable services, eligible staff, live slots ve public create.

### Public slot ve create

Public slot hesabı Faz 4/5 invariant'larını korur: schedule kesişimi, snapshot değil güncel service duration/buffer, blocks, non-cancelled occupancy, timezone, notice ve horizon.

Public create:

1. business/settings çözülür;
2. `public_create` idempotency command claim edilir;
3. exact retry committed sonucu döndürebilir;
4. enabled/notice/horizon/service/staff/live-slot tekrar doğrulanır;
5. final insert exclusion constraint'e tabidir.

Public kayıt provenance'ı açıktır: `appointments.source='public'`, audit `actor_type='public'`, authenticated actor null.

### Public customer güvenliği

Telefon/e-posta exact match mevcut customer ID'sini reuse edebilir fakat anonim input mevcut customer master row'unu güncellemez. Form değerleri appointment snapshot'a yazılır.

## Faz 7 — Customer appointment management

### Bearer capability

`/m/:token` bağlantısına sahip olmak yalnız tek appointment'ı görüntüleme/değiştirme yetkisidir. Bu nedenle token parola gibi ele alınır.

- Token browser'da Web Crypto ile 32 random byte (256 bit) üretilir.
- Plain token PostgreSQL'e yazılmaz.
- `appointment_management_capabilities` yalnız SHA-256 token hash'i saklar.
- Capability tablosuna anon veya authenticated doğrudan table grant verilmez.
- Token listing/recovery endpoint'i yoktur.

### Provisioning

Public booking create RPC'sinin stabil imzası değiştirilmez. Booking başarıdan sonra `provision_public_management_token` çağrısı appointment ID + **aynı original public-create idempotency key** ile appointment'ın o public create command'e ait olduğunu kanıtlar.

Frontend booking key ve management token'ı provision başarıya kadar hafızada tutar. Network booking'den sonra koparsa aynı booking exact retry sonucu döner ve capability provision tekrar denenir; ikinci appointment oluşmaz.

Bir appointment'a aynı token tekrar provision edilebilir; farklı token ile overwrite edilemez.

### Existing capability vs public publication

Public sayfanın sonradan `enabled=false` olması mevcut appointment capability'sini iptal etmez. Publication yeni müşteri edinme yüzeyidir; verilmiş appointment yönetim yetkisinden ayrıdır.

### Reschedule

Customer reschedule:

- mevcut appointment'ın duration/buffer snapshot'larını korur;
- güncel staff active/StaffService yetkinliğini kullanır;
- güncel business/staff schedule ve blocks'u kullanır;
- public settings'teki step/notice/horizon kurallarını kullanır;
- kendi appointment'ını occupancy hesabından hariç tutar;
- final update'te exclusion constraint'e tabidir;
- idempotent `public_reschedule` command ve public audit event'i bırakır.

Hizmet sonradan pasifleşse veya duration değişse bile mevcut appointment snapshot'ı taşınabilir; yeni public booking katalog davranışı bundan etkilenmez.

### Cancellation

Customer yalnız gelecekteki `scheduled|confirmed` appointment'ı iptal edebilir. İptal `public_cancel` idempotency command'i ve public audit event'i bırakır; slot Faz 5 invariant'ı gereği tekrar müsait olur.

### Phase 7 scope boundary

Bu faz capability linkini **üretir ve ekranda gösterir**, fakat SMS/e-posta ile teslim etmez. Token recovery/reissue, ödeme/depozito, anti-bot/rate-limit, dış takvim sync ve CRM automation ayrı concern'lerdir.
