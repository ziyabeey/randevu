# Randevu Video-Scroll Implementation Blueprint

**Durum:** Motion production için güncel bağlayıcı teknik yön  
**Tarih:** 14 Eylül 2026  
**Yerine geçtiği production yaklaşımı:** İlk production sürümünde `three` / React Three Fiber / Blender zorunlu değildir. Mevcut Kling motion asset, scrollytelling'in ana hareket katmanı olarak kullanılacaktır.  
**Bağlı belgeler:** `randevu-transformation-shotlist-05-08-revised.md`, `randevu-motion-blueprint-frame06-07.md`, `randevu-homepage-implementation-handoff.md`, `randevu-lookdev-master-decision.md`

---

## 1. Production kararı

Onaylanan güncel yaklaşım:

> **Kling tarafından üretilmiş fotogerçekçi 5 saniyelik salon videosu + gerçek React/HTML/CSS UI + scroll-scrub kontrolü.**

Bu kararın amacı 3D insan, gerçek zamanlı saç fiziği ve Blender üretim maliyetini kaldırmak; görsel gerçekçiliği AI-render edilmiş motion asset ile almak ve ürün/UI katmanını gerçek frontend olarak korumaktır.

### Video ana motion asset'tir

- Modelin yüzü, wardrobe'u ve salon evreni videoda gelir.
- Saç kesimi, kamera aşağı hareketi, saçın zeminde görünmesi, sweep ve modelin oturması videoda gelir.
- Copy, reminder/customer UI, `Uğraş? Az.`, pricing kartları ve CTA videoya gömülmez.
- UI gerçek DOM/React katmanı olarak videonun üstünde/yanında çalışır.

### 3D kararının statüsü

`randevu-3d-scrollytelling-implementation-blueprint.md` araştırma / fallback referansı olarak kalabilir, ancak **ilk production implementation için varsayılan yol değildir**. Three.js / Blender yalnız video yaklaşımı production kriterlerini karşılamazsa yeniden değerlendirilir.

---

## 2. Kullanılacak Kling master asset

Mevcut onaylı örnek asset özellikleri:

- yaklaşık `5.04 s`
- `24 fps`
- `1928 × 1072`
- 16:9'a yakın geniş format
- fotogerçekçi salon reklam/B-roll estetiği

Repo'ya alınırken önerilen canonical isim:

```text
public/marketing/transformation/randevu-transformation-master.mp4
```

Production'da mümkünse ayrıca optimize WebM alternatifi hazırlanır:

```text
public/marketing/transformation/randevu-transformation-master.webm
```

Tarayıcı fallback sırası:

```html
<video muted playsInline preload="auto">
  <source src="...webm" type="video/webm" />
  <source src="...mp4" type="video/mp4" />
</video>
```

Video autoplay olarak hikâyeyi kendi başına oynatmaz. Scroll progress videonun zamanını belirler.

---

## 3. Mevcut videonun gerçek hareket timeline'ı

Kling master'ın gözlenen ritmi yaklaşık şöyledir:

| Video zamanı | Hikâye | Web davranışı |
| ---: | --- | --- |
| `0.00–0.70 s` | model ayakta / sakin başlangıç | Frame 05 giriş, reminder/customer UI görünür |
| `0.70–1.80 s` | kesim hareketi | Frame 05 copy tutulur, UI hafif sakinleşir |
| `1.80–2.70 s` | kamera aşağı inmeye başlar | UI fade/translate out, `Uğraş? Az.` hazırlanır |
| `2.70–3.35 s` | saç parçaları zeminde görünür | Frame 06, `Uğraş? Az.` görünür |
| `3.35–4.15 s` | sweep/fırça saçı temizler | Frame 07, `Sen uğraşma. Biz toparlayalım.` |
| `4.15–5.04 s` | kamera açılır, model koltukta final duruma geçer | Frame 08, pricing reveal başlar |

Bu zamanlar ilk browser spike'ta gerçek asset üzerinde tekrar kalibre edilir. Kullanıcının scroll pozisyonunda video frame'i deterministik olmalıdır.

---

## 4. Scroll mapping

Transformation section yaklaşık `320–380vh` scroll alanına sahip olur.

Viewport içinde video stage:

```css
.transformation-stage {
  position: sticky;
  top: 0;
  height: 100svh;
  overflow: hidden;
}
```

Normalized progress:

```ts
progress = clamp((scrollY - sectionTop) / scrollRange, 0, 1)
video.currentTime = progress * video.duration
```

Doğrudan her scroll event'te kontrolsüz `currentTime` yazmak yerine requestAnimationFrame / damping ile hedef zaman takip edilir. Amaç mousewheel trackpad jitter'ını azaltmaktır.

Önerilen model:

```ts
targetTime = progress * duration
currentTime += (targetTime - currentTime) * 0.18
```

Video ileri ve geri scrub edilebilir. Autoplay zorunlu değildir.

---

## 5. DOM overlay timeline

### Frame 05 / `0.00–0.36 progress`

Video: model ayakta ve kesim başlar.

DOM:
- `Unuttu mu? Biz hatırlatırız.`
- reminder card
- customer card

Kural: ekran kalabalıklaşmaz. Seçilen Frame 05 master yoğunluğu korunur.

### Frame 06 / `0.36–0.66 progress`

Video: kamera saçı takip ederek aşağı iner, saç zemin seviyesine gelir.

DOM:
- önceki UI çıkar
- büyük `Uğraş? Az.` girer
- opsiyonel en fazla 3 friction chip kullanılabilir

