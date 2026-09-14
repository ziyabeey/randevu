# Randevu Ana Sayfa — Art Direction & Interaction Spec

**Durum:** Onaylı marka yönü için uygulamaya hazır yaratıcı sözleşme  
**Tarih:** 14 Eylül 2026  
**Bağlı belgeler:** `randevu-branding.md`, `randevu-site-copy-card-system.md`, `randevu-homepage-copy.md`, `randevu-transformation-scrollytelling-storyboard.md`, `f12-01-visual-flow-contract.md`  
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

### Perde 2 — Dönüşüm / “Bunu ben yapmak zorunda değilim”
Hatırlatma + müşteri hafızası + concierge kurulum + saç dönüşümü + `Uğraş? Az.`

### Perde 3 — Güven / “Buna para veririm”
Sweep temizliği + fiyat + gerçek pilot kanıtı + FAQ + final CTA.

Her perdede tek bir büyük “wow” anı bulunur. Bir ekranda iki büyük motion fikri aynı anda yarışmaz.

---

## 4. Dönüşüm metaforu

Marketing scrollytelling'in omurgası artık yalnız UI morph değildir. Güzellik sektörüne ait fiziksel bir dönüşüm metaforu kullanılır:

> **Karışıklık gider, düzen kalır.**

Uzun saç, yoğunluk ve birikmiş uğraşı temsil eder. Scroll ilerledikçe saç kontrollü biçimde kısalır; her dönüşüm anında gerçek ürün davranışı açılır. Kesilen parçalarla birlikte `deftere bak`, `tek tek ara`, `kim boştu?`, `mesajı unutma` gibi gündelik sürtünmeler aşağı düşer. Lime bir sweep hareketi sahneyi temizler ve pricing alanını ortaya çıkarır.

Bu sahnenin tam beat-by-beat sözleşmesi `randevu-transformation-scrollytelling-storyboard.md` içindedir.

**Kural:** model moda filmi kahramanı değildir; dönüşümün insan yüzüdür. Asıl kahraman, azalan uğraştır.

---

# 5. Section-by-section wireframe ve hareket koreografisi

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

## 02 — Booking demo / “Müşteri kendi alsın.”

Sticky product story. Copy bir tarafta, gerçek ürün demosu diğer tarafta kalır. Scroll ilerledikçe hizmet → çalışan → saat → onay akışı açılır. Bu bölüm sahte demo değil, gerçek ürün yapısının kontrollü görsel demonstrasyonudur.

Saç dönüşümü burada henüz başlamaz; kullanıcı önce ürünün ne yaptığını net görür.

---

## 03 — Calendar stage / “Kim boş, kim dolu? Bakınca belli.”

Tam kobalt sahne. Büyük takvim UI'sı merkezde. Bir randevu kartı boş slota oturur. İkinci büyük ürün kanıtı burada verilir.

---

## 04 — Reminder playground / “Unuttu mu? Biz hatırlatırız.”

Açık mavi yüzey. Mesaj balonları kısa ve hafif motion ile çıkar. Ürün kapsamı dışında kanal adı yazılmaz.

---

## 05 — Customer memory / “Müşteri kimdi? Hatırlamak zorunda değilsin.”

Pudra/editorial sahne. İnsan yüzü tekrar güçlenir. Müşteri kartı, portreyle aynı kompozisyonda ürünün insan tarafını gösterir.

Bu bölüm sonunda model, dönüşüm storyboard'una bağlanır.

---

## 06 — Transformation stage / saç dönüşümü

Bu bölüm 3D/2.5D scrollytelling'in ana sahnesidir.

- modelin saç formu 3–4 kontrollü scroll beat'inde dönüşür,
- her kesim bir ürün avantajıyla eşleşir,
- kesilen parçalar aşağı düşer,
- gündelik sürtünme etiketleri onlarla birlikte kaybolur,
- dönüşüm “önce kötü / sonra güzel” değil, “önce yoğun / sonra hafif ve net” olarak anlatılır.

Ana copy varyantları:

`Her şey üst üste mi geliyor?`

`Karışıklık gider, düzen kalır.`

`Fazlalık gitsin. İşin kalsın.`

---

