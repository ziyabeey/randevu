# YZT Randevu

YZT Digital'ın yerel hizmet işletmeleri için geliştirdiği multi-tenant randevu SaaS'ı.

**Güncel ürün sınırı: Faz 9 — Public Booking E-mail Delivery.** Auth/tenant, hizmet-ekip, timezone/DST-safe availability, concurrency-safe booking, public self-booking, müşteri self-management ve operatör takvimi üstüne public rezervasyon onayı ile güvenli manage-link e-posta teslimi eklendi.

> Coding agent: önce `PROJECT_STATE.md`, sonra gerekiyorsa `DECISIONS.md`. `AGENTS.md` düşük-context çalışma protokolüdür.

## Yerel kurulum

```bash
cp .dev.vars.example .dev.vars
npm ci
npm run dev
```

Worker service-role key kullanmaz. E-posta teslimi Resend REST API üzerinden yapılır; SDK bağımlılığı yoktur.

## Ortam değişkenleri

Temel çalışma için:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
COOKIE_SECURE
```

E-posta teslimi için ayrıca:

```text
RESEND_API_KEY
NOTIFICATION_FROM_EMAIL
```

`RESEND_API_KEY` veya `NOTIFICATION_FROM_EMAIL` yoksa booking yine çalışır; confirmation ekranı e-posta tesliminin devre dışı olduğunu bildirir ve `/m#<token>` yönetim bağlantısını göstermeye devam eder.

## Ana ekranlar

| Yol | İşlev |
| --- | --- |
| `/calendar` | Gün/hafta operasyon takvimi, personel filtresi, hızlı durum aksiyonları |
| `/bookings` | Yeni randevu, taşıma ve gelişmiş booking işlemleri |
| `/availability` | Mesai, izin/kapanış ve slot önizleme |
| `/` | İşletme, hizmet ve ekip |
| `/public-booking` | Public sayfa ayarları |
| `/r/:slug` | Müşteri self-booking |
| `/m#<token>` | Tek randevu için güvenli müşteri yönetimi |

## Public booking ve e-posta teslimi

Public booking başarılı olduktan sonra browser 256-bit management token üretir. `/api/manage/provision`, original public-create idempotency key ile appointment sahipliğini doğrular ve PostgreSQL'e yalnız SHA-256 token hash'ini yazar.

Capability provision edildikten sonra confirmation e-postası best-effort gönderilir:

1. DB, appointment ID + original public-create idempotency key ile dar notification payload'ını çözer.
2. Müşterinin e-postası yoksa teslim atlanır.
3. Resend yapılandırılmamışsa teslim `disabled` olur; booking etkilenmez.
4. Yapılandırılmışsa Worker Resend'e booking özeti ve `/m#<token>` manage-link içeren e-posta gönderir.
5. PostgreSQL'e yalnız recipient, provider ve provider message ID içeren durable delivery receipt yazılır.
6. Plain management token veya full manage URL PostgreSQL'de saklanmaz.

Provider/network hatası valid appointment veya management capability'yi geri almaz. Müşteri on-screen yönetim linkini her durumda kullanabilir.

## Takvim

Takvim yeni bir booking sistemi değildir. `get_calendar_appointments` mevcut appointment snapshot'larını aktif tenant üyeliği ile okur. İstenen yerel gün/hafta business timezone'unda exact `timestamptz` sınırlarına çevrilir; UTC günü ile işletme günü karıştırılmaz.

Gün görünümü personel sütunları üzerinde timed blocks gösterir. Hafta görünümü 7 business-local günü kompakt sütunlarda gösterir. Detay çekmecesi müşteri/hizmet/personel/kaynak/iletişim/not bilgilerini gösterir ve mevcut Faz 5 lifecycle endpoint'leriyle onay, tamamlandı, gelmedi ve iptal aksiyonlarını çalıştırır.

Yeni randevu ve gelişmiş reschedule `/bookings` yüzeyinde kalır. Booking doğruluğu ve overlap kilidi takvim UI'sına taşınmaz.

## Güvenlik ve booking invariant'ları

- Tenant root `Business`'tır; cookie yetki değildir.
- Member erişimi aktif Membership + RLS ile doğrulanır.
- Cross-tenant ilişkiler engellenir.
- Availability ve calendar işletme timezone'u ile gerçek timeline üzerinde çalışır.
- Occupied aralık buffer'ları içerir.
- Same-staff overlap final kilidi PostgreSQL `EXCLUDE USING gist` constraint'idir.
- `cancelled` slotu serbest bırakır; `completed/no_show` tarihçeyi korur.
- Booking mutation'ları idempotenttir.
- Public booking mevcut customer master kaydını anonim veriyle güncellemez.
- Management token DB'de plaintext tutulmaz; `/m#token` fragment server-visible URL'e gitmez.
- E-posta provider hatası booking authority değildir ve randevuyu geri alamaz.
- Delivery receipt plain capability veya full manage URL tutmaz.

## Migration sırası

```text
20260911090000_phase2_auth_tenancy.sql
20260911100000_phase3_services_team.sql
20260911110000_phase4_availability.sql
20260911120000_phase5_booking_core.sql
20260911121000_phase5_booking_hardening.sql
20260911130000_phase6_public_booking.sql
20260911140000_phase7_customer_manage.sql
20260911150000_phase8_calendar.sql
20260911160000_phase9_email_delivery.sql
```

## Kabul kontrolü

```bash
npm ci
npm run typecheck
npm run build
```

CI PostgreSQL 17 üzerinde tüm migration zincirini ve Faz 3–9 regression testlerini çalıştırır.

## MVP rotası

**Takvim ✅ → confirmation e-mail/manage-link delivery ✅ → appointment reminders → mobil/UX polish → deployable MVP.**

Ödeme, gelişmiş CRM, loyalty, AI ve ERP-benzeri genişlemeler MVP öncesi varsayılan kapsam değildir.
