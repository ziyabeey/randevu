# Jev Türkçe randevu değerlendirmesi — test seti 2 — 2026-09-24T04:57:07.891Z

Model: jev-1.13.0 · Güven eşiği: 0.8 · Fiyat varsayımı: $0.042/1M girdi token

**Doğruluk** yalnız net mesajlarda ölçülür. **Otomatik** = güveni eşiğin üstünde olup insana sorulmadan uygulanacak kararların oranı.
**Emin ama yanlış** = eşiğin üstünde olduğu hâlde yanlış olan karar sayısı; botun asıl riski budur.
**Belirsizde durma** = gerçekten belirsiz mesajlarda güvenin eşiğin altında kalıp soruya/insana düşme oranı (yüksek olması iyi).
**kural** = anahtar kelime kuralları. Test seti görülerek yazıldığı için iyimserdir; yeni gerçek mesajlarda bu kadar iyi olması beklenmez.

| Görev | Varyant | n | Hata | Doğruluk | Otomatik | Otomatikte doğruluk | Emin ama yanlış | Belirsizde durma | p50 ms | p95 ms | Maliyet |
|---|---|---|---|---|---|---|---|---|---|---|---|
| niyet | kural | 65 | 0 | %55.0 | — | — | — | — | 0 | 0 | $0.00000 |
| niyet | duz | 65 | 0 | %98.3 | %90.0 | %98.1 | 1 | %0.0 | 324 | 696 | $0.00216 |
| niyet | hazirlanmis | 65 | 0 | %96.7 | %93.3 | %98.2 | 1 | %0.0 | 304 | 431 | $0.00389 |
| niyet | baglamli | 65 | 0 | %98.3 | %93.3 | %98.2 | 1 | %100.0 | 322 | 492 | $0.00356 |
| hizmet | duz | 26 | 0 | %87.5 | %70.8 | %100.0 | 0 | %100.0 | 285 | 595 | $0.00075 |
| hizmet | hazirlanmis | 26 | 0 | %95.8 | %75.0 | %100.0 | 0 | %100.0 | 297 | 749 | $0.00098 |
| hizmet | salon | 26 | 0 | %100.0 | %91.7 | %100.0 | 0 | %100.0 | 263 | 464 | $0.00101 |
| saat | duz | 19 | 0 | %88.9 | %72.2 | %100.0 | 0 | %0.0 | 259 | 556 | $0.00042 |
| saat | hazirlanmis | 19 | 0 | %94.4 | %72.2 | %100.0 | 0 | %0.0 | 302 | 592 | $0.00055 |

## niyet · kural

**Etikete göre (en zayıftan):** sikayet %0.0 (5) · randevu_al %20.0 (5) · bilgi_sorusu %20.0 (5) · insan_istiyor %20.0 (5) · ret %40.0 (5) · randevu_tasi %60.0 (5) · gecikme %60.0 (5) · onay %60.0 (5) · memnuniyet %80.0 (5) · randevu_iptal %100.0 (5) · fiyat_sorusu %100.0 (5) · diger %100.0 (5)

**Zorluk etiketine göre:** ironi %0.0 (2) · emoji %33.3 (3) · baglam %50.0 (10) · tuzak %50.0 (2) · duz %55.2 (29) · olumsuzluk %55.6 (9) · yazim %66.7 (6) · kisa %80.0 (5) · spam %100.0 (2) · coklu %100.0 (1)

**Yanlışlar (en emin olunandan):**

| Mesaj | Bağlam | Beklenen | Seçilen | Güven |
|---|---|---|---|---|
| arkadaşımla beraber gelmek istiyoruz ikimize de manikür |  | randevu_al | diger | — |
| cuma akşamüstü için bi yer ayarlayabilir misin kanka |  | randevu_al | diger | — |
| Düğün öncesi ön deneme için ne zaman gelebilirim |  | randevu_al | diger | — |
| Hafta sonu boş gününüz olursa beni de sıkıştırın |  | randevu_al | diger | — |
| Bugün yetişemeyeceğim, yarına alsak olur mu |  | randevu_tasi | diger | — |
| Gün aynı kalsın sadece saat değişsin |  | randevu_tasi | diger | — |
| yola çıktım ama biraz geç olur |  | gecikme | diger | — |
| Birazcık bekletirsem kızmayın 🙈 |  | gecikme | diger | — |
| Cumartesi kaça kadar açıksınız |  | bilgi_sorusu | diger | — |
| Hangi semttesiniz |  | bilgi_sorusu | diger | — |
| Erkek berberliği de var mı sizde |  | bilgi_sorusu | diger | — |
| Benim randevu saatimi hatırlatır mısınız |  | bilgi_sorusu | randevu_al | — |
| taşıyalım | Randevunuzu Salı 10:00'a taşıyalım mı? | onay / randevu_tasi | diger | — |
| edelim | Randevunuzu iptal edelim mi? | onay / randevu_iptal | diger | — |
| pek uymuyor | Pazartesi 11:00 sizin için uygun mu? | ret | diger | — |

