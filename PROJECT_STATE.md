# YZT Randevu — Doğrulanmış mevcut durum

**Kontrol: 15 Eylül 2026.** Bu dosya yalnız main'de doğrulanmış runtime durumunu ve aktif entegrasyon sınırını tutar. Canlı görev/sahiplik `TASKS.md`, bağımlılıklar `ROADMAP.md`, koordinasyon/conflict/staging kararları Issue #65 içindedir.

## Main referansı

Bu dosya **exact current main SHA'yı bilerek içine gömmez**; belgeyi main'e merge etmek SHA'yı yeniden değiştirip kendi kendini bayatlatır. Güncel exact SHA için repository `main` ref'i otoritedir.

Son runtime-affecting ürün baseline'ı **F10-05 forward repair / PR #87**'dir. Kabul adayı `08be2296bea585f30b9ea4db537ac070edbe7230`, merge commit `56ef3be734369e329a30406ea8a66a5eb9ef5993`; exact-head CI #938 ve merge sonrası main CI #948 başarılıdır. R1 security/DB/access ve R2 browser/integration bağımsız kapıları ACCEPTABLE sonuçlanmıştır; hosted-only residual olmadığı için bu repair için ayrıca staging açılmamıştır.

Önceki ana ürün kapanışları:

- **GS / S01…S08:** tamamlandı.
- **G09 / F09-01…05:** tamamlandı.
- **F10-01:** ortak oturum/parola akışları tamamlandı.
- **F10-02:** davet/üyelik/rol, mali izinler, deactivation/last-owner sınırı tamamlandı; staging #30 + bağımsız security/DB review geçti.
- **F10-03:** ikinci işletme, `/setup` onboarding, owner-as-staff, bounded onboarding snapshot, tenant switch stale-state izolasyonu ve fail-closed public readiness tamamlandı; PR #72 merge + bağımsız review geçti.
- **F10-05:** işletme müşteri kayıtları + customer authority forward repair tamamlandı. Recovery direct customer-bearing read RPC'lerinden fail-closed edilir; canonical customer çözümü phone/email ambiguity'de arbitrary winner seçmez; booking CRM master'ı sessizce değiştirmez; `/customers` A↔B stale izolasyonu, 360/390, exclusive states, keyboard ve optimistic-conflict recovery gerçek Chrome ile doğrulandı.
- **F12-01:** görsel yön/akış sözleşmesi tamamlandı.
- **F17-01/02:** staging ve CI temeli tamamlandı.

Tam tarihsel kanıtlar `TASKS.md` ve `docs/handoffs/**` içindedir; burada tekrar kopyalanmaz.

## Main'deki doğrulanmış teknik temel

| Alan | Doğrulanmış durum | Sonraki iş |
| --- | --- | --- |
| Auth / Membership / tenant | F10-01 + S01/S02 + F10-02/03/05; recovery normal tenant authority kazanamaz ve customer-bearing direct RPC'lerde standard-session guard vardır; business switch Membership ile doğrulanır | F10-04 / F10-06 |
| Hizmet / personel / eşleşme | Faz 3 temeli + F10-03 owner-as-staff; StaffProfile ile Membership ayrı kimlikler | F10-04, sonra F12-03 |
| Mesai / availability | Faz 4 + F10-03 structural publish readiness | F10-04, F11 |
| Booking / müşteri / snapshot / audit | Faz 5 + F09 + S07 + F10-05; geçmiş appointment snapshotları korunur, canonical customer çözümü tenant-scoped ve ambiguity fail-closed'dur, booking mevcut CRM master'ı sessizce değiştirmez | F11, F13 |
| Public booking | Faz 6–7 + F09/S04/S07; F10-03 readiness business/services/staff/slots/create yüzeylerini fail-closed kapatır | F12-02+ |
| Onboarding / business switch | F10-03 main'de; gerçek domain state'inden resume, bounded snapshot, A/B stale-state izolasyonu | F10-04 / F12-02 |
| Takvim | Gün/hafta temeli mevcut | F13 |
| Bildirim / outbox | F09-03/05 + S03 + S07 | F16-02 |
| Kaynak limitleri | S04 quota + S07 runtime/read budgets + F10-03 bounded onboarding + F10-05 bounded customer/history reads | F11/F13/F17-03 takipleri |
| CI / staging | F17-01/02 + S05/S06; required CI gate ve staging rollback/rotation temeli | F17-03 |
| Future DB ACL | S08; yeni nesnelerde explicit grant/RLS disiplini | Her yeni migration + F17-03 |
| Görsel ürün sözleşmesi | F12-01 main'de | F12-02+ |
| Marketing brand/motion | PR #69 ile `docs/brand/**` main'de; PR #77 izole video + WebP/canvas A/B implementation'ı green experiment head'e ulaştı, production renderer henüz seçilmedi | MKT-01 / PR #77 |
| SalonApp / adisyon / tahsilat | Henüz ürün uygulaması yok | F14 |
| Ürün / stok / masraf / kasa | Henüz ürün uygulaması yok | F15 |
| Paket / promosyon / prim / yorum / dil | Planlandı | F16 |
| Kontrollü pilot | Yapılmadı | F17-04/05 |

