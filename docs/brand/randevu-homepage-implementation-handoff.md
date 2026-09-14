# Randevu Ana Sayfa — Frontend Implementation Handoff

**Durum:** Uygulamaya hazır tasarım devri; kod uygulaması için TASKS kimliği/koordinatör ataması bekler  
**Tarih:** 14 Eylül 2026  
**Kaynak marka yönü:** 02 — Modern ve Canlı  
**Bağlı belgeler:** `randevu-branding.md`, `randevu-site-copy-card-system.md`, `randevu-homepage-copy.md`, `randevu-homepage-art-direction.md`, `randevu-transformation-scrollytelling-storyboard.md`, `randevu-transformation-shotlist.md`, `randevu-transformation-asset-direction.md`, `randevu-lookdev-selection-criteria.md`, `../plan/f12-01-visual-flow-contract.md`  
**Hedef alan adı:** `randevu.kepenk.ai`

Bu dosya, onaylı branding ve art direction'ı frontend ekibinin uygulayabileceği dosya sınırı, component tree, responsive davranış, motion grammar ve kabul ölçütlerine çevirir. Bu belge kendi başına kod uygulaması başlatmaz. Repo protokolü gereği gerçek kod değişikliği TASKS'ta atanmış tek bir görev kimliği, sahiplik ve branch sınırı aldıktan sonra yapılır.

Look-development sırasında kullanılacak model/saç/UI yönü `randevu-lookdev-selection-criteria.md` içindeki puanlı seçim kapısını geçmeden production asset kabul edilmez.

---

## 1. Neden ayrı bir marketing surface?

Mevcut `src/App.tsx` auth ve işletme çalışma alanını birlikte taşıyor. Marketing deneyimi bu dosyanın içine doğrudan büyütülmemeli.

Önerilen ayrım:

- `/` → Marketing homepage
- `/app` veya mevcut auth/workspace route'u → İşletme uygulaması
- Public müşteri rezervasyon route'ları → mevcut F12 ürün sözleşmesiyle sakin premium yüzey

Routing kararı uygulama görevinin teknik incelemesinde mevcut Worker/Vite yapısına göre kesinleştirilir. Yeni router bağımlılığı yalnız gerçekten gerekli olduğu kanıtlanırsa eklenir.

**Değişmez ilke:** site heyecan verir; ürün sakinleştirir.

---

## 2. Önerilen dosya sınırı

Kod görevi açıldığında en küçük kabul dilimi için önerilen yazılabilir dosyalar:

```text
src/marketing/MarketingHome.tsx
src/marketing/marketing.css
src/marketing/components/MarketingNav.tsx
src/marketing/components/BrandLockup.tsx
src/marketing/components/HeroStage.tsx
src/marketing/components/BookingDemoStage.tsx
src/marketing/components/CalendarStage.tsx
src/marketing/components/ReminderStage.tsx
src/marketing/components/CustomerMemoryStage.tsx
src/marketing/components/ConciergeStage.tsx
src/marketing/components/LowFrictionInterlude.tsx
src/marketing/components/OperationsStage.tsx
src/marketing/components/SocialProofStage.tsx
src/marketing/components/PricingStage.tsx
src/marketing/components/FaqStage.tsx
src/marketing/components/FinalCtaStage.tsx
src/marketing/components/MarketingFooter.tsx
src/marketing/hooks/useReducedMotion.ts
src/marketing/hooks/useInView.ts
src/marketing/marketing.types.ts
```

İlk slice'ta bunların hepsini ayrı dosyaya bölmek zorunlu değildir. 6–8 gerçek tekrar noktası oluşmadan component parçalama yapılmamalıdır. Ama `src/App.tsx` içine yüzlerce satırlık landing page eklenmemelidir.

### İlk slice için minimum gerçek dosya seti

```text
src/marketing/MarketingHome.tsx
src/marketing/marketing.css
src/marketing/components/BrandLockup.tsx
src/marketing/components/HeroStage.tsx
src/marketing/components/FeatureStages.tsx
src/marketing/hooks/useReducedMotion.ts
```

Bu slice yalnız **static art direction + responsive layout** teslim eder. Büyük scroll morph ve gelişmiş motion ikinci slice'a bırakılır.

---

## 3. Component tree

