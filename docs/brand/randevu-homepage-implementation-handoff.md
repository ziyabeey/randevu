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