## Aktif branch / PR'lar — henüz main değildir

Aşağıdaki işler aktif veya park durumda olsa da doğrulanmış-main tablosuna dahil değildir:

### PR #75 — F10-04 / Ajan C

`f10-04-catalog-hours-management`

- guarded service/staff/assignment yönetimi,
- mesai/kapanış ayarları,
- stale write / archive davranışı,
- F10-03 readiness ile uyum,
- `/availability` yönetim yüzeyi.

Draft/stale branch'tir. Shared writer sırası #76 sonrasıdır; claim açıldığında latest main'e taşınır ve kabul head'i yeniden üretilir.

### PR #76 — F12-02 / Ajan B

`f12-02-salon-profile-public-media`

- salon profil alanları,
- public medya/Storage yaşam döngüsü,
- 5 MB/input ve 20 public görsel sınırı,
- content/type doğrulaması,
- unpublished/readiness fail-closed,
- orphan cleanup ve fallback,
- F12-01 responsive/a11y sözleşmesi.

F10-05 repair artık main'de olduğundan shared writer sırası #76'ya açılır. Branch latest main'e tek seferde taşınırken customer authority ve ortak CI/router değişiklikleri korunur. Açık lifecycle blocker: interrupted `pending/deleting` medya için bounded grace + race-safe reclaim + idempotent Storage cleanup. Final FOCUSED kabulde R1 ve dar R2 gerçek risk nedeniyle kullanılır; staging yalnız hosted Storage davranışı lokalde kanıtlanamıyorsa açılır.

### PR #77 — MKT-01 / FRONTEND 2

`mkt-01-scroll-motion-homepage`

İzole marketing lane'i:

- `src/marketing/**` homepage ve DOM story katmanları,
- repaired deterministic video scrub control,
- 121-frame WebP/canvas A/B renderer,
- bounded fetch concurrency + decoded LRU cache,
- mobile/desktop renderer ayrımı,
- reduced-motion ve media-failure static fallback.

Current isolated experiment green'dir; fakat gerçek Kling frame binary toplam byte/perf benchmark'ı ve deployed real-phone/cellular kabulü yapılmadan production renderer seçilmez. Shared `/` marketing + `/app` workspace cutover #76/shared-entry sırası açılana kadar kapalıdır.

## Aktif entegrasyon sırası

Bu sıra ürün önceliğinden çok shared-file conflict ve dependency güvenliği içindir:

1. **F12-02 / PR #76** latest main'e taşınır; interrupted-media lifecycle blocker'ı kapatılır ve exact-head CI + risk-uygun bağımsız kabul alınır.
2. **F10-04 / PR #75** #76 merge sonrası latest main'e taşınır; shared CI/router alanında yalnız kendi eklerini uygular.
3. **MKT-01 / PR #77** izole lane'de park kalır; production route/entry + gerçek binary/deployed media kabulü shared entry sırası açıldığında yapılır.

Canlı queue için Issue #65 otoritedir; eski PR gövdeleri veya eski head gözlemleri görev sırası oluşturmaz.

## Marketing / site track

**MKT-01 / Issue #70 ürün sahibi onaylıdır.** 54 MVP ürün/teknik görevinin dışında ayrı marketing track'idir. Bağlayıcı tasarım kaynağı `docs/brand/**` ve PR #69'dur; implementation PR #77'dir.

