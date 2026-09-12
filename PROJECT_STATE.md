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
| Public booking abuse sınırı | Main'de, F09-04 / PR #14 | Direct RPC bypass kapalı; guarded RPC + actor/network/business rate-limit + retention tamamlandı |
| Test/CI + dependency bakım temeli | Main'de, F17-02 / PR #15 | Coverage gate, gerçek Chrome smoke, blocking audit ve 0-vulnerability lock baseline tamamlandı |
| Staging ortamı | Engelli, F17-01 | Supabase hosted + ACL canlı doğrulandı; dış contract 17→11→9→7'ye daraltıldı; workers.dev origin otomatik çözülüyor, gate/dispatch secret'ları run başına üretiliyor; Cloudflare/Resend/privileged provisioning bekleniyor |
| SalonApp mobil kabuğu, adisyon ve tahsilat | Planlandı, Faz 14 | Henüz uygulama/route/tablo yok |
| Ürün/stok, masraf, kasa/raporlar | Planlandı, Faz 15 | Sınırlı operasyon işlevleri |
| Tekrar/SMS, yorum/fotoğraf, paket/promosyon, prim, hesap menüsü | Planlandı, Faz 16 | Ayrı alt işler |
| Üç kolun gerçek ortam pilotu | Doğrulanmadı, Faz 17 | Canlı Auth, mesaj teslimi, abuse/load, mobil ve ortak işlem zinciri doğrulanacak |

## Faz 9 aktif durum

- **F09-01 tamamlandı:** recovery/bildirim authority sözleşmesi main'de, PR #11.
- **F09-02 tamamlandı:** PR #12 atomik booking + management capability + recovery akışını main'e aldı.
- **F09-03 tamamlandı:** PR #13 durable e-posta outbox, lease/retry, scheduled dispatcher, upgrade backfill ve server-only provider receipt authority ekledi.
- **F09-04 tamamlandı:** PR #14 raw public RPC bypass'larını kapattı; Worker-only gate secret, signed HttpOnly actor proof, coarse network HMAC, actor/network/business PostgreSQL rate-limit ve bounded counter retention ekledi.
- **F17-02 tamamlandı:** PR #15 CI/test envanter kapısı, gerçek headless Chrome smoke, tek HTTP test komutu ve blocking high/critical dependency audit ekledi; Cloudflare toolchain dar yükseltmesiyle `npm ci` 0 vulnerability baseline'a geldi.
- **F17-01 engelli:** Supabase hosted staging ve ACL hardening canlı doğrulandı; gerçek staging probe `34671008590` GitHub environment provisioning katmanında fail-closed durdu. Repo otomasyonu dış contract'ı 17 değerden 7'ye indirir; public Supabase client metadata, workers.dev origin ve rotatable gate/dispatch secret'ları artık elle provision edilmez. Cloudflare, privileged Supabase erişimi, kalıcı management encryption key ve Resend kimlikleri dışarıdan bağlanmalıdır.
- Notification intent F09-02 recovery satırı appointment'a bağlandığında aynı outer booking transaction'ında doğar; provider HTTP booking response yolunda değildir.
- Notification job state'leri `pending`, `leased`, `retry_wait`, `sent`, `failed_terminal`; lease varsayılanı 45 saniye, provider timeout 10 saniye, max deneme 8, bounded retry penceresi en fazla 72 saattir.
- `sent`, provider'ın isteği kabul edip message ID verdiğini ifade eder; inbox teslimi değildir.
- Resend idempotency key'i job başına stabildir. Provider'ın güncel 24 saatlik idempotency saklama penceresi nedeniyle 24 saat sonrasındaki ambiguous retry'larda mutlak exactly-once iddiası yoktur.
- **F09-05 sıradaki Faz 9 entegrasyon kapısıdır**, ancak kalan önkoşul F17-01 gerçek development/staging ortamıdır. G09, F09-05 gerçek ortam kabulü tamamlanmadan kapanmaz.

## Branch / PR notu

