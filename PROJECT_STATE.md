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
| Rezervasyon sonucu + yönetim erişimi kurtarma | F09-02 PR #12, incelemede | Atomik create/capability/recovery; provider/outbox yok |
| Public rezervasyon e-postası | Eski taslak PR #8 / kısmi | Doğrudan merge edilmez; F09-03 sözleşmesine göre seçilerek taşınır |
| SalonApp mobil kabuğu, adisyon ve tahsilat | Planlandı, Faz 14 | Henüz uygulama/route/tablo yok |
| Ürün/stok, masraf, kasa/raporlar | Planlandı, Faz 15 | Önceki kapsam bu sınırlı operasyon işlevleri için genişletildi |
| Tekrar/SMS, yorum/fotoğraf, paket/promosyon, prim, hesap menüsü | Planlandı, Faz 16 | İlgili referans satırlarına bağlı ayrı alt işler |
| Üç kolun gerçek ortam pilotu | Doğrulanmadı, Faz 17 | Canlı Auth, mesaj teslimi, mobil ve ortak işlem zinciri doğrulanacak |

## Faz 9 aktif durum

- **F09-01 tamamlandı:** bağlayıcı recovery/bildirim authority sözleşmesi main'de, PR #11.
- **F09-02 incelemede:** PR #12, branch `f09-02-booking-recovery`.
- F09-02 public booking sonucu ile management capability'yi aynı PostgreSQL transaction sınırına alır; recovery proof ve encrypted management material ekler.
- Worker `MANAGEMENT_LINK_ENCRYPTION_KEY_V1` olmadan create çağrısını DB'ye göndermeden fail-closed davranır.
- Browser pending recovery state'i müşteri PII'si ve management bearer saklamaz; belirsiz network sonucunda yeni appointment yaratmak yerine recovery dener.
- F09-03 provider/outbox/retry/authoritative receipt; F09-04 direct-RPC abuse/rate-limit; F09-05 gerçek ortam birleşik kabulüdür. Bu sınırlar F09-02 içinde tamamlandı sayılmaz.

## Branch / PR notu

- `phase-3-services-team` → `phase-8-calendar` çalışmaları squash commit'lerle main'e alınmış. Eski branch'lerde farklı commit geçmişi görünmesi tek başına eksik merge değildir.
- `phase-2-auth-tenant`, `1e58648` Faz 1 commit'inde kalmış. Main'in auth/tenant kodu bu eski branch'in durumundan çıkarılamaz.
- `phase-9-email-delivery`: [PR #8](https://github.com/ziyabeey1-ai/randevu/pull/8), eski taslak; F09-03 için yalnız parça kaynağıdır.
- `f09-02-booking-recovery`: [PR #12](https://github.com/ziyabeey1-ai/randevu/pull/12), aktif F09-02 teslimidir.
- Başka oturumdan kalan yerel `codex/faz-2-auth-tenants` değişiklikleri güncel main'den farklı veri/auth yaklaşımı taşır; doğrudan birleştirilmez.

## İncelemeden kalan işler

| Bulgu | Etki | Faz |
| --- | --- | --- |
| Rezervasyon ve yönetim bağlantısı ayrı istek; bağlantı hatasında başarı ekranı açılmayabiliyor | **F09-02 PR #12 gideriyor:** atomik create + recovery. Merge/main CI sonrası kapanır | 9 |
| Taslak e-posta işi kullanıcı isteğinde bekliyor; kalıcı otomatik yeniden deneme yok | Yavaş/kesilen sağlayıcı müşteri sonucunu ve bağlantı teslimini etkiler | 9 / F09-03 |
| Taslak gönderim kaydı RPC'si, rezervasyon oluşturma anahtarına sahip anon istemciye açık | Gerçek sağlayıcı gönderimi olmadan receipt yazılabilir; server-only completion gerekir | 9 / F09-03 |
| Public oluşturma RPC'leri Worker dışından doğrudan çağrılabilir; uygulama/RPC düzeyinde kötüye kullanım kontrolü kapanmış değil | Otomatik isteklerle saat doldurma/direct-RPC bypass ele alınmalı | 9 / F09-04 |
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

## Worker ve migration haritası

`worker/app.ts` feature router'larını birleştirir: `index.ts` auth/işletme/katalog; `availability.ts` müsaitlik; `bookings.ts` işlemler; `public-booking.ts` mevcut public katalog/slot uçları; `public-booking-recovery.ts` F09-02 atomik booking/recovery; `customer-manage.ts` bağlantıyla yönetim; `calendar.ts` takvim okuması.

Migration sırası F09-02 branch'inde:

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
```

Birleştirilmiş migration'lar değiştirilmez; yeni davranış ileri migration ile eklenir. Eski PR #8'in aynı zaman damgasını kullanan taslak migration'ı main'e alınmamıştır ve F09-02 migration'ının üzerine doğrudan taşınamaz; F09-03 yeni ileri migration kullanmalıdır.

## F09-02 güvenlik ve recovery invariant'ları

- Management token ve recovery secret en az 256-bit browser-generated değerlerdir.
- PostgreSQL management bearer'ın yalnız SHA-256 hash'ini capability tablosunda tutar; recovery kaydı ayrıca AES-256-GCM ciphertext/IV/key version tutar.
- Plain management token/recovery secret DB'ye gönderilmez; HTTP contract testi bunu payload seviyesinde doğrular.
- `MANAGEMENT_LINK_ENCRYPTION_KEY_V1` yalnız Worker secret/var yüzeyidir; geçersizse create DB'ye ulaşmaz.
- Recovery `recoveryId + idempotencyKey + recoverySecret hash` ile yapılır; yanlış/expired proof dışarıdan aynı generic not-found davranışını verir.
- Create ve recover aynı recovery-ID advisory transaction lock'ını kullanır; in-flight create sırasında recovery transient false-negative vermeden commit sonucunu bekler.
- Aynı idempotency key farklı recovery secret/ID ile sessizce yeniden bağlanmaz.
- Management capability insert başarısız olursa yeni appointment ve recovery bootstrap aynı outer transaction ile rollback olur.
- F09-04 tamamlanana kadar anon direct-RPC abuse sınırı kapanmış sayılmaz.

## Doğrulama kanıtı ve sınırı

- [F09-01 PR #11](https://github.com/ziyabeey1-ai/randevu/pull/11): recovery/bildirim sözleşmesi main'e alındı ve merge sonrası CI başarılı.
- [F09-02 PR #12](https://github.com/ziyabeey1-ai/randevu/pull/12): final kod branch'i; exact final head merge edilmeden önce CI yeniden doğrulanır.
- F09-02 CI artık `npm ci`, typecheck, production build, Node HTTP contract, PostgreSQL 17 migration/regression ve iki-session dblink concurrency testini çalıştırır.
- SQL testleri yerel Auth fixture'ı kullanır. Gerçek Supabase kayıt/giriş, canlı provider teslimi ve uçtan uca mobil zincir bu kontrollerin kanıtladığı kapsam değildir.
- Aktif gerçek Supabase/staging ortamı F17-01/F09-05 kabulünde doğrulanacaktır.

Her PR aynı zorunlu build/SQL kapısını geçer. Yeni görev yalnız karttaki kabul kanıtları tamamlandıktan, main'e alındıktan ve gerekli main CI/gerçek ortam kanıtı doğrulandıktan sonra tamamlandı işaretlenir.
