# Randevu Ana Sayfa — Art Direction & Interaction Spec

**Durum:** Onaylı marka yönü için uygulamaya hazır yaratıcı sözleşme  
**Tarih:** 14 Eylül 2026  
**Bağlı belgeler:** `randevu-branding.md`, `randevu-site-copy-card-system.md`, `randevu-homepage-copy.md`, `f12-01-visual-flow-contract.md`  
**Yaratıcı hedef:** Awwwards seviyesinde, ancak dönüşümü ve kullanım kolaylığını bozmayan bir marketing deneyimi.

---

## 1. Yaratıcı tez

Ana sayfanın hissi:

**2000'ler Türk internet iyimserliği × 2026 editorial ürün gösterimi × güzellik sektörünün insan sıcaklığı.**

Site, klasik beyaz SaaS landing page görünümünden kaçınır. İlk izlenim "güzel yazılım" değil, **"bu marka aklımda kalır ve beni uğraştırmaz"** olmalıdır.

Awwwards seviyesi burada şu anlama gelir:

- güçlü ve özgün art direction,
- bölüm bölüm değişen ama tek kimlikte kalan ritim,
- motion ile ürün davranışını anlatma,
- gerçek insan + gerçek ürün ekranı birlikteliği,
- yüksek tipografik cesaret,
- kusursuz mobil karşılık,
- erişilebilirlik ve performanstan ödün vermeme.

**Awwwards klişeleri kullanılmaz:** gereksiz custom cursor, okunmayan minik yazı, 20 saniyelik loader, ağır WebGL, scroll'u kullanıcıdan alan hijack davranışı ve dekoratif 3D kalabalık yasaktır.

---

## 2. Marketing ile ürün yüzeyi ayrımı

### Marketing site

Cesur, hareketli, editoryal, büyük tipografi ve gerçek yüz kullanabilir.

### Gerçek rezervasyon / işletme yüzeyleri

F12 sözleşmesindeki sakin premium, açık hiyerarşi ve mobil öncelikli yapı korunur. Marketing sayfasındaki eğik kartlar, iri doodle'lar ve kinetik tipografi gerçek rezervasyon formuna taşınmaz.

**Kural:** site heyecan verir; ürün sakinleştirir.

---

## 3. Sayfa ritmi — üç perde

### Perde 1 — Tanışma / “Bu kolaymış”
Hero + rezervasyon demosu + takvim.

### Perde 2 — Rahatlama / “Bunu ben yapmak zorunda değilim”
Hatırlatma + müşteri hafızası + concierge kurulum + `Uğraş? Az.`

### Perde 3 — Güven / “Buna para veririm”
Gün özeti + gerçek pilot kanıtı + fiyat + FAQ + final CTA.

Her perdede tek bir büyük “wow” anı bulunur. Bir ekranda iki büyük motion fikri aynı anda yarışmaz.

---

# 4. Section-by-section wireframe ve hareket koreografisi

## 00 — Floating navigation

**Desktop:** 12 kolon içinde ortalanmış, sayfanın üstünde yüzen yarı opak açık yüzey.  
**Mobile:** sade header; logo + menü + tek CTA.

İçerik:
- solda `randevu / kolay` lockup,
- ortada `Nasıl çalışır?`, `İşletmen için`, `Fiyat`,
- sağda `Giriş yap` + lime `Kolay başlayalım`.

Scroll sonrası navbar 8–12 px küçülür, gölge yerine hafif blur ve ince sınır kazanır.

---

## 01 — Hero / “Randevu kolay.”

**Yükseklik:** min. `100svh`, desktop 880–980 px hedef.  
**Grid:** 12 kolon.

### Kompozisyon

- Sol 7 kolon: dev H1.
- Sağ 5 kolon: gerçek insan yüzü / salon profesyoneli.
- Ürün UI kartı portre üzerine kontrollü biçimde bindirilir.
- Arkada logonun organik mavi formunu anımsatan dev kobalt shape.
- Lime çizgi H1'in altına “elle çekilmiş” hissiyle gelir.