## niyet · duz

Ortalama güven — doğru: 0.95, yanlış: 0.99

| Eşik | Otomatik | Otomatikte doğruluk | Emin ama yanlış |
|---|---|---|---|
| 0.5 | %100.0 | %98.3 | 1 |
| 0.6 | %95.0 | %98.2 | 1 |
| 0.7 | %95.0 | %98.2 | 1 |
| 0.8 | %90.0 | %98.1 | 1 |
| 0.9 | %88.3 | %98.1 | 1 |

**Etikete göre (en zayıftan):** fiyat_sorusu %80.0 (5) · randevu_al %100.0 (5) · randevu_tasi %100.0 (5) · randevu_iptal %100.0 (5) · gecikme %100.0 (5) · bilgi_sorusu %100.0 (5) · onay %100.0 (5) · ret %100.0 (5) · diger %100.0 (5) · sikayet %100.0 (5) · memnuniyet %100.0 (5) · insan_istiyor %100.0 (5)

**Zorluk etiketine göre:** duz %96.6 (29) · baglam %100.0 (10) · olumsuzluk %100.0 (9) · yazim %100.0 (6) · kisa %100.0 (5) · emoji %100.0 (3) · tuzak %100.0 (2) · ironi %100.0 (2) · spam %100.0 (2) · coklu %100.0 (1)

**Yanlışlar (en emin olunandan):**

| Mesaj | Bağlam | Beklenen | Seçilen | Güven |
|---|---|---|---|---|
| keratinle fön birlikte ne tutar |  | fiyat_sorusu | bilgi_sorusu | 0.99 |

## niyet · hazirlanmis

Ortalama güven — doğru: 0.97, yanlış: 0.70

| Eşik | Otomatik | Otomatikte doğruluk | Emin ama yanlış |
|---|---|---|---|
| 0.5 | %98.3 | %96.6 | 2 |
| 0.6 | %96.7 | %98.3 | 1 |
| 0.7 | %96.7 | %98.3 | 1 |
| 0.8 | %93.3 | %98.2 | 1 |
| 0.9 | %86.7 | %100.0 | 0 |

**Etikete göre (en zayıftan):** randevu_al %80.0 (5) · fiyat_sorusu %80.0 (5) · randevu_tasi %100.0 (5) · randevu_iptal %100.0 (5) · gecikme %100.0 (5) · bilgi_sorusu %100.0 (5) · onay %100.0 (5) · ret %100.0 (5) · diger %100.0 (5) · sikayet %100.0 (5) · memnuniyet %100.0 (5) · insan_istiyor %100.0 (5)

**Zorluk etiketine göre:** duz %93.1 (29) · baglam %100.0 (10) · olumsuzluk %100.0 (9) · yazim %100.0 (6) · kisa %100.0 (5) · emoji %100.0 (3) · tuzak %100.0 (2) · ironi %100.0 (2) · spam %100.0 (2) · coklu %100.0 (1)

**Yanlışlar (en emin olunandan):**

| Mesaj | Bağlam | Beklenen | Seçilen | Güven |
|---|---|---|---|---|
| keratinle fön birlikte ne tutar |  | fiyat_sorusu | bilgi_sorusu | 0.83 |
| Hafta sonu boş gününüz olursa beni de sıkıştırın |  | randevu_al | onay | 0.57 |

## niyet · baglamli

Ortalama güven — doğru: 0.96, yanlış: 0.89

| Eşik | Otomatik | Otomatikte doğruluk | Emin ama yanlış |
|---|---|---|---|
| 0.5 | %98.3 | %98.3 | 1 |
| 0.6 | %98.3 | %98.3 | 1 |
| 0.7 | %96.7 | %98.3 | 1 |
| 0.8 | %93.3 | %98.2 | 1 |
| 0.9 | %88.3 | %100.0 | 0 |