```text
MarketingHome
├─ MarketingNav
│  └─ BrandLockup
├─ HeroStage
│  ├─ HeroCopy
│  ├─ HeroPortrait
│  └─ HeroUiPreview
├─ BookingDemoStage
│  ├─ BookingPhoneFrame
│  └─ BookingSteps
├─ CalendarStage
│  ├─ CalendarHeadline
│  └─ CalendarUiPreview
├─ ReminderStage
│  ├─ ReminderCopy
│  └─ MessageStack
├─ CustomerMemoryStage
│  ├─ EditorialPortrait
│  └─ CustomerCardPreview
├─ ConciergeStage
│  ├─ ConciergeCopy
│  └─ SetupChecklist
├─ LowFrictionInterlude
├─ OperationsStage
│  └─ OperationsUiPreview
├─ SocialProofStage
├─ PricingStage
├─ FaqStage
├─ FinalCtaStage
│  └─ BrandLockup
└─ MarketingFooter
```

### Tasarım prensibi

Component adı ürün özelliğini değil, **sahnedeki anlatım rolünü** temsil eder. `FeatureCard1`, `FeatureCard2` gibi isimler kullanılmaz.

---

## 4. Design token katmanı

Marketing CSS içinde ilk günden token kullanılır:

```css
:root {
  --brand-blue: #3366cc;
  --brand-blue-dark: #15386d;
  --brand-lime: #c6e800;
  --surface: #f8f9fa;
  --surface-blue: #d9ecff;
  --surface-pink: #ffe9f1;
  --surface-lavender: #e9e4ff;
  --ink: #122038;
  --ink-soft: #536078;

  --radius-sm: 14px;
  --radius-md: 24px;
  --radius-lg: 40px;
  --radius-blob: 999px;

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;
  --space-12: 48px;
  --space-16: 64px;
  --space-24: 96px;

  --container: 1440px;
  --gutter-desktop: 32px;
  --gutter-tablet: 24px;
  --gutter-mobile: 16px;

  --ease-out-soft: cubic-bezier(.22,1,.36,1);
  --ease-pop: cubic-bezier(.2,.9,.2,1.08);
}
```

Değerler görsel QA sırasında küçük oranda ayarlanabilir; marka paleti keyfi şekilde yeniden tanımlanmaz.

---

## 5. Grid sistemi

### Desktop ≥ 1200 px

- 12 kolon
- max content width: `1440px`
- dış gutter: `32px`
- kolon gap: `24px`
- section dikey ritim: çoğu sahnede `clamp(96px, 10vw, 176px)`

### Tablet 768–1199 px

- 8 kolon
- gutter `24px`
- görsel ve metin yan yana kalabiliyorsa 4/4 dağılım
- karmaşık sahnelerde dikey stack

### Mobile < 768 px

- 4 kolon zihinsel modeli, gerçek CSS'te tek içerik akışı
- gutter `16px`
- hiçbir kritik içerik yatay scroll gerektirmez
- kart rotasyonu ±2° üstüne çıkmaz
- dekoratif büyük shape viewport'tan taşabilir ama layout overflow üretmez

---

## 6. Section kabul sözleşmesi

### 6.1 MarketingNav

Desktop:
- logo sol
- 3 ana anchor orta
- `Giriş yap` + lime `Kolay başlayalım` sağ
- başlangıçta transparent/açık
- scroll sonrası kompakt yüzey

Mobile:
- logo + tek CTA + menu trigger
- açılan menü full-screen olmak zorunda değil; erişilebilir sheet yeterli

Kabul:
- klavye ile erişilebilir
- focus ring görünür
- sticky nav içerik başlıklarını kapatmaz

### 6.2 HeroStage

Metin:
- eyebrow: `Kepenk.ai sunar`
- H1: `Randevu kolay.`
- body: `Müşteri kendi alsın. Takvimin karışmasın. Kurulumla da seni uğraştırmayalım.`
- CTA: `Birlikte kuralım`
- secondary: `Nasıl çalışıyor?`

Desktop:
- sol 7 kolon copy
- sağ 5 kolon portrait + UI preview
- dev kobalt organik arka form
- lime underline yalnız H1 çevresinde

Mobile:
- H1 önce
- portrait ikinci
- UI preview portrait'in altına/önüne kontrollü bindirilir
- CTA'lar tek kolon veya iki eşit buton değil; primary tam genişlik, secondary text-link tercih

