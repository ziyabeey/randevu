# YZT Randevu

YZT Digital'ın salon ve yerel hizmet işletmeleri için geliştirdiği ortak randevu/operasyon ürünü.

## Üç ürün kolu

| Kol | Amaç | Tasarım ilkesi |
| --- | --- | --- |
| Müşteri paneli | Salon/hizmet keşfi, rezervasyon ve randevu yönetimi | Aynı temel işlevler, daha estetik müşteri deneyimi |
| Randevu paneli | Salonun gün/hafta/liste takvimi ve günlük planlama | Referanstaki iş disiplini ve işlem sırası; küçük iyileştirmeler |
| SalonApp | Mobil randevu, adisyon, tahsilat ve salon işlemleri | Tanıdık menü/adisyon akışı; küçük görsel ve ergonomik farklar |

Üç kol ortak işletme, üyelik, müşteri, hizmet, personel ve randevu verisini kullanır. SalonApp alt menü hedefi: **Randevular · Adisyonlar · Yeni · Müşteriler · Diğer**.

## Mevcut durum

Main'de Faz 1–8 temeli vardır: Auth/tenant, katalog, çalışma saatleri/müsaitlik, tek hizmetli randevu, müşteriye açık rezervasyon, güvenli bağlantıyla yönetim ve gün/hafta takvimi.

F09-01…05 güvenilir booking/bildirim, F10-01 hesap temeli ve F17-01/02 staging/CI main’dedir. [Eski PR #8](https://github.com/ziyabeey1-ai/randevu/pull/8) kapalı/superseded durumundadır. Plan v3’ün S01…S08 teknik düzeltmeleri henüz uygulanmadı. Çoklu hizmet, yeni müşteri tasarımı, SalonApp/adisyon/tahsilat ve ürün/stok/rapor genişlemeleri planlanmıştır; henüz uygulanmış değildir. Canlı pilot doğrulanmış sayılmaz.

## Proje rehberi

- [PRODUCT_SPEC.md](PRODUCT_SPEC.md) — üç kol, işlev/tasarım kuralları ve kapsam.
- [ROADMAP.md](ROADMAP.md) — korunan Faz 1–8 ve kabul ölçütlü Faz 9–17.
- [TASKS.md](TASKS.md) — Korunan 46 MVP işi + 8 teknik düzeltme; toplam 54 görev, bağımlılıklar ve durum/sahip takibi.
- [CONTRIBUTING.md](CONTRIBUTING.md) — Ziya ve diğer ajanlar için görev seçimi, branch/PR, ortak dosya ve devir rehberi; kopyalanabilir görev metni.
- [MVP_ACCEPTANCE.md](MVP_ACCEPTANCE.md) — üç kolun birlikte doğrulanacağı 31 birleşik kabul/pilot senaryosu.
- [PROJECT_STATE.md](PROJECT_STATE.md) — gerçek kod durumu, branch'ler, açık bulgular ve kanıtlar.
- [DECISIONS.md](DECISIONS.md) — teknik kararlar ve veri sınırları.
- [Görsel referanslar](docs/references/README.md) — ürün sahibinin sağladığı 11 ekranın eşleştirmesi.
- [AGENTS.md](AGENTS.md) — geliştirme ve doğrulama protokolü.

Katkı vermek için mevcut durumu okuyup TASKS'tan tek görev seçin; ilgili faz dosyası başlama noktası, çıktı ve kabul ölçütlerini içerir. Staging/CI temeli tamamlanmıştır; yeni özelliklerden önce GS teknik düzeltme kabulü gerekir. Güncel durum TASKS’tadır; bu belgelerin yazılması yeni ekranların veya işlevlerin tamamlandığı anlamına gelmez.

## Yerel kurulum

```bash
cp .dev.vars.example .dev.vars
npm ci
npm run dev
```

`.dev.vars` içindeki Supabase değerleri gerçek geliştirme ortamına göre ayarlanır. Kesin migration sırası `supabase/migrations/` içindedir; güncel kapsam [PROJECT_STATE.md](PROJECT_STATE.md) üzerinden okunur. Worker, Supabase Auth ve kullanıcının RLS yetkileriyle çalışır; service-role anahtarı kullanmaz.

## Mevcut ekranlar

| Yol | İşlev |
| --- | --- |
| `/calendar` | Gün/hafta takvimi, personel filtresi, durum işlemleri |
| `/bookings` | Randevu oluşturma ve taşıma |
| `/availability` | Mesai, kapanış ve müsaitlik |
| `/` | Giriş, işletme, hizmet ve ekip |
| `/public-booking` | Public sayfa ayarları |
| `/r/:slug` | Müşteri rezervasyonu |
| `/m#<token>` | Tek randevuyu bağlantıyla yönetme |

SalonApp/adisyon yolları ilgili uygulama fazında eklenecek; yukarıdaki tablo mevcut çalışan route'ları gösterir.

## Korunan teknik temel

İşletme sınırı aktif üyelik + RLS + composite FK'lerle uygulanır. Müsaitlik işletmenin IANA saat dilimini kullanır. Tamponlar dahil personel çakışması PostgreSQL exclusion constraint'iyle engellenir. Randevu işlemleri tekrar güvenlidir; snapshot ve değişiklik geçmişi korunur. Takvim ortak randevuların görünümüdür. Müşteri yönetim token'ı düz metin saklanmaz ve URL path/query'sine konulmaz.

Yeni kapsamda adisyon/tahsilat durumu randevu durumundan ayrı tutulur. İlk mali işlev işletmede gerçekleşen tahsilatı kaydetmektir; çevrimiçi ödeme, tam muhasebe, e-fatura, bordro ve ERP ayrı kapsamdır.

## Kontroller

```bash
npm ci
npm run typecheck
npm run build
```

GitHub CI PostgreSQL 17 üzerinde main'deki tüm migration'ları ve SQL gerileme testlerini çalıştırır. Gerçek hesap, tarayıcı, mobil, bildirim ve üç kol arasındaki işlemler ayrıca ilgili fazın kabul ölçütleriyle doğrulanır.

## Plan v3 ile devam

Güncel görev için [PROJECT_STATE](PROJECT_STATE.md) → [ROADMAP](ROADMAP.md) → [TASKS](TASKS.md) sırasını kullanın. Önce [S01–S08 / GS](docs/plan/stabilization.md), sonra onaylı üç kollu MVP devam eder. [Ortak mimari sözleşmeler](docs/plan/architecture-contracts.md) ve [ajan/beceri protokolü](docs/plan/agent-workflow.md), insan ve GPT-5.6 Sol katkısının devir temelidir. Bu revizyon uygulama veya PDF teslimi değildir.
