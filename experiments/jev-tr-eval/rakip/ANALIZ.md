# Rakip mesaj analizi — 24 Eylül 2026

**Kapsam:** 9 rakibin kamuya açık işletme sayfaları (ana sayfa + fiyat sayfası) ve kendi homepage
metnimiz (`docs/brand/randevu-homepage-copy.md`, v1). Kolay Randevu ve Reservio bot koruması (403
"Access Denied") nedeniyle analiz dışı; koruma aşılmaya çalışılmadı. Randu için yalnız işletme sitesi
(`randuapp.com`) kullanıldı. Bu belge MKT-01 için **tavsiye niteliğindedir**; karar ürün sahibinindir.

**Yöntem:** Her site = 1 Jev isteği, 17 atomik soru (`rakip/analyze.mjs`, `jev-1.13.0`, toplam ≈ $0.002).
Ham matris: [`rapor-2026-09-24.md`](rapor-2026-09-24.md).

**Doğrulama:** Metinden doğrulanabilir 13 soruda (açılış tipi, hedef kitle, CTA, teklif ve 9 evet/hayır)
elle etiketlerle uyum **118/120 (%98.3)** (`rakip/verify.mjs`, `dogrulama.json`). İyimserdir: etiketler
Jev'in ilk çıktısı görüldükten sonra yazıldı, sosyal kanıt kriteri bu sitelere bakılarak düzeltildi.
Ana vaat, farkındalık, netlik ve farklılaşma **yorumdur**, doğrulanmadı.

## Tablo

| | Rakip sayısı (9) | Bizim metin |
|---|---|---|
| Birincil CTA "ücretsiz başla / dene" | **8** | yok — "Birlikte kuralım" |
| Ücretsiz deneme ya da ücretsiz plan | 6 | yok |
| Sayfada fiyat rakamı | **9** | yok |
| Otomatik hatırlatma | 7 | var |
| WhatsApp | 5 | yok |
| Mobil uygulama | 5 | yok |
| Türkiye / yerel vurgu | 5 | yok |
| Online ödeme / kapora | 4 | yok |
| Sosyal kanıt (işletme sayısı, puan, referans) | 3 | yok |
| Yapay zekâ | 1 | yok |
| **Kurulumu firma yapar / birlikte kurar** | **0** | **var** |

Açılış cümlesi (H1): 3 kategori tanımı (SalonJet, AppRandevu, Asistan Panel), 3 fayda vaadi (Randu,
Bosgun, Salun), 3 üstünlük iddiası (RandevApp "Türkiye'nin En İyi…", SalonRandevu "En İyi…", Fresha
"1 numaralı"). Sorun/acı noktasıyla ya da sosyal kanıtla açan yok.

## Bulgular

1. **"Biz kuralım" boş bir alan, ama rakipler kurulumu "dakikalar" diye satıyor.** Salun "2 dakikada
   kurulum", Randu "Kurulum gerektirmez / 5 dakikada başlayın", Asistan Panel "10 dk", Bosgun "5 dakikada
   kurun", RandevApp "Kurulum ücretsiz". Hiçbiri kurulumu işletme adına yapmıyor. *Yorum:* "Kurulumla da
   seni uğraştırmayalım" kurulumun zahmetli olduğunu ima edebilir; farkı "dakikada boş bir hesap" ile
   "müşteri listen, hizmetlerin, personel saatlerin hazır" arasında kurmak daha güçlü olabilir.
2. **Fiyat açıklığı masa bahsi.** 9/9 rakip sayfada rakam gösteriyor (ör. Salun 0/479/799 ₺, Asistan
   Panel 419 TL/ay tek fiyat, Randu ₺2.750/ay). Bizim "Fiyatı da kolay olsun" bölümünde rakam yok.
3. **WhatsApp ve AI iddiası rakiplerde başladı.** SalonJet "WhatsApp Chatbot", RandevApp "Yapay Zeka
   Asistanı (WhatsApp & Instagram)", Randu "Otomatik WhatsApp hatırlatmaları", Salun WhatsApp'ı "paket
   dahil" diye öne çıkarıyor. Sohbet botu planı için: fark "bot var" değil, botun ne kadar doğru ve
   güvenli davrandığı olmalı. Faz 16 kuralı gereği kabul edilmemiş bir özellik metinde canlıymış gibi
   gösterilmemeli.
4. **Ücretsiz başlangıç normu.** 8/9 birincil CTA "ücretsiz başla"; 6/9 süreli deneme ya da ücretsiz plan.
   Bizim metin bilinçli olarak "Ücretsiz dene"yi politika kesinleşene kadar kullanmıyor.
5. **Pazar farklılaşmıyor.** Farklılaşma puanları 0.3–1.5 / 3 (yorum, düşük güvenli). Ana vaatler "hepsi
   bir arada" (4) ve "düzen/kontrol" (3) etrafında toplanıyor; "kolaylık" yalnız Randu ve bizde.
   Bizim metin de dışarıdan genel görünüyor (0.8, düşük güven): "Randevu kolay" tek başına ayırt edici
   değil; ayırt edici olan concierge kurulum, hero'da değil sayfanın ortasında.
6. **Sosyal kanıt az kullanılıyor** (3/9: SalonJet "500'den fazla salon", Fresha "130.000'den fazla",
   Randu "50+"). Bizde pilot tamamlanmadan gerçek kanıt yok; uydurulmamalı.

## MKT-01 için öneriler (tavsiye)

- Concierge kurulumu hero'ya ve birincil CTA'ya taşıyın; "dakikada kurulum"a karşı "hazır teslim"i somut
  örnekle anlatın (müşteri listesi, hizmetler, personel saatleri).
- Fiyat politikası kesinleşince rakamı sayfaya koyun.
- WhatsApp/AI'ı ancak kabul edilmiş özellik olarak ve doğrulukla birlikte söyleyin.
- Açılışta "sorun" tonunu deneyin; rakiplerin hiçbiri H1'de kullanmıyor.
- Sosyal kanıtı F17-05 pilotundan sonra gerçek verilerle ekleyin.

## Sınırlar

- Site başına en fazla 2 sayfa; JS ile geç yüklenen bazı bölümler eksik olabilir.
- En güçlü yerel rakip (Kolay Randevu) bot koruması nedeniyle yok.
- Siteler değişir; analiz 24 Eylül 2026 anlık görüntüsüdür (`sayfalar/*.json`).
- Reklamlar yok: Meta Reklam Kütüphanesi API'si Türkiye'deki ticari reklamları kapsamıyor.
