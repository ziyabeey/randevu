# YZT Randevu — Mevcut Durum

Son kontrol: 12 Eylül 2026. Ürün planı Faz 9–17 görev sözleşmeleriyle takip edilir; gerçek uygulama durumu bu dosya ve [TASKS.md](TASKS.md) üzerinden okunur.

## Ürün yönü

**Müşteri paneli + randevu paneli + SalonApp**, ortak işletme/müşteri/randevu verisini kullanan üç kullanım koludur. Müşteri tarafında estetik farklılaşma; işletme takvimi ve adisyon tarafında referansa yakın düzen ve küçük farklar hedeflenir.

- [PRODUCT_SPEC.md](PRODUCT_SPEC.md): bağlayıcı ürün/akış kuralları.
- [ROADMAP.md](ROADMAP.md): faz sırası, bağımlılıklar ve kabul ölçütleri.
- [TASKS.md](TASKS.md): Faz 9–17 için görev, bağımlılık, sahip, durum ve PR/kanıt takibi.
- [CONTRIBUTING.md](CONTRIBUTING.md): insan/ajan katkısı, ortak dosya sahipliği ve oturum devri.
- [MVP_ACCEPTANCE.md](MVP_ACCEPTANCE.md): birleşik kabul senaryoları.
- [DECISIONS.md](DECISIONS.md): teknik kararlar ve korunan veri sınırları.
- [Görsel eşleştirme](docs/references/README.md): kaynak ekranlar, mevcut farklar ve hedef fazlar.

## Gerçek uygulama durumu

| Alan | Durum | Sınır / sonraki iş |
| --- | --- | --- |
| React + Worker temeli | Main'de, Faz 1 | Ortak repo/backend korunacak |
| Supabase Auth + Business/Membership + RLS | Main'de, Faz 2 temeli | Davet/rol yönetimi, parola kurtarma, görünür işletme geçişi Faz 10 |
| Hizmet/personel/eşleştirme | Main'de, Faz 3 | Düzenleme/pasifleştirme ve süre/fiyat arayüzleri Faz 10 |
| Çalışma saatleri, kapanış, müsaitlik | Main'de, Faz 4 | Aynı motor üç kolda kullanılacak |
| Müşteri + randevu çekirdeği | Main'de, Faz 5 | Tek hizmet/personel modeli; çoklu hizmet Faz 11 |
| Müşteriye açık rezervasyon | Main'de, Faz 6 | Yeni müşteri paneli estetiği ve eşdeğerlik Faz 12 |
| Güvenli bağlantıyla yönetim | Main'de, Faz 7 | `/m#token` capability korunur |
| Gün/hafta takvimi | Main'de, Faz 8 | Liste görünümü, güncellik ve referans düzeni Faz 13 |
| Rezervasyon sonucu + yönetim erişimi kurtarma | Main'de, F09-02 / PR #12 | Atomik create/capability/recovery tamamlandı |
| Durable public booking e-postası | Main'de, F09-03 / PR #13 | Outbox/lease/retry/provider receipt tamamlandı; gerçek provider teslimi F09-05/F17 |
| SalonApp mobil kabuğu, adisyon ve tahsilat | Planlandı, Faz 14 | Henüz uygulama/route/tablo yok |
| Ürün/stok, masraf, kasa/raporlar | Planlandı, Faz 15 | Sınırlı operasyon işlevleri |
| Tekrar/SMS, yorum/fotoğraf, paket/promosyon, prim, hesap menüsü | Planlandı, Faz 16 | Ayrı alt işler |
| Üç kolun gerçek ortam pilotu | Doğrulanmadı, Faz 17 | Canlı Auth, mesaj teslimi, mobil ve ortak işlem zinciri doğrulanacak |

## Faz 9 aktif durum

