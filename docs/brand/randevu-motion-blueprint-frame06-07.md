# Randevu — Frame 06–07 Motion Blueprint

**Durum:** Onaylı scrollytelling yönü için uygulamaya hazır motion sözleşmesi  
**Tarih:** 14 Eylül 2026  
**Bağlı belgeler:** `randevu-transformation-scrollytelling-storyboard.md`, `randevu-transformation-shotlist.md`, `randevu-transformation-asset-direction.md`, `randevu-lookdev-master-decision.md`, `randevu-homepage-implementation-handoff.md`  
**Kapsam:** Frame 05 çıkışı → Frame 06 saçların düşüşü → Frame 07 sweep temizliği → Frame 08 pricing reveal girişi.

---

## 1. Sahnenin tek cümlelik amacı

> **Kes → düşür → temizle → düzen kur.**

Bu bölüm 3D şov değildir. Randevu'nun ana vaadini fiziksel olarak oynar: kullanıcının üzerindeki küçük işler azalır, ortalık toparlanır ve karar alanı sadeleşir.

E-kolay yaratıcı mantığı korunur:

**gündelik yük → görünür rahatlama → kısa cümle → kolaylık.**

---

## 2. Başlangıç ve bitiş durumu

### Başlangıç — Frame 05 çıkışı

- Master model aynı kişi ve aynı styling'dedir.
- Saç H2/H3 geçişindedir; omuz civarı, dönüşüm belirgindir.
- Reminder kartı ve müşteri kartı görünür durumdadır.
- Ana mesaj: `Unuttu mu? Biz hatırlatırız.`
- Sahne hâlâ ürün kanıtı taşır.

### Bitiş — Frame 08 girişi

- Model H3 final saç formundadır.
- Kesilmiş saç parçaları tamamen temizlenmiştir.
- Sweep objesi sahneden çıkmıştır.
- Sweep'in lime izi yatay bir grid/baseline'a dönüşmüştür.
- Pricing kartlarının oturacağı sakin alan açılmıştır.
- Ana mesaj: `Fiyatı da kolay olsun.`

---

# 3. Scroll zaman çizgisi

Bu yüzdeler yalnız ilgili dönüşüm bölümünün kendi progress değeridir; tüm sayfanın mutlak scroll yüzdesi değildir.

| Progress | Olay |
| --- | --- |
| `0.00–0.12` | Frame 05 tutulur, UI sakinleşir |
| `0.12–0.28` | Son kesim cue'su, 3 ana hair mesh detach olur |
| `0.28–0.48` | Saç parçaları ve 3 sürtünme chip'i aşağı düşer |
| `0.48–0.58` | Kamera maksimum %6–8 aşağı takip eder; zemin görünür |
| `0.58–0.66` | Kısa `Uğraş? Az.` anı; düşüş tamamlanır |
| `0.66–0.82` | Sweep objesi tek yönde sahneyi temizler |
| `0.82–0.90` | Lime trail düzleşir ve pricing baseline olur |
| `0.90–1.00` | Sweep çıkar; pricing kartları baseline üstüne oturur |

**Kural:** Kullanıcı scroll'u bırakırsa sahne o anda anlamlı bir kare olarak kalmalıdır. Zorunlu autoplay yoktur.

---

# 4. Katman mimarisi

## 4.1 3D / pre-render katmanı

Bu katman yalnız fiziksel dönüşümü taşır:

- model / model cutout veya 3D eşdeğeri,
- H2 → H3 hair state,
- 3 ana detachable hair mesh,
- 8–16 küçük secondary hair fragment desktop,
- makas cue'su,
- salon sweep/floor brush.

## 4.2 DOM / HTML-CSS katmanı

Okunabilir ürün ve metin 3D texture'a gömülmez:

- reminder kartı,
- customer card,
- `Uğraş? Az.`,
- `Sen uğraşma. Biz toparlayalım.`,
- pricing kartları,
- CTA'lar,
- logo/brand lockup,
- sürtünme chip'leri.

DOM ve 3D aynı normalized progress değeriyle senkron edilir.

---

# 5. Saç kesim mekaniği

## 5.1 Hair state

Frame 05 sonunda ana kafada H3 silhouette hazırdır. Kesilecek 3 tutam H2 görünümünü tamamlayan ayrı mesh/plane olarak H3'ün üstünde durur.

Scroll `0.12`'yi geçtiğinde:

1. kesim cue'su görünür,
2. detachable tutamların parent bağı kaldırılır,
3. H3 ana saç formu altta kesintisiz kalır,
4. düşen tutamlar bağımsız fizik/motion yoluna geçer.

Bu yöntem gerçek zamanlı saç kesme simülasyonundan daha kontrollü ve performanslıdır.

## 5.2 Ana tutam sayısı

- 3 büyük tutam zorunlu,
- desktop 8–16 küçük parça,
- mobile 3–6 küçük parça.

Binlerce tel simüle edilmez.

## 5.3 Düşüş karakteri

Saç taş gibi düşmez.

Her ana parça:

- farklı 40–120 ms gecikme,
- düşük başlangıç yatay hızı,
- yerçekimi hissi,
- hafif `rotateZ/rotateX`,
- küçük sway,
- zemine yaklaşırken daha az rotasyon

alır.

Görsel hedef: **tatmin edici ve hafif**, hipergerçekçi fizik değil.

---

# 6. Sürtünme chip'leri

Saçlarla beraber yalnız **3 chip** düşer. Daha fazlası Frame 05'te yaşanan yazı karmaşasını geri getirir.

Önerilen set:

- `Deftere bak...`
- `Kim boştu?`
- `Tek tek ara...`

Alternatiflerden biri gerektiğinde `Mesajı unutma...` olabilir, ama aynı anda maksimum üç chip görünür.

### Davranış

- saç parçasıyla birebir yapışık değiller,
- aynı aşağı yönlü ritimde ayrı DOM layer olarak hareket ederler,
- saçtan daha yavaş düşerler,
- opacity düşüş boyunca %100 → %80 olur,
- sweep dokunduğunda tamamen kaybolurlar.

**Kural:** kullanıcı chip okumak zorunda değildir; motion kapalıyken anlam kaybı olmaz.

---

# 7. Kamera hareketi

Kamera saçları takip eder ama hikâyeyi terk etmez.

### Düşüş sırasında

- maksimum `6–8%` aşağı offset,
- maksimum `2°` pitch,
- lateral orbit yok,
- zoom değişimi minimum.

### Sweep sırasında

Kamera tekrar ana kompozisyona döner.

### Pricing reveal

Frame 08'e yaklaşırken çok hafif pull-back yapılabilir; kullanıcı model + pricing alanını birlikte görür.

**Yasak:** yere kadar dramatik kamera dalışı, spin, lens warp veya motion sickness yaratacak hareket.

---

# 8. Frame 06 — “Uğraş? Az.”

## Görsel an

Saç parçaları alt üçte bire ulaşmıştır. Model hâlâ yukarıda sakin ve görünürdür. UI kanıtları geri çekilir; reminder/customer kartları opacity azaltarak sahneyi boşaltır.

## Copy

> **Uğraş? Az.**

Bu copy 300–500 ms eşdeğer scroll mesafesinde tek büyük tipografik an olarak belirir.

### Motion

- `Uğraş?` önce görünür,
- `Az.` lime organik küçük balon/shape içinde oturabilir,
- kullanıcı scroll'u sürdürünce ikisi fade/translate ile çekilir.

Bu bir ara başlıktır; yeni bölüm değildir.

---

# 9. Frame 07 — Sweep temizliği

## 9.1 Obje

Stilize salon floor brush:

- kobalt sap,
- krem gövde,
- lime kıllar veya lime motion edge,
- ev süpürgesi estetiği yok,
- hafif oyuncaklaştırılmış 2000'ler reklam objesi sıcaklığı.

## 9.2 Giriş yönü

Varsayılan desktop yönü: **sağdan sola değil, soldan sağa.**

Neden:

- Türkçe/Latin okuma yönüyle uyumlu ilerleme hissi verir,
- pricing alanı sağ/merkezde açılabilir,
- lime trail doğal olarak sonraki grid çizgisine uzar.

Kompozisyon gerektirirse yalnız tüm sahne aynalanarak ters yön kullanılabilir; aynı build içinde yön rastgele değişmez.

## 9.3 Tek sweep kuralı

Sweep sadece **bir kez** geçer.

1. objenin başı saç kümesine temas eder,
2. saç parçaları sweep yönüne doğru sürüklenir,
3. chip'ler sweep sınırı geçtiği anda fade olur,
4. saçlar brush altında/önünde sıkışmış küçük bir küme halinde sahneden çıkar,
5. brush geri dönmez.

Bu hareket 2–3 tur temizlik yapmaz; tek ve kendinden emin bir hareket olmalıdır.

## Copy

> **Sen uğraşma. Biz toparlayalım.**

Copy sweep başlamadan hemen önce görünür, sweep bitene kadar kalır, sonra pricing başlığına alan bırakır.

---

# 10. Lime trail → pricing baseline morph

Bu hareket sahnenin imza transition'ıdır.

### Aşama 1 — Trail

Sweep ilerlerken arkasında organik, hafif kıvrımlı lime çizgi oluşur.

### Aşama 2 — Düzleşme

Brush sahneden çıkarken çizginin kontrol noktaları aşağı/yatay bir hatta yaklaşır.

### Aşama 3 — Grid

Tek çizgi:

- pricing kartlarının taban çizgisi,
- çok hafif section divider,
- veya kartların oturduğu görsel baseline

haline dönüşür.

### Aşama 4 — Kartların oturması

Pricing kartları 12–24 px aşağıdan hafif translate ile baseline üstüne oturur. Bounce minimumdur.

**Hedef his:** “temizlik bitti, yapı kuruldu.”

---

# 11. Pricing reveal ile bağlantı