**Etikete göre (en zayıftan):** fiyat_sorusu %80.0 (5) · randevu_al %100.0 (5) · randevu_tasi %100.0 (5) · randevu_iptal %100.0 (5) · gecikme %100.0 (5) · bilgi_sorusu %100.0 (5) · onay %100.0 (5) · ret %100.0 (5) · diger %100.0 (5) · sikayet %100.0 (5) · memnuniyet %100.0 (5) · insan_istiyor %100.0 (5)

**Zorluk etiketine göre:** duz %96.6 (29) · baglam %100.0 (10) · olumsuzluk %100.0 (9) · yazim %100.0 (6) · kisa %100.0 (5) · emoji %100.0 (3) · tuzak %100.0 (2) · ironi %100.0 (2) · spam %100.0 (2) · coklu %100.0 (1)

**Yanlışlar (en emin olunandan):**

| Mesaj | Bağlam | Beklenen | Seçilen | Güven |
|---|---|---|---|---|
| keratinle fön birlikte ne tutar |  | fiyat_sorusu | bilgi_sorusu | 0.89 |

## hizmet · duz

Ortalama güven — doğru: 0.88, yanlış: 0.59

| Eşik | Otomatik | Otomatikte doğruluk | Emin ama yanlış |
|---|---|---|---|
| 0.5 | %87.5 | %90.5 | 2 |
| 0.6 | %83.3 | %90.0 | 2 |
| 0.7 | %75.0 | %100.0 | 0 |
| 0.8 | %70.8 | %100.0 | 0 |
| 0.9 | %66.7 | %100.0 | 0 |

**Etikete göre (en zayıftan):** dip_boya %0.0 (1) · kesim_kadin %0.0 (1) · keratin %50.0 (2) · balyaj %100.0 (2) · protez_tirnak %100.0 (2) · fon %100.0 (2) · yok %100.0 (2) · kesim_erkek %100.0 (1) · sakal %100.0 (1) · kas %100.0 (1) · agda %100.0 (1) · lazer %100.0 (1) · gelin %100.0 (1) · makyaj %100.0 (1) · cilt %100.0 (1) · tum_boya %100.0 (1) · kalici_oje %100.0 (1) · manikur %100.0 (1) · pedikur %100.0 (1)

**Zorluk etiketine göre:** salon_esanlamli %75.0 (4) · esanlam %81.8 (11) · duz %100.0 (6) · katalog_disi %100.0 (2) · tuzak %100.0 (1) · coklu %100.0 (1)

**Yanlışlar (en emin olunandan):**

| Mesaj | Bağlam | Beklenen | Seçilen | Güven |
|---|---|---|---|---|
| küt kesim |  | kesim_kadin | kesim_erkek | 0.67 |
| Kızım için brezilya fönü randevusu |  | keratin | fon | 0.61 |
| kök boyası yaptıracağım |  | dip_boya | tum_boya | 0.49 |

## hizmet · hazirlanmis

Ortalama güven — doğru: 0.89, yanlış: 0.32

| Eşik | Otomatik | Otomatikte doğruluk | Emin ama yanlış |
|---|---|---|---|
| 0.5 | %95.8 | %100.0 | 0 |
| 0.6 | %91.7 | %100.0 | 0 |
| 0.7 | %79.2 | %100.0 | 0 |
| 0.8 | %75.0 | %100.0 | 0 |
| 0.9 | %62.5 | %100.0 | 0 |

**Etikete göre (en zayıftan):** protez_tirnak %50.0 (2) · keratin %100.0 (2) · balyaj %100.0 (2) · fon %100.0 (2) · yok %100.0 (2) · kesim_erkek %100.0 (1) · sakal %100.0 (1) · kas %100.0 (1) · agda %100.0 (1) · lazer %100.0 (1) · gelin %100.0 (1) · makyaj %100.0 (1) · cilt %100.0 (1) · dip_boya %100.0 (1) · tum_boya %100.0 (1) · kalici_oje %100.0 (1) · manikur %100.0 (1) · pedikur %100.0 (1) · kesim_kadin %100.0 (1)