- **F09-01 tamamlandı:** recovery/bildirim authority sözleşmesi main'de, PR #11.
- **F09-02 tamamlandı:** PR #12 atomik booking + management capability + recovery akışını main'e aldı.
- **F09-03 tamamlandı:** PR #13 durable e-posta outbox, lease/retry, scheduled dispatcher, upgrade backfill ve server-only provider receipt authority ekledi.
- Notification intent F09-02 recovery satırı appointment'a bağlandığında aynı outer booking transaction'ında doğar; provider HTTP booking response yolunda değildir.
- Notification job state'leri `pending`, `leased`, `retry_wait`, `sent`, `failed_terminal`; lease varsayılanı 45 saniye, provider timeout 10 saniye, max deneme 8, bounded retry penceresi en fazla 72 saattir.
- `sent`, provider'ın isteği kabul edip message ID verdiğini ifade eder; inbox teslimi değildir.
- Resend idempotency key'i job başına stabildir. Provider'ın güncel 24 saatlik idempotency saklama penceresi nedeniyle 24 saat sonrasındaki ambiguous retry'larda mutlak exactly-once iddiası yoktur.
- F09-04 direct-RPC abuse/rate-limit; F09-05 gerçek Supabase + provider birleşik kabulüdür. G09 bu görevler tamamlanmadan kapanmaz.

## Branch / PR notu

