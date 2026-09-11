# YZT Randevu — Mevcut Durum

Son kontrol: 11 Eylül 2026. Uygulama kodu tabanı: `main` / `7c78be88fd1ed99bf37cd603eb503f2b1b4d4e3f`. Bu güncelleme ürün kurallarını, fazları ve referansları düzenler; yeni ürün ekranı veya veritabanı özelliği eklemez.

## Ürün yönü

**Müşteri paneli + randevu paneli + SalonApp**, ortak işletme/müşteri/randevu verisini kullanan üç kullanım koludur. Müşteri tarafında estetik farklılaşma; işletme takvimi ve adisyon tarafında referansa yakın düzen ve küçük farklar hedeflenir.

- [PRODUCT_SPEC.md](PRODUCT_SPEC.md): bağlayıcı ürün/akış kuralları.
- [ROADMAP.md](ROADMAP.md): faz sırası, bağımlılıklar ve kabul ölçütleri.
- [DECISIONS.md](DECISIONS.md): teknik kararlar ve korunan veri sınırları.
- [Görsel eşleştirme](docs/references/README.md): 11 kaynak ekran, mevcut farklar ve hedef fazlar.

## Gerçek uygulama durumu

| Alan | Durum | Sınır / sonraki iş |
| --- | --- | --- |
| React + Worker temeli | Main'de, Faz 1 | Ortak repo/backend korunacak |
| Supabase Auth + Business/Membership + RLS | Main'de, Faz 2 temeli | Davet/rol yönetimi, parola kurtarma, görünür işletme geçişi Faz 10 |
| Hizmet/personel/eşleştirme | Main'de, Faz 3 | Düzenleme/pasifleştirme ve süre/fiyat arayüzleri Faz 10 |
| Çalışma saatleri, kapanış, müsaitlik | Main'de, Faz 4 | Aynı motor üç kolda kullanılacak |
| Müşteri + randevu çekirdeği | Main'de, Faz 5 | Tek hizmet/personel modeli; çoklu hizmet Faz 11 |
| Müşteriye açık rezervasyon | Main'de, Faz 6 | Yeni müşteri paneli estetiği ve eşdeğerlik Faz 12 |
| Güvenli bağlantıyla yönetim | Main'de, Faz 7 | Ara hata/kurtarma ve bildirim güvenilirliği Faz 9 |
| Gün/hafta takvimi | Main'de, Faz 8 | Liste görünümü, güncellik ve referans düzeni Faz 13 |
| Public rezervasyon e-postası | Taslak PR / kısmi, Faz 9 | Main'de değil; fazın yeni kabul ölçütleri tamamlanmalı |
| SalonApp mobil kabuğu, adisyon ve tahsilat | Planlandı, Faz 14 | Henüz uygulama/route/tablo yok |
| Ürün/stok, masraf, kasa/raporlar | Planlandı, Faz 15 | Önceki kapsam bu sınırlı operasyon işlevleri için genişletildi |
| Tekrar/SMS, yorum/fotoğraf, paket/promosyon, prim, hesap menüsü | Planlandı, Faz 16 | İlgili referans satırlarına bağlı ayrı alt işler |
| Üç kolun gerçek ortam pilotu | Doğrulanmadı, Faz 17 | Canlı Auth, mesaj teslimi, mobil ve ortak işlem zinciri doğrulanacak |

## Branch / PR notu