Chip'lerin videodaki saçla pixel-perfect fizik eşleşmesi zorunlu değildir. Motion yönü aşağı olmalıdır.

### Frame 07 / `0.66–0.82 progress`

Video: sweep hareketi.

DOM:
- `Sen uğraşma. Biz toparlayalım.`
- lime motion line SVG/CSS olarak sweep arkasında oluşmaya başlar

Lime trail videoya gömülü olmak zorunda değildir. Gerçek DOM/SVG çizgisi olarak markaya tam renk kontrolü sağlanır.

### Frame 08 / `0.82–1.00 progress`

Video: model oturmuş final kompozisyona geçer.

DOM:
- `Fiyatı da kolay olsun.`
- pricing kartları
- CTA
- pricing baseline'a dönüşen lime çizgi

Pricing kartları exact commercial policy kilitlenmeden sahte fiyatlarla yayınlanmaz.

---

## 6. Component mimarisi

TASKS kimliği atandığında önerilen runtime yapı:

```text
src/marketing/transformation/
  TransformationSection.tsx
  TransformationVideo.tsx
  TransformationOverlay.tsx
  ReminderOverlay.tsx
  FrictionOverlay.tsx
  SweepOverlay.tsx
  PricingOverlay.tsx
  useVideoScrollScrub.ts
  transformation.timeline.ts
  transformation.css

public/marketing/transformation/
  randevu-transformation-master.mp4
  randevu-transformation-master.webm
  randevu-transformation-poster.webp
```

Three.js / R3F dependency'si bu slice için eklenmez.

---

## 7. Video layout

Desktop:
- video viewport'u doldurur,
- `object-fit: cover`,
- kritik model bölgesi sağ/orta bölgede korunur,
- sol negatif alan copy/UI için kullanılır.

Video master sağ tarafta insan anchor'ı taşıdığı için desktop composition buna göre korunmalıdır.

### Mobile

Tek bir desktop crop'u körlemesine kullanma.

Öncelik sırası:
1. `object-position` ile model + hareket okunuyorsa aynı asset,
2. gerekirse ayrı mobile crop encode,
3. performans / okunurluk yetmezse poster + sınırlı crossfade/reduced animation.

Modelin yüzü ile sweep aynı anda mobile viewport'a sığmak zorunda değildir; hikâyenin ilgili anında doğru focal point görünür olmalıdır.

---

## 8. Video watermark / clean master

Production asset'te generator watermark kabul edilmez.

Kling'den export edilen master'ın lisans/plan kapsamında watermark-free sürümü varsa o kullanılır. Yoksa production için temiz export / uygun ticari lisanslı kaynak zorunludur.

CSS ile watermark kapatma/crop etme production çözümü olarak kabul edilmez.

---

## 9. Performance

Hedef:
- LCP ≤ `2.5s`
- CLS < `0.1`
- INP < `200ms`

Kurallar:
- poster image ilk paint'i taşır,
- video metadata/preload kontrollüdür,
- video hero LCP'yi kilitliyorsa `preload="metadata"` + poster kullanılır,
- desktop ve mobile encode boyutu ayrı optimize edilebilir,
- sahne viewport dışında ise scrub loop çalışmaz,
- `requestVideoFrameCallback` desteklenen browserlarda kullanılabilir,
- React render state her scroll pixelinde güncellenmez; mutable ref/progress store tercih edilir.

---

## 10. Reduced motion

`prefers-reduced-motion: reduce` durumunda scroll-scrub devre dışı bırakılır.

Önerilen deneyim:
- Frame 05 poster
- kısa dissolve ile seated final poster
- gerçek DOM copy + pricing

Kullanıcı içeriği kaybetmez.

---

## 11. İlk runtime spike kabul kriterleri

Final styling beklenmez. Spike şunları kanıtlamalıdır:

1. Video `100svh` sticky stage içinde çalışır.
2. Scroll 0→1 videoyu 0→duration scrub eder.
3. Yukarı scroll videoyu güvenilir biçimde geri sarar.
4. Frame 05 UI doğru zamanda çıkar.
5. `Uğraş? Az.` saç düşüşünde görünür.
6. Sweep copy sweep sırasında görünür.
7. Pricing yalnız seated final state'e yaklaşırken girer.
8. Mobile'da overflow/crop hikâyeyi bozmaz.
9. Reduced motion fallback vardır.
10. Typecheck/build/browser smoke geçer.

---

## 12. Vibe-coding sırası

Runtime görevi atanır atanmaz şu sırayla ilerlenir:

### Pass 1 — çıplak video scrub
- boş route/section
- sticky video
- progress debug meter
- scrub ileri/geri

### Pass 2 — dört story state
- Frame 05
- Frame 06
- Frame 07
- Frame 08

UI henüz sade placeholder olabilir.

### Pass 3 — gerçek art direction
- typography
- cobalt/lime
- reminder/customer UI
- lime sweep line
- pricing cards

### Pass 4 — mobile + reduced motion + performance

Bu sırada yeni AI video üretimi gerekmez. Mevcut master davranışı implementation için yeterlidir.

---

## 13. Son karar

İlk production sürümünün teknik omurgası:

> **AI-rendered photorealistic motion, code-controlled timing, real product UI.**

Site 3D görünmeye çalışmaz; gerçekçi motion'ı video üretir, etkileşim hissini scroll scrub ve DOM katmanı üretir.