- `phase-3-services-team` → `phase-8-calendar` çalışmaları squash commit'lerle main'e alınmış.
- `f09-02-booking-recovery`: [PR #12](https://github.com/ziyabeey1-ai/randevu/pull/12), main'e alındı.
- `f09-03-durable-notifications`: [PR #13](https://github.com/ziyabeey1-ai/randevu/pull/13), F09-03 teslimidir; main kabul kaydı TASKS ve handoff'tadır.
- `phase-9-email-delivery`: [PR #8](https://github.com/ziyabeey1-ai/randevu/pull/8), eski taslak; F09-03 içinde yalnız template/escaping/Resend adapter fikirleri seçilerek tüketildi. Eski synchronous send ve anon receipt modeli kullanılmaz.
- `phase-2-auth-tenant`, Faz 1 seviyesinde kalan eski branch'tir; main auth durumunu temsil etmez.
- Eski yerel `codex/faz-2-auth-tenants` çalışması güncel main'den farklı yaklaşım taşır ve doğrudan birleştirilmez.

## İncelemeden kalan işler

| Bulgu | Etki | Faz |
| --- | --- | --- |
| Public oluşturma RPC'leri Worker dışından doğrudan çağrılabilir; public abuse sınırı kapanmış değil | Otomatik slot doldurma/direct-RPC bypass ölçülebilir biçimde sınırlanmalı | 9 / F09-04 |
| Gerçek Resend/Supabase staging teslimi henüz doğrulanmadı | Stub/provider-acceptance testleri gerçek inbox teslimi kanıtı değildir | 9 / F09-05, 17 |
| Personel kaydı üyelik/davet üretmiyor; parola kurtarma ve işletme geçişi UI'sı eksik | Çok kullanıcılı günlük kullanım tamamlanmış değil | 10 |
| Auth/istek yardımcıları Worker modüllerinde tekrarlanıyor; hata/Origin/CSRF davranışı merkezi değil | Oturum ve güvenlik düzeltmeleri birlikte uygulanmalı | 10 |
| Takvimde otomatik güncelleme ve eski yanıt koruması yok | Public/diğer çalışan işlemleri geç veya yanlış seçimde görünebilir | 13 |
| Bazı ekranlarda Faz 3/tenant/StaffService metinleri ve eksik düzenleme kontrolleri var | Ürün dili ve operasyon kullanımı tamamlanmalı | 10, 12–14 |
| Proje notunda high-severity dependency audit uyarıları raporlandı | Güncel advisory/etki doğrulanıp pilot öncesi kapatılmalı | 17 |

## Mevcut tarayıcı yolları

| Yol | Uygulanan işlev / dosya |
| --- | --- |
| `/calendar` | Gün/hafta takvimi — `src/CalendarPage.tsx` |
| `/bookings` | Randevu oluşturma/taşıma/durum — `src/BookingPage.tsx` |
| `/availability` | Mesai/kapanış/müsaitlik — `src/AvailabilityPage.tsx` |
| `/` | Giriş, işletme, hizmet ve ekip — `src/App.tsx` |
| `/public-booking` | Halka açık rezervasyon ayarları — `src/PublicBookingSettingsPage.tsx` |
| `/r/:slug` | Müşteri rezervasyonu + F09-02 pending recovery — `src/PublicBookingPage.tsx` |
| `/m#<token>` | Müşteri yönetimi — `src/ManageAppointmentPage.tsx` |

SalonApp/adisyon için çalışan yeni bir yol henüz yok.

## Worker ve notification haritası

`worker/app.ts` feature router'larını birleştirir. F09-03 ile Wrangler entry `worker/entry.ts` olur: HTTP isteklerini Hono app'e aktarır ve her dakika scheduled notification maintenance + dispatcher çalıştırır.

Notification dosyaları:

- `worker/notifications.ts`: claim, AES-GCM decrypt, Resend request, timeout/retry sınıflandırması, complete/release.
- `worker/notification-maintenance.ts`: provider configinden bağımsız terminalization/retention maintenance RPC çağrısı.
- `docs/handoffs/F09-03.md`: retry, provider ve secret sözleşmesinin ayrıntılı devri.

Production notification env:

- `MANAGEMENT_LINK_ENCRYPTION_KEY_V1`
- `NOTIFICATION_DISPATCH_SECRET`
- `RESEND_API_KEY`
- `NOTIFICATION_FROM_EMAIL`
- `PUBLIC_APP_ORIGIN` — production için HTTPS zorunlu

DB'de `notification_dispatch_config` yalnız `NOTIFICATION_DISPATCH_SECRET` SHA-256 hash'ini tutar. Raw secret repo/migration içine yazılmaz; staging/production provisioning F17-01'de doğrulanır.

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
20260911160000_phase9_booking_recovery.sql
20260911170000_phase9_notification_outbox.sql
20260911170100_phase9_notification_maintenance.sql
```

`170000` outbox/state/trigger/lease RPC'lerini ekler. `170100`, F09-03 öncesi F09-02 recoveries için idempotent e-posta job backfill'i ve bağımsız maintenance RPC'sini ekler. Birleştirilmiş eski migration'lar değiştirilmez.

## F09-03 güvenlik ve delivery invariant'ları

- Public booking job'ı, e-posta varsa booking transaction'ı commit olurken durable olarak doğar.
- Job payload plaintext management bearer veya full manage URL tutmaz.
- Dispatcher bearer'ı yalnız F09-02 encrypted material'dan Worker belleğinde decrypt eder.
- Production management link origin'i HTTPS olmak zorundadır; HTTP yalnız local development'ta kabul edilir.
- Notification tablolarına anon/authenticated doğrudan erişemez.
- Claim/complete/release/maintenance yalnız `NOTIFICATION_DISPATCH_SECRET` doğrulamasıyla çalışır; DB yalnız secret hash'i tutar.
- Active lease başka worker tarafından claim edilemez; `FOR UPDATE SKIP LOCKED` iki gerçek PostgreSQL session ile test edilir.
- Completion aktif lease tokenını doğrular. Müşterinin booking idempotency key'i provider receipt authority değildir.
- Provider/network failure appointment'ı geri almaz.
- Recovery TTL dolduktan ve ilgili notification terminal olduktan sonra recovery hash/ciphertext/IV maintenance ile temizlenir.
- F09-04 tamamlanana kadar public booking/direct RPC abuse sınırı kapanmış sayılmaz.

## Doğrulama kanıtı ve sınırı

- [F09-01 PR #11](https://github.com/ziyabeey1-ai/randevu/pull/11): sözleşme main'de.
- [F09-02 PR #12](https://github.com/ziyabeey1-ai/randevu/pull/12): atomik booking/recovery main'de.
- [F09-03 PR #13](https://github.com/ziyabeey1-ai/randevu/pull/13): CI run `34653785166` üzerinde typecheck, production build, Wrangler scheduled dry-run, provider stub, full PostgreSQL regression, iki-session notification claim race ve ayrı F09-02→F09-03 upgrade/backfill testi success.
- Testler fake Resend response ve yerel PostgreSQL/Auth fixture kullanır. Gerçek Resend hesabı, gerçek inbox teslimi ve gerçek Supabase environment bu kanıtın kapsamı değildir.
- Gerçek ortam/secret provisioning F17-01 ve F09-05 kabulinde doğrulanacaktır.

Her PR aynı zorunlu build/SQL kapısını geçer. F09-03 kullanıcıya ancak PR merge edilip merge sonrası main CI başarılı olduğunda tamamlandı diye raporlanır. G09 ancak F09-01…F09-05 kabul edildiğinde kapanır.
