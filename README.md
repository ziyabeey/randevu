# YZT Randevu

YZT Digital'ın salon ve yerel hizmet işletmeleri için geliştirdiği ortak randevu/operasyon ürünü.

## Ürün yapısı

| Kol | Amaç | Tasarım ilkesi |
| --- | --- | --- |
| Müşteri Paneli | Salon/hizmet keşfi, rezervasyon ve randevu yönetimi | Özgün ve estetik müşteri deneyimi |
| Randevu Paneli | Gün/hafta/liste takvimi ve işletme operasyonu | İş disiplini ve hızlı günlük kullanım |
| SalonApp | Mobil randevu, adisyon, tahsilat ve salon işlemleri | Tanıdık mobil işlem akışı |

Üç kol ortak işletme, üyelik, müşteri, hizmet, personel ve randevu verisini kullanır. SalonApp alt menü sözleşmesi: **Randevular · Adisyonlar · Yeni · Müşteriler · Diğer**.

Marketing sitesi ürün uygulamasından ayrı bir track'tir. **MKT-01 / Issue #70** ürün sahibi tarafından onaylıdır; marka ve scroll-motion kaynağı `docs/brand/**` altındadır.

## Güncel durum

Canlı proje durumu bu README içinde tekrar edilmez. **Tek güncel kaynak [TASKS.md](TASKS.md)** dosyasıdır; tamamlanan/açık işler, sahiplik, engeller ve kabul kapıları oradan okunur.

Bu README ürünün giriş ve kaynak haritasıdır. PR, Issue, handoff veya burada yazan tarihsel örnekler TASKS ile çelişirse güncel durum sayılmaz.

## Kanonik proje kaynakları

- [PRODUCT_SPEC.md](PRODUCT_SPEC.md) — ürün sınırı ve üç kol.
- [TASKS.md](TASKS.md) — **tek canlı durum kaynağı**: görev, sahiplik, bağımlılık, kabul kapısı, main kabulü ve açık engeller.
- [ROADMAP.md](ROADMAP.md) — bağımlılık ve faz planı; canlı durum tutmaz.
- [MVP_ACCEPTANCE.md](MVP_ACCEPTANCE.md) — birleşik release/pilot kabul matrisi.
- [CONTRIBUTING.md](CONTRIBUTING.md) — branch/PR/sahiplik ve merge kuralları.
- [DECISIONS.md](DECISIONS.md) — teknik kararlar ve veri sınırları.
- [docs/plan/architecture-contracts.md](docs/plan/architecture-contracts.md) — K01/K02/K03 bağlayıcı mimari sözleşmeleri.
- [docs/plan/agent-workflow.md](docs/plan/agent-workflow.md) — ajan çalışma ve devir protokolü.
- [docs/brand/README.md](docs/brand/README.md) — Randevu marka, homepage ve motion sistemi.
- [docs/references/README.md](docs/references/README.md) — ürün sahibinin referans ekran eşleştirmesi.

**Okuma sırası:** `TASKS.md` → ilgili faz kartı → gerekiyorsa açık PR ve Issue #65 koordinasyon kanıtı.

## Yerel kurulum

```bash
cp .dev.vars.example .dev.vars
npm ci
npm run dev
```

`.dev.vars` Supabase geliştirme değerleriyle doldurulur. Kesin migration sırası `supabase/migrations/` içindedir. Worker, Supabase Auth ve kullanıcının RLS yetkileriyle çalışır; service-role anahtarı uygulama runtime'ında kullanılmaz.

## Main'deki temel ekranlar

| Yol | İşlev |
| --- | --- |
| `/` | Giriş ve temel işletme alanı |
| `/setup` | İşletme seçimi ve onboarding |
| `/team` | Davet, üyelik ve rol yönetimi |
| `/account` | Hesap/parola akışları |
| `/calendar` | Gün/hafta takvimi |
| `/bookings` | Randevu oluşturma ve taşıma |
| `/availability` | Mesai, kapanış ve müsaitlik |
| `/public-booking` | Public rezervasyon ayarları |
| `/r/:slug` | Müşteri rezervasyonu |
| `/m#<token>` | Tek randevuyu güvenli bağlantıyla yönetme |

`/customers` F10-05 PR #74 içindedir; main'e merge edilmeden çalışan main route'u sayılmaz. Marketing homepage runtime'ı da PR #77 merge edilmeden main işlevi sayılmaz. SalonApp/adisyon yolları F14 ile gelir.

## Korunan teknik sınırlar

İşletme erişimi aktif Membership + RLS + tenant FK'leriyle uygulanır. Recovery oturumu normal tenant authority kazanamaz. Yeni DB nesneleri explicit grant/RLS ister. Liste ve snapshot okumaları K03/S07 bütçelerine uyar; sessiz kısmi sonuç kabul edilmez. Worker service-role ile yetki atlamaz.

Randevu durumu ile mali/adisyon durumu ayrı tutulur. Çevrimiçi ödeme, tam muhasebe, e-fatura, bordro ve ERP MVP kapsamı dışındadır.

## Kontroller

```bash
npm ci
npm run typecheck
npm run build
```

GitHub CI PostgreSQL 17 üzerinde gerekli migration/SQL ve uygulama testlerini seçerek çalıştırır. Gerçek Auth, staging ve browser kabulü ilgili görev kartlarının kanıt kapılarıyla ayrıca yapılır.
