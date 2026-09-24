# Jev Türkçe randevu değerlendirmesi — test seti 1 — 2026-09-24T04:56:53.758Z

Model: jev-1.13.0 · Güven eşiği: 0.8 · Fiyat varsayımı: $0.042/1M girdi token

**Doğruluk** yalnız net mesajlarda ölçülür. **Otomatik** = güveni eşiğin üstünde olup insana sorulmadan uygulanacak kararların oranı.
**Emin ama yanlış** = eşiğin üstünde olduğu hâlde yanlış olan karar sayısı; botun asıl riski budur.
**Belirsizde durma** = gerçekten belirsiz mesajlarda güvenin eşiğin altında kalıp soruya/insana düşme oranı (yüksek olması iyi).
**kural** = anahtar kelime kuralları. Test seti görülerek yazıldığı için iyimserdir; yeni gerçek mesajlarda bu kadar iyi olması beklenmez.

| Görev | Varyant | n | Hata | Doğruluk | Otomatik | Otomatikte doğruluk | Emin ama yanlış | Belirsizde durma | p50 ms | p95 ms | Maliyet |
|---|---|---|---|---|---|---|---|---|---|---|---|
| niyet | kural | 183 | 0 | %93.6 | — | — | — | — | 0 | 0 | $0.00000 |
| niyet | duz | 183 | 0 | %98.3 | %89.5 | %100.0 | 0 | %54.5 | 334 | 667 | $0.00607 |
| niyet | hazirlanmis | 183 | 0 | %98.3 | %90.1 | %99.4 | 1 | %54.5 | 318 | 481 | $0.01096 |
| niyet | baglamli | 183 | 0 | %98.3 | %90.1 | %99.4 | 1 | %54.5 | 308 | 452 | $0.01002 |
| hizmet | duz | 30 | 0 | %85.2 | %63.0 | %100.0 | 0 | %33.3 | 329 | 473 | $0.00086 |
| hizmet | hazirlanmis | 30 | 0 | %85.2 | %59.3 | %100.0 | 0 | %33.3 | 303 | 449 | $0.00113 |
| hizmet | salon | 30 | 0 | %96.3 | %70.4 | %100.0 | 0 | %33.3 | 298 | 412 | $0.00116 |
| saat | duz | 31 | 0 | %78.6 | %67.9 | %100.0 | 0 | %100.0 | 339 | 841 | $0.00069 |
| saat | hazirlanmis | 31 | 0 | %85.7 | %78.6 | %95.5 | 1 | %100.0 | 341 | 479 | $0.00090 |

## niyet · kural

**Etikete göre (en zayıftan):** diger %80.0 (10) · gecikme %83.3 (12) · sikayet %86.7 (15) · ret %91.7 (12) · onay %93.3 (15) · randevu_tasi %93.8 (16) · randevu_al %94.1 (17) · bilgi_sorusu %94.7 (19) · randevu_iptal %100.0 (18) · fiyat_sorusu %100.0 (15) · memnuniyet %100.0 (12) · insan_istiyor %100.0 (11)

**Zorluk etiketine göre:** spam %50.0 (2) · ironi %66.7 (3) · coklu %75.0 (12) · emoji %85.7 (7) · olumsuzluk %92.6 (27) · kisa %93.3 (30) · yazim %95.0 (20) · baglam %96.2 (26) · duz %97.5 (80)

**Yanlışlar (en emin olunandan):**

| Mesaj | Bağlam | Beklenen | Seçilen | Güven |
|---|---|---|---|---|
| bu hafta içi akşamüstü herhangi bir gün olur, lazer epilasyon |  | randevu_al | diger | — |
| Tarih değişikliği yapmak istiyorum |  | randevu_tasi | randevu_al | — |
| Yarım saat geç gelsem olur mu yoksa iptal mi olur |  | bilgi_sorusu / gecikme | randevu_iptal | — |
| Az kaldı, köşedeyim |  | gecikme / onay | diger | — |
| nerdesiniz tam olarak metroya yakın mı |  | bilgi_sorusu | diger | — |
| Geç kalmayacağım merak etmeyin, tam saatinde ordayım |  | onay | gecikme | — |
| cumartesi değil pazar olabilir mi | Cumartesi 12:00 için yer ayıralım mı? | randevu_al / ret | diger | — |
| Geçen sefer 500 ödemiştim şimdi neden 650 oldu |  | fiyat_sorusu / sikayet | diger | — |
| süper hizmet, 40 dk bekledim sadece 🙃 |  | sikayet | gecikme | — |
| Salonunuza reklam vermek ister misiniz, uygun fiyatlı |  | diger | fiyat_sorusu | — |
| SMS aboneliğinden çıkmak istiyorum |  | bilgi_sorusu / diger / insan_istiyor | randevu_al | — |