## 07 — Concierge takeover / “Sen kurma. Biz hazırlayalım.”

Lime tam ekran takeover. Sweep hareketi dönüşüm sahnesinden devam eder ve saç parçalarını / uğraş etiketlerini temizler.

Bu sweep yalnız dekor değildir; marka vaadini fiziksel olarak gösterir: işi kullanıcıdan alır.

Copy:

`Sen uğraşma. Biz toparlayalım.`

Alt:

`Kurulumu da birlikte halledelim. İlk gün panelle boğuşma.`

---

## 08 — Kinetic interlude / “UĞRAŞ? AZ.”

Sweep sonrası çok kısa tipografik nefes. Dev `UĞRAŞ?` ve yanında/altında `AZ.`. Kobalt/lime ters kontrast kullanılabilir.

Bu bölüm 1–1.5 viewport'tan uzun sürmez.

---

## 09 — Pricing reveal / “Fiyatı da kolay olsun.”

Sweep ile temizlenmiş sakin kırık beyaz sahne. Motion belirgin biçimde yavaşlar.

- tek fiyat stratejisi varsa tek güçlü kart,
- birden fazla paket varsa minimum seçenek,
- fiyat, KDV, dönem ve limitler açık,
- karar anında dekoratif 3D kullanılmaz.

Ana copy:

`Fiyatı da kolay olsun.`

Alt:

`Ne alacağını, ne ödeyeceğini ilk bakışta gör.`

---

## 10 — Social proof

Gerçek pilot yoksa ürün demonstrasyonu kullanılır. Pilot sonrası gerçek salon yüzü, gerçek isim ve doğrulanmış tek metrik eklenir. Stock testimonial yasaktır.

---

## 11 — FAQ

Sakin, net, yüksek okunabilirlik. Bu bölümde motion yalnız aç/kapa ve küçük durum geçişidir.

---

## 12 — Final CTA / logo closure

Beyaz `kolay` balonu büyür ve final CTA alanına dönüşür.

`Randevu kolay. İşin sana kalsın.`

CTA: `Birlikte kuralım`

Sayfa sonuna yaklaştıkça balon küçülür ve gerçek `randevu + kolay` logo lockup'ına oturur. Üçüncü büyük wow anı budur.

---

## 6. Üç büyük wow anı

1. **Hero UI → booking demo morph**
2. **Saç dönüşümü → düşen uğraşlar → lime sweep temizliği**
3. **Final `kolay` balonu → logo lockup**

Bunların dışında kalan motion yardımcıdır.

---

## 7. 3D / 2.5D karar kuralı

Tam gerçek-zamanlı 3D yalnız şu koşullarda kullanılır:

- mobil performans bütçesi korunabiliyorsa,
- reduced-motion alternatifi varsa,
- model/saç asset üretimi kalitesiz görünmüyorsa,
- interaktif sahne LCP/INP'yi bozmuyorsa.

Aksi durumda pre-rendered sequence, video sprite, WebP/AVIF frame sequence veya CSS/DOM layered 2.5D çözüm tercih edilir. Kullanıcının fark ettiği şey teknoloji değil, dönüşüm olmalıdır.

---

## 8. Performans ve erişilebilirlik

Hedefler:

- LCP ≤ 2.5 s
- CLS < 0.1
- INP < 200 ms
- hero first-load'da ağır model indirme yok
- 3D asset lazy-load
- `prefers-reduced-motion` ile static/crossfade fallback
- keyboard ve screen reader için gerçek içerik DOM'da kalır
- canvas içine kritik copy gömülmez
- scroll hijack yapılmaz

---

## 9. Yaratıcı kalite testi

Her güçlü efekt için üç soru:

1. Bu hareket hangi kullanıcı yükünü azaltıyor?
2. Copy olmadan hareketin anlamı ürünle ilişkili mi?
3. Efekti kaldırınca dönüşüm hikâyesi hâlâ çalışıyor mu?

Cevaplar zayıfsa efekt çıkarılır.

İç yaratıcı manifesto:

> **Biz saç kesmiyoruz; karmaşayı kesiyoruz.**

Kullanıcıya dönük ana vaat değişmez:

> **Randevu kolay.**
