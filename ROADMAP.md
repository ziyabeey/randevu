# YZT Randevu — MVP yol haritası

**Plan v3.** Bu dosya yalnız faz sırası ve bağımlılık planıdır; **canlı statü tutmaz**. Güncel görev/main kabul durumu yalnız `TASKS.md` içindedir. Detay kabul ölçütleri ilgili faz dosyalarındadır.

## Kaynak sırası

| Soru | Kaynak |
| --- | --- |
| Ürün kapsamı nedir? | [PRODUCT_SPEC](PRODUCT_SPEC.md) |
| Main'de kabul edilmiş ve açık olan işler neler? | [TASKS](TASKS.md) |
| Faz sırası ve bağımlılık planı nedir? | Bu ROADMAP + `docs/plan/phase-*.md` |
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

## Fazlar ve bağımlılık sırası

Bu tablo **durum göstermez**. Yalnız işlerin hangi sırayla açılabileceğini özetler; bir satırın tamamlanıp tamamlanmadığı yalnız [TASKS.md](TASKS.md) üzerinden okunur.

| Faz / dilim | Görevler | Bağımlılık yönü |
| --- | --- | --- |
| Stabilization | S01…S08 → GS | Teknik kapı; ayrıntı [stabilization planında](docs/plan/stabilization.md) |
| [9 — Güvenilir rezervasyon/bildirim](docs/plan/phase-09.md) | F09-01…05 | recovery → notifications/abuse → integration; F09-05 ayrıca F17-01/02 altyapısını tüketir |
| [10 — Hesap ve işletme](docs/plan/phase-10.md) | F10-01…06 | session → roles → business/onboarding → catalog + customer → real-account acceptance |
| [12 — Fiyat veri desteği](docs/plan/phase-12.md#f12-03) | F12-03 | F10-04 sonrası; F11-01 group snapshot sözleşmesinden önce |
| [11 — Çok hizmetli çekirdek](docs/plan/phase-11.md) | F11-01…04 | F12-03 → group contract → atomic availability/create → group management → conflict/timezone/upgrade acceptance |
| [12 — Müşteri yüzeyi](docs/plan/phase-12.md) | F12-01…05 | visual/profile + pricing support + F11 group motoru → selection → result/manage |
| [13 — Randevu Paneli](docs/plan/phase-13.md) | F13-01…04 | freshness → day/week/list → create/close/detail → navigation/usage acceptance |
| [14 — SalonApp ve mali çekirdek](docs/plan/phase-14.md) | F14-01…05 | panel readiness + group/customer/price contracts → mobile shell + adisyon/tahsilat → financial/PWA acceptance |
| [15 — Ürün ve kasa](docs/plan/phase-15.md) | F15-01…04 | financial core → stock/product sale/refund → expense → till/day-end/report |
| [16 — Referans eşdeğerliği](docs/plan/phase-16.md) | F16-01…08 | booking/panel/customer/finance foundations üzerine recurring, notifications, media, feedback, package/promo/commission/account-language |
| [17 — Yayın adayı ve pilot](docs/plan/phase-17.md) | F17-01…05 | staging/CI foundation → operational hardening → integrated acceptance → controlled pilot |

**54 MVP ürün/teknik görev = korunan 46 görev + 8 stabilization görevi.** MKT-01 marketing/site işi bu sayıya dahil değildir. Görev sayısı ürün tamamlanma yüzdesi değildir.

## Paralellik kuralları

- Aynı router/entry, ortak SQL fonksiyonu, lockfile veya CI planına iki eşzamanlı yazıcı verilmez.
- Paralel ajan yalnız kendi `TASKS.md` satırını değiştirir; coordinator state-sync istisnası accepted/merged gerçeği ana tabloya taşır.
- Validation budget varsayılan LIGHT'tır; R1/R2/staging yalnız somut auth/DB/browser/hosted riskine göre açılır, otomatik çift-gate yoktur.
- Main kaydığında branch güncellenir; eski branch state'i main yerine kaynak sayılmaz.
- Head'e bağlı teknik tüyo doğrulandığı SHA'yı taşır ve hedef kart açılırken current main'de yeniden ölçülür.
- 2–3 başarısız yaklaşımda aynı deneme tekrar edilmez; varsayım ve kanıt yeniden incelenir.

## Marketing / site track

MKT-01, 54 MVP ürün/teknik görevinden ayrı marketing/site track'idir. Bağlayıcı görsel yön [docs/brand/README.md](docs/brand/README.md) ve ilgili brand belgelerindedir. ROADMAP burada aktif PR, branch, renderer seçimi veya deployment durumu tutmaz; bunların canlı durumu yalnız TASKS üzerinden okunur.

Ürün track'i ile ortak route/entry, domain veya runtime alanına girecek marketing değişiklikleri shared-writer kuralına uyar ve ürün kabulünü varsayarak ilerlemez.

## Bitti sayılma kuralı

Bir görev yalnız davranış kanıtı + riskin gerektirdiği bağımsız review + kabul edilen exact-head CI + main merge birlikte sağlandığında `Tamamlandı` olur. Staging/CI yeşili tek başına pilot kabulü değildir.

F17-04 birleşik teknik/ürün kabulünü, F17-05 gerçek 1–3 işletmeli kontrollü pilotu kapatır. Açık güvenlik/veri/para kusuru MVP tesliminde kalamaz.