## niyet · duz

Ortalama güven — doğru: 0.95, yanlış: 0.67

| Eşik | Otomatik | Otomatikte doğruluk | Emin ama yanlış |
|---|---|---|---|
| 0.5 | %98.8 | %98.2 | 3 |
| 0.6 | %97.7 | %98.2 | 3 |
| 0.7 | %94.2 | %99.4 | 1 |
| 0.8 | %89.5 | %100.0 | 0 |
| 0.9 | %83.7 | %100.0 | 0 |

**Etikete göre (en zayıftan):** gecikme %91.7 (12) · ret %91.7 (12) · randevu_tasi %93.8 (16) · bilgi_sorusu %100.0 (19) · randevu_iptal %100.0 (18) · randevu_al %100.0 (17) · fiyat_sorusu %100.0 (15) · onay %100.0 (15) · sikayet %100.0 (15) · memnuniyet %100.0 (12) · insan_istiyor %100.0 (11) · diger %100.0 (10)

**Zorluk etiketine göre:** coklu %91.7 (12) · baglam %96.2 (26) · olumsuzluk %96.3 (27) · duz %97.5 (80) · kisa %100.0 (30) · yazim %100.0 (20) · emoji %100.0 (7) · ironi %100.0 (3) · spam %100.0 (2)

**Yanlışlar (en emin olunandan):**

| Mesaj | Bağlam | Beklenen | Seçilen | Güven |
|---|---|---|---|---|
| Kızımın randevusunu benimkiyle aynı saate alabilir miyiz |  | randevu_tasi | randevu_al | 0.77 |
| Park yeri arıyorum birazdan ordayım |  | gecikme | bilgi_sorusu | 0.62 |
| cumartesi değil pazar olabilir mi | Cumartesi 12:00 için yer ayıralım mı? | randevu_al / ret | randevu_tasi | 0.62 |

## niyet · hazirlanmis

Ortalama güven — doğru: 0.95, yanlış: 0.50

| Eşik | Otomatik | Otomatikte doğruluk | Emin ama yanlış |
|---|---|---|---|
| 0.5 | %98.3 | %99.4 | 1 |
| 0.6 | %95.3 | %99.4 | 1 |
| 0.7 | %93.0 | %99.4 | 1 |
| 0.8 | %90.1 | %99.4 | 1 |
| 0.9 | %85.5 | %99.3 | 1 |

**Etikete göre (en zayıftan):** gecikme %91.7 (12) · ret %91.7 (12) · bilgi_sorusu %94.7 (19) · randevu_iptal %100.0 (18) · randevu_al %100.0 (17) · randevu_tasi %100.0 (16) · fiyat_sorusu %100.0 (15) · onay %100.0 (15) · sikayet %100.0 (15) · memnuniyet %100.0 (12) · insan_istiyor %100.0 (11) · diger %100.0 (10)

**Zorluk etiketine göre:** coklu %91.7 (12) · baglam %96.2 (26) · olumsuzluk %96.3 (27) · duz %97.5 (80) · kisa %100.0 (30) · yazim %100.0 (20) · emoji %100.0 (7) · ironi %100.0 (3) · spam %100.0 (2)

**Yanlışlar (en emin olunandan):**

| Mesaj | Bağlam | Beklenen | Seçilen | Güven |
|---|---|---|---|---|
| cumartesi değil pazar olabilir mi | Cumartesi 12:00 için yer ayıralım mı? | randevu_al / ret | randevu_tasi | 0.93 |
| Instagramdaki fotoğraftaki modeli yapabilir misiniz |  | bilgi_sorusu | diger | 0.30 |
| Park yeri arıyorum birazdan ordayım |  | gecikme | diger | 0.28 |

## niyet · baglamli

Ortalama güven — doğru: 0.95, yanlış: 0.55

| Eşik | Otomatik | Otomatikte doğruluk | Emin ama yanlış |
|---|---|---|---|
| 0.5 | %97.1 | %99.4 | 1 |
| 0.6 | %95.9 | %99.4 | 1 |
| 0.7 | %94.2 | %99.4 | 1 |
| 0.8 | %90.1 | %99.4 | 1 |
| 0.9 | %86.0 | %99.3 | 1 |

**Etikete göre (en zayıftan):** gecikme %91.7 (12) · ret %91.7 (12) · bilgi_sorusu %94.7 (19) · randevu_iptal %100.0 (18) · randevu_al %100.0 (17) · randevu_tasi %100.0 (16) · fiyat_sorusu %100.0 (15) · onay %100.0 (15) · sikayet %100.0 (15) · memnuniyet %100.0 (12) · insan_istiyor %100.0 (11) · diger %100.0 (10)

