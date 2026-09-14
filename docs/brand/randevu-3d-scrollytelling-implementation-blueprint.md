# Randevu 3D Scrollytelling — Implementation Blueprint

**Durum:** Vibe-coding / frontend implementation için teknik üretim planı  
**Tarih:** 14 Eylül 2026  
**Bağlı belgeler:** `randevu-transformation-shotlist-05-08-revised.md`, `randevu-motion-blueprint-frame06-07.md`, `randevu-lookdev-master-decision.md`, `randevu-homepage-implementation-handoff.md`  
**Amaç:** Seçilen Randevu scrollytelling fikrini gerçek tarayıcıda üretilebilir bir 2.5D/3D + DOM hibritine çevirmek.

---

## 1. Production kararı

İlk production sürümünde **tam 3D insan karakteri kullanılmayacak**.

Önerilen mimari:

**2.5D model cutout + gerçek 3D saç parçaları/sweep + gerçek HTML/CSS ürün UI + scroll-scrub timeline**

Neden:

- fotogerçekçi tam 3D insan web için ağır ve uncanny-valley riski taşır,
- seçilmiş model look-dev yönünü korumak 2.5D asset ile daha kolaydır,
- saç düşüşü ve sweep gibi gerçekten derinlik isteyen hareketler 3D kalabilir,
- ürün UI'sı DOM olarak keskin, erişilebilir ve responsive kalır,
- aynı timeline daha sonra tam 3D karaktere yükseltilebilir.

İç teknik kural:

> **Önce hareketi proxy assetlerle doğru kur; final görsel assetleri en son tak.**

---

## 2. Araç zinciri

### Kod

- React 19 / mevcut Vite uygulaması
- `three`
- `@react-three/fiber`
- `@react-three/drei`
- `gsap` + `ScrollTrigger`

İlk sürümde Lenis veya başka smooth-scroll replacement **eklenmez**. Native scroll + ScrollTrigger yeterlidir. Kullanıcının scroll kontrolü elinden alınmaz.

### 3D asset

- Blender
- export: `.glb` / glTF 2.0
- GLB içindeki node adları deterministik tutulur
- gerekirse `gltfjsx` ile React component'e dönüştürülür

### 2.5D insan assetleri

İlk prototip:
- standing cutout
- seated cutout
- gerekirse 8–12 karelik kısa sit-transition image sequence

Production:
- lisanslı/üretilmiş aynı model kimliği
- aynı ışık / wardrobe
- H2/H3 saç state'leri
- desktop ve mobile crop masterları

---

## 3. Neden fizik motoru kullanmıyoruz?

Bu sahne scroll ile ileri **ve geri** oynayabilmelidir.

Gerçek zamanlı fizik motoru:
- geri scroll'da deterministik değildir,
- aynı scroll konumunda aynı pozu garanti etmek zorlaşır,
- debug ve responsive eşleme maliyetini büyütür.

Bu nedenle saç düşüşü fizik gibi **görünür**, ama gerçekte timeline matematiğiyle belirlenir.

Örnek:

```ts
const t = clamp01(remap(progress, 0.28, 0.55));
const y = startY - fallDistance * t * t;
const x = startX + drift * Math.sin(t * Math.PI);
const rotZ = startRot + spin * t;
```

Aynı progress her zaman aynı frame'i üretir.

---

## 4. Repo içinde önerilen dosya yapısı

Gerçek TASKS kimliği atandığında önerilen alan:

```text
src/marketing/transformation/
  TransformationSection.tsx
  TransformationCanvas.tsx
  TransformationDom.tsx
  TransformationScene.tsx
  HairClumps.tsx
  SweepBrush.tsx
  ModelCutout.tsx
  SitTransition.tsx
  PricingReveal.tsx
  useTransformationProgress.ts
  transformation.timeline.ts
  transformation.types.ts
  transformation.css

public/marketing/transformation/
  model-standing.webp
  model-seated.webp
  sit-sequence/
  hair-clumps.glb
  sweep-brush.glb
  chair.webp | chair.glb
```

İlk spike'ta final asset dosyaları yerine proxy geometry kullanılabilir.

---

## 5. DOM + Canvas katman yapısı

```tsx
<section className="transformation-scroll">
  <div className="transformation-stage">
    <Canvas className="transformation-canvas">
      <TransformationScene />
    </Canvas>

    <TransformationDom />
  </div>
</section>
```

CSS:

```css
.transformation-scroll {
  min-height: 360vh;
}

.transformation-stage {
  position: sticky;
  top: 0;
  height: 100svh;
  overflow: clip;
}

.transformation-canvas,
.transformation-dom {
  position: absolute;
  inset: 0;
}

.transformation-dom {
  pointer-events: none;
}

.transformation-dom a,
.transformation-dom button {
  pointer-events: auto;
}
```

Canvas fiziksel dünya içindir. Metin ve ürün UI Canvas içine gömülmez.

---

## 6. Tek master scroll progress

Bütün sahne bir `progress: 0..1` değeriyle sürülür.

GSAP/ScrollTrigger görevi:

- dönüşüm bölümünü pin/sticky bağlamında takip etmek,
- scroll konumunu normalize etmek,
- DOM ve 3D katmanlarına aynı progress'i vermek.

Önerilen state aralıkları:

```text
0.00–0.28  Frame 05 / standing + reminder + customer card
0.28–0.55  Frame 06 / hair falls to feet
0.55–0.78  Frame 07 / sweep
0.78–0.84  lime trail settles into baseline
0.84–0.94  camera pulls back + standing→seated transition
0.90–1.00  pricing cards enter
```

Sahneler ayrı route veya banner değildir. **Aynı world state** ilerler.

---

## 7. Frame 05 implementation

### Canvas

- standing model cutout plane
- H3 base hair already visible
- 3 detachable hair objects H2 silhouette'i tamamlar
- floor henüz düşük görünürlükte

### DOM

- `Unuttu mu? Biz hatırlatırız.`
- reminder card
- customer card

### Progress 0.18–0.28

- detachable hair clumps cut cue alır
- hair parent transform'dan world transform'a geçer
- DOM kartlarının hareketi sakinleşir

---

## 8. Frame 06 — hair fall

3 ana clump için ayrı motion parametreleri:

```ts
const hair = [
  { drift: -0.22, fall: 3.8, spin: -0.8 },
  { drift:  0.08, fall: 4.1, spin:  0.5 },
  { drift:  0.28, fall: 3.6, spin:  1.0 },
];
```

Bunlar örnek değerlerdir; gerçek scene unit'leri asset ölçeğine göre ayarlanır.

### Kamera

- FOV çok az açılır veya camera z geri gider
- pitch `4–7°` aşağı
- modelin ayağı ve floor reveal olur

### DOM

Maksimum 3 friction chip:
- `Deftere bak...`
- `Kim boştu?`
- `Tek tek ara...`

Chip'ler saçlarla aynı normalized düşüş progress'ini kullanır ama DOM transform ile hareket eder.

Copy:

`Uğraş? Az.`

---

## 9. Frame 07 — sweep

### Brush

Blender'dan basit GLB olabilir veya ilk spike'ta box/cylinder proxy.

Node:

```text
SweepBrush
  Handle
  Head
```

### Motion

Progress `0.55–0.78`:

- brush tek yönde gider
- yerdeki clump'ların x/z konumu brush front edge'e bağlanır
- chip'ler DOM tarafında aynı sweep curve ile çıkar
- geri scroll'da hareket tersine döner

### Lime trail

İlk spike:
- DOM/SVG path

Son production:
- SVG veya R3F curve, hangisi daha keskin/ucuzsa

Trail `0.70–0.84` arasında eğriden düz pricing baseline'a morph olur.

Copy:

`Sen uğraşma. Biz toparlayalım.`

---

## 10. Frame 08 — camera pull-back + seated transition

Bu bölümün ilk production yöntemi **full character rig değildir**.

### V1 — önerilen

- standing cutout plane
- seated cutout plane
- sandalye/koltuk foreground occluder
- camera pull-back sırasında 8–12 frame'lik kısa transition sequence veya kontrollü crossfade

Progress:

```text
0.84 standing opacity 1.0
0.86 chair/foreground occlusion grows
0.87–0.92 sit sequence / crossfade
0.92 seated opacity 1.0
0.90–1.00 pricing DOM enters
```

Kullanıcı oturma geçişini görür ama karakter rig'i yüklemek zorunda kalmayız.

### V2 — daha sonra

Tam rigged 3D karakter eklenirse timeline contract değişmez. Sadece `ModelCutout/SitTransition` component'i `RiggedModel` ile değişir.

### Pricing

Pricing kartları DOM'dur.

- lime baseline üstüne oturur
- translateY + opacity
- stagger çok kısa
- model solda/kenarda sakin anchor