Static slice kabulü:
- motion olmadan bile kompozisyon güçlü görünmeli
- hero LCP görseli optimize edilmeli
- UI preview sahte ürün özelliği göstermemeli

### 6.3 BookingDemoStage

Başlık: `Müşteri kendi alsın.`

Static slice:
- telefon frame
- hizmet, saat ve onay gibi üç gerçek/izinli ekran durumu
- alt açıklama kısa

Motion slice:
- hero UI kartı bu frame'e morph olabilir
- scroll progress ile hizmet → saat → onay geçişi

Kabul:
- hareket olmadan da anlaşılır
- `prefers-reduced-motion` için tüm adımlar erişilebilir kalır

### 6.4 CalendarStage

Başlık: `Kim boş, kim dolu? Bakınca belli.`

Görsel:
- tam genişliğe yakın kobalt sahne
- içeride yüksek kontrastlı gerçek takvim mock/preview
- uygun slot lime ile vurgu

Kabul:
- uygun/dolu yalnız renkle ayrılmaz
- desktop kadar mobile'da da takvim mantığı okunabilir

### 6.5 ReminderStage

Başlık: `Unuttu mu? Biz hatırlatırız.`

Kompozisyon:
- açık mavi/krem sahne
- sağ/sol yüzen mesaj kartları
- tek bir randevu zamanı

Motion:
- mesaj stack stagger
- max 3 mesaj öğesi

Kabul:
- kanal adı sadece canlı özellik doğrulandığında yazılır
- dekoratif mesajlar gerçek müşteri verisi içermez

### 6.6 CustomerMemoryStage

Başlık: `Müşteri kimdi? Hatırlamak zorunda değilsin.`

Kompozisyon:
- editorial portrait büyük
- müşteri kartı portreyi kesen ayrı beyaz yüzey
- pudra/lavanta kullanımı burada yoğunlaşabilir

Kabul:
- sağlık/klinik verisi uydurulmaz
- yalnız mevcut/planlanan güvenli müşteri alanları örneklenir

### 6.7 ConciergeStage

Başlık: `Sen kurma. Biz hazırlayalım.`

Bu bölüm sitenin ikinci büyük wow anıdır.

- tam viewport'a yakın lime takeover
- çok büyük kobalt başlık
- yanında 3–4 maddelik gerçek onboarding checklist
- insan yüzü destekleyici, ürün screenshot'ı ikincil

Kabul:
- vaat operasyon kapasitesini aşmaz
- `hizmetler`, `personel`, `çalışma saatleri` gibi gerçek onboarding maddeleri kullanılabilir
- otomatik migration/import yapılmıyorsa öyle yazılmaz

### 6.8 LowFrictionInterlude

Metin:
- `UĞRAŞ?`
- scroll/viewport değişiminde `AZ.`

Static slice:
- iki büyük kelime, boşluk ve renk kontrastı

Motion slice:
- `UĞRAŞ?` ekranı doldurur
- `AZ.` lime balon olarak içeri girer

Kabul:
- ekran okuyucuda tek anlamlı başlık: `Uğraş? Az.`
- dekoratif tekrar aria-hidden

### 6.9 OperationsStage

Başlık: `Bugün ne olmuş? Tek yerde.`

Koyu gece mavisi sahne. Bu bölüm ürün ciddiyetini yükseltir.

Static:
- randevu/gün özeti
- yalnız canlı kapsam

Release gate:
- adisyon/kasa/stok/prim ancak ilgili F14/F15/F16 işleri tamamlandıysa gösterilir

### 6.10 SocialProofStage

Gerçek pilot yoksa yayınlanmaz.

Fallback:
- gerçek ürün demonstration paneli
- `İlk salonlarla birlikte kuruyoruz.` gibi doğrulanabilir dürüst metin

Pilot sonrası:
- tek büyük gerçek alıntı
- gerçek işletme adı
- gerçek yüz
- tek doğrulanmış metrik

### 6.11 PricingStage

Başlık: `Fiyatı da kolay olsun.`

- birincil hedef: tek paket
- büyük fiyat
- kısa `dahil` listesi
- iletişim kredisi/paket detayı gerçek politikaya göre
- `gizli ücret yok` ancak gerçekten kanıtlanabiliyorsa kullanılır

