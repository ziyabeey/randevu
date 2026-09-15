# YZT Randevu — MVP yol haritası

**Plan v3 · güncel durum 15 Eylül 2026.** Ürün üç kolu ve F09–F17 görev kimlikleri korunur. Canlı durum `TASKS.md`, doğrulanmış main `PROJECT_STATE.md`, detay kabul ölçütleri ilgili faz dosyalarındadır.

## Kaynak sırası

| Soru | Kaynak |
| --- | --- |
| Ürün kapsamı nedir? | [PRODUCT_SPEC](PRODUCT_SPEC.md) |
| Main'de gerçekten ne var? | [PROJECT_STATE](PROJECT_STATE.md) |
| Hangi görev kimin ve hangi durumda? | [TASKS](TASKS.md) |
| Faz/dependency sırası nedir? | Bu dosya + `docs/plan/phase-*.md` |
| Ortak teknik kurallar nedir? | [K01/K02/K03](docs/plan/architecture-contracts.md), [DECISIONS](DECISIONS.md) |
| Release/pilot ne zaman kabul edilir? | [MVP_ACCEPTANCE](MVP_ACCEPTANCE.md), F17-04/05 |
| Marketing homepage yönü nedir? | [docs/brand/README.md](docs/brand/README.md), MKT-01 / Issue #70 |

TASKS sahiplik/durum kaynağıdır. ROADMAP yalnız ürün sırası ve bağımlılıkları özetler; eski PR/branch durumlarını tekrar etmez.

## MVP hedefi

| Kol | Çalışan sonuç | Tasarım sınırı |
| --- | --- | --- |
| Müşteri Paneli | Salon profili, çoklu hizmet/personel, uygun saat, özet, rezervasyon ve güvenli yönetim | Özgün, estetik müşteri deneyimi |
| Randevu Paneli | Gün/hafta/liste, ekip/müşteri/katalog, mesai/kapanış, randevu detayları | Takvim merkezli günlük operasyon |
| SalonApp | Randevular / Adisyonlar / Yeni / Müşteriler / Diğer; tahsilat, stok, kasa, paket/prim | Tanıdık mobil işlem akışı |

Tek repo/backend ve ortak veriler korunur. İlk mobil teslim responsive/PWA'dır. **MVP Faz 17 sonunda**, Faz 9–16'nın kabul edilmiş işlevleri ve gerçek pilotla biter.

Çevrimiçi kart çekimi, otomatik abonelik tahsilatı, native mağaza dağıtımı, tam muhasebe/e-fatura/bordro/ERP, marketplace, AI ve gelişmiş şube hiyerarşisi MVP dışıdır. Manuel tahsilat, temel stok, paket/promosyon ve prim MVP içindedir.

## Tamamlanan temel

- Faz 1–8 React/Worker, Auth/tenant, katalog, müsaitlik, tek hizmetli booking, public/manage ve takvim temeli main'de.
- **G09 / F09-01…05** tamamlandı.
- **GS / S01…S08** tamamlandı ve kapalı. Recovery, ortak auth guard, notification consistency, quota/resource budget, deploy consistency, CI gate ve future-object ACL kabul edildi.
- **F10-01, F10-02, F10-03, F10-05** tamamlandı. Oturum/parola, davet/üyelik/rol, ikinci işletme + onboarding + fail-closed publish readiness ve customer authority/CRM main'de.
- **F12-01** görsel yön/akış sözleşmesi tamamlandı.
- **F17-01/02** staging ve CI temeli tamamlandı.
- **PR #69 brand/motion docs** main'e girdi; ayrı **MKT-01** marketing track'i aktif ama production renderer/cutover kararı bekliyor.

GS artık yeni feature kodunu engelleyen bir kapı değildir; aşağıdaki dependency'ler geçerlidir.

## Şu anki dalga

F10-05 kabul+merge sonrası shared writer kuyruğu sadeleşti:

1. **F12-02 — salon profili/public fotoğraflar / Ajan B / PR #76**
   - profil + public medya,
   - upload type/size/count,
   - public/private ayrımı,
   - interrupted `pending/deleting` media için bounded grace + race-safe reclaim + idempotent Storage cleanup,
   - F12-01 responsive/a11y sözleşmesi.
2. **F10-04 — hizmet/personel/çalışma ayarları / Ajan C / PR #75**
   - guarded service/staff/assignment yönetimi,
   - mesai/kapanış ayarları,
   - stale write ve archive davranışı,
   - F10-03 readiness sözleşmesini genişletme.

MKT-01 ayrı ve izole lane'dir; current video + WebP/canvas experiment green olsa da production renderer gerçek Kling binary/perf + real-phone/cellular kanıtını bekler. Shared `/`→marketing ve `/app`→workspace cutover, entry writer sırası açılmadan yapılmaz.

### Shared-file entegrasyon sırası

1. F12-02 / PR #76 latest main'e taşınır ve lifecycle blocker'ı kapatılır.
2. F10-04 / PR #75 #76 merge sonrası latest main'e taşınır; `scripts/ci-postgres-plan.json` ve shared entry alanında yalnız kendi eklerini uygular.
3. MKT-01 production route/entry + gerçek binary kabulü shared entry sırası açıldığında yapılır.

