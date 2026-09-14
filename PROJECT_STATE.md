# YZT Randevu — Mevcut durum

**Kontrol: 14 Eylül 2026.** Plan v3 ürün ve teknik sıra kaynağıdır. Canlı görev/sahiplik [TASKS.md](TASKS.md), bağımlılık sırası [ROADMAP.md](ROADMAP.md), ürün sınırı [PRODUCT_SPEC.md](PRODUCT_SPEC.md), stabilization kapanış fişi [docs/handoffs/GS.md](docs/handoffs/GS.md) içindedir.

## Devam noktası

**GS stabilization kapısı kapalıdır; F10-02 ve F10-03 tamamlanmıştır.** S01…S08 kendi kabul ölçütleriyle tamamlandı; F12-01 ürün/tasarım sözleşmesi, F10-02 davet/üyelik/rol teslimi ve F10-03 işletme geçişi/onboarding akışı main'dedir. F10-03 feature merge commit'i `0be2a5bdd857fe95625ea56374aab6cb3fbdbd24`; merge sonrası [main CI #643](https://github.com/ziyabeey1-ai/randevu/actions/runs/34834526885) başarılıdır.

Son kabul edilen ürün teslimleri:

- **F12-01 tamamlandı.** Görsel yön ve akış sözleşmesi [PR #61](https://github.com/ziyabeey1-ai/randevu/pull/61) ile main'e girdi. SalonApp sabit alt menü sırası `Randevular / Adisyonlar / Yeni / Müşteriler / Diğer` olarak bağlayıcıdır; desktop-shell esnekliği yalnız Randevu Paneli içindir. Çalışan müşteri paneli teslimi değildir; sonraki F12 işleri kendi bağımlılıklarını bekler.
- **F10-02 tamamlandı.** [PR #32](https://github.com/ziyabeey1-ai/randevu/pull/32) merge commit'i `4d07cb07d6cf2e6815ec83edc0dad31ad855ccdd`'dir. Implementation/staging kabul head'i `958bb27debe72f23c801ee7985ad8480fd1ed600`; [CI #613](https://github.com/ziyabeey1-ai/randevu/actions/runs/34823672970) ve [Staging deploy #30](https://github.com/ziyabeey1-ai/randevu/actions/runs/34824049900) başarılıdır. İki gerçek Auth hesabıyla invite binding/replay/revoke/expiry, tenant sınırı, rol ve mali izinler, StaffProfile↔Membership link, live deactivation ve last-owner race doğrulandı. Ajan A final bağımsız güvenlik + DB/access incelemesinde **ACCEPTABLE** verdi. Acceptance-marker head `92e232898ed81a050e95fee6fab6ea54c8072e47` için [CI #615](https://github.com/ziyabeey1-ai/randevu/actions/runs/34825241482) başarılıdır.
- **F10-03 tamamlandı.** [PR #72](https://github.com/ziyabeey1-ai/randevu/pull/72) ile ikinci işletme oluşturma/seçme, `/setup` onboarding, owner-as-staff, stale tenant-state izolasyonu ve fail-closed public readiness main'e girdi. Repair code head `d8bf7296269ce048e21c39c08f1eb67963dcda94` için [CI #638](https://github.com/ziyabeey1-ai/randevu/actions/runs/34832424294), bağımsız review head `5e51681d4071088c6846aa8ed628b23058bae1b4` için [CI #640](https://github.com/ziyabeey1-ai/randevu/actions/runs/34832787839), acceptance-marker head `ab0413bc8c27e57758de95e707271887fba73a56` için [CI #642](https://github.com/ziyabeey1-ai/randevu/actions/runs/34834272453) ve merge sonrası main CI #643 başarılıdır. Ajan A final security + DB/access incelemesinde **ACCEPTABLE — blocker yok** verdi; DANIŞMA 2 final kabulü verdi.

F10-02 staging teşhisinde hosted Auth/JWT, RLS ve object grant'ların doğru olduğu; `/api/session` hatasının PostgREST ilişki ambiguity'sinden kaynaklandığı kanıtlandı. Aktif session snapshot sorgusu doğrudan `memberships_business_id_fkey` ilişkisini seçer ve regresyon testi bunu kilitler. Auth/recovery authority, grant veya RLS sınırı gevşetilmedi.

F10-03'te onboarding ilerlemesi ayrı wizard tablosu yerine gerçek hizmet/personel/eşleşme/mesai durumundan türetilir. Onboarding snapshot, S07 katalog sınırlarını kullanan bounded DB RPC üzerinden atomik okunur; 101 business-hours / 5001 staff-hours taşması partial success değildir. Aynı readiness otoritesi public business/services/staff/slots ve public appointment create zincirini fail-closed kapatır. Saved `enabled=true` tercihi readiness kaybında sessizce değiştirilmez; yapı düzelene kadar public erişim kapanır. Worker service-role veya yeni yetki modeli eklenmedi.

GS'nin ayrıntılı kanıt zinciri ve kabul sınırları [GS devir kaydında](docs/handoffs/GS.md) sabittir. Tamamlanan işler yeni bir bulgu nedeniyle geriye dönük olarak genişletilmez; yeni iş gerçek ürün/operasyon sahibine taşınır.

## Aktif sıra

1. **Üç paralel dependency-safe lane açıktır:**
   - **Ajan C — F10-04: Hizmet, personel ve çalışma ayarları.** F10-03 main'de tamamlandığı için başlayabilir. Mevcut katalog/availability/F10-03 setup sözleşmesini genişletir; ikinci katalog veya mesai motoru kurmaz.
   - **Ajan A — F10-05: İşletmenin müşteri kayıtları.** F10-03 main'de tamamlandığı için başlayabilir. Tenant-scoped müşteri arama/listeleme/oluşturma/düzenleme/iletişim + randevu geçmişi; duplicate ve pagination negatifleriyle teslim edilir.
   - **Ajan B — F12-02: Salon profili ve public fotoğraflar.** F12-01 + F10-03 tamamlandığı için başlayabilir. Profil/public medya sözleşmesi, tenant auth, boyut/tip/count, unpublished/fallback ve orphan cleanup sınırlarıyla teslim edilir. Gerçek marka/fotoğraf varlığının eksikliği güvenli placeholder ile işlevsel uygulamayı engellemez; final gerçek-varlık kabulü ayrıca kaydedilir.
2. **Sonraki bağımlılıklar:** F10-06, F10-04 + F10-05 tamamlanmasını bekler. F12-03, F10-04'ü bekler. F12-04, F12-02 + F12-03 + F11-02'yi bekler. Yeni görevler yalnız TASKS/ROADMAP bağımlılıkları sağlandıkça açılır.
3. Ortak SQL/router/CI alanlarında tek-yazıcı veya açık merge sırası korunur. Paralel ajanlar yalnız kendi TASKS satırına dokunur; migration/router conflict görünürse koordinatör merge sırası belirler.

## Doğrulanmış teknik temel

| Alan | Main'deki doğrulanmış durum | Sonraki ürün/operasyon işi |
| --- | --- | --- |
| React/Vite/TypeScript + Worker/Hono | Tek uygulama/backend korunuyor | Mimariyi gereksiz büyütme |
| Auth + Business/Membership + RLS | F10-01 + S01/S02 + F10-02 + F10-03; recovery/PKCE, refresh, cookie mutation, invite/rol/mali izin, live deactivation, last-owner ve business-switch authority doğrulandı | F10-04 ayarlar, F10-05 müşteri kayıtları |
| Hizmet/personel/eşleştirme | Faz 3 temel tabloları; Membership/StaffProfile ayrımı F10-02'de, owner-as-staff onboarding F10-03'te korunuyor | F10-04 tam yönetim; F12-03 kategori/fiyat |
| Mesai/kapanış/timezone | Faz 4 + F10-03 structural publish readiness | F10-04 ayarlar; F11 çok-hizmet uyumu |
| Booking/customer/audit/idempotency | Faz 5 + F09 + S07 v2 recovery; bounded list/read yolları | F10-05 müşteri kayıtları; F11 grup modeli; F13 güncellik/listeler |
| Public booking/manage capability | Faz 6–7 + F09/S04/S07; F10-03 readiness public business/services/staff/slots/create zincirini fail-closed kapatıyor | F12-02 profil/fotoğraf ve sonraki müşteri yüzeyi |
| Onboarding / işletme geçişi | F10-03 main'de; bounded snapshot, incomplete resume, owner-as-staff, A/B switch stale-state izolasyonu ve publish readiness mevcut | F10-04 yönetim yüzeyleri; F12-02 profil |
| Takvim | Gün/hafta temeli mevcut; S07 DB bütçesi/sessiz kırpma sınırı uygulandı | F13 yarış/güncellik, gün/hafta/liste UX |
| Bildirim outbox | F09-03/05 + S03 + S07 retention/timeout | F16-02 hatırlatma/SMS/lifecycle |
| Abuse/resource bounds | S04 kotaları + S07 runtime/read sınırları + F10-03 bounded onboarding | Gerçek production/pilot gözlemi F17-03/05 |
| Staging/deploy/CI | F17-01/02 + S05/S06; routine/rotation, required CI ve main ruleset doğrulandı; F10-02 staging #30; F10-03 CI #638/#640/#642 + main CI #643 yeşil | F17-03 yayın/rollback/backup gözlemi |
| Future DB ACL | S08; `anon`/`authenticated` future object default grants hosted staging'de 0; F10-03 yeni function/trigger yüzeyi explicit ACL ile kapalı | Yeni migration'larda explicit grant + RLS; exposed-schema takibi F17-03 |
| Görsel yön | F12-01 main'de; üç ürün kolu ve bağlayıcı SalonApp alt menü sözleşmesi mevcut | F12-02 profil/public fotoğraf uygulaması |
| SalonApp/adisyon/tahsilat | Henüz ürün uygulaması yok | F14 |
| Ürün/stok/masraf/kasa | Henüz ürün uygulaması yok | F15 |
| Paket/promosyon/prim/fotoğraf/yorum/dil | Planlandı | F16 |
| Kontrollü pilot | Yapılmadı | F17-04/05; staging/CI yeşili pilot kabulü değildir |

Mevcut veri erişimi Supabase HTTP/RPC'dir. pg/Hyperdrive geçişi, yeni mikroservis veya ikinci booking/mali motor bu planın parçası değildir.

## Tamamlanan stabilization kanıt dizini

| Görev | Ana teslim / kanıt |
| --- | --- |
| S01 | [PR #34](https://github.com/ziyabeey1-ai/randevu/pull/34), [devir](docs/handoffs/S01.md), gerçek staging `34704131649` |
| S02 | [PR #36](https://github.com/ziyabeey1-ai/randevu/pull/36), [devir](docs/handoffs/S02.md), CI/staging `34708432373` / `34708621675` |
| S03 | [PR #35](https://github.com/ziyabeey1-ai/randevu/pull/35), [devir](docs/handoffs/S03.md), CI/staging `34733476367` / `34733661007` attempt 2 |
| S04 | [PR #39](https://github.com/ziyabeey1-ai/randevu/pull/39), [devir](docs/handoffs/S04.md), CI/staging `34735531168` / `34737231931` |
| S05 | [PR #41](https://github.com/ziyabeey1-ai/randevu/pull/41), [devir](docs/handoffs/S05.md), CI `34742491243`, routine #18, rotate #19 |
| S06 | [PR #43](https://github.com/ziyabeey1-ai/randevu/pull/43), [devir](docs/handoffs/S06.md), CI `34753034546`, ruleset `23159972` |
| S07 | [GS devir](docs/handoffs/GS.md), C4 [PR #60](https://github.com/ziyabeey1-ai/randevu/pull/60), CI `34772317665`, staging #23 `34772665661` |
| S08 | [GS devir](docs/handoffs/GS.md), [PR #64](https://github.com/ziyabeey1-ai/randevu/pull/64), CI `34775018893`, main CI `34776825842`, staging #24 `34777601528`, hosted ACL readback |

## Tamamlanan GS sonrası kanıt dizini

| Görev | Ana teslim / kanıt |
| --- | --- |
| F12-01 | [PR #61](https://github.com/ziyabeey1-ai/randevu/pull/61), [devir](docs/handoffs/F12-01.md), final ürün/tasarım kabulü |
| F10-02 | [PR #32](https://github.com/ziyabeey1-ai/randevu/pull/32), [devir](docs/handoffs/F10-02.md), CI #613, staging #30, bağımsız Ajan A ACCEPTABLE, acceptance-marker CI #615, main CI #616 |
| F10-03 | [PR #72](https://github.com/ziyabeey1-ai/randevu/pull/72), [devir](docs/handoffs/F10-03.md), repair CI #638, review CI #640, Ajan A ACCEPTABLE, acceptance-marker CI #642, main CI #643 |

## Adlandırılmış açık takipler

Bunlar **GS'yi veya tamamlanmış F10-02/F10-03 kartlarını yeniden açmaz**.

### F17-03 — yayın/operasyon hardening

- S07 C4 routine deploy'da tam acceptance istenmiyorsa görünür `S07_C4_SKIPPED reason=...` receipt'i üretmeli; truth-table testi receipt string'ini de assert etmeli. Explicit C4 intent + eksik alt gate fail-closed olmalı.
- S07 DB runner diagnostikleri secret/URI redaksiyonunu koruyan bounded tail vermeli ve timeout / ENOBUFS / spawn / psql exit / SQL assertion ayrımını yapmalı.
- S08 gate'in `postgres` creator rolüne dayandığı ve Supabase exposed schema listesi `public` dışına genişlerse yeni schema'nın ayrıca kapatılması gerektiği yayın kontrol listesinde doğrulanmalı.

### F13-01 / F13-02 — mutable-key pagination ve liste güncelliği

S07 keyset kabulü, dışarıdan eşzamanlı sıralama-anahtarı mutasyonu olmayan veri kümesinde `(timestamp,id)` ile atlama/tekrar olmadan ilerler. Sayfalar arasında `starts_at`/`created_at` değişirse snapshot-consistency garantisi verilmez. Gerçek eşzamanlı yazar testi ve gün/hafta/liste tarih aralığı semantiği F13-01/F13-02'de tamamlanır; C4 rollback paketine dblink commit testi eklenmez.

### S08 kapsam sınırları

- Default ACL creator-role scoped'dur; hosted migration oturumu `postgres` olarak doğrulandı.
- Global future function `PUBLIC EXECUTE` revoke schema-scoped değildir ve `postgres` tarafından başka schema'da yaratılan future function'ları da etkiler.
- S08 deny-by-default garantisi API rolleri `anon`/`authenticated` içindir; `service_role` bilinçli kapsam dışıdır.

## Ortam ve korunacak sınırlar

- Doğrulanmış staging origin: `https://yzt-randevu-staging.ziyabeey1.workers.dev`.
- Hedef production `randevu.kepenk.ai`, staging custom domain `staging.randevu.kepenk.ai`, sender `randevu@notify.kepenk.ai`. Bunlar production/pilot hazır kanıtı değildir.
- Runtime secret/config değerleri Git'e yazılmaz. Worker service-role veya acceptance-admin key taşımaz.
- Outbox provider kabulü `delivered` ile aynı değildir; S03'ün provider idempotency sınırı dışındaki belirsiz tekrar davranışı korunur.
- S07 retention müşteri/randevu ana kaydını otomatik silmez; terminal operasyonel PII/recovery materyali için tanımlı temizliği uygular.
- S08 future nesne erişimi explicit grant ve table/view için ayrıca RLS/policy gerektirir.

## Ürün sınırı

Üç ürün kolu korunur: **Müşteri Paneli**, **Randevu Paneli**, **SalonApp**. MVP Faz 17 sonunda biter. “Future Plan” PDF ayrı teslimdir ve repoya eklenmez.

## Sonraki somut adım

F10-03 tamamlandığı için aynı kanonik main'den üç bağımsız lane açılır: **Ajan C → F10-04**, **Ajan A → F10-05**, **Ajan B → F12-02**. Her ajan atomik claim + kendi branch'i + yalnız kendi TASKS satırı ile çalışır; draft PR, exact-head CI, handoff ve bağımsız/koordinatör review kuralı korunur.