### 6.12 FaqStage

Accordion olabilir ama JavaScript olmadan içerik erişilebilir kalmalı (`details/summary` güçlü aday).

Sorular günlük dilde:
- `Kurulum zor mu?`
- `Müşteriler uygulama indirmek zorunda mı?`
- `Çalışanlarım da kullanabilir mi?`
- `Mevcut müşterilerimi nasıl taşırım?`
- `Destek lazım olursa kime yazacağım?`

### 6.13 FinalCtaStage

Başlık: `Randevu kolay. İşin sana kalsın.`

- beyaz `kolay` balonu büyük CTA container
- CTA: `Birlikte kuralım`
- son scroll anında bu form küçülüp BrandLockup'a yaklaşabilir

Üçüncü ve son büyük wow anı budur.

---

## 7. Motion grammar

### Süre ölçeği

- micro: 120–180 ms
- element enter: 280–450 ms
- section choreography: 550–850 ms
- hiçbir blok 1 saniyeyi aşan zorunlu animasyon bekletmez

### Hareket dili

Kabul edilen:
- translate + opacity
- hafif scale
- clip-path reveal sınırlı
- underline draw
- UI card snap/morph
- küçük parallax

Kaçınılacak:
- sürekli floating her öğede
- 3D rotate yoğunluğu
- custom cursor
- scroll hijack
- inertia scroll replacement
- zorunlu loader
- text scramble gibi okunurluğu bozan efektler

### Reduced motion

`prefers-reduced-motion: reduce` altında:
- parallax kapalı
- morph yerine crossfade/static
- stagger kaldırılır
- transform mesafeleri 0'a yakın
- içerik sırası ve anlam değişmez

---

## 8. Fotoğraf üretim/çekim brief'i

Hero ve concierge için toplam 2 ana insan görseli yeterli.

Aranan karakter:
- 22–45 yaş aralığında farklı salon profesyonelleri
- gerçek iş ortamı hissi
- kameraya doğrudan veya hafif yan bakış
- fazla lüks editorial değil
- steril stock gülüşü değil
- renkli ama doğal ışık
- saç/güzellik sektörünü taşıyan küçük bağlam detayları

Kadraj:
- kesilmiş omuz/üst beden olabilir
- organik shape içinde kullanılabilecek temiz negatif alan
- desktop ve mobile crop için güvenli yüz konumu

Gerçek pilot yüzleri geldiğinde generic çekimlerden daha yüksek öncelik alır.

---

## 9. Asset kuralları

- Logo SVG/vektör olacak.
- Hero portrait AVIF/WebP; responsive `srcset`.
- UI screenshot yerine mümkün olduğunda HTML/CSS demo tercih edilir; text keskinliği ve responsive kalite artar.
- Screenshot gerekiyorsa yalnız gerçek ürün/veri veya açıkça mock demonstrasyon.
- Inline SVG doodle toplam DOM'u şişirmemeli.
- Büyük dekoratif shape'ler CSS pseudo-element olabilir.

---

## 10. Teknik implementation yaklaşımı

İlk tercih: React + mevcut Vite + CSS.

Yeni dependency eklemeden önce şu sorular cevaplanır:
1. CSS transition + IntersectionObserver yeterli mi?
2. View Transitions API progressive enhancement olabilir mi?
3. Gerçek morph için küçük bir motion library zorunlu mu?

Kütüphane yalnız ikinci motion slice'ta ve ölçülmüş ihtiyaçla eklenir.

### İlk slice

**Amaç:** Motion olmadan Awwwards seviyesinde kompozisyon.

Teslim:
- routing/entry ayrımı
- nav
- hero
- tüm section skeleton'ları
- gerçek renk/type/grid
- mobile/tablet/desktop layout
- static UI demos
- reduced-motion CSS temeli

### İkinci slice

**Amaç:** üç wow anı + mikro hareketler.

Teslim:
- hero → booking morph
- concierge takeover transition
- final CTA → logo lockup
- controlled in-view enters
- calendar snap
- reminder stagger

### Üçüncü slice

**Amaç:** visual QA + gerçek asset + performans.

Teslim:
- gerçek portraitler
- gerçek product UI screenshot/demo verisi
- responsive crop QA
- Lighthouse/Web Vitals ölçümü
- browser smoke
- reduced motion QA