**Zorluk etiketine göre:** salon_esanlamli %75.0 (4) · esanlam %100.0 (11) · duz %100.0 (6) · katalog_disi %100.0 (2) · tuzak %100.0 (1) · coklu %100.0 (1)

**Yanlışlar (en emin olunandan):**

| Mesaj | Bağlam | Beklenen | Seçilen | Güven |
|---|---|---|---|---|
| Tırnak uzatma yapıyor musunuz |  | protez_tirnak | manikur | 0.32 |

## hizmet · salon

Ortalama güven — doğru: 0.94, yanlış: —

| Eşik | Otomatik | Otomatikte doğruluk | Emin ama yanlış |
|---|---|---|---|
| 0.5 | %100.0 | %100.0 | 0 |
| 0.6 | %95.8 | %100.0 | 0 |
| 0.7 | %95.8 | %100.0 | 0 |
| 0.8 | %91.7 | %100.0 | 0 |
| 0.9 | %79.2 | %100.0 | 0 |

**Etikete göre (en zayıftan):** keratin %100.0 (2) · balyaj %100.0 (2) · protez_tirnak %100.0 (2) · fon %100.0 (2) · yok %100.0 (2) · kesim_erkek %100.0 (1) · sakal %100.0 (1) · kas %100.0 (1) · agda %100.0 (1) · lazer %100.0 (1) · gelin %100.0 (1) · makyaj %100.0 (1) · cilt %100.0 (1) · dip_boya %100.0 (1) · tum_boya %100.0 (1) · kalici_oje %100.0 (1) · manikur %100.0 (1) · pedikur %100.0 (1) · kesim_kadin %100.0 (1)

**Zorluk etiketine göre:** esanlam %100.0 (11) · duz %100.0 (6) · salon_esanlamli %100.0 (4) · katalog_disi %100.0 (2) · tuzak %100.0 (1) · coklu %100.0 (1)

## saat · duz

Ortalama güven — doğru: 0.87, yanlış: 0.66

| Eşik | Otomatik | Otomatikte doğruluk | Emin ama yanlış |
|---|---|---|---|
| 0.5 | %94.4 | %88.2 | 2 |
| 0.6 | %88.9 | %93.8 | 1 |
| 0.7 | %77.8 | %92.9 | 1 |
| 0.8 | %72.2 | %100.0 | 0 |
| 0.9 | %55.6 | %100.0 | 0 |

**Etikete göre (en zayıftan):** hicbiri %66.7 (3) · s1 %75.0 (4) · s2 %100.0 (7) · s3 %100.0 (4)

**Zorluk etiketine göre:** kisa %50.0 (2) · 12_24_saat %50.0 (2) · listede_yok %66.7 (3) · tuzak %66.7 (3) · dakika %83.3 (6) · goreli_gun %100.0 (5) · gun_dilimi %100.0 (2) · cikarim %100.0 (1) · tarih %100.0 (1)

**Yanlışlar (en emin olunandan):**

| Mesaj | Bağlam | Beklenen | Seçilen | Güven |
|---|---|---|---|---|
| 5 |  | s1 | hicbiri | 0.76 |
| altıya çeyrek var |  | hicbiri | s2 | 0.55 |

## saat · hazirlanmis

Ortalama güven — doğru: 0.85, yanlış: 0.17

| Eşik | Otomatik | Otomatikte doğruluk | Emin ama yanlış |
|---|---|---|---|
| 0.5 | %83.3 | %100.0 | 0 |
| 0.6 | %83.3 | %100.0 | 0 |
| 0.7 | %72.2 | %100.0 | 0 |
| 0.8 | %72.2 | %100.0 | 0 |
| 0.9 | %61.1 | %100.0 | 0 |

**Etikete göre (en zayıftan):** s1 %75.0 (4) · s2 %100.0 (7) · s3 %100.0 (4) · hicbiri %100.0 (3)

**Zorluk etiketine göre:** kisa %50.0 (2) · 12_24_saat %50.0 (2) · dakika %100.0 (6) · goreli_gun %100.0 (5) · listede_yok %100.0 (3) · tuzak %100.0 (3) · gun_dilimi %100.0 (2) · cikarim %100.0 (1) · tarih %100.0 (1)

**Yanlışlar (en emin olunandan):**

| Mesaj | Bağlam | Beklenen | Seçilen | Güven |
|---|---|---|---|---|
| 5 |  | s1 | s2 | 0.17 |