- `phase-3-services-team` → `phase-8-calendar` çalışmaları squash commit'lerle main'e alınmış.
- `f09-02-booking-recovery`: [PR #12](https://github.com/ziyabeey1-ai/randevu/pull/12), main'e alındı.
- `f09-03-durable-notifications`: [PR #13](https://github.com/ziyabeey1-ai/randevu/pull/13), F09-03 teslimidir.
- `f09-04-public-abuse-control`: [PR #14](https://github.com/ziyabeey1-ai/randevu/pull/14), F09-04 teslimidir; ayrıntı [handoff](docs/handoffs/F09-04.md) içindedir.
- `f17-02-ci-test-dependency-baseline`: [PR #15](https://github.com/ziyabeey1-ai/randevu/pull/15), F17-02 teslimidir; ayrıntı [handoff](docs/handoffs/F17-02.md) içindedir.
- F17-01 repo/staging zinciri: [PR #16](https://github.com/ziyabeey1-ai/randevu/pull/16), hosted uyumluluk/ACL [PR #17](https://github.com/ziyabeey1-ai/randevu/pull/17) + [PR #18](https://github.com/ziyabeey1-ai/randevu/pull/18), canlı sınır kaydı [PR #19](https://github.com/ziyabeey1-ai/randevu/pull/19) + [PR #20](https://github.com/ziyabeey1-ai/randevu/pull/20), dış secret yüzeyi daraltmaları [PR #21](https://github.com/ziyabeey1-ai/randevu/pull/21) + [PR #22](https://github.com/ziyabeey1-ai/randevu/pull/22) + [PR #23](https://github.com/ziyabeey1-ai/randevu/pull/23).
- `phase-9-email-delivery`: [PR #8](https://github.com/ziyabeey1-ai/randevu/pull/8), superseded eski taslaktır; synchronous send ve anon receipt modeli kullanılmaz.
- `phase-2-auth-tenant`, Faz 1 seviyesinde kalan eski branch'tir; main auth durumunu temsil etmez.

## İncelemeden kalan işler

| Bulgu | Etki | Faz |
| --- | --- | --- |
| Hosted Supabase staging + ACL doğrulandı; Cloudflare deploy ve Resend sender için GitHub `staging` privileged config henüz provision edilmedi | CI fixture/stub kanıtı provider/deploy davranışı değildir; 7 dış değer bağlanıp gerçek workflow/smoke yeşil olmalı | 9 / F09-05, 17 |
| Personel kaydı üyelik/davet üretmiyor; parola kurtarma ve işletme geçişi UI'sı eksik | Çok kullanıcılı günlük kullanım tamamlanmış değil | 10 |
| Auth/istek yardımcıları Worker modüllerinde tekrarlanıyor; hata/Origin/CSRF davranışı merkezi değil | Oturum ve güvenlik düzeltmeleri birlikte uygulanmalı | 10 |
| Takvimde otomatik güncelleme ve eski yanıt koruması yok | Public/diğer çalışan işlemleri geç veya yanlış seçimde görünebilir | 13 |
| Bazı ekranlarda Faz 3/tenant/StaffService metinleri ve eksik düzenleme kontrolleri var | Ürün dili ve operasyon kullanımı tamamlanmalı | 10, 12–14 |

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

## Worker haritası

`worker/app.ts` feature router'larını birleştirir. F09-03 ile Wrangler entry `worker/entry.ts` olur: HTTP isteklerini Hono app'e aktarır ve her dakika scheduled notification maintenance + dispatcher çalıştırır.

- `worker/notifications.ts`: claim, AES-GCM decrypt, Resend request, timeout/retry sınıflandırması, complete/release.
- `worker/notification-maintenance.ts`: provider configinden bağımsız terminalization/retention maintenance RPC çağrısı.
- `worker/public-abuse.ts`: F09-04 gate validation, signed public client cookie, IPv4 `/24` / IPv6 `/64` coarse network anahtarı, HMAC-derived actor/network hash'leri ve HTTP 429 mapping.
- `worker/public-booking.ts`, `worker/public-booking-recovery.ts`: yalnız guarded public RPC yüzeyini kullanır.

Production env:

- `MANAGEMENT_LINK_ENCRYPTION_KEY_V1`
- `PUBLIC_BOOKING_GATE_SECRET`
- `NOTIFICATION_DISPATCH_SECRET`
- `RESEND_API_KEY`
- `NOTIFICATION_FROM_EMAIL`
- `PUBLIC_APP_ORIGIN` — production için HTTPS zorunlu

DB'de `notification_dispatch_config` yalnız `NOTIFICATION_DISPATCH_SECRET` SHA-256 hash'ini; `public_booking_abuse_config` yalnız `PUBLIC_BOOKING_GATE_SECRET` SHA-256 hash'ini tutar. Raw secret'lar repo/migration içine yazılmaz. Gerçek staging/production provisioning F17-01/F09-05'te doğrulanır. Abuse config satırı yoksa public gate fail-closed davranır.

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
20260911180000_phase9_public_abuse_control.sql
20260911180100_phase9_public_abuse_hardening.sql
20260911180200_phase9_public_abuse_retention.sql
```

Birleştirilmiş eski migration'lar değiştirilmez; yeni davranış ileri migration ile eklenir.

## F09-03 delivery invariant'ları

- Public booking job'ı, e-posta varsa booking transaction'ı commit olurken durable olarak doğar.
- Job payload plaintext management bearer veya full manage URL tutmaz.
- Dispatcher bearer'ı yalnız F09-02 encrypted material'dan Worker belleğinde decrypt eder.
- Production management link origin'i HTTPS olmak zorundadır; HTTP yalnız local development'ta kabul edilir.
- Notification tablolarına anon/authenticated doğrudan erişemez.
- Claim/complete/release/maintenance yalnız `NOTIFICATION_DISPATCH_SECRET` doğrulamasıyla çalışır; DB yalnız secret hash'i tutar.
- Active lease başka worker tarafından claim edilemez; completion aktif lease tokenını doğrular.
- Provider/network failure appointment'ı geri almaz.
- Recovery TTL dolduktan ve ilgili notification terminal olduktan sonra recovery hash/ciphertext/IV maintenance ile temizlenir.

## F09-04 abuse invariant'ları

- Eski raw public business/service/staff/slot/create/recovery RPC'leri anon/authenticated dış API değildir; guarded wrapper'lar tek public PostgREST yüzeyidir.
- Guarded wrapper server-only gate secret olmadan fail-closed davranır.
- Browser cookie imzalı + HttpOnly + SameSite=Lax'tır; raw cookie ve raw IP PostgreSQL'e gitmez.
- Actor ve coarse-network anahtarları Worker'da HMAC-SHA-256 türetilir; DB yalnız 64 hex hash key saklar.
- Read/recovery actor+network, create actor+network+business limitine tabidir.
- Same-intent başarılı retry yeni create budget tüketmez.
- Guarded public create yanlışlıkla authenticated üst context taşısa bile booking command source `public` kalır.
- Rate counters `updated_at` index'iyle 48 saatten eski state'i request-path'te en fazla 500 satır/call bounded prune eder.
- 429 cevabı `Retry-After` taşır; rate-limit booking failure gibi raporlanmaz.

## F17-02 CI/test invariant'ları

- SQL migration ve SQL acceptance dosyaları CI workflow'unda açıkça bağlı değilse coverage gate kırılır.
- Node kontratları `tests/*.test.mjs` wildcard'ıyla tek komutta çalışır; negatif coverage testi gate'in fail-closed davranışını kanıtlar.
- Production build sonrası gerçek headless Chrome giriş ekranını render etmeden browser smoke geçmez.
- `npm audit --audit-level=high` blocking'dir; high veya critical dependency advisory CI'ı kırar.
- Güncel lock baseline: `@cloudflare/vite-plugin@1.54.8`, `wrangler@4.131.0`, transitive `sharp@0.35.4`; clean install/audit 0 vulnerability raporlar.
- CI secret/provider/staging kanıtı değildir; gerçek servis kabulü F17-01/F09-05 kapsamındadır.

## Doğrulama kanıtı ve sınırı

- [F09-01 PR #11](https://github.com/ziyabeey1-ai/randevu/pull/11): sözleşme main'de.
- [F09-02 PR #12](https://github.com/ziyabeey1-ai/randevu/pull/12): atomik booking/recovery main'de.
- [F09-03 PR #13](https://github.com/ziyabeey1-ai/randevu/pull/13): CI `34653785166` success; provider stub + tam PostgreSQL + concurrency + upgrade/backfill kapsandı.
- [F09-04 PR #14](https://github.com/ziyabeey1-ai/randevu/pull/14): CI `34656950693` success; Worker abuse contract, direct-RPC deny, wrong-proof deny, actor/network/business quota, safe retry, recovery, public provenance ve counter retention kapsandı.
- [F17-02 PR #15](https://github.com/ziyabeey1-ai/randevu/pull/15): teknik kabul CI `34658041327` success; 34-file coverage gate, negatif gate testi, 0-vulnerability blocking audit, real Chrome smoke, 21/21 HTTP kontratı ve tam SQL zinciri kapsandı.
- F17-01 canlı hosted kanıtı: `randevu-staging` Supabase `ACTIVE_HEALTHY`; ACL migration `20260912030000_f17_hosted_acl_hardening` uygulandı ve security advisor tekrar çalıştırıldı.
- F17-01 canlı workflow probe `34671008590`: runner/toolchain/install geçti, environment contract dış config yokluğunda fail-closed durdu; deploy/smoke çalıştırılmadı.
- F17-01 PR #21 staging contract'ı 11 dış değere daralttı ve bunun geri büyümesini Node kontrat testiyle kilitledi.
- F17-01 PR #22 contract'ı 9 dış değere indirdi; public Supabase client metadata'sını workflow'a aldı ve Cloudflare workers.dev origin'ini migration öncesi otomatik çözdü.
- F17-01 PR #23 contract'ı 7 dış değere indirdi; public-booking gate ve notification-dispatch secret'larını run başına üretip aynı job içinde DB hash provisioning + Worker runtime'a bağladı. PR CI `34676186429` ve main CI `34676257736` success.
- Testler yerel PostgreSQL/Auth fixture ve fake provider kullanır. Gerçek Resend hesabı/inbox teslimi, Cloudflare deploy ve üretim abuse/load davranışı bu CI kanıtının kapsamı değildir.
- Gerçek environment credential provisioning F17-01 ve provider entegrasyonu F09-05 kabulinde doğrulanacaktır.

Her PR aynı zorunlu build/SQL kapısını geçer. G09 ancak F09-01…F09-05 kabul edildiğinde kapanır.