Frame 08 finalinde hareket belirgin biçimde azalır.

### Copy

> **Fiyatı da kolay olsun.**

Alt:

> Ne alacağını bakınca anlayacağın kadar net.

### Motion

- pricing başlığı fade/translate,
- kartlar kısa stagger veya tek grup halinde settle,
- model hareketi durulur,
- background particle kalmaz,
- sweep artık görünmez.

**Kural:** karar anı, sayfanın en sakin bölümlerinden biri olmalıdır.

Pricing içerikleri ticari karar kesinleşmeden placeholder olarak production'a çıkmaz.

---

# 12. Teknik uygulama seçenekleri

Teknoloji seçimi uygulama görevinin sahibi tarafından ölçülerek yapılır. Bu belge dependency dayatmaz.

## Seçenek A — 2.5D / pre-render öncelikli

Önerilen ilk yaklaşım:

- H2/H3 model state'leri pre-render/cutout,
- detachable hair parçaları WebP/AVIF/SVG/transparent sprite veya hafif canvas layer,
- DOM UI + CSS transforms,
- sweep SVG/3D pre-render asset,
- normalized scroll progress ile bütün katmanların yönetimi.

Avantajı: düşük JS/GPU maliyeti, mobil kontrolü yüksek.

## Seçenek B — gerçek 3D

Yalnız ölçüm bunu haklı çıkarırsa:

- Three.js / React Three Fiber benzeri scene layer,
- detachable hair meshes,
- basit rigid/kinematic motion,
- DOM overlay UI.

Gerçek 3D saç simülasyonu yapılmaz.

---

# 13. Mobile davranışı

Mobile'da hikâye korunur, fizik sadeleşir.

- model crop yüz + omuz + saç dönüşümünü korur,
- 3 ana saç parçasından 2'si yeterli olabilir,
- secondary fragments %50–75 azaltılır,
- chip sayısı `2` olabilir,
- kamera vertical tracking kapatılabilir,
- sweep ekranın alt üçte birinde geçer,
- pricing kartları tek sütun stack olur,
- lime trail kartların üst/alt separator çizgisine dönüşebilir.

Mobile performans uğruna anlam feda edilmez; dekor azaltılır.

---

# 14. Reduced-motion davranışı

`prefers-reduced-motion: reduce` altında:

1. Frame 05 statik H3 modele crossfade eder.
2. Saç parçaları fiziksel düşmez; kısa dissolve/opacity ile kaybolur.
3. `Uğraş? Az.` statik görünür.
4. Sweep hareketi yapılmaz; lime çizgi doğrudan reveal olur.
5. Pricing kartları fade-in ile gelir.

Aynı hikâye ve aynı metin korunur.

---

# 15. Performance budget

Bu transition tek başına homepage performansını bozmaz.

- hair particle sayısı sınırlı,
- scroll handler layout thrash üretmez,
- transform/opacity öncelikli,
- ağır blur animasyonu yok,
- hero LCP ile aynı anda 3D bundle yüklenmesi zorunlu değil,
- dönüşüm sahnesi lazy-load edilebilir,
- mobile'da DPR / particle / 3D detail sınırlandırılır.

Frame 06–07 için yeni motion dependency eklenirse bundle ve main-thread maliyeti ayrıca ölçülür.

---

# 16. Production asset checklist

Gerekli minimum assetler:

- master model Frame 05 H2/H3 referansı,
- H3 final model state,
- 3 detachable main hair clump,
- 8–16 desktop secondary fragment,
- makas cue,
- salon floor brush master,
- lime trail vector/path,
- 3 friction chip component,
- Frame 08 pricing baseline/grid state.

Her asset desktop + mobile crop/variant açısından kontrol edilir.

---

# 17. Acceptance kriterleri

Motion slice ancak şu koşullarla kabul edilir:

1. Kullanıcı aşağı kaydırdığında saç gerçekten aşağı doğru düşüyor hissi verir.
2. Düşüş, modelin final H3 saç formunu bozmaz veya kopuk göstermiyor.
3. Aynı anda maksimum üç friction chip görünür; yazı karmaşası oluşmaz.
4. Sweep tek temiz hareketle sahneyi toplar; geri dönüş yapmaz.
5. Lime trail pricing alanına fiziksel olarak bağlanır.
6. Frame 08'e gelindiğinde sahne belirgin biçimde sakinleşir.
7. Scroll bırakıldığında ara kareler görsel olarak bozuk görünmez.
8. Mobile'da anlatı korunur ve jank görülmez.
9. Reduced-motion tam ve anlaşılır alternatif sunar.
10. UI/metin 3D texture içinde okunmaz hale gelmez; DOM katmanında kalır.
11. Tamamlanmamış özellik veya kesinleşmemiş pricing production'da gerçekmiş gibi sunulmaz.

---

## Son yaratıcı kontrol

Bu sahne izlendiğinde kullanıcı teknoloji düşünmemelidir.

Hissetmesi gereken yalnızca şudur:

> **"Bir sürü ufak işi benim yerime toparlıyor."**
