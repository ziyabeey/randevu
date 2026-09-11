# YZT Randevu

YZT Digital'ın yerel hizmet işletmeleri için geliştirdiği multi-tenant randevu SaaS'ı.

**Güncel ürün sınırı: Faz 7 — Customer Appointment Management.** Auth/tenant, hizmet-ekip, timezone/DST güvenli müsaitlik, concurrency-safe booking ve public self-booking üstüne müşterinin güvenli capability bağlantısıyla kendi randevusunu görüntüleme, taşıma ve iptal etme akışı eklenmiştir.

> Coding agent kullanıyorsan önce [`PROJECT_STATE.md`](PROJECT_STATE.md), sonra yalnız gerekli olduğunda [`DECISIONS.md`](DECISIONS.md) oku. `AGENTS.md` düşük-context çalışma protokolünü içerir.

## Yerel kurulum

```bash
cp .dev.vars.example .dev.vars
npm ci
npm run dev
```

`.dev.vars` içine Supabase proje URL'si ve anon/publishable key girilir. Worker **service-role key kullanmaz**.

## Ekranlar

| Yol | İşlev |
| --- | --- |
| `/` | Giriş, işletme seçimi, hizmet ve ekip |
| `/availability` | İşletme/personel mesaisi, mola, izin/kapanış, slot önizleme |
| `/bookings` | Operatör randevu oluşturma, taşıma, durum ve audit |
| `/public-booking` | Owner/manager public sayfa ayarları ve paylaşım linki |
| `/r/:slug` | Login gerektirmeyen müşteri self-booking sayfası |
| `/m/:token` | Tek randevu için capability-link görüntüleme, taşıma ve iptal |

Public rezervasyon **varsayılan kapalıdır**. Owner/manager `/public-booking` ekranından açtıktan sonra müşteri linki çalışır. Daha önce verilmiş `/m/:token` yönetim bağlantısı, public sayfa sonradan kapatılsa da mevcut randevu için geçerli kalır.

## Public booking akışı

1. Müşteri `/r/:slug` sayfasını açar.
2. Yalnız aktif ve gerçekten atanabilir hizmetleri görür.
3. Personel veya `Fark etmez` seçip tarih belirler.
4. Müsaitlik motoru mesai, buffer, izin/kapanış ve mevcut appointment'ları düşerek gerçek slot üretir.
5. Müşteri bir slot seçer; telefon veya e-postadan en az birini verir.
6. `create_public_appointment` slotu transaction içinde tekrar doğrular.
7. Son yarış koşulunda PostgreSQL `EXCLUDE USING gist` aynı personele overlap yazılmasını engeller.
8. Başarılı kayıt `appointments.source='public'` ve public audit event'i bırakır.
9. Tarayıcı 256-bit rastgele bir management token üretir; aynı booking idempotency key ile capability provision edilir.
10. DB yalnız `SHA-256(token)` saklar; müşteriye `/m/:token` linki gösterilir.

Anon kullanıcıların `customers`, `appointments`, `public_booking_settings` veya capability tablolarına doğrudan erişimi yoktur. Public yüzey yalnız dar security-definer RPC'lerden oluşur.

## Randevumu yönet akışı

`/m/:token` bearer-capability bağlantısı yalnız tek appointment'ı temsil eder. Token düz hali PostgreSQL'de saklanmaz ve listelenemez.

Müşteri bu bağlantıyla:

- sanitize edilmiş randevu özetini görebilir,
- mevcut appointment'ın snapshot süre/buffer değerleriyle hesaplanan uygun saatleri görebilir,
- `Idempotency-Key` ile güvenli biçimde randevuyu taşıyabilir,
- `Idempotency-Key` ile iptal edebilir.

Taşıma mevcut işletme/personel çalışma saatleri, block'lar, personel-hizmet yetkinliği, minimum notice ve horizon kurallarını uygular. Final overlap kilidi yine PostgreSQL exclusion constraint'tir. Taşıma ve iptal audit event'leri `actor_type='public'`, `actor_user_id=null` provenance taşır.

## Public ayarlar

Owner/manager şunları yönetebilir:

- public sayfa açık/kapalı
- slot adımı
- minimum önceden rezervasyon süresi
- ileri tarih rezervasyon ufku

## Migration sırası

```text
supabase/migrations/20260911090000_phase2_auth_tenancy.sql
supabase/migrations/20260911100000_phase3_services_team.sql
supabase/migrations/20260911110000_phase4_availability.sql
supabase/migrations/20260911120000_phase5_booking_core.sql
supabase/migrations/20260911121000_phase5_booking_hardening.sql
supabase/migrations/20260911130000_phase6_public_booking.sql
supabase/migrations/20260911140000_phase7_customer_manage.sql
supabase/migrations/20260911140100_phase7_capability_hash_hardening.sql
supabase/migrations/20260911140200_phase7_composite_row_hardening.sql
```

Stabil merge edilmiş migration'lar geriye dönük düzenlenmez; yeni davranış yeni migration ile eklenir.

## Temel API yüzeyi

### Member

- `GET /api/session`
- `GET /api/catalog`
- `/api/availability/*`
- `/api/bookings/*`
- `GET /api/public/settings`
- `PUT /api/public/settings`

### Anonymous public booking

- `GET /api/public/business/:slug`
- `GET /api/public/business/:slug/staff?serviceId=...`
- `GET /api/public/business/:slug/slots?serviceId=...&date=...&staffId=...`
- `POST /api/public/business/:slug/book` — `Idempotency-Key` zorunlu

### Anonymous customer management

- `POST /api/manage/provision` — booking sonucuna management capability bağlar
- `GET /api/manage/:token`
- `GET /api/manage/:token/slots?date=...&staffId=...`
- `POST /api/manage/:token/reschedule` — `Idempotency-Key` zorunlu
- `POST /api/manage/:token/cancel` — `Idempotency-Key` zorunlu

## Booking invariant'ları

- Tenant root `Business`'tır; cookie yetki değildir.
- Cross-tenant ilişkiler birleşik foreign key + RLS ile engellenir.
- Availability gerçek `timestamptz` timeline üzerinde çalışır.
- Occupied aralık `buffer_before + duration + buffer_after` içerir.
- Non-cancelled aynı-personel overlap'ının son kilidi PostgreSQL exclusion constraint'tir.
- `cancelled` slotu serbest bırakır; `completed/no_show` tarihsel occupancy'yi korur.
- Create/reschedule/status ve public-management mutation komutları idempotenttir.
- Appointment snapshot'ları sonradan değişen katalogdan etkilenmez.
- Terminal durumlar yeniden aktif duruma açılamaz.
- Public booking mevcut CRM customer kaydını contact match ile reuse edebilir ama anonim veriyle o customer satırını güncellemez.
- Management capability yalnız tek appointment içindir; plain token DB'de saklanmaz.

## Kabul kontrolü

```bash
npm ci
npm run typecheck
npm run build
```

CI ayrıca PostgreSQL 17 üzerinde tüm migration zincirini kurar ve Faz 3–7 SQL regression testlerini çalıştırır. Kırmızı DB gate ile merge yapılmaz.

## Sonraki kapsam

Faz 7'de SMS/e-posta ile yönetim linki teslimi veya hatırlatma, token recovery/reissue, ödeme/depozito, Turnstile/dağıtık rate-limit, dış takvim senkronizasyonu ve gelişmiş CRM otomasyonu yoktur. Bunlar sonraki fazlarda ayrı concern olarak ele alınacaktır.
