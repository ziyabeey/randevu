# YZT Randevu — Doğrulanmış mevcut durum

**Kontrol: 14 Eylül 2026.** Bu dosya yalnız main'de doğrulanmış durumu ve aktif entegrasyon sınırını tutar. Canlı görev/sahiplik `TASKS.md`, bağımlılıklar `ROADMAP.md`, koordinasyon/conflict/staging kararları Issue #65 içindedir.

## Güncel main

Doğrulanmış main: **`7056c5a560bb55de84a1618b62efca214e9dd8b8`**.

- PR #69 brand/motion docs bu commit ile main'e girdi.
- Merge sonrası **CI #664 / run `34837710783` success**.
- PR #69 runtime veya MVP task davranışı değiştirmedi; yalnız `docs/brand/**` ekledi.

Önceki ana ürün kapanışları:

- **GS / S01…S08:** tamamlandı.
- **G09 / F09-01…05:** tamamlandı.
- **F10-01:** ortak oturum/parola akışları tamamlandı.
- **F10-02:** davet/üyelik/rol, mali izinler, deactivation/last-owner sınırı tamamlandı; staging #30 + bağımsız security/DB review geçti.
- **F10-03:** ikinci işletme, `/setup` onboarding, owner-as-staff, bounded onboarding snapshot, tenant switch stale-state izolasyonu ve fail-closed public readiness tamamlandı; PR #72 merge + Ajan A final review geçti.
- **F12-01:** görsel yön/akış sözleşmesi tamamlandı.
- **F17-01/02:** staging ve CI temeli tamamlandı.

Tam tarihsel kanıtlar `TASKS.md` ve `docs/handoffs/**` içindedir; burada tekrar kopyalanmaz.

## Main'deki doğrulanmış teknik temel

| Alan | Doğrulanmış durum | Sonraki iş |
| --- | --- | --- |
| Auth / Membership / tenant | F10-01 + S01/S02 + F10-02/03; recovery normal tenant authority kazanamaz; business switch Membership ile doğrulanır | F10-04 / F10-05 |
| Hizmet / personel / eşleşme | Faz 3 temeli + F10-03 owner-as-staff; StaffProfile ile Membership ayrı kimlikler | F10-04, sonra F12-03 |
| Mesai / availability | Faz 4 + F10-03 structural publish readiness | F10-04, F11 |
| Booking / customer snapshot / audit | Faz 5 + F09 + S07; geçmiş snapshot ve idempotency sınırları korunur | F10-05, F11, F13 |
| Public booking | Faz 6–7 + F09/S04/S07; F10-03 readiness business/services/staff/slots/create yüzeylerini fail-closed kapatır | F12-02+ |
| Onboarding / business switch | F10-03 main'de; gerçek domain state'inden resume, bounded snapshot, A/B stale-state izolasyonu | F10-04 / F12-02 |
| Takvim | Gün/hafta temeli mevcut | F13 |
| Bildirim / outbox | F09-03/05 + S03 + S07 | F16-02 |
| Kaynak limitleri | S04 quota + S07 runtime/read budgets + F10-03 bounded onboarding | F11/F13/F17-03 takipleri |
| CI / staging | F17-01/02 + S05/S06; required CI gate ve staging rollback/rotation temeli | F17-03 |
| Future DB ACL | S08; yeni nesnelerde explicit grant/RLS disiplini | Her yeni migration + F17-03 |
| Görsel ürün sözleşmesi | F12-01 main'de | F12-02+ |
| Marketing brand/motion | PR #69 ile `docs/brand/**` main'de; scroll-scrub video + gerçek DOM UI production yönü onaylı | MKT-01 / PR #77 |
| SalonApp / adisyon / tahsilat | Henüz ürün uygulaması yok | F14 |
| Ürün / stok / masraf / kasa | Henüz ürün uygulaması yok | F15 |
| Paket / promosyon / prim / yorum / dil | Planlandı | F16 |
| Kontrollü pilot | Yapılmadı | F17-04/05 |

## Aktif branch / PR'lar — henüz main değildir

Aşağıdaki işler aktif olsa da bu dosyanın doğrulanmış-main tablosuna dahil değildir:

### PR #74 — F10-05 / Ajan A

`f10-05-business-customers`

- tenant-scoped müşteri arama/listesi,
- K03 pagination,
- create/edit + duplicate/concurrency sınırı,
- appointment snapshot geçmişi,
- `/customers` UI ve stale tenant-response koruması,
- auth/ACL negatifleri.

Draft PR'dır. Exact-head CI + bağımsız review + coordinator kabulü olmadan main sayılmaz.

### PR #75 — F10-04 / Ajan C

`f10-04-catalog-hours-management`