---

## 11. Accessibility kabul ölçütleri

- tüm CTA'lar semantik `a` veya `button`
- keyboard navigation eksiksiz
- görünür focus
- contrast WCAG AA
- hareket anlam için zorunlu değil
- heading hierarchy bozulmaz
- decorative blobs `aria-hidden`
- mobile menu focus trap ve escape davranışı doğru
- `details/summary` veya erişilebilir accordion
- portre alt metni içerik taşıyorsa anlamlı, dekoratifse boş alt

---

## 12. Performance bütçesi

Hedef:
- LCP ≤ 2.5 s
- CLS < 0.1
- INP < 200 ms

Pratik sınırlar:
- başlangıç JS marketing için mümkün olduğunca küçük
- hero için tek büyük raster asset
- autoplay video yok
- desktop parallax requestAnimationFrame + passive input veya CSS tabanlı
- scroll listener doğrudan layout thrash üretmez
- font sayısı minimum
- preload yalnız gerçek LCP asset/font

---

## 13. Browser / responsive QA matrisi

En az:
- Chrome desktop 1440
- Safari desktop 1440
- Chrome Android 390
- Safari iPhone 390
- tablet 768/834

Kontroller:
- nav
- hero crop
- H1 line breaks
- section overflow
- sticky behavior
- reduced motion
- keyboard
- tap targets
- pricing readability
- final CTA

---

## 14. Static slice kabul kriteri

Kod görevinin ilk dilimi ancak şu koşullarla kabul edilir:

1. `Randevu kolay.` hero'su 1440 ve 390 genişlikte markaya özgü ve güçlü görünür.
2. Landing page, motion kapalıyken de bütün hikâyeyi anlatır.
3. Hero + booking + calendar + concierge + operations + pricing bölümleri tasarım olarak birbirinden ayrışır ama tek marka hissini korur.
4. Public booking veya işletme ekranı davranışı bozulmaz.
5. Tamamlanmamış özellik sahte UI ile yapılmış gibi sunulmaz.
6. Klavye/focus/contrast temel erişilebilirliği geçer.
7. `npm run typecheck` ve `npm run build` geçer.
8. Gerçek UI smoke gerekiyorsa `control-browser` becerisi kullanılarak desktop + mobile görünüm doğrulanır.

---

## 15. Motion slice kabul kriteri

1. Sadece üç büyük wow anı vardır.
2. Motion, içeriğin anlaşılma süresini uzatmaz.
3. Reduced motion aynı içeriği tam sunar.
4. Scroll hijack yoktur.
5. Mobile'da parallax ve pahalı efektler kapalı veya azaltılmıştır.
6. Ana thread uzun task yaratmaz; gözle görülür jank yoktur.
7. Hero LCP motion dependency yüzünden gecikmez.

---

## 16. Kapsam dışı

Bu homepage görevi kendi başına şunları yapmaz:
- F12-02 salon fotoğraf veri modelini,
- F12-03 kategori/fiyat veri modelini,
- F14 adisyonu,
- F15 stok/kasayı,
- F16 yorum/paket/promosyon/prim akışlarını,
- gerçek ödeme entegrasyonunu,
- marketplace'i,
- AI özelliklerini.

Marketing demonstrasyonu bu alanları tamamlanmış gibi gösteremez.

---

## 17. Koordinatöre önerilen görev paketi

Bu iş mevcut F12-02'ye eklenmemelidir; F12-02 salon profili ve public fotoğraf ürün davranışıdır.

Koordinatör, ROADMAP/TASKS semantiğini koruyacak yeni bir ürün/marketing görev kimliği belirlemelidir. Görev paketi en az şunları sabitlemelidir:
- exact main SHA,
- branch,
- `src/marketing/**` ve gerekli entry/routing dosyaları,
- hangi mevcut dosyada tek-yazıcı hakkı olduğu,
- branding PR #69'un merge önkoşulu olup olmadığı,
- static slice / motion slice ayrımı,
- `product-design:image-to-code` becerisinin erişilebilir olup olmadığı,
- CI + browser smoke kabulü,
- merge sırası.

**Sonraki tek somut adım:** koordinatör bu implementation işine TASKS kimliği ve dosya sahipliği versin; uygulayıcı static art-direction slice'ını koda çevirsin.