**Zorluk etiketine göre:** coklu %91.7 (12) · baglam %96.2 (26) · olumsuzluk %96.3 (27) · duz %97.5 (80) · kisa %100.0 (30) · yazim %100.0 (20) · emoji %100.0 (7) · ironi %100.0 (3) · spam %100.0 (2)

**Yanlışlar (en emin olunandan):**

| Mesaj | Bağlam | Beklenen | Seçilen | Güven |
|---|---|---|---|---|
| cumartesi değil pazar olabilir mi | Cumartesi 12:00 için yer ayıralım mı? | randevu_al / ret | randevu_tasi | 0.94 |
| Instagramdaki fotoğraftaki modeli yapabilir misiniz |  | bilgi_sorusu | randevu_al | 0.40 |
| Park yeri arıyorum birazdan ordayım |  | gecikme | diger | 0.31 |

## hizmet · duz

Ortalama güven — doğru: 0.89, yanlış: 0.45

| Eşik | Otomatik | Otomatikte doğruluk | Emin ama yanlış |
|---|---|---|---|
| 0.5 | %92.6 | %92.0 | 2 |
| 0.6 | %81.5 | %95.5 | 1 |
| 0.7 | %74.1 | %100.0 | 0 |
| 0.8 | %63.0 | %100.0 | 0 |
| 0.9 | %59.3 | %100.0 | 0 |

**Etikete göre (en zayıftan):** kesim_erkek %0.0 (1) · kesim_kadin %0.0 (1) · balyaj %50.0 (2) · keratin %50.0 (2) · yok %100.0 (4) · tum_boya %100.0 (2) · protez_tirnak %100.0 (2) · manikur %100.0 (2) · fon %100.0 (2) · dip_boya %100.0 (1) · kalici_oje %100.0 (1) · pedikur %100.0 (1) · kas %100.0 (1) · lazer %100.0 (1) · gelin %100.0 (1) · makyaj %100.0 (1) · cilt %100.0 (1) · sakal %100.0 (1)

**Zorluk etiketine göre:** yazim %0.0 (1) · tuzak %33.3 (3) · esanlam %78.6 (14) · duz %100.0 (6) · katalog_disi %100.0 (4) · kisa %100.0 (1) · coklu %100.0 (1)

**Yanlışlar (en emin olunandan):**

| Mesaj | Bağlam | Beklenen | Seçilen | Güven |
|---|---|---|---|---|
| brezilya fönü |  | keratin | fon | 0.61 |
| oğluma tıraş |  | kesim_erkek | sakal | 0.58 |
| sac kesimi kisa bob |  | kesim_kadin | sakal | 0.34 |
| röfle yaptırmak istiyorum |  | balyaj | yok | 0.26 |

## hizmet · hazirlanmis

Ortalama güven — doğru: 0.85, yanlış: 0.49

| Eşik | Otomatik | Otomatikte doğruluk | Emin ama yanlış |
|---|---|---|---|
| 0.5 | %85.2 | %95.7 | 1 |
| 0.6 | %77.8 | %100.0 | 0 |
| 0.7 | %70.4 | %100.0 | 0 |
| 0.8 | %59.3 | %100.0 | 0 |
| 0.9 | %44.4 | %100.0 | 0 |

**Etikete göre (en zayıftan):** kesim_erkek %0.0 (1) · balyaj %50.0 (2) · keratin %50.0 (2) · manikur %50.0 (2) · yok %100.0 (4) · tum_boya %100.0 (2) · protez_tirnak %100.0 (2) · fon %100.0 (2) · dip_boya %100.0 (1) · kalici_oje %100.0 (1) · pedikur %100.0 (1) · kas %100.0 (1) · lazer %100.0 (1) · gelin %100.0 (1) · makyaj %100.0 (1) · cilt %100.0 (1) · sakal %100.0 (1) · kesim_kadin %100.0 (1)

**Zorluk etiketine göre:** coklu %0.0 (1) · tuzak %33.3 (3) · esanlam %78.6 (14) · duz %100.0 (6) · katalog_disi %100.0 (4) · kisa %100.0 (1) · yazim %100.0 (1)

**Yanlışlar (en emin olunandan):**

| Mesaj | Bağlam | Beklenen | Seçilen | Güven |
|---|---|---|---|---|
| manikür pedikür ikisi |  | manikur / pedikur | yok | 0.56 |
| röfle yaptırmak istiyorum |  | balyaj | fon | 0.48 |
| brezilya fönü |  | keratin | fon | 0.48 |
| oğluma tıraş |  | kesim_erkek | sakal | 0.46 |

## hizmet · salon

Ortalama güven — doğru: 0.88, yanlış: 0.54