### H1

`Randevu kolay.`

Desktop display boyutu yaklaşık `clamp(72px, 9vw, 152px)`.  
Satır yüksekliği 0.88–0.94.  
Letter spacing negatif ama okunur.

### Motion

İlk yükte:
1. kobalt form scale 0.94 → 1,
2. yüz 16 px yukarı oturur,
3. `Randevu` gelir,
4. 120 ms sonra `kolay.` belirir,
5. lime underline çizilir,
6. son olarak ürün demo kartı yüzer.

Toplam açılış koreografisi 850 ms'yi geçmez.

Mouse hareketinde portre max 3% ve UI kartı max 6% parallax yapabilir. Mobilde parallax kapalıdır.

### CTA

Birincil: `Birlikte kuralım`  
İkincil: `Nasıl çalışıyor?`

### Hero alt geçişi

Aşağı kaydırırken UI rezervasyon kartı hero'dan kopmaz; bir sonraki bölümdeki telefon ekranının içine “yerine oturur”. İlk büyük wow anı budur.

---

## 02 — Sticky product story / “Müşteri kendi alsın.”

**Desktop scroll alanı:** yaklaşık 220–260vh.  
**Mobile:** normal dikey 4 adım, sticky zorunlu değil.

### Layout

Sol tarafta 5 kolon sticky metin; sağda 7 kolon büyük telefon / browser frame.

Metin sabit:

`Müşteri kendi alsın.`

Sağdaki ürün dört gerçek adım üzerinden değişir:
1. hizmet seç,
2. personel / fark etmez,
3. saat seç,
4. randevu tamamlandı.

Her adımda ekran yeniden çizilmez; aynı UI içindeki seçimler ilerler.

### Motion

- seçilen hizmet satırı lime ile hafifçe dolar,
- personel chip'i yer değiştirir,
- saat hücresi 1.02 scale ile oturur,
- final confirmation küçük konfeti yerine tek lime tik + kısa “hazır” animasyonu kullanır.

**Amaç:** motion dekor değil, ürün demonstrasyonu.

---

## 03 — Kobalt stage / “Kim boş, kim dolu? Bakınca belli.”

Tam genişlik kobalt bölüm.

### Layout

- Başlık oversized beyaz.
- Gerçek takvim ekranı dev bir yatay panel olarak gelir.
- Personel kolonları okunur.
- Bir “uygun saat” lime ile belirginleşir.

### Scroll choreography

Takvim aşağıdan gelir, section merkezinde 0.8 viewport boyunca sticky kalır. Scroll ilerledikçe üç dolu kart farklı çalışan kolonlarına oturur; bir boş slot açık kalır.

Yan metin:

`Çakışma aramakla uğraşma.`

İkinci büyük wow anı burada değil; bölüm güçlü ama kontrollüdür.

---

## 04 — Reminder playground / “Unuttu mu? Biz hatırlatırız.”

**Zemin:** açık mavi `#D9ECFF`.

### Kompozisyon

Büyük beyaz alan içinde tek telefon veya mesaj paneli. Çevresinde 2–3 mesaj balonu.

Balon örnekleri:
- `Yarın 14.30'da görüşüyoruz.`
- `Randevun hazır.`

Bir balonun gönderim animation'ı 500–650 ms.

**Yasak:** 8 tane uçuşan chat balonu, notification yağmuru, WhatsApp markasını işlev yayında değilse kullanmak.

---

## 05 — Editorial portrait / “Müşteri kimdi? Hatırlamak zorunda değilsin.”

**Zemin:** kırık beyaz + pudra pembe editorial blok.

### Layout

Asimetrik magazine spread:
- 7 kolon gerçek yüz / salon içi yakın plan,
- 5 kolon müşteri kartı UI.

Müşteri kartı portre üzerine değil, ayrı temiz yüzeyde kalır.

Başlık iki satır:

`Müşteri kimdi?`  
`Hatırlamak zorunda değilsin.`

