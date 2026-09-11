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

Faz 9 e-posta çalışması [taslak PR #8](https://github.com/ziyabeey1-ai/randevu/pull/8) içindedir. Çoklu hizmet, yeni müşteri tasarımı, SalonApp/adisyon/tahsilat ve ürün/stok/rapor genişlemeleri planlanmıştır; henüz uygulanmış değildir. Canlı pilot doğrulanmış sayılmaz.

## Proje rehberi

- [PRODUCT_SPEC.md](PRODUCT_SPEC.md) — üç kol, işlev/tasarım kuralları ve kapsam.
- [ROADMAP.md](ROADMAP.md) — korunan Faz 1–8 ve kabul ölçütlü Faz 9–17.
- [PROJECT_STATE.md](PROJECT_STATE.md) — gerçek kod durumu, branch'ler, açık bulgular ve kanıtlar.
- [DECISIONS.md](DECISIONS.md) — teknik kararlar ve veri sınırları.
- [Görsel referanslar](docs/references/README.md) — ürün sahibinin sağladığı 11 ekranın eşleştirmesi.
- [AGENTS.md](AGENTS.md) — geliştirme ve doğrulama protokolü.

## Yerel kurulum

```bash
cp .dev.vars.example .dev.vars
npm ci
npm run dev
```

`.dev.vars` içindeki Supabase değerleri gerçek geliştirme ortamına göre ayarlanır. Main'deki migration sırası [PROJECT_STATE.md](PROJECT_STATE.md) içindedir. Worker, Supabase Auth ve kullanıcının RLS yetkileriyle çalışır; service-role anahtarı kullanmaz.

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
