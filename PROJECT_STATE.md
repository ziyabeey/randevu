# YZT Randevu — Doğrulanmış mevcut durum

**Kontrol: 16 Eylül 2026.** Bu dosya yalnız main'de doğrulanmış runtime durumunu ve aktif entegrasyon sınırını tutar. Canlı görev/sahiplik `TASKS.md`, bağımlılıklar `ROADMAP.md`, koordinasyon/conflict/staging kararları Issue #65 içindedir.

## Main referansı

Bu dosya **exact current main SHA'yı bilerek içine gömmez**; belgeyi main'e merge etmek SHA'yı yeniden değiştirip kendi kendini bayatlatır. Güncel exact SHA için repository `main` ref'i otoritedir.

Son runtime-affecting ürün baseline'ı **F11-01 grup/satır sözleşmesi ve ileri migration / PR #105**'tir. Final semantic head `40a476ec4bdf070d17d5595f76980fb4852457db`, latest-main docs-only descendant `d9960e6c487f86f49d90b0ed07db240dc6775682`, merge/main commit `83d61f4115dafb887b89eba66d1157311927139f`; semantic STRICT CI #1075, fresh-base CI #1078 ve merge sonrası main CI #1079 başarılıdır. R1 security/DB/access ve R2 browser/integration bağımsız kapıları final semantic head üzerinde **ACCEPTABLE** sonuçlanmış, Phase-11 gerçek saha receipt'i `5693460041` kabul edilmiştir; hosted-only residual bulunmadığı için ayrıca staging açılmamıştır. F11-01 mevcut `appointments` tablosunu fiziksel service-line store olarak korur ve additive `appointment_groups` başlığı ekler; legacy appointment kimliği/recovery/outbox kanıtı korunur. Fixed/range line snapshotları integer minor-unit min/max + currency + policy version taşır, range estimate definitive charge sayılmaz. Legacy fixed create concurrent katalog değişiminde eski para ile yeni policy version'ı karıştıramaz; authoritative service state uyuşmazlığı `SERVICE_PRICE_SNAPSHOT_MISMATCH` ile fail-closed olur. Gerçek saha receipt'iyle doğrulanan kısmi hizmet iptalinde non-legacy group lifecycle mixed line durumunu `partial` olarak temsil eder, sibling line status/time bağımsız kalır ve tenant/customer/source bütünlüğü korunur.

Önceki ana ürün kapanışları:

- **GS / S01…S08:** tamamlandı.
- **G09 / F09-01…05:** tamamlandı.
- **F10-01:** ortak oturum/parola akışları tamamlandı.
- **F10-02:** davet/üyelik/rol, mali izinler, deactivation/last-owner sınırı tamamlandı; staging #30 + bağımsız security/DB review geçti.
- **F10-03:** ikinci işletme, `/setup` onboarding, owner-as-staff, bounded onboarding snapshot, tenant switch stale-state izolasyonu ve fail-closed public readiness tamamlandı; PR #72 merge + bağımsız review geçti.
- **F10-04:** hizmet/personel CRUD + archive/reactivate, staff↔service assignment, işletme/personel saatleri ve kapanışlar tamamlandı. Recovery direct catalog read'leri fail-closed standard-session guard ile kapatıldı; stale write authoritative reload/discard, iki işletmeli stale izolasyon, 360/390, keyboard/focus ve hata/boş/ready state ayrımı gerçek Chrome regression ile doğrulandı.
- **F10-05:** işletme müşteri kayıtları + customer authority forward repair tamamlandı. Recovery direct customer-bearing read RPC'lerinden fail-closed edilir; canonical customer çözümü phone/email ambiguity'de arbitrary winner seçmez; booking CRM master'ı sessizce değiştirmez; `/customers` A↔B stale izolasyonu, 360/390, exclusive states, keyboard ve optimistic-conflict recovery gerçek Chrome ile doğrulandı.
- **F12-01:** görsel yön/akış sözleşmesi tamamlandı.
- **F12-02:** salon public profili, private Storage medya yaşam döngüsü, bounded reclaim/cleanup, operator retry-state ve 360/390 + keyboard/focus public/private kabulü tamamlandı.
- **F12-03:** hizmet kategori/sıra ile fixed/range lower/upper/currency/policy-version sözleşmesi tamamlandı. Legacy fixed kayıtlar kayıpsız taşınır, tarihsel appointment fiyat snapshotları yeniden yazılmaz, server-side estimate mixed-currency/cross-tenant/inactive seçimlerde fail-closed'dur; range hizmetler eski public/operator tek-fiyatlı booking yüzeyine kesin fiyat gibi sızmaz.
- **F11-01:** additive group header + mevcut appointment line store, fixed/range frozen line snapshotları, fixed-price concurrency fence, mixed lifecycle `partial`, legacy identity/recovery/outbox preservation ve gerçek saha receipt'i tamamlandı; PR #105 merge + R1/R2 bağımsız review geçti.
- **F17-01/02:** staging ve CI temeli tamamlandı.

Tam tarihsel kanıtlar `TASKS.md` ve `docs/handoffs/**` içindedir; burada tekrar kopyalanmaz.