İkinci satır daha küçük olabilir.

### Motion

Scroll'da müşteri kartındaki yalnız 3 veri sırasıyla görünür: son randevu, kısa not, yaklaşan randevu. Gizli sağlık/klinik verisi veya henüz olmayan alan gösterilmez.

---

## 06 — Concierge takeover / “Sen kurma. Biz hazırlayalım.”

**Zemin:** lime `#C6E800`; tam genişlik.

Bu bölüm markanın stratejik farklılaştırıcısıdır.

### Layout

Sol yarı: büyük gerçek insan, doğrudan kameraya bakan sıcak ekip/salon yüzü.  
Sağ yarı: dev başlık + üç büyük satır.

`Hizmetler ✓`  
`Çalışanlar ✓`  
`Çalışma saatleri ✓`

CTA: `Birlikte kuralım`

### Motion

Checklist satırları scroll ile tek tek değil, kullanıcının bölüme girişinde hızlı 3 adımlı “hazırlandı” hissiyle gelir.

Bu bölümde UI ekranı kullanmak zorunlu değildir. İnsan hizmetini satıyoruz.

---

## 07 — Kinetic interlude / “Uğraş? Az.”

Kısa, 60–75vh ara bölüm.

### Art direction

Krem zemin üzerinde dev tipografi:

`UĞRAŞ?`  
`AZ.`

Etrafında küçük gündelik sürtünmeler:
- `defter karıştırmak`,
- `tek tek müsait misin diye sormak`,
- `müşteriyi yeniden aramak`,
- `hangi saatti diye bakmak`.

Scroll ile bu küçük metinler ekran kenarına çekilir, merkezde yalnız `AZ.` kalır.

Bu e-kolay dilinin en belirgin reklam anıdır; birebir eski kampanya kopyası değildir.

---

## 08 — Dark operations / “Bugün ne olmuş? Tek yerde.”

**Zemin:** gece mavisi `#15386D`.

### Layout

- Büyük açık renk başlık,
- gerçek dashboard / gün özeti kartları,
- yalnız yayındaki metrikler.

MVP ilgili fazlar tamamlanana kadar adisyon, stok, kasa, prim gibi veriler placeholder bile olarak gösterilmez.

### Motion

Kartlar bento şeklinde patlamaz. Tek ana panel vardır; ikincil bilgiler çevresine sakin biçimde açılır.

Bu section klasik “SaaS bento grid” klişesinden özellikle kaçınır.

---

## 09 — Real proof / gerçek salon

Gerçek pilot gelmeden section ürün demonstrasyonu olarak kalır.

Gerçek pilot sonrası:
- tek güçlü salon portresi,
- gerçek isim ve işletme,
- maksimum 1 cümle yorum,
- maksimum 1 doğrulanmış metrik.

Örnek yapı:

`“Artık telefona randevu yazmıyorum.”`  
`İsim · İşletme · Bahçeşehir`  
`X günde Y gerçek randevu`

Carousel yapılmaz. Bir güçlü hikâye beş zayıf testimonial'dan değerlidir.

---

## 10 — Pricing / “Fiyatı da kolay olsun.”

**Zemin:** kırık beyaz.

Tek paket kesinleşirse tek büyük fiyat kartı kullanılır.

### Görsel

Kart 12 kolonun 8–10 kolonunu kaplar. Büyük fiyat solda; dahil olanlar sağda. Küçük yıldız dipnotları minimum.

Başlık:

`Fiyatı da kolay olsun.`

Alt copy:

`Ne ödeyeceğini baştan bil.`

Paket / fiyat kesinleşmeden rakam yazılmaz.

---

## 11 — FAQ / rahat cevaplar

Açık zemin, geniş boşluk. Accordion satırları 64–72 px.

Sorular salon sahibinin diliyle:
- `Kurulumu ben mi yapacağım?`
- `Müşteriler uygulama indirmek zorunda mı?`
- `Çalışanlarımı ayrı ayrı ekleyebilir miyim?`
- `Randevu değişince ne oluyor?`
- `Bir şeye takılırsam kime yazacağım?`

