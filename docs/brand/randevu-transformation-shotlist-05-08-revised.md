# Randevu Transformation — Revised Shotlist 05–08

**Durum:** Ürün sahibinin son yaratıcı kararıyla revize edilmiş bağlayıcı sahne sözleşmesi  
**Tarih:** 14 Eylül 2026  
**Yerine geçtiği bölüm:** `randevu-transformation-shotlist.md` içindeki Frame 05–08 yorumları  
**Bağlı belgeler:** `randevu-lookdev-master-decision.md`, `randevu-motion-blueprint-frame06-07.md`, `randevu-transformation-asset-direction.md`, `randevu-homepage-implementation-handoff.md`

## 1. Yeni ana fikir

Frame 05–08 artık dört ayrı banner gibi davranmaz. Aynı sahne **pinned / sticky scrollytelling** içinde dönüşür.

> **Ayakta yoğunluk → yükler ayağa düşer → zemin temizlenir → kamera açılır → model oturur → karar alanı gelir.**

Fiziksel hikâye:

**kes → düşür → süpür → rahatla → seç**

Bu akışta modelin ekran içindeki dünya koordinatı korunur. Kullanıcı scroll ettikçe başka bir sayfaya geçmiyor hissi değil, aynı sahnenin ilerlediği hissi almalıdır.

---

# 2. Pinned sahne geometrisi

## Desktop

Dönüşüm bölümü yaklaşık `320–380vh` scroll alanı kullanır.

İç sahne:

```css
.transformation-stage {
  position: sticky;
  top: 0;
  height: 100svh;
  overflow: hidden;
}
```

Scroll yalnız normalized `progress: 0 → 1` üretir. Sahne viewport içinde sabit kalır.

### Sabit anchor'lar

- Modelin yatay merkezi yaklaşık viewport'un `%56–62` aralığında kalır.
- Sol taraf copy için ayrılır.
- Sağ/üst alan ürün UI kartı için ayrılır.
- Zemin çizgisi Frame 05'te görünmez veya çok az görünür; Frame 06'da kamera açıldıkça belirir.
- Model sahne boyunca yatayda sıçramaz.

## Mobile

- Aynı hikâye korunur.
- Stage `100svh` sticky kalabilir ancak scroll mesafesi `260–320vh`'ye düşürülebilir.
- Ayak + zemin + sweep okunmuyorsa model biraz küçültülür; yatay crop ile çözülmez.
- Ağır 3D yerine H2/H3 pre-render pose state'leri kullanılabilir.

---

# 3. FRAME 05 — Ayakta / dönüşüm merkezi

**İlgili progress:** `0.00–0.28`  
**Ana mesaj:** `Unuttu mu? Biz hatırlatırız.`

## Model

- Seçilen master model.
- **Ayakta.**
- Lacivert önlük + kırık beyaz/krem iç katman korunur.
- Saç H2/H3 geçişinde, omuz civarında.
- Gövde ve diz üstü okunabilir; henüz ayağı göstermek zorunlu değildir.
- Duruş rahat fakat hâlâ işin içindedir.

## Kamera

- Yaklaşık medium / 3⁄4 body.
- Kamera göz–göğüs hizasında.
- Frame 05 boyunca modelin başı ve gövdesi ekranda sabit anchor hissi verir.

## UI

Yalnız iki ürün kanıtı:

1. reminder card  
   `Randevunuz yarın 14:30'da.`
2. küçük müşteri kartı

Ek yazı kalabalığı yoktur.

Maksimum 2–3 küçük friction chip hazırlanabilir ancak bu frame'in başında görünmez veya çok siliktir.

## Son kesim

Progress yaklaşık `0.18–0.28`:

- son detachable hair parçaları ayrılır,
- ana H3 saç silueti modelin üzerinde kalır,
- makas cue'su kısa ve kontrollüdür,
- kesilen saçlar aşağı doğru fizik yoluna girer.

**Önemli:** saçlar sahnenin dışına yanlara uçmaz. Ana hareketleri aşağı doğrudur.

---

# 4. FRAME 06 — Saçlar modelin ayağına düşer

**İlgili progress:** `0.28–0.55`  
**Ana mesaj:** `Uğraş? Az.`

## Kamera

Kamera/model dünyası kesilmez.

Progress ilerledikçe:

- kamera hafif geri açılır,
- pitch yaklaşık `4–7°` aşağı iner,
- model artık **tam boy veya en az diz altı + ayaklar** okunacak kadar görünür,
- ayağın temas ettiği zemin açıkça görünür.

Kamera pan yapıp başka sahneye gitmez. Kullanıcı Frame 05'teki kişiyle aynı fiziksel ortamda olduğunu anlamalıdır.

## Saç fiziği

3 ana detachable hair parçası:

- yerçekimi yönünde aşağı düşer,
- çok hafif yaw/roll yapar,
- havada uçuşan yaprak gibi uzun süre asılı kalmaz,
- modelin **ayağının dibindeki hedef bölgeye** iner.

Desktop secondary fragments: `8–14`  
Mobile: `3–6`

### Ground target

Saçların çoğu modelin ön ve hafif sağ/sol ayağının çevresinde yaklaşık `%20–30` viewport genişliğinde bir alanda birikir.

Saç birikintisi pricing sahnesinde kalmaz; Frame 07'de tamamen temizlenir.

## Friction chip'leri

En fazla üç tane:

- `Deftere bak...`
- `Kim boştu?`
- `Tek tek ara...`

Chip'ler DOM katmanında kalır ama saçlarla aynı düşüş eğrisini paylaşır.

Chip'ler ayağın yakınında fade etmez; sweep tarafından gerçekten toplanacak kadar aşağı gelir.

## Copy

Sol tarafta büyük fakat tek mesaj:

> **Uğraş? Az.**

Başka açıklama gerekmez.

---

# 5. FRAME 07 — Ayağın dibindeki saçlar süpürülür

**İlgili progress:** `0.55–0.78`  
**Ana mesaj:** `Sen uğraşma. Biz toparlayalım.`

## Model

- H3 final saç formu.
- Hâlâ **ayakta**.
- Model yatayda ve dünyada yerini korur.
- Bu frame'de model yeni bir poz vermeye başlamaz; sweep ana harekettir.

## Kamera

- Frame 06 sonunda ulaşılan genişlik korunur.
- Ayaklar + zemin + saç yığını net görünür.
- Sweep okunmadan önce kamera yukarı dönmez.

## Sweep objesi

Stilize salon floor brush:

- kobalt sap,
- krem/nötr gövde,
- lime movement trail.

Tek geçiş yapar. İleri geri temizlik animasyonu yoktur.

### Yön

Tercih edilen yön: **sağdan sola veya soldan sağa, modelin ayaklarının önünden geçen tek yatay sweep**.

Yön production layout'a göre seçilebilir, ancak pricing kartlarının geleceği temiz alanı açmalıdır.

## Fizik

Sweep geldiğinde:

- yerdeki ana saç parçaları fırçaya bağlanır / itilir,
- secondary fragments aynı yönde sürüklenir,
- friction chip'leri de saçlarla beraber gider,
- hiçbir saç parçası pricing reveal'de görünmez.

## Lime trail

Sweep arkasında kalan lime çizgi dekor değil geçiş geometrisidir.

Progress `0.70–0.78` civarında:

- çizgi stabilize olur,
- eğriliği azalır,
- yatay pricing baseline/grid haline gelmeye başlar.

Copy:

> **Sen uğraşma. Biz toparlayalım.**

Bu copy sweep tamamlandıkça görünür; sweep'i kapatmaz.

---

# 6. FRAME 08 — Kamera uzaklaşır, model oturur, pricing gelir

**İlgili progress:** `0.78–1.00`  
**Ana mesaj:** `Fiyatı da kolay olsun.`

## Geçiş mantığı

Bu sahne ani bir kesme değildir.

Önce:

1. sweep tamamlanır,
2. lime baseline sabitlenir,
3. kamera yavaşça geri açılmaya başlar,
4. model ayakta anchor'dan **oturmuş final pose'a** geçer,
5. pricing kartları açılan negatif alana yerleşir.

## Ayakta → oturma

### Tercih A — gerçek 3D/rig

Model rig'i varsa:

- ağırlık önce bir ayağa kayar,
- kalça/torso koltuğa doğru iner,
- kamera pull-back ile hareketi yumuşatır,
- toplam pose transition progress'i yaklaşık `0.80–0.90`.

### Tercih B — 2.5D / pre-render

Performans veya asset sınırı varsa:

- standing ve seated master pose aynı ışık/kamera ekseninde hazırlanır,
- kamera pull-back sırasında foreground chair/blue blob kısa süre modelin alt gövdesini örter,
- bu occlusion anında standing → seated state crossfade/morph yapılır,
- yüz ve wardrobe continuity bozulmaz.

Bu fallback kabul edilir ve mobil için tercih edilebilir.

## Final model pozu

- model koltukta oturur,
- artık elinde makas olmak zorunda değildir,
- beden dili daha rahat,
- model pricing'in rakibi değil duygusal anchor'dır,
- H3 saç formu net görünür.

### Metafor

Ayakta olmak = işin içinde koşturma  
Oturmak = işler toparlandı, artık karar vermek kolay

Bu anlam copy ile açıklanmaz; sahne davranışıyla hissedilir.

## Kamera

- yumuşak pull-back,
- finalde pricing için geniş negatif alan,
- lens hissi değişmez; yalnız camera distance/FOV kontrollü biçimde açılır,
- zoom efekti gibi yapay görünmez.

## Pricing reveal

Pricing kartları lime baseline üstüne `translateY + opacity` ile oturur.

Sıra:

1. başlık,
2. ana fiyat/paket kartı,
3. gerekiyorsa ikincil seçenek,
4. CTA.

Fiyat politikası kesinleşmeden sahte 3 paket zorunlu değildir.

Copy:

> **Fiyatı da kolay olsun.**

Alt:

> Ne alacağını, ne ödeyeceğini ilk bakışta gör.

---

# 7. Kamera süreklilik kuralları

Frame 05–08 boyunca aşağıdakiler yasaktır:

- modelin bir anda ekranın karşı tarafına geçmesi,
- ayrı banner/cut hissi,
- saçların yana veya kameraya doğru ana hareket yapması,
- sweep öncesi zeminin kaybolması,
- Frame 08'de alakasız yeni salon/ışık/kostüm,
- model otururken hard cut.

### Kamera yolu özeti

`medium standing → gentle pull-back/down reveal → feet/floor readable → sweep hold → smooth pull-back → seated wide final`

---

# 8. Scroll progress özeti

| Local progress | Sahne |
| --- | --- |
| `0.00–0.18` | Ayakta Frame 05, reminder + müşteri kartı |
| `0.18–0.28` | Son kesim / detach |
| `0.28–0.48` | Saçlar aşağı düşer |
| `0.48–0.55` | Saç ayağın dibinde birikir, `Uğraş? Az.` |
| `0.55–0.72` | Sweep saçları ve 3 chip'i toplar |
| `0.72–0.78` | Lime trail pricing baseline olur |
| `0.78–0.90` | Kamera geri açılır + ayakta→oturma |
| `0.90–1.00` | Pricing reveal + final sakinlik |

---

# 9. Reduced motion

`prefers-reduced-motion` altında:

1. Frame 05 standing H2/H3 statik kare,
2. kısa crossfade ile yerdeki saç birikintisi,
3. statik sweep-sonrası temiz zemin,
4. seated H3 + pricing.

Fizik animasyonu zorunlu değildir. Hikâye sırası değişmez.

---

# 10. Kabul ölçütleri

Bu 05–08 sahnesi ancak şu durumda kabul edilir:

1. Kullanıcı scroll ederken modelin **aynı fiziksel sahnede kaldığını** hisseder.
2. Saçların ana hareketi gerçekten **ayağa doğru aşağıdır**.
3. Frame 06 sonunda saç zeminde ve modelin ayağı yakınında görünür.
4. Sweep saçları fiziksel olarak o bölgeden temizler.
5. Sweep'ten kalan lime trail pricing layout'una dönüşür.
6. Model pricing gelmeden önce veya pricing ile birlikte **oturmuş final pose'a** geçer.
7. Oturma geçişi hard cut gibi görünmez.
8. Frame 08, önceki sahnenin devamı gibi görünür; yeni bir banner gibi değil.
9. Mobile ve reduced-motion aynı anlatı sırasını korur.
10. Görsel şov copy ve ürün karar alanını bastırmaz.

## Kilit yaratıcı cümle

> **Ayakta yoğunluktan, oturan sakinliğe.**

Bu cümle iç art-direction kuralıdır; site copy'si olmak zorunda değildir.
