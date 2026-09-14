# YZT Randevu — Mevcut durum

**Kontrol: 14 Eylül 2026.** Plan v3 ürün ve teknik sıra kaynağıdır. Canlı görev/sahiplik [TASKS.md](TASKS.md), bağımlılık sırası [ROADMAP.md](ROADMAP.md), ürün sınırı [PRODUCT_SPEC.md](PRODUCT_SPEC.md), stabilization kapanış fişi [docs/handoffs/GS.md](docs/handoffs/GS.md) içindedir.

## Devam noktası

**GS stabilization kapısı kapalıdır ve F10-02 tamamlanmıştır.** S01…S08 kendi kabul ölçütleriyle tamamlandı; F12-01 ürün/tasarım sözleşmesi ve F10-02 davet/üyelik/rol teslimi main'dedir. Güncel doğrulanmış main: `4d07cb07d6cf2e6815ec83edc0dad31ad855ccdd`; merge sonrası [main CI #616](https://github.com/ziyabeey1-ai/randevu/actions/runs/34825489625) başarılıdır.

Son kabul edilen ürün teslimleri:

- **F12-01 tamamlandı.** Görsel yön ve akış sözleşmesi [PR #61](https://github.com/ziyabeey1-ai/randevu/pull/61) ile main'e girdi. SalonApp sabit alt menü sırası `Randevular / Adisyonlar / Yeni / Müşteriler / Diğer` olarak bağlayıcıdır; desktop-shell esnekliği yalnız Randevu Paneli içindir. Çalışan müşteri paneli teslimi değildir; sonraki F12 işleri kendi bağımlılıklarını bekler.
- **F10-02 tamamlandı.** [PR #32](https://github.com/ziyabeey1-ai/randevu/pull/32) merge commit'i `4d07cb07d6cf2e6815ec83edc0dad31ad855ccdd`'dir. Implementation/staging kabul head'i `958bb27debe72f23c801ee7985ad8480fd1ed600`; [CI #613](https://github.com/ziyabeey1-ai/randevu/actions/runs/34823672970) ve [Staging deploy #30](https://github.com/ziyabeey1-ai/randevu/actions/runs/34824049900) başarılıdır. İki gerçek Auth hesabıyla invite binding/replay/revoke/expiry, tenant sınırı, rol ve mali izinler, StaffProfile↔Membership link, live deactivation ve last-owner race doğrulandı. Ajan A final bağımsız güvenlik + DB/access incelemesinde **ACCEPTABLE** verdi. Acceptance-marker head `92e232898ed81a050e95fee6fab6ea54c8072e47` için [CI #615](https://github.com/ziyabeey1-ai/randevu/actions/runs/34825241482) başarılıdır.

F10-02 staging teşhisinde hosted Auth/JWT, RLS ve object grant'ların doğru olduğu; `/api/session` hatasının PostgREST ilişki ambiguity'sinden kaynaklandığı kanıtlandı. Aktif session snapshot sorgusu doğrudan `memberships_business_id_fkey` ilişkisini seçer ve regresyon testi bunu kilitler. Auth/recovery authority, grant veya RLS sınırı gevşetilmedi.

GS'nin ayrıntılı kanıt zinciri ve kabul sınırları [GS devir kaydında](docs/handoffs/GS.md) sabittir. Tamamlanan işler yeni bir bulgu nedeniyle geriye dönük olarak genişletilmez; yeni iş gerçek ürün/operasyon sahibine taşınır.

## Aktif sıra

1. **F10-03 — İşletme geçişi ve kurulum akışı:** F10-02 main'de tamamlandığı için başlangıç kapısı açıktır. Ajan C için makro paket ayrılmıştır. Güncel main'den claim/branch açılır; ikinci işletme, yetkili işletme seçimi, onboarding `işletme → hizmet → personel → çalışma saatleri → önizleme → yayın`, owner-as-staff, incomplete resume ve stale tenant-state izolasyonu teslim edilir.
2. **F10-04 / F10-05 / F12-02:** F10-03 main'de `Tamamlandı` olana kadar feature branch/claim açılmaz. F10-03 kabulünden sonra C:F10-04, A:F10-05 ve B:F12-02 dependency-safe biçimde paralel açılabilir.
3. Diğer ürün işleri yalnız TASKS/ROADMAP bağımlılıkları sağlandıkça açılır. Ortak SQL/router/CI alanlarında tek-yazıcı veya açık merge sırası korunur; bütün fazlar aynı anda başlatılmaz.

## Doğrulanmış teknik temel

| Alan | Main'deki doğrulanmış durum | Sonraki ürün/operasyon işi |
| --- | --- | --- |
| React/Vite/TypeScript + Worker/Hono | Tek uygulama/backend korunuyor | Mimariyi gereksiz büyütme |
| Auth + Business/Membership + RLS | F10-01 + S01/S02 + F10-02; recovery/PKCE, refresh, cookie mutation, invite/rol/mali izin, live deactivation ve last-owner sınırı gerçek staging'de doğrulandı | F10-03 işletme geçişi/onboarding |
| Hizmet/personel/eşleştirme | Faz 3 temel tabloları ve mevcut katalog main'de; Membership ile StaffProfile ayrımı F10-02'de korunuyor | F10-03 owner-as-staff/onboarding; F10-04 yönetim; F12-03 kategori/fiyat |
| Mesai/kapanış/timezone | Faz 4 mevcut | F10-03 publish readiness; F10-04 ayarlar; F11 çok-hizmet uyumu |
| Booking/customer/audit/idempotency | Faz 5 + F09 + S07 v2 recovery; bounded list/read yolları | F10-05 müşteri kayıtları; F11 grup modeli; F13 güncellik/listeler |
| Public booking/manage capability | Faz 6–7 + F09/S04/S07; F10-02 session embed FK ilişkisi explicit | F10-03 fail-closed publish readiness; F12 müşteri yüzeyi |
| Takvim | Gün/hafta temeli mevcut; S07 DB bütçesi/sessiz kırpma sınırı uygulandı | F13 yarış/güncellik, gün/hafta/liste UX |
| Bildirim outbox | F09-03/05 + S03 + S07 retention/timeout | F16-02 hatırlatma/SMS/lifecycle |
| Abuse/resource bounds | S04 kotaları + S07 runtime/read sınırları | Gerçek production/pilot gözlemi F17-03/05 |
| Staging/deploy/CI | F17-01/02 + S05/S06; routine/rotation, required CI ve main ruleset doğrulandı; F10-02 staging #30 + main CI #616 yeşil | F17-03 yayın/rollback/backup gözlemi |
| Future DB ACL | S08; `anon`/`authenticated` future object default grants hosted staging'de 0 | Yeni migration'larda explicit grant + RLS; exposed-schema takibi F17-03 |
| Görsel yön | F12-01 main'de; üç ürün kolu ve bağlayıcı SalonApp alt menü sözleşmesi mevcut | F12-02+ uygulama |
| SalonApp/adisyon/tahsilat | Henüz ürün uygulaması yok | F14 |
| Ürün/stok/masraf/kasa | Henüz ürün uygulaması yok | F15 |
| Paket/promosyon/prim/fotoğraf/yorum/dil | Planlandı | F16 |
| Kontrollü pilot | Yapılmadı | F17-04/05; staging yeşili pilot kabulü değildir |

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

## Adlandırılmış açık takipler

Bunlar **GS'yi veya tamamlanmış F10-02'yi yeniden açmaz**.

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

**F10-03 — İşletme geçişi ve kurulum akışı** güncel main'den Ajan C tarafından claim edilip tam makro paket olarak yürütülür. F10-04, F10-05 ve F12-02 F10-03 main'de `Tamamlandı` olmadan başlamaz.