Cevaplar 2–4 cümle. Hukuk metni tonuna dönmez.

---

## 12 — Final CTA / “Randevu kolay. İşin sana kalsın.”

Üçüncü ve final wow anı.

### Kompozisyon

Kobalt organik form tüm ekranı kaplayacak şekilde büyür. `kolay` beyaz balonu merkezde CTA konteynerine dönüşür.

Metin:

`Randevu kolay.`  
`İşin sana kalsın.`

CTA: `Birlikte kuralım`

Footer'a geçerken mavi form küçülüp gerçek logo lockup'ına dönüşür.

Bu transition markanın imzası olur.

---

# 5. Kart sistemi — Awwwards seviyesi varyasyon

Kartların hepsi aynı radius, aynı shadow ve aynı grid hücresi değildir.

### Card family A — Proof card
Gerçek ürün ekranı. Düz, yüksek okunurluk.

### Card family B — Human editorial card
Gerçek yüz / salon fotoğrafı. 4:5 veya 3:4.

### Card family C — Conversation card
Mesaj, soru-cevap, kısa mikrocopy.

### Card family D — Sticker / note
Kısa el yazısı aksan; ana bilgi taşımaz.

### Card family E — Statement card
Tek dev cümle: `Sen kurma.` / `Uğraş? Az.`

**Kural:** aynı viewport'ta en fazla 3 farklı card family görünür.

---

# 6. Grid ve spacing

### Desktop ≥ 1280
- max content: 1440 px,
- 12 kolon,
- dış gutter 40–64 px,
- kolon gap 20–28 px,
- section dikey boşluk 120–200 px.

### Tablet 768–1279
- 8 kolon,
- gutter 28–40 px,
- büyük sticky akışlar sadeleşir.

### Mobile ≤ 767
- 4 kolon,
- 16–20 px gutter,
- horizontal scroll zorunlu tasarım kullanılmaz,
- sticky demo normal step flow'a dönüşebilir,
- display font `clamp(48px, 16vw, 76px)`.

---

# 7. Tipografi

## Display
Yumuşak, güçlü, Türkçe karakterlerde temiz bir grotesk / rounded sans.

Hedef davranış:
- 700–900 ağırlık,
- tight tracking,
- kısa başlık,
- çok büyük boyut.

## Body/UI
Nunito Sans veya aynı karakterde okunaklı sans.

## Handwritten accent
Font ailesi olarak değil; kısa SVG/asset çizimleri veya çok sınırlı marka fontu. Paragraf olmaz.

**Kural:** nostalji typography'nin okunabilirliğini yenemez.

---

# 8. Fotoğraf art direction

### Görsel his

2000'lerin iyimser reklam enerjisi, ancak düşük kaliteli nostalji filtresi değil.

- doğrudan kamera bakışı,
- sıcak ifade,
- hareket içinde çekim,
- gerektiğinde hafif direct-flash,
- geniş açılı ama deformasyonsuz portre,
- mavi/lime set parçaları,
- gerçek salon dokusu,
- yüksek kontrastlı ama doğal ten.

### Kaçınılacak

- steril stock salon çalışanı,
- aşırı luxury / parfüm kampanyası pozu,
- pembe neon beauty klişesi,
- herkesin laptop tuttuğu SaaS stock fotoğrafı,
- yapay testimonial yüzü.

---

# 9. Motion grammar

### Micro UI
150–220 ms.

### Marketing reveal
420–700 ms.

### Page transition / hero
700–900 ms maksimum.

### Easing
Doğal ease-out; hafif spring kabul edilir. Bounce oyuncak hissi vermez.

### Distance
Reveal translate çoğunlukla 12–28 px. 100 px'den uçan metin yok.

### Scroll
Native scroll korunur. Scroll hijack yapılmaz.

### Reduced motion
`prefers-reduced-motion` ile tüm parallax, scale ve scroll koreografisi sade fade/state değişimine düşer.

---