Güncel production yönü:

- sticky/pinned transformation stage,
- gerçek React/HTML/CSS overlay'leri,
- repaired video scrub bir kontrol renderer'ı olarak korunur,
- ayrı WebP kareleri + tek canvas renderer eşit production adayıdır,
- WebP yolu tüm kareleri decode edip RAM'de tutmaz; bounded decoded cache kullanır,
- mobile ve `prefers-reduced-motion` davranışı fail-closed'dur,
- scroll hijack yok,
- kilitlenmemiş fiyat veya tamamlanmamış ürün işlevi gerçekmiş gibi yayınlanmaz,
- production renderer kararı synthetic CI ile değil gerçek binary byte/perf + gerçek telefon/hücresel davranışla verilir.

## Açık ama tamamlanmış kartları yeniden açmayan takipler

### F17-03 — operasyon / yayın hardening

- S07 routine C4 skip receipt ve bounded DB-runner diagnostics.
- S08 creator-role/exposed-schema kontrolü.
- backup/restore/rollback ve production gözlemi.
- auth/session provider + membership/business hop count, calendar hot-path round-trip sayısı / p50 / p95 / waterfall ve public/marketing/private workspace bundle ayrımı sayısal ölçülür; ölçülmeden sırf var oldukları için blocker yapılmaz.

### F13-01 / F13-02 — mutable-key pagination / güncellik

S07 keyset pagination, dışarıdan eşzamanlı sıralama-anahtarı mutasyonu **yokken** `(timestamp,id)` ile skip/repeat üretmeden ilerler. Mutable risk `appointments.starts_at` alanıdır; sayfalar arasında `starts_at` değişirse continuation skip/repeat üretebilir ve snapshot-consistency garantisi verilmez. `created_at` bu mutable-key riskinin parçası değildir. Gerçek eşzamanlı yazar/stale-continuation testi **F13-01**'de; gün/hafta/liste için tarih aralığı dahil-hariç + işletme timezone filtre sözleşmesi **F13-02**'de kapanır. Bu dblink commit yarışı C4 rollback paketinin işi değildir.

F13-02 date-range API'si mevcut `list_appointments_page(uuid,integer,timestamptz,uuid)` imzasını genişletecekse PostgreSQL function identity değişimi önceden planlanır: forward migration eski exact signature'ı explicit kapatır/drop eder, yeni signature'ı create eder, narrow GRANT/caller ve clean+upgrade kanıtı aynı değişimde taşınır. `CREATE OR REPLACE` ile parametre listesi sessizce değişiyormuş gibi davranılmaz.

Bu takipler GS/F10-02/F10-03/F10-05'i geriye dönük yeniden açmaz.

## Faz direktifleri

Head'e bağlı repo gözlemleri ilgili `docs/plan/phase-*.md` kartına `Hazır olan` / `Tuzak` olarak taşınır ve doğrulandığı head SHA'sını taşır. Kart açılırken current main'de yeniden doğrulanmadan “mevcut durum” sayılmaz. Carry-forward kısaltması pozitif garanti, negatif sınır, exact risk alanı ve exact hedef kartı silemez.

## Ortam ve korunacak sınırlar

- Doğrulanmış staging origin: `https://yzt-randevu-staging.ziyabeey1.workers.dev`.
- Hedef production: `randevu.kepenk.ai`; staging custom domain: `staging.randevu.kepenk.ai`; sender: `randevu@notify.kepenk.ai`.
- Runtime secret/config Git'e yazılmaz.
- Worker service-role veya acceptance-admin key taşımaz.
- Staging/CI yeşili production/pilot kabulü değildir.
- S07 retention müşteri/randevu ana kaydını otomatik silmez.
- Yeni DB nesnesi explicit grant ve table/view için RLS/policy ister.
- Auth/recovery kapanışı yalnız raw table grant denetimi değildir; korunan veriyi döndüren directly executable `SECURITY DEFINER` RPC/function/view/Data API yüzeyleri de capability envanterine girer.

## Ürün sınırı

Üç ürün kolu korunur: **Müşteri Paneli, Randevu Paneli, SalonApp**. MVP Faz 17 sonunda gerçek pilotla biter. MKT-01 marketing sitesi ayrı teslim track'idir ve MVP görev sayısını değiştirmez.