---

## 11. İlk vibe-coding spike nasıl yapılmalı?

Final model/saç beklenmez.

### Spike 1 — 60–90 dakika hedefi değil, en küçük davranış kanıtı

Sahneye koy:

- model = mavi `plane`
- 3 hair clump = kahverengi capsule/curve
- sweep = lime/blue box
- floor = plane
- pricing = düz HTML kartları

Kanıtla:

1. stage pin/sticky çalışıyor,
2. scroll progress 0→1 stabil,
3. clump'lar ayağa düşüyor,
4. brush onları süpürüyor,
5. trail baseline'a dönüyor,
6. model state standing→seated değişiyor,
7. pricing geliyor,
8. geri scroll aynı hareketi tersine doğru oynatıyor.

Bu geçmeden final asset üretimine para/zaman harcanmaz.

---

## 12. Kurulum komutları

Gerçek implementation görevi açıldığında başlangıç adayı:

```bash
npm install three @react-three/fiber @react-three/drei gsap
```

GLB React component dönüşümü gerekiyorsa:

```bash
npx gltfjsx public/marketing/transformation/hair-clumps.glb
```

Dependency sürümleri görev başındaki güncel React/Vite uyumluluğuyla lock edilir; bu belge sabit sürüm numarası zorlamaz.

---

## 13. Blender'da gerçekten ne üretilecek?

İlk Blender dosyasında yalnız şunlar yeterlidir:

1. `HairClump_A`
2. `HairClump_B`
3. `HairClump_C`
4. `SweepBrush`
5. opsiyonel basit `Chair`

İnsan modeli Blender'da olmak zorunda değildir.

### Hair clump

- curve/bevel veya low-poly card/mesh
- pivot noktası kesim noktasına yakın
- origin doğru
- transparan/alpha ağır materyalden kaçın
- kahverengi 2–3 ton yeter

### Brush

- low poly
- silhouette önemli
- kobalt sap
- krem head
- lime renk materyal yerine trail çoğunlukla web tarafında üretilebilir

Export:

- glTF 2.0 / GLB
- apply transforms
- yalnız gerekli node'lar
- lights/camera export gerekmez

---

## 14. Performans sınırı

Marketing deneyiminin 3D hissi LCP'yi öldüremez.

- Canvas hero LCP asset'ini bloklamaz
- 3D transformation section viewport'a yaklaşınca lazy-load olabilir
- modeller düşük polygon
- texture boyutu küçük
- DOM UI texture'a çevrilmez
- devicePixelRatio mobile'da clamp edilir
- mobile particle sayısı azaltılır
- reduced-motion tam statik story sunar

Fail-safe:

WebGL açılamazsa statik H2/H3 görsel + normal section akışı gösterilir. CTA ve ürün mesajı kaybolmaz.

---

## 15. Vibe-coding çalışma şekli

Her turda yalnız bir davranış doğrulanır.

Önerilen sıra:

1. pinned stage
2. normalized progress debugger
3. proxy model
4. hair fall
5. floor reveal
6. sweep
7. lime trail
8. standing→seated transition
9. pricing DOM
10. responsive
11. final assets
12. polish

Her adımda sağ üstte development-only debug göstergesi kullanılabilir:

```text
progress 0.437
state HAIR_FALL
fps 60
```

Final build'de kaldırılır.

---

## 16. Kabul kriteri

Spike başarılı sayılırsa:

- normal mouse/trackpad scroll ile çalışır,
- ileri ve geri scroll deterministiktir,
- sahne yatay zıplamaz,
- modelin ayağı hair landing zone ile ilişkilidir,
- sweep gerçekten aynı yerdeki hair clump'ları toplar,
- pricing ancak temizlikten sonra gelir,
- mobile'da aynı hikâye okunur,
- reduced motion'da bilgi kaybı yoktur,
- `npm run typecheck` ve `npm run build` geçer.

---

## 17. TASKS koordinasyonu

Bu belge kod yazma yetkisi vermez. Gerçek uygulama Issue #70 üzerinden TASKS kimliği, exact main SHA, branch ve dosya sahipliği aldıktan sonra başlar.

Önerilen ilk teknik teslim:

**Marketing 3D spike — proxy assets ile pinned stage + hair fall + sweep + seated pricing transition.**

Bu spike final UI veya production asset teslimi değildir; hareket mimarisini kanıtlar.