# 10. “Wow” bütçesi

Tüm site boyunca yalnız üç ana wow anı:

1. **Hero UI kartının rezervasyon demosuna morph olması.**
2. **Sticky rezervasyon akışının gerçek seçimlerle ilerlemesi.**
3. **Final CTA balonunun logoya dönüşmesi.**

Diğer motion'lar destekleyicidir.

Bu bütçe sitenin festival demo'suna dönüşmesini engeller.

---

# 11. Performans ve kalite kapısı

Awwwards görünümü performans bahanesi değildir.

Hedef:
- LCP ≤ 2.5 s,
- CLS < 0.1,
- INP < 200 ms,
- hero'da mobil autoplay video yok,
- AVIF/WebP responsive görsel,
- üst ekranda maksimum 1 büyük fotoğraf + 1 ürün mockup,
- font subset / preload kontrollü,
- scroll listener yerine mümkün olduğunda IntersectionObserver / CSS,
- animasyon yalnız `transform` + `opacity` ekseninde,
- WebGL kullanılacaksa yalnız progressive enhancement ve lazy-init.

İlk implementation ekstra motion kütüphanesi zorunlu kılmaz. Mevcut React/Vite tabanı üzerinde CSS + browser API ile başlanır; ancak karmaşık morph gereksinimi kanıtlanırsa küçük ve ölçümlü bir animation dependency ayrı teknik kararla eklenir.

---

# 12. Erişilebilirlik

- tüm CTA'lar klavye ile erişilebilir,
- hover bilgisi focus ile de görünür,
- hareket bilgiyi tek başına taşımaz,
- renk + metin/ikon birlikte kullanılır,
- kontrast WCAG AA altına düşmez,
- sticky section içerikleri ekran okuyucuda mantıklı DOM sırasını korur,
- `prefers-reduced-motion` zorunlu,
- fotoğraflarda gerçek anlamlı alt text; dekoratif shape'lerde boş alt.

---

# 13. Benchmark notu

2025–2026 Awwwards beauty/wellness örneklerinde iki uç dikkat çekiyor: güçlü editorial art direction ve immersive/sensory sunum. Randevu bu kalite çıtasını takip eder ancak kendi farkını **Türkçe konuşma dili + gerçek ürün demonstrasyonu + kolaylık** üzerinden kurar.

Referans ekseni:
- Adcker — beauty/fashion/wellness odaklı 2026 SOTD,
- Essentiality of Beauty — immersive beauty storytelling,
- Venetian Nail Spa — calm/refined beauty experience.

Bunlar kopya kaynakları değil, kalite benchmark'ıdır.

---

# 14. Uygulama sırası

## Slice 1 — Static art direction
Hero + nav + section kompozisyonları, gerçek responsive grid, motion olmadan.

## Slice 2 — Product demo
Rezervasyon sticky story + takvim demonstrasyonu.

## Slice 3 — Brand motion
Hero morph + underline + final logo transition.

## Slice 4 — Human layer
Gerçek fotoğraf / pilot kanıtı / salon materyalleri.

## Slice 5 — Performance + accessibility pass
Reduced motion, image budget, keyboard, Lighthouse ve gerçek cihaz kontrolü.

**Kural:** motion hiçbir zaman layout ve içerik kabulünden önce başlamaz.

---

# 15. Kabul ölçütü

Ana sayfa ancak şu beş soruya evet diyorsa tasarım başarılı sayılır:

1. İlk 5 saniyede “ne işe yarıyor?” anlaşılıyor mu?
2. Bir salon sahibi teknik terim bilmeden faydayı okuyabiliyor mu?
3. Site ekran görüntüsü tek başına Randevu'ya ait görünüyor mu?
4. Motion gerçekten ürünün kolaylığını gösteriyor mu?
5. Mobil deneyim desktop'ın kırpılmış hali değil, kendi başına güçlü mü?

Hedef yalnız ödül estetiği değil; **hatırlanabilir, satılabilir ve gerçekten kolay bir Randevu markasıdır.**