## Main'deki doğrulanmış teknik temel

| Alan | Doğrulanmış durum | Sonraki iş |
| --- | --- | --- |
| Auth / Membership / tenant | F10-01 + S01/S02 + F10-02/03/04/05; recovery normal tenant authority kazanamaz; customer ve catalog read yüzeylerinde standard-session guard vardır; business switch Membership ile doğrulanır | F10-06 |
| Hizmet / personel / eşleşme | F10-04 + F12-03 main'de: guarded service/staff CRUD, archive/reactivate, staff↔service assignment, optimistic concurrency, kategori/sıra ve fixed/range integer minor-unit fiyat + policy-version sözleşmesi; StaffProfile ile Membership ayrı kimlikler | F11-02 |
| Mesai / availability | Faz 4 + F10-03 structural publish readiness + F10-04 business/staff hours ve availability block yönetimi; stale writes authoritative reload ile reconcile edilir. Phase-11 saha receipt'i bekleme sırasında personel kapasitesinin salon/service policy'ye göre serbest kalabildiğini veya kalmadığını doğruladı | F11-02 |
| Booking / müşteri / snapshot / audit | Faz 5 + F09 + S07 + F10-05 + F12-03 + F11-01; `appointment_groups` additive header, `appointments` fiziksel service-line store'dur. Legacy tek-line kimliği korunur; line fixed/range min/max/currency/policy snapshotı freeze edilir; mixed non-legacy lifecycle `partial` olabilir; canonical customer çözümü tenant-scoped ve ambiguity fail-closed'dur | F11-02, F13 |
| Public booking | Faz 6–7 + F09/S04/S07 + F10-03 + F12-02/03; readiness fail-closed kalır, salon public profil/media yalnız yayınlanabilir tenantta görünür, pending/deleting/cleanup/private object public yüzeye sızmaz; legacy public service projection yalnız fixed fiyatı yayınlar, range lower bound kesin fiyat gibi gösterilmez | F12-04/05 |
| Onboarding / business switch | F10-03 main'de; gerçek domain state'inden resume, bounded snapshot, A/B stale-state izolasyonu; F10-04 ayar yüzeyi aynı domain state'i tüketir | F10-06 |
| Takvim | Gün/hafta temeli mevcut | F13 |
| Bildirim / outbox | F09-03/05 + S03 + S07; F11-01 group bridge legacy provider/retry evidence'ını korur | F16-02 |
| Kaynak limitleri | S04 quota + S07 runtime/read budgets + F10-03 bounded onboarding + F10-04 catalog/schedule/block caps + F10-05 bounded customer/history reads + F12-02 5 MiB/20 media + bounded cleanup + F12-03 en fazla 10 hizmetlik internal estimate + F11-01 max 10 group line | F11-02/F13/F17-03 takipleri |
| CI / staging | F17-01/02 + S05/S06; required CI gate ve staging rollback/rotation temeli | F17-03 |
| Future DB ACL | S08; yeni nesnelerde explicit grant/RLS disiplini | Her yeni migration + F17-03 |
| Görsel ürün sözleşmesi | F12-01 akış/görsel sözleşmesi + F12-02 responsive salon profil/media yüzeyi + F12-03 responsive katalog/fiyat kontrolleri main'de | F12-04+ |
| Domain / marka | PR #89 main'de: outward Randevu Kolay; marketing `randevukolay.net`; public tenant `{slug}.randevukolay.net`; tek private app origin `randevu.kepenk.ai`; private cookie host-only | DOMAIN-01 #92 + living-doc #95 + mail #96 |
| Marketing brand/motion | PR #69 `docs/brand/**` main'de; PR #77 izole video + WebP/canvas A/B implementation'ı green experiment head'e ulaştı; production renderer henüz seçilmedi | MKT-01 / PR #77 |
| KolayApp / adisyon / tahsilat | PR #91 izole, reusable KolayApp shell main'de; canonical 5-tab shell mevcut fakat production route/session/business entegrasyonu F14-01 değildir. Adisyon/tahsilat henüz yok | F14 |
| Ürün / stok / masraf / kasa | Henüz ürün uygulaması yok | F15 |
| Paket / promosyon / prim / yorum / dil | Planlandı | F16 |
| Kontrollü pilot | Yapılmadı | F17-04/05 |

## Randevu ürün track'i ve Kepenk Core platform track'i

**Randevu ürün track'i:** runtime ürün baseline'ı F11-01'dir. Bu docs-only state-sync main'e girdikten sonra aktif ürün writer **Ajan D / F11-02** olur. F11-02 atomic multi-service availability/create işidir; F11-03 ve F11-04 kendi dependency kapıları açılana kadar kapalı kalır.

**Kepenk Core platform track'i:** K04 ve KC planı docs-only [PR #106](https://github.com/ziyabeey1-ai/randevu/pull/106) ile main'dedir ve Randevu F09–F17 54 MVP görev sayısını değiştirmez. KC-00 hosted numeric read-only inventory receipt'i **OPEN / Çalışılıyor**; Kepenk Issue #10 bunu toplar. KC-01 Core schema/RPC writer token'ı KC-00 receipt kabul edilene kadar **CLOSED / Engelli**. KC-02…KC-07 planlıdır. K04/KC, mevcut Randevu `profiles/businesses/memberships`, booking authority veya Firestore projection sınırlarını ikinci bir otorite yaratacak şekilde değiştirmez.