Bu sıra ürün önceliği değil Git/CI conflict önleme sırasıdır. Canlı override ve writer token otoritesi Issue #65'tir.

## Fazlar ve bağımlılık sırası

| Faz | Görevler | Güncel kapanış / sonraki kapı |
| --- | --- | --- |
| [9 — Güvenilir rezervasyon/bildirim](docs/plan/phase-09.md) | F09-01…05 | **Tamamlandı**; kalan operasyon takipleri F17-03'te |
| [10 — Hesap ve işletme](docs/plan/phase-10.md) | F10-01…06 | F10-01/02/03/05 **tamam**; F10-04 → F10-06 |
| [12 — Fiyat veri desteği](docs/plan/phase-12.md#f12-03) | F12-03 | F10-04 sonrası; F11-01'den önce |
| [11 — Çok hizmetli çekirdek](docs/plan/phase-11.md) | F11-01…04 | F12-03 → F11-01 → F11-02 → F11-03 → F11-04 |
| [12 — Müşteri yüzeyi](docs/plan/phase-12.md) | F12-01…05 | F12-01 tamam; F12-02 PR #76 sıradaki implementation lane'i; F12-04 F12-02 + F12-03 + F11-02 bekler |
| [13 — Randevu Paneli](docs/plan/phase-13.md) | F13-01…04 | F11/F10/F12 bağımlılıkları sonrası |
| [14 — SalonApp ve mali çekirdek](docs/plan/phase-14.md) | F14-01…05 | F13/F11/F12 sonrasında mobil kabuk + adisyon/tahsilat |
| [15 — Ürün ve kasa](docs/plan/phase-15.md) | F15-01…04 | F14 mali model sonrası stok, satış/iade, masraf ve rapor |
| [16 — Referans eşdeğerliği](docs/plan/phase-16.md) | F16-01…08 | Tekrar, bildirim/SMS, fotoğraf/yorum, paket/promosyon/prim ve hesap/dil |
| [17 — Yayın adayı ve pilot](docs/plan/phase-17.md) | F17-01…05 | F17-01/02 tamam; F17-03 → F17-04 → F17-05 gerçek pilot |

**54 MVP ürün/teknik görev = korunan 46 görev + 8 stabilization görevi.** MKT-01 marketing/site işi bu sayıya dahil değildir. Görev sayısı ürün tamamlanma yüzdesi değildir.

## Paralellik kuralları

- Aynı router/entry, ortak SQL fonksiyonu, lockfile veya CI planına iki eşzamanlı yazıcı verilmez.
- Paralel ajan yalnız kendi `TASKS.md` satırını değiştirir; coordinator state-sync istisnası accepted/merged gerçeği ana tabloya taşır.
- Validation budget varsayılan LIGHT'tır; R1/R2/staging yalnız somut auth/DB/browser/hosted riskine göre açılır, otomatik çift-gate yoktur.
- Main kaydığında branch güncellenir; eski branch state'i main yerine kaynak sayılmaz.
- Head'e bağlı teknik tüyo doğrulandığı SHA'yı taşır ve hedef kart açılırken current main'de yeniden ölçülür.
- 2–3 başarısız yaklaşımda aynı deneme tekrar edilmez; varsayım ve kanıt yeniden incelenir.

## Marketing / site track

**MKT-01 / Issue #70** ürün sahibi kontrollü ayrı track'tir ve 54 MVP görevine eklenmez. PR #69 ile bağlayıcı brand/motion belgeleri main'e girdi. İzole implementation **PR #77 / `mkt-01-scroll-motion-homepage`** üzerinde draft/park durumundadır.

Güncel production yönü:

- sticky/pinned scrollytelling,
- gerçek React/HTML/CSS overlay,
- repaired deterministic video scrub kontrol renderer'ı,
- ayrı WebP kareleri + tek canvas eşit renderer adayı,
- bounded fetch/decode cache,
- mobile + reduced-motion fail-closed davranışı,
- tamamlanmamış özellik veya kilitlenmemiş fiyatı gerçekmiş gibi göstermeme,
- renderer seçimini synthetic CI değil gerçek binary byte/perf + gerçek telefon/hücresel davranışla verme.

PR #77 izole `src/marketing/**` lane'inde kalır; `src/main.tsx` / `src/App.tsx` route entegrasyonu #76/shared entry işi kapanınca coordinator sırasıyla yapılır.

## Bitti sayılma kuralı

Bir görev yalnız davranış kanıtı + riskin gerektirdiği bağımsız review + kabul edilen exact-head CI + main merge birlikte sağlandığında `Tamamlandı` olur. Staging/CI yeşili tek başına pilot kabulü değildir.

F17-04 birleşik teknik/ürün kabulünü, F17-05 gerçek 1–3 işletmeli kontrollü pilotu kapatır. Açık güvenlik/veri/para kusuru MVP tesliminde kalamaz.