- guarded service/staff/assignment yönetimi,
- mesai/kapanış ayarları,
- stale write / archive davranışı,
- F10-03 readiness ile uyum,
- `/availability` yönetim yüzeyi.

Draft PR'dır. `worker/app.ts` ve `src/main.tsx` F10-05 lane'ine bırakılmıştır.

### PR #76 — F12-02 / Ajan B

`f12-02-salon-profile-public-media`

- salon profil alanları,
- public medya/Storage yaşam döngüsü,
- 5 MB/input ve 20 public görsel sınırı,
- content/type doğrulaması,
- unpublished/readiness fail-closed,
- orphan cleanup ve fallback,
- F12-01 responsive/a11y sözleşmesi.

Draft PR'dır. Gerçek marka/fotoğraf varlıklarının eksikliği işlevsel kodu engellemez; final gerçek-varlık kabulü ayrıca kaydedilir.

### PR #77 — MKT-01 / ChatGPT-Sol

`mkt-01-scroll-motion-homepage`

İlk izole marketing slice'ı:

- `src/marketing/**` floating nav + `Randevu kolay.` hero shell,
- sticky transformation stage,
- native scroll progress → deterministic video scrub,
- Frame 05–08 DOM story overlay'leri,
- mobile crop,
- reduced-motion / video-failure fallback,
- production motion asset path contract.

PR #77 bilinçli olarak `src/main.tsx`, `src/App.tsx`, `TASKS.md`, worker/DB/migration alanlarına dokunmaz. Route/entry entegrasyonu shared-file sırası açılınca yapılır. Draft PR'dır; gerçek motion binary + browser smoke tamamlanmadan main sayılmaz.

## Aktif entegrasyon sırası

F10-04 ve F10-05 `scripts/ci-postgres-plan.json` ortak alanına ihtiyaç duyuyor.

1. **F10-05 / PR #74** CI-plan tek-yazıcısı olarak önce entegre edilir.
2. #74 kabul+merge sonrası **F10-04 / PR #75** yeni main'e taşınır ve yalnız kendi CI-plan adımı eklenir.
3. F12-02 bağımsız ilerler; ortak migration/router/CI alanına girerse Issue #65'te sıra belirlenir.
4. MKT-01 / PR #77 `src/marketing/**` içinde izole kalır; ortak `src/main.tsx` / `src/App.tsx` route bağlantısı aktif entry yazıcısı kapandıktan sonra coordinator sırasıyla yapılır.

Bu sıra ürün önceliği değil conflict önleme sırasıdır.

## Marketing / site track

**MKT-01 / Issue #70 aktif ve ürün sahibi onaylıdır.** 54 MVP ürün/teknik görevinin dışında ayrı bir marketing track'idir. Bağlayıcı tasarım kaynağı `docs/brand/**` ve PR #69'dur; ilk implementation slice'ı PR #77'dir.

Güncel production yönü:

- sticky/pinned stage,
- deterministik scroll-scrub video,
- gerçek React/HTML/CSS overlay'leri,
- dört story state,
- mobile ve `prefers-reduced-motion` fallback,
- scroll hijack yok,
- kilitlenmemiş fiyat veya tamamlanmamış ürün işlevi gerçekmiş gibi yayınlanmaz.

## Açık ama tamamlanmış kartları yeniden açmayan takipler

### F17-03 — operasyon / yayın hardening

- S07 routine C4 skip receipt ve bounded DB-runner diagnostics.
- S08 creator-role/exposed-schema kontrolü.
- backup/restore/rollback ve production gözlemi.

### F13-01 / F13-02 — mutable-key pagination / güncellik

S07 keyset pagination dış eşzamanlı sort-key mutasyonunda snapshot-consistency garantisi vermez. Gerçek yarış ve tarih aralığı semantiği F13'te kapanır.

Bu takipler GS/F10-02/F10-03'ü geriye dönük yeniden açmaz.

## Ortam ve korunacak sınırlar

- Doğrulanmış staging origin: `https://yzt-randevu-staging.ziyabeey1.workers.dev`.
- Hedef production: `randevu.kepenk.ai`; staging custom domain: `staging.randevu.kepenk.ai`; sender: `randevu@notify.kepenk.ai`.
- Runtime secret/config Git'e yazılmaz.
- Worker service-role veya acceptance-admin key taşımaz.
- Staging/CI yeşili production/pilot kabulü değildir.
- S07 retention müşteri/randevu ana kaydını otomatik silmez.
- Yeni DB nesnesi explicit grant ve table/view için RLS/policy ister.

## Ürün sınırı

Üç ürün kolu korunur: **Müşteri Paneli, Randevu Paneli, SalonApp**. MVP Faz 17 sonunda gerçek pilotla biter. MKT-01 marketing sitesi ayrı teslim track'idir ve MVP görev sayısını değiştirmez.
