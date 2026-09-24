# Bulgular — Jev Türkçe randevu kararları (24 Eylül 2026)

Model `jev-1.13.0`, güven eşiği 0.8. İki tur, toplam ~1.500 çağrı, toplam maliyet ~7 sent.
Ham raporlar: [`raporlar/`](raporlar/).

- **Set 1:** ilk yazılan 244 mesaj (183 niyet, 30 hizmet, 31 saat).
- **Set 2:** 1. turun hatalarına bakılıp değişiklikler yapıldıktan **sonra** yazılmış yeni 110 mesaj
  (65 niyet, 26 hizmet, 19 saat). Hazırlığın genelleşip genelleşmediğini bu set gösterir.

## Ana tablo (net mesajlarda doğruluk)

| Görev | Varyant | Set 1 | Set 2 (yeni) |
|---|---|---|---|
| Niyet | kural (anahtar kelime) | %93.6 | **%55.0** |
| Niyet | düz | %98.3 | %98.3 |
| Niyet | hazırlanmış | %98.3 | %96.7 |
| Niyet | bağlamlı | %98.3 | %98.3 |
| Hizmet | düz | %85.2 | %87.5 |
| Hizmet | hazırlanmış | %85.2 | %95.8 |
| Hizmet | salon eş anlamlıları | %96.3* | **%100** |
| Saat | düz | %78.6 | %88.9 |
| Saat | hazırlanmış | %85.7 | %94.4 |

\* Set 1'de salon eş anlamlıları o setin hatalarından türetildi; bu sayı iyimserdir. Geçerli ölçüm set 2'dir.

Aynı set tekrar çalıştırıldığında sonuçlar 1 mesaj kadar oynuyor (ör. saat/düz set 1'de %82.1 → %78.6).
Küçük görevlerde 1–2 mesajlık farkları anlamlı saymayın.

## Sonuçlar

1. **Jev Türkçe niyeti genelleştiriyor, kurallar genelleştirmiyor.** Set 1'i görerek yazılmış anahtar
   kelime kuralları yeni mesajlarda %93.6'dan %55'e düştü; Jev iki sette de %98.3.
2. **Güven değeri kullanılabilir bir fren.** Doğru kararlarda ortalama güven ~0.95, yanlışlarda ~0.5–0.6.
   0.8 eşiğinde niyet kararlarının ~%90'ı otomatik uygulanabiliyor ve bunların doğruluğu %98–100.
3. **Bağlama göre seçenek sunmak şart.** Botun bekleyen sorusu yokken gelen "tamam", "Evet", "👌",
   "olmaz" gibi mesajlar düz/hazırlanmış varyantta 0.93–1.00 güvenle `onay`/`ret` seçildi (bot sormadığı
   bir şeyi onaylanmış sayardı). Bağlamlı varyantta bu seçenekler sunulmadığında hepsinin güveni eşiğin
   altında kaldı ve netleştirici soruya düştü (set 2'de "belirsizde durma" %0 → %100).
4. **Salonun kendi eş anlamlıları hizmet eşleştirmeyi kapatıyor.** "brezilya fönü", "röfle", "oğluma tıraş",
   "tırnak uzatma" kataloga eklenince yeni cümlelerde de doğru eşleşti (set 2 %100). Genel eş anlamlılar
   (hazırlanmış) da yeni sette +8 puan getirdi.
5. **Türkçe saat kuralları yardımcı ama saat seçimi hassas.** Hazırlık iki sette de +5–7 puan getirdi.
   "dördü çeyrek geçe" (listede yokken) bir çalıştırmada tam 0.80 güvenle 16:45 seçildi. Seçilen saat
   müşteriye her zaman bir kez onaylatılmalı ve saat için eşik 0.9 olmalı.

## Kalan zayıflıklar

- "keratinle fön birlikte **ne tutar**" üç varyantta da 0.83–0.99 güvenle `bilgi_sorusu` seçildi (fiyat
  sorusu). "ne tutar" gibi Türkçe fiyat kalıpları açıklamalara eklenmeli ve yeni bir setle doğrulanmalı.
- "Park yeri arıyorum birazdan ordayım" (gecikme) düşük güvenle kaçıyor; eşik doğru davranıyor.
- Mesajlar sentetik ve tek kişi tarafından yazıldı. Sonraki doğrulama anonimleştirilmiş gerçek
  WhatsApp mesajlarıyla yapılmalı.

## Bot tasarımına çıkan kurallar

- Jev yalnız seçer; müsaitlik, fiyat ve randevu durumu her zaman mevcut RPC'lerden gelir.
- Seçenekler konuşma durumundan kurulur: `onay`/`ret` yalnız bekleyen bir soru varken, saatler yalnız
  müsaitlik RPC'sinin döndürdükleri, hizmetler yalnız salonun katalogu (+ salonun eş anlamlıları).
- Eşik altı → netleştirici soru ya da salona devir. Saat ve randevu oluşturma gibi geri dönüşü zor
  adımlarda ek olarak müşteri onayı.
- Yanlış seçilen mesajlar salonun eş anlamlı / ifade listesine eklenir; her iyileştirme yeni mesajlarla
  ölçülür.
