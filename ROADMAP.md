# YZT Randevu — MVP yol haritası

**Plan v3 · güncel durum 14 Eylül 2026.** Ürün üç kolu ve F09–F17 görev kimlikleri korunur. Canlı durum `TASKS.md`, doğrulanmış main `PROJECT_STATE.md`, detay kabul ölçütleri ilgili faz dosyalarındadır.

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
- **F10-01, F10-02, F10-03** tamamlandı. Oturum/parola, davet/üyelik/rol, ikinci işletme + onboarding + fail-closed publish readiness main'de.
- **F12-01** görsel yön/akış sözleşmesi tamamlandı.
- **F17-01/02** staging ve CI temeli tamamlandı.
- **PR #69 brand/motion docs** main'e girdi; ayrı **MKT-01** marketing track'i aktif.

GS artık yeni feature kodunu engelleyen bir kapı değildir; aşağıdaki dependency'ler geçerlidir.

## Şu anki dalga

Aynı main tabanından üç dependency-safe ürün lane'i açıldı:

1. **F10-05 — müşteri kayıtları / Ajan A / PR #74**
   - tenant-scoped arama/liste/create/edit,
   - duplicate iletişim ve concurrency,
   - randevu geçmişi snapshot korunumu,
   - K03 pagination ve stale-response koruması.
2. **F10-04 — hizmet/personel/çalışma ayarları / Ajan C / PR #75**
   - guarded service/staff/assignment yönetimi,
   - mesai/kapanış ayarları,
   - stale write ve archive davranışı,
   - F10-03 readiness sözleşmesini genişletme.
3. **F12-02 — salon profili/public fotoğraflar / Ajan B**
   - profil + public medya,
   - upload type/size/count,
   - public/private ayrımı, orphan cleanup ve fallback.

### Shared-file entegrasyon sırası

F10-04 ve F10-05 `scripts/ci-postgres-plan.json` ortak alanını kullanıyor. Çakışma önlemek için:

1. F10-05 / PR #74 CI-plan yazıcısı olarak önce kapanır.
2. F10-04 branch'i yeni main'e taşınır ve kendi plan adımını ekler.
3. F12-02 bağımsız ilerler; ortak router/migration alanına girerse Issue #65'te sıra verilir.

Bu sıra ürün önceliği değil Git/CI conflict önleme sırasıdır.

## Fazlar ve bağımlılık sırası

| Faz | Görevler | Güncel kapanış / sonraki kapı |
| --- | --- | --- |
| [9 — Güvenilir rezervasyon/bildirim](docs/plan/phase-09.md) | F09-01…05 | **Tamamlandı**; kalan operasyon takipleri F17-03'te |
| [10 — Hesap ve işletme](docs/plan/phase-10.md) | F10-01…06 | F10-01/02/03 **tamam**; F10-04 + F10-05 aktif → F10-06 |
| [12 — Fiyat veri desteği](docs/plan/phase-12.md#f12-03) | F12-03 | F10-04 sonrası; F11-01'den önce |
| [11 — Çok hizmetli çekirdek](docs/plan/phase-11.md) | F11-01…04 | F12-03 → F11-01 → F11-02 → F11-03 → F11-04 |
| [12 — Müşteri yüzeyi](docs/plan/phase-12.md) | F12-01…05 | F12-01 tamam; F12-02 aktif; F12-04 F12-02 + F12-03 + F11-02 bekler |
| [13 — Randevu Paneli](docs/plan/phase-13.md) | F13-01…04 | F11/F10/F12 bağımlılıkları sonrası |
| [14 — SalonApp ve mali çekirdek](docs/plan/phase-14.md) | F14-01…05 | F13/F11/F12 sonrasında mobil kabuk + adisyon/tahsilat |
| [15 — Ürün ve kasa](docs/plan/phase-15.md) | F15-01…04 | F14 mali model sonrası stok, satış/iade, masraf ve rapor |
| [16 — Referans eşdeğerliği](docs/plan/phase-16.md) | F16-01…08 | Tekrar, bildirim/SMS, fotoğraf/yorum, paket/promosyon/prim ve hesap/dil |
| [17 — Yayın adayı ve pilot](docs/plan/phase-17.md) | F17-01…05 | F17-01/02 tamam; F17-03 → F17-04 → F17-05 gerçek pilot |

**54 MVP ürün/teknik görev = korunan 46 görev + 8 stabilization görevi.** MKT-01 marketing/site işi bu sayıya dahil değildir. Görev sayısı ürün tamamlanma yüzdesi değildir.

## Paralellik kuralları

- Aynı router/entry, ortak SQL fonksiyonu, lockfile veya CI planına iki eşzamanlı yazıcı verilmez.
- Paralel ajan yalnız kendi `TASKS.md` satırını değiştirir.
- Migration/security/mali değişiklikler bağımsız review ister.
- Main kaydığında branch güncellenir; eski branch state'i main yerine kaynak sayılmaz.
- 2–3 başarısız yaklaşımda aynı deneme tekrar edilmez; varsayım ve kanıt yeniden incelenir.

## Marketing / site track

**MKT-01 / Issue #70** ürün sahibi kontrollü ayrı track'tir ve 54 MVP görevine eklenmez. PR #69 ile bağlayıcı brand/motion belgeleri main'e girdi.

Güncel production yönü:

- sticky/pinned scrollytelling,
- deterministik scroll-scrub video,
- gerçek React/HTML/CSS overlay,
- mobile + reduced-motion fallback,
- tamamlanmamış özellik veya kilitlenmemiş fiyatı gerçekmiş gibi göstermeme.

Kod uygulaması, aktif F10/F12 lane'lerinin ortak entry/router alanını ezmeyecek biçimde coordinator tarafından exact main + dosya sahipliğiyle açılır.

## Bitti sayılma kuralı

Bir görev yalnız davranış kanıtı + gerekli bağımsız review + kabul edilen exact-head CI + main merge birlikte sağlandığında `Tamamlandı` olur. Staging/CI yeşili tek başına pilot kabulü değildir.

F17-04 birleşik teknik/ürün kabulünü, F17-05 gerçek 1–3 işletmeli kontrollü pilotu kapatır. Açık güvenlik/veri/para kusuru MVP tesliminde kalamaz.