- `phase-3-services-team` → `phase-8-calendar` çalışmaları squash commit'lerle main'e alınmış. Eski branch'lerde farklı commit geçmişi görünmesi tek başına eksik merge değildir.
- `phase-2-auth-tenant`, `1e58648` Faz 1 commit'inde kalmış. Main'in auth/tenant kodu bu eski branch'in durumundan çıkarılamaz.
- `phase-9-email-delivery`: [PR #8](https://github.com/ziyabeey1-ai/randevu/pull/8), açık taslak; incelenen head `9b5a6ceab648c70b8c892d831d041021d8568e37`.
- Başka oturumdan kalan yerel `codex/faz-2-auth-tenants` değişiklikleri kaydedilip gönderilmiş değildir ve güncel main'den farklı veri/auth yaklaşımı taşır. Yeni iş güncel main üzerinden yürür; eski yerel çalışma doğrudan birleştirilmez.
- **Sıradaki uygulama işi Faz 9'un tamamlanmasıdır.** Bu dokümanların main'e alınması Faz 9'u veya sonraki fazları tamamlamaz.

## İncelemeden kalan işler

Bu maddeler 11 Eylül kod incelemesinin açık bulgularıdır; giderilince ilgili PR ve doğrulama kanıtıyla güncellenir.

| Bulgu | Etki | Faz |
| --- | --- | --- |
| Rezervasyon ve yönetim bağlantısı ayrı istek; bağlantı hatasında başarı ekranı açılmayabiliyor | Kayıt oluştuğu halde müşteri hata görür; yenileme sonrası kurtarma eksik | 9 |
| Taslak e-posta işi kullanıcı isteğinde bekliyor; kalıcı otomatik yeniden deneme yok | Yavaş/kesilen sağlayıcı müşteri sonucunu ve bağlantı teslimini etkiler | 9 |
| Taslak gönderim kaydı RPC'si, rezervasyon oluşturma anahtarına sahip anon istemciye açık | Kendi rezervasyonuna gerçek sağlayıcı gönderimi olmadan kayıt yazılabilir | 9 |
| Public oluşturma için uygulama/RPC düzeyinde kötüye kullanım kontrolü görülmedi | Otomatik isteklerle saatlerin doldurulması ele alınmalı | 9 |
| Personel kaydı üyelik/davet üretmiyor; parola kurtarma ve işletme geçişi UI'sı eksik | Çok kullanıcılı günlük kullanım tamamlanmış değil | 10 |
| Auth/istek yardımcıları Worker modüllerinde tekrarlanıyor; hata/Origin/CSRF davranışı merkezi değil | Oturum ve güvenlik düzeltmeleri birlikte uygulanmalı | 10 |
| Takvimde otomatik güncelleme ve eski yanıt koruması yok | Public/diğer çalışan işlemleri geç veya yanlış seçimde görünebilir | 13 |
| Bazı ekranlarda Faz 3/tenant/StaffService metinleri ve eksik düzenleme kontrolleri var | Ürün dili ve operasyon kullanımı tamamlanmalı | 10, 12–14 |
| Proje notunda 4 high-severity dependency audit uyarısı raporlandı | Ayrı bakım PR'ında güncel advisory/etki doğrulanıp kapatılmalı | Pilot öncesi; en geç 17 |

## Mevcut tarayıcı yolları

| Yol | Uygulanan işlev / dosya |
| --- | --- |
| `/calendar` | Gün/hafta takvimi — `src/CalendarPage.tsx` |
| `/bookings` | Randevu oluşturma/taşıma/durum — `src/BookingPage.tsx` |
| `/availability` | Mesai/kapanış/müsaitlik — `src/AvailabilityPage.tsx` |
| `/` | Giriş, işletme, hizmet ve ekip — `src/App.tsx` |
| `/public-booking` | Halka açık rezervasyon ayarları — `src/PublicBookingSettingsPage.tsx` |
| `/r/:slug` | Müşteri rezervasyonu — `src/PublicBookingPage.tsx` |
| `/m#<token>` | Müşteri yönetimi — `src/ManageAppointmentPage.tsx` |

SalonApp/adisyon için çalışan yeni bir yol henüz yok. Yeni route/menü haritası ilgili fazda bu tabloya eklenir; mevcut bağlantılar korunur.

## Worker ve migration haritası

`worker/app.ts` feature router'larını birleştirir: `index.ts` auth/işletme/katalog; `availability.ts` müsaitlik; `bookings.ts` işlemler; `public-booking.ts` public rezervasyon; `customer-manage.ts` bağlantıyla yönetim; `calendar.ts` takvim okuması.

Main'deki migration sırası:

```text
20260911090000_phase2_auth_tenancy.sql
20260911100000_phase3_services_team.sql
20260911110000_phase4_availability.sql
20260911120000_phase5_booking_core.sql
20260911121000_phase5_booking_hardening.sql
20260911130000_phase6_public_booking.sql
20260911140000_phase7_customer_manage.sql
20260911150000_phase8_calendar.sql
```

Dosyalar `supabase/migrations/` altındadır. Faz 9 e-posta migration'ı taslak PR'dadır; main'de uygulanmış zincire eklenmiş sayılmaz. Birleştirilmiş migration'lar değişmez; yeni modeller ileri migration ile eklenir.

## Doğrulama kanıtı ve sınırı

- [Main CI](https://github.com/ziyabeey1-ai/randevu/actions/runs/34590092465): `7c78be8`, başarılı.
- [Faz 9 PR CI](https://github.com/ziyabeey1-ai/randevu/actions/runs/34591337311): `9b5a6ce`, başarılı; PR yine taslaktır.
- Kapsam: `npm ci`, TypeScript, üretim derlemesi; PostgreSQL 17 üzerinde migration'lar ve Faz 3–8 (taslak PR'da 3–9) SQL gerileme testleri.
- SQL testleri yerel Auth fixture'ı kullanır. Gerçek Supabase kayıt/giriş, canlı sağlayıcı teslimi ve uçtan uca tarayıcı/mobil zinciri bu kontrollerin kanıtladığı kapsam değildir.
- İnceleme sırasında erişilebilen hesapta projeye bağlı aktif Supabase ortamı doğrulanamadı. Bu, başka bir hesapta ortam bulunmadığı iddiası değildir.

Her PR aynı zorunlu build/SQL kapısını geçer. Yeni faz tamamlanınca bu dosya gerçek merge ve kabul kanıtlarıyla güncellenir; yeni kapsam hazırmış gibi yalnız faz numarası artırılmaz.
