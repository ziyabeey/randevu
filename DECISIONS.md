# YZT Randevu — Teknik Kararlar

Güncel dosya/route/test haritası için önce `PROJECT_STATE.md` oku. Bu dosya yalnız mimari gerekçeleri ve kalıcı sınırları tutar.

## Faz 2 — Auth ve tenant

`Business` tenant köküdür. Supabase Auth kimliği, `Membership` güncel tenant rolü/aktifliğini sağlar. Client business seçimi yetki değildir; member erişimi aktif membership + RLS ile doğrulanır. Worker service-role key kullanmaz.

## Faz 3 — Hizmet ve ekip

Services, staff profiles ve staff-service eligibility tenant kimliği taşır. Composite FK'ler cross-tenant bağlantıları DB seviyesinde engeller. Owner/manager katalog yazar; staff read-only'dir.

## Faz 4 — Müsaitlik

Business/staff weekly windows kesişir; blocks düşülür; `buffer_before + duration + buffer_after` bütünü pencereye sığmalıdır. Local schedule business IANA timezone'u ile gerçek `timestamptz` timeline'a çevrilir; DST edge'leri gerçek instant semantiğiyle korunur.

## Faz 5 — Booking çekirdeği

Appointment create anındaki customer/service/staff/duration/buffer/price/currency/timezone snapshot'larını saklar. Same-staff non-cancelled occupied overlap final sınırı PostgreSQL `EXCLUDE USING gist` constraint'idir. `cancelled` slotu açar; completed/no-show tarihi occupancy'yi korur.

Create/reschedule/status `booking_commands` ile idempotenttir. Terminal appointment tekrar aktif hale getirilemez. Mutation'lar append-only appointment audit event bırakır.

## Faz 6 — Public self-booking

Public booking opt-in/default-disabled'dır. Anon role tenant tablolarına direct read/write grant almaz; sanitized security-definer RPC yüzeyi kullanır. Public create exact live slotu transaction içinde yeniden doğrular ve exclusion constraint'e tabidir. Public contact match mevcut customer ID'sini reuse edebilir fakat anonim input mevcut customer master row'unu değiştirmez.

## Faz 7 — Customer appointment management

Müşteri tek appointment kapsamlı bearer capability kullanır. Browser 256-bit token üretir; DB yalnız SHA-256 hash saklar. Link `/m#<token>` fragment kullanır ve management API token'ı yalnız POST JSON body'de kabul eder. Existing capability public page kapatılsa da çalışır. Reschedule appointment snapshot duration/buffer'ını korur, güncel schedule/block/staff eligibility/notice/horizon kullanır, idempotenttir ve final overlap constraint'e tabidir. Cancel da idempotent public audit bırakır.

## Faz 8 — Operator calendar

### Calendar bir projection'dır

Takvim ayrı appointment state'i veya ikinci mutation motoru yaratmaz. Kaynak her zaman Faz 5 `appointments` + snapshot'lardır. Hızlı lifecycle aksiyonları doğrudan mevcut booking status endpoint'ini kullanır. Böylece calendar UI booking invariants'ını fork etmez.

### Business-local range

Calendar query bir `p_start_date` ve `p_days` alır. PostgreSQL business timezone'unu bulur ve `[local midnight, local midnight + N days)` sınırlarını exact `timestamptz` instantlarına çevirir. Bu özellikle UTC gün sınırında veya DST kullanan timezone'larda randevunun yanlış takvim gününe düşmesini engeller.

RPC yalnız aktif tenant member tarafından execute edilebilir. Optional staff filter aynı tenant içindeki appointment projection'ını daraltır. Cross-tenant business ID geçirmek yetki sağlamaz.

### Day / week UX

Day view personel sütunlu timed grid'dir. Week view 7 local-date column kullanır. Cancelled görünürlüğü opsiyoneldir. Detay drawer appointment snapshot'ını gösterir ve lifecycle quick actions sağlar. Yeni appointment/create-reschedule gibi daha karmaşık operasyonlar `/bookings` yüzeyinde kalır.

### Faz 8 scope boundary

Calendar drag-drop reschedule, external calendar sync, notification ve payment bu faza dahil değildir. Takvim önce operasyonun ana görsel yüzeyini tamamlar.

## Faz 9 — Public booking e-posta teslimi

### Booking ile delivery ayrıdır

Booking/capability doğruluğu e-posta sağlayıcısına bağlı değildir. `provision_public_management_token` başarıyla tamamlandıktan sonra delivery best-effort çalışır. Resend kapalı, yanlış yapılandırılmış veya geçici olarak erişilemez olsa bile appointment ve management capability geçerli kalır; UI ekrandaki `/m#<token>` linkini göstermeye devam eder.

### Capability secret sınırı

Plain management token PostgreSQL'e yazılmaz. Faz 9'da token yalnız şu kısa ömürlü hatta bulunabilir:

`browser memory → /api/manage/provision POST body → Worker memory → outbound Resend request`

E-posta sağlayıcısının manage linki teslim edebilmesi için bu URL'yi görmesi doğaldır. Buna karşılık uygulama logları, `appointment_notification_deliveries` ve diğer PostgreSQL tabloları plain token veya full manage URL saklamaz.

### Public-create ownership proof

`get_public_booking_email_payload` ve `record_public_booking_email_delivery` keyfi appointment ID kabul etmez. Phase 6/7 ile aynı kanıt kullanılır: appointment ID + original `public_create` idempotency key, `booking_commands` üzerinden aynı public appointment'a bağlanmalıdır. Böylece anon RPC yüzeyi genel PII lookup endpoint'ine dönüşmez.

### Delivery idempotency ve receipt

Resend çağrısı appointment kimliğine bağlı provider `Idempotency-Key` kullanır. Başarılı gönderimden sonra PostgreSQL yalnız recipient, provider ve provider message ID içeren durable receipt saklar. `(appointment_id, kind, channel)` primary key'i aynı confirmation'ın ikinci durable receipt'ini engeller.

Receipt yazımı e-posta gönderiminden sonra başarısız olursa booking yine geçerlidir. Provider idempotency kısa süreli retry duplicate riskini azaltır; kalıcı receipt ise sonraki normal provision retry'larında `already_sent` sonucu üretir.

### Faz 9 scope boundary

Bu faz yalnız **public booking confirmation e-mail + manage-link delivery** kesitini tamamlar. Appointment reminder scheduling/delivery, SMS, token recovery/reissue, provider webhook analytics ve marketing flows sonraki ayrı concern'lerdir.

## MVP yönü

Faz 9 sonrası: appointment reminders → mobil/UX polish → deployable MVP. Ödeme, gelişmiş CRM, loyalty, AI ve ERP-benzeri genişlemeler MVP öncesi varsayılan kapsam değildir.