## Aktif branch / PR'lar — henüz main değildir

Aşağıdaki işler aktif veya park durumda olsa da doğrulanmış-main tablosuna dahil değildir:

### PR #77 — MKT-01 / FRONTEND 2

`mkt-01-scroll-motion-homepage`

İzole marketing lane'i:

- `src/marketing/**` homepage ve DOM story katmanları,
- repaired deterministic video scrub control,
- 121-frame WebP/canvas A/B renderer,
- bounded fetch concurrency + decoded LRU cache,
- mobile/desktop renderer ayrımı,
- reduced-motion ve media-failure static fallback,
- PR #89 domain contract'a göre outward Randevu Kolay + `randevukolay.net` marketing ve `randevu.kepenk.ai` private CTA ayrımı.

Current isolated experiment green'dir. Gerçek Kling frame binary toplam byte/perf benchmark'ı ve deployed real-phone/cellular kabulü yapılmadan production renderer seçilmez. Shared route/entry ve DNS cutover, aktif ürün writer sırası ve DOMAIN-01 security/browser kapıları açılmadan yapılmaz.

## Aktif entegrasyon sırası

Bu sıra ürün önceliğinden çok shared-file conflict ve dependency güvenliği içindir:

1. **F11-02 / Ajan D** state-sync merge sonrasında sıradaki ürün writer lane'idir. Initial model ordered sequential service plan + farklı staff'tır; stable multi-staff lock ordering ve DB exclusion/buffer final guard kalır. Phase-11 saha receipt'i nedeniyle passive-wait personel kapasite release'i salon/service policy'ye bağlıdır ve booking estimate definitive charge değildir.
2. **MKT-01 / PR #77** izole lane'de paralel kalabilir; production route/entry + gerçek binary/deployed media kabulü shared writer sırası ve domain cutover kapıları açıldığında yapılır.
3. **BRAND-DOC-SYNC / #95** runtime'a dokunmadan living-doc isim/domain cleanup'ı olarak paralel yürüyebilir; tarihsel kanıtlar değiştirilmez.

Canlı queue için Issue #65 otoritedir; eski PR gövdeleri veya eski head gözlemleri görev sırası oluşturmaz.

## Marketing / site track

**MKT-01 / Issue #70 ürün sahibi onaylıdır.** 54 MVP ürün/teknik görevinin dışında ayrı marketing track'idir. Bağlayıcı tasarım kaynağı `docs/brand/**` ve PR #69; domain/origin kaynağı PR #89 ile main'e giren `docs/plan/randevu-kolay-domain-contract.md`; implementation PR #77'dir.

Güncel production yönü:

- outward ürün markası **Randevu Kolay**,
- marketing origin `randevukolay.net`, private operator CTA `randevu.kepenk.ai`,
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

Bu takipler GS/F10-02/F10-03/F10-04/F10-05/F12-02/F12-03/F11-01'i geriye dönük yeniden açmaz.

## Faz direktifleri

Head'e bağlı repo gözlemleri ilgili `docs/plan/phase-*.md` kartına `Hazır olan` / `Tuzak` olarak taşınır ve doğrulandığı head SHA'sını taşır. Kart açılırken current main'de yeniden doğrulanmadan “mevcut durum” sayılmaz. Carry-forward kısaltması pozitif garanti, negatif sınır, exact risk alanı ve exact hedef kartı silemez.

## Ortam ve korunacak sınırlar

- Doğrulanmış staging origin: `https://yzt-randevu-staging.ziyabeey1.workers.dev`.
- Hedef canonical private app: `randevu.kepenk.ai`; public marketing: `randevukolay.net`; public tenant hedefi: `{slug}.randevukolay.net`; staging custom domain: `staging.randevu.kepenk.ai`; sender hâlen `randevu@notify.kepenk.ai` ve #96 operasyonel cutover'ı bekler.
- Runtime secret/config Git'e yazılmaz.
- Worker service-role veya acceptance-admin key taşımaz.
- Staging/CI yeşili production/pilot kabulü değildir.
- S07 retention müşteri/randevu ana kaydını otomatik silmez.
- Yeni DB nesnesi explicit grant ve table/view için RLS/policy ister.
- Auth/recovery kapanışı yalnız raw table grant denetimi değildir; korunan veriyi döndüren directly executable `SECURITY DEFINER` RPC/function/view/Data API yüzeyleri de capability envanterine girer.

## Ürün sınırı

Üç ürün kolu korunur: **Müşteri Paneli, Randevu Paneli, KolayApp**. KolayApp aynı private app/session/business context'inin mobil işletme kabuğudur; ayrı backend/auth değildir. MVP Faz 17 sonunda gerçek pilotla biter. MKT-01 marketing sitesi ayrı teslim track'idir ve MVP görev sayısını değiştirmez.