| Eşik | Otomatik | Otomatikte doğruluk | Emin ama yanlış |
|---|---|---|---|
| 0.5 | %96.3 | %96.2 | 1 |
| 0.6 | %92.6 | %100.0 | 0 |
| 0.7 | %81.5 | %100.0 | 0 |
| 0.8 | %70.4 | %100.0 | 0 |
| 0.9 | %55.6 | %100.0 | 0 |

**Etikete göre (en zayıftan):** manikur %50.0 (2) · yok %100.0 (4) · balyaj %100.0 (2) · tum_boya %100.0 (2) · keratin %100.0 (2) · protez_tirnak %100.0 (2) · fon %100.0 (2) · dip_boya %100.0 (1) · kalici_oje %100.0 (1) · pedikur %100.0 (1) · kas %100.0 (1) · lazer %100.0 (1) · gelin %100.0 (1) · makyaj %100.0 (1) · cilt %100.0 (1) · kesim_erkek %100.0 (1) · sakal %100.0 (1) · kesim_kadin %100.0 (1)

**Zorluk etiketine göre:** coklu %0.0 (1) · esanlam %100.0 (14) · duz %100.0 (6) · katalog_disi %100.0 (4) · tuzak %100.0 (3) · kisa %100.0 (1) · yazim %100.0 (1)

**Yanlışlar (en emin olunandan):**

| Mesaj | Bağlam | Beklenen | Seçilen | Güven |
|---|---|---|---|---|
| manikür pedikür ikisi |  | manikur / pedikur | yok | 0.54 |

## saat · duz

Ortalama güven — doğru: 0.90, yanlış: 0.45

| Eşik | Otomatik | Otomatikte doğruluk | Emin ama yanlış |
|---|---|---|---|
| 0.5 | %85.7 | %87.5 | 3 |
| 0.6 | %82.1 | %91.3 | 2 |
| 0.7 | %71.4 | %95.0 | 1 |
| 0.8 | %67.9 | %100.0 | 0 |
| 0.9 | %60.7 | %100.0 | 0 |

**Etikete göre (en zayıftan):** hicbiri %50.0 (4) · s1 %77.8 (9) · s3 %80.0 (5) · s2 %90.0 (10)

**Zorluk etiketine göre:** dakika %40.0 (5) · kisa %50.0 (4) · listede_yok %50.0 (4) · tuzak %50.0 (2) · olumsuzluk %80.0 (5) · goreli_gun %83.3 (6) · gun_dilimi %100.0 (6) · duz %100.0 (1) · tarih %100.0 (1) · 12_24_saat %100.0 (1)

**Yanlışlar (en emin olunandan):**

| Mesaj | Bağlam | Beklenen | Seçilen | Güven |
|---|---|---|---|---|
| iki |  | s1 | s2 | 0.71 |
| bugün olmaz yarın aynı saat |  | s3 | hicbiri | 0.60 |
| dördü çeyrek geçe |  | hicbiri | s2 | 0.50 |
| 3'ü biraz geçe |  | hicbiri / s2 | s3 | 0.38 |
| 12 buçukta |  | hicbiri | s1 | 0.37 |
| dört |  | s1 | s2 | 0.15 |

## saat · hazirlanmis

Ortalama güven — doğru: 0.90, yanlış: 0.54

| Eşik | Otomatik | Otomatikte doğruluk | Emin ama yanlış |
|---|---|---|---|
| 0.5 | %89.3 | %92.0 | 2 |
| 0.6 | %85.7 | %91.7 | 2 |
| 0.7 | %82.1 | %91.3 | 2 |
| 0.8 | %78.6 | %95.5 | 1 |
| 0.9 | %71.4 | %100.0 | 0 |

**Etikete göre (en zayıftan):** hicbiri %75.0 (4) · s1 %77.8 (9) · s3 %80.0 (5) · s2 %100.0 (10)

**Zorluk etiketine göre:** kisa %50.0 (4) · tuzak %50.0 (2) · listede_yok %75.0 (4) · dakika %80.0 (5) · olumsuzluk %80.0 (5) · goreli_gun %83.3 (6) · gun_dilimi %100.0 (6) · duz %100.0 (1) · tarih %100.0 (1) · 12_24_saat %100.0 (1)

**Yanlışlar (en emin olunandan):**

| Mesaj | Bağlam | Beklenen | Seçilen | Güven |
|---|---|---|---|---|
| dördü çeyrek geçe |  | hicbiri | s2 | 0.80 |
| iki |  | s1 | s2 | 0.71 |
| bugün olmaz yarın aynı saat |  | s3 | hicbiri | 0.35 |
| dört |  | s1 | s2 | 0.31 |
