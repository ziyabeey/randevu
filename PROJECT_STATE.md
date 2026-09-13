# YZT Randevu — Mevcut durum

**Kontrol: 13 Eylül 2026.** Plan v3 ürün ve teknik sıra kaynağıdır. Canlı görev/sahiplik [TASKS.md](TASKS.md), bağımlılık sırası [ROADMAP.md](ROADMAP.md), ürün sınırı [PRODUCT_SPEC.md](PRODUCT_SPEC.md), stabilization kapanış fişi [docs/handoffs/GS.md](docs/handoffs/GS.md) içindedir.

## Devam noktası

**GS stabilization kapısı kapalıdır.** S01…S08 kendi kabul ölçütleriyle tamamlandı. Kapanış öncesi doğrulanmış main `ec8f307d1bb8d217990c71433d28324c1b27c489`; bu docs-only kapanış turu runtime veya migration davranışını değiştirmez.

Son iki stabilization kabulü:

- **S07 tamamlandı.** C1 retention, C2 pagination/DB budget/snapshot bounds, C3 load ölçümü ve C4 gerçek staging zinciri main'dedir. Final C4 kabul head'i `61b6a2a8ae79dd83b59b1d3b88f354f9fc5bb06e`; [CI #512](https://github.com/ziyabeey1-ai/randevu/actions/runs/34772317665) ve [Staging deploy #23](https://github.com/ziyabeey1-ai/randevu/actions/runs/34772665661) başarılıdır. #23 routine deploy → F09 → F10 → gerçek S01 mailbox/PKCE → S07 retention/pagination/snapshot/load zincirini geçti; iki load workload'unda `errors=0`, final DB readback'te `pending=0` ve Worker source commit exact head ile eşleşti. [PR #60](https://github.com/ziyabeey1-ai/randevu/pull/60) main merge commit'i `4f928de0983e3f0c19b6eaa361d0a9ac6223d998`; merge sonrası main CI #514 başarılıdır.
- **S08 tamamlandı.** Future `public` table/view, sequence ve function object ACL'leri API rolleri için deny-by-default yapılmıştır. [PR #64](https://github.com/ziyabeey1-ai/randevu/pull/64) implementation head'i `67e9b46789ae1006aa04ad8c7ad6631c9fc4d851`; exact-head [CI #520](https://github.com/ziyabeey1-ai/randevu/actions/runs/34775018893), merge commit `ec8f307d1bb8d217990c71433d28324c1b27c489` ve merge sonrası [main CI #521](https://github.com/ziyabeey1-ai/randevu/actions/runs/34776825842) başarılıdır. [Staging deploy #24](https://github.com/ziyabeey1-ai/randevu/actions/runs/34777601528) bu exact main üzerinde S08 migration'ını gerçek staging DB'ye uyguladı. Migration sonrası hosted `pg_default_acl` readback'te `current_user=session_user=postgres` ve hedeflenen yasak `anon`/`authenticated` default grant sayısı **0** çıktı.

GS'nin ayrıntılı kanıt zinciri ve kabul sınırları [GS devir kaydında](docs/handoffs/GS.md) sabittir. Tamamlanan stabilization işleri yeni bir bulgu nedeniyle geriye dönük olarak genişletilmez; yeni iş gerçek ürün/operasyon sahibine taşınır.

## GS sonrası aktif sıra

1. **F12-01 / PR #61:** tasarım sözleşmesi teknik GS kapısından tarihsel olarak muaftı ve taslakta hazırlandı. S08/GS main'i ilerlediği için branch kapanış main'ine yeniden taşınmalı; yalnız F12-01 satırı korunmalı; exact-head docs CI sonrası koordinatör son ürün/tasarım incelemesi ve merge kararı verir.
2. **F10-02 / PR #32:** mevcut sahiplik korunur. GS engeli kalkmıştır. Ayrı ikinci branch açılmaz; mevcut branch güncel GS-kapalı main'e taşınıp devir kaydı yenilendikten sonra davet/üyelik/rol uygulamasına devam edilir.
3. F10-02 kabulünden sonra **F10-03**. Ardından bağımlılık uygunsa **F10-04 ve F10-05** paralel ilerleyebilir.
4. GS sonrası paralellik 2–3 dependency-safe lane ile açılır; ortak SQL/router/CI alanlarında tek-yazıcı kuralı korunur. Bütün ürün fazları aynı anda başlatılmaz.

## Doğrulanmış teknik temel

| Alan | Main'deki doğrulanmış durum | Sonraki ürün/operasyon işi |
| --- | --- | --- |
| React/Vite/TypeScript + Worker/Hono | Tek uygulama/backend korunuyor | Mimariyi gereksiz büyütme |
| Auth + Business/Membership + RLS | F10-01 + S01/S02; gerçek recovery/PKCE, refresh, tenant ve cookie mutation sınırı doğrulandı | F10-02 ekip/davet/rol, F10-03 kurulum |
| Hizmet/personel/eşleştirme | Faz 3 temel tabloları ve mevcut katalog main'de | F10-04 yönetim; F12-03 kategori/fiyat |
| Mesai/kapanış/timezone | Faz 4 mevcut | F11 çok-hizmet uyumu |
| Booking/customer/audit/idempotency | Faz 5 + F09 + S07 v2 recovery; bounded list/read yolları | F11 grup modeli; F13 güncellik/listeler |
| Public booking/manage capability | Faz 6–7 + F09/S04/S07 | F12 müşteri yüzeyi |
| Takvim | Gün/hafta temeli mevcut; S07 DB bütçesi/sessiz kırpma sınırı uygulandı | F13 yarış/güncellik, gün/hafta/liste UX |
| Bildirim outbox | F09-03/05 + S03 + S07 retention/timeout | F16-02 hatırlatma/SMS/lifecycle |
| Abuse/resource bounds | S04 kotaları + S07 runtime/read sınırları | Gerçek production/pilot gözlemi F17-03/05 |
| Staging/deploy/CI | F17-01/02 + S05/S06; routine/rotation, required CI ve main ruleset doğrulandı | F17-03 yayın/rollback/backup gözlemi |
| Future DB ACL | S08; `anon`/`authenticated` future object default grants hosted staging'de 0 | Yeni migration'larda explicit grant + RLS; exposed-schema takibi F17-03 |
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

## Adlandırılmış açık takipler

Bunlar **GS'yi yeniden açmaz**.

### F17-03 — yayın/operasyon hardening

- S07 C4 routine deploy'da tam acceptance istenmiyorsa görünür `S07_C4_SKIPPED reason=...` receipt'i üretmeli; truth-table testi receipt string'ini de assert etmeli. Explicit C4 intent + eksik alt gate fail-closed olmalı.
- S07 DB runner diagnostikleri secret/URI redaksiyonunu koruyan bounded tail vermeli ve timeout / ENOBUFS / spawn / psql exit / SQL assertion ayrımını yapmalı.
- S08 gate'in `postgres` creator rolüne dayandığı ve Supabase exposed schema listesi `public` dışına genişlerse yeni schema'nın ayrıca kapatılması gerektiği yayın kontrol listesinde doğrulanmalı.

### F13-01 / F13-02 — mutable-key pagination ve liste güncelliği

S07 keyset kabulü, dışarıdan eşzamanlı sıralama-anahtarı mutasyonu olmayan veri kümesinde `(timestamp,id)` ile atlama/tekrar olmadan ilerler. Sayfalar arasında `starts_at`/`created_at` değişirse snapshot-consistency garantisi verilmez. Gerçek eşzamanlı yazar testi ve gün/hafta/liste tarih aralığı semantiği F13-01/F13-02'de tamamlanır; C4 rollback paketine dblink commit testi eklenmez.

### S08 kapsam sınırları

- Default ACL creator-role scoped'dur; hosted migration oturumu bugün `postgres` olarak doğrulandı.
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

Bu GS closeout docs PR'ı exact-head docs CI'dan geçip main'e birleşsin. Ardından merge sırasındaki **F12-01 / PR #61** güncel GS-kapalı main'e taşınarak son ürün/tasarım incelemesine alınır. Sonrasında mevcut sahipliği korunan **F10-02 / PR #32** güncel main'e taşınır ve uygulama devam eder.
