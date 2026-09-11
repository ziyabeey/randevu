# YZT Randevu

YZT Digital'ın yerel hizmet işletmeleri için geliştirdiği multi-tenant randevu SaaS'ı.

**Güncel ürün sınırı: Faz 6 — Public Self-Booking.** Auth/tenant, hizmet-ekip, timezone/DST güvenli müsaitlik ve concurrency-safe booking çekirdeğinin üstüne işletmenin paylaşabileceği public rezervasyon sayfası eklenmiştir.

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

Public rezervasyon **varsayılan kapalıdır**. Owner/manager `/public-booking` ekranından açtıktan sonra müşteri linki çalışır.

## Public booking akışı

1. Müşteri `/r/:slug` sayfasını açar.
2. Yalnız aktif ve gerçekten atanabilir hizmetleri görür.
3. Personel veya `Fark etmez` seçip tarih belirler.
4. Müsaitlik motoru mesai, buffer, izin/kapanış ve mevcut appointment'ları düşerek gerçek slot üretir.
5. Müşteri bir slot seçer; telefon veya e-postadan en az birini verir.
6. `create_public_appointment` slotu transaction içinde tekrar doğrular.
7. Son yarış koşulunda PostgreSQL `EXCLUDE USING gist` aynı personele overlap yazılmasını engeller.
8. Başarılı kayıt `appointments.source='public'` ve public audit event'i bırakır.

Anon kullanıcıların `customers`, `appointments`, `public_booking_settings` veya başka tenant tablolarına doğrudan erişimi yoktur. Public yüzey yalnız dar security-definer RPC'lerden oluşur.

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
```

Stabil migration'lar geriye dönük düzenlenmez; yeni davranış yeni migration ile eklenir.

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

## Booking invariant'ları

- Tenant root `Business`'tır; cookie yetki değildir.
- Cross-tenant ilişkiler birleşik foreign key + RLS ile engellenir.
- Availability gerçek `timestamptz` timeline üzerinde çalışır.
- Occupied aralık `buffer_before + duration + buffer_after` içerir.
- Non-cancelled aynı-personel overlap'ının son kilidi PostgreSQL exclusion constraint'tir.
- `cancelled` slotu serbest bırakır; `completed/no_show` tarihsel occupancy'yi korur.
- Create/reschedule/status komutları idempotenttir.
- Appointment snapshot'ları sonradan değişen katalogdan etkilenmez.
- Terminal durumlar yeniden aktif duruma açılamaz.
- Public booking mevcut CRM customer kaydını contact match ile reuse edebilir ama anonim veriyle o customer satırını güncellemez.

## Kabul kontrolü

```bash
npm ci
npm run typecheck
npm run build
```

CI ayrıca PostgreSQL 17 üzerinde tüm migration zincirini kurar ve Faz 3–6 SQL regression testlerini çalıştırır. Kırmızı DB gate ile merge yapılmaz.

## Sonraki kapsam

Faz 6'da public cancellation/reschedule linkleri, ödeme/depozito, SMS/e-posta bildirimleri, Turnstile/dağıtık rate-limit, dış takvim senkronizasyonu ve gelişmiş CRM otomasyonu yoktur. Bunlar sonraki fazlarda ayrı concern olarak ele alınacaktır.
