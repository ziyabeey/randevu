# Jev Türkçe randevu değerlendirmesi — 2026-09-24T04:51:42.242Z

Model: jev-1.13.0 · Güven eşiği: 0.8 · Fiyat varsayımı: $0.042/1M girdi token

**Doğruluk** yalnız net mesajlarda ölçülür. **Otomatik** = güveni eşiğin üstünde olup insana sorulmadan uygulanacak kararların oranı.
**Emin ama yanlış** = eşiğin üstünde olduğu hâlde yanlış olan karar sayısı; botun asıl riski budur.
**Belirsizde durma** = gerçekten belirsiz mesajlarda güvenin eşiğin altında kalıp soruya/insana düşme oranı (yüksek olması iyi).
**kural** = anahtar kelime kuralları. Test seti görülerek yazıldığı için iyimserdir; yeni gerçek mesajlarda bu kadar iyi olması beklenmez.

| Görev | Varyant | n | Hata | Doğruluk | Otomatik | Otomatikte doğruluk | Emin ama yanlış | Belirsizde durma | p50 ms | p95 ms | Maliyet |
|---|---|---|---|---|---|---|---|---|---|---|---|
| niyet | kural | 183 | 0 | %93.6 | — | — | — | — | 0 | 0 | $0.00000 |
| niyet | duz | 183 | 0 | %98.3 | %91.9 | %100.0 | 0 | %54.5 | 278 | 439 | $0.00607 |
| niyet | hazirlanmis | 183 | 0 | %98.3 | %91.3 | %99.4 | 1 | %45.5 | 293 | 464 | $0.01096 |
| hizmet | duz | 30 | 0 | %85.2 | %63.0 | %100.0 | 0 | %33.3 | 274 | 504 | $0.00086 |
| hizmet | hazirlanmis | 30 | 0 | %81.5 | %59.3 | %100.0 | 0 | %33.3 | 281 | 403 | $0.00113 |
| saat | duz | 31 | 0 | %82.1 | %67.9 | %100.0 | 0 | %100.0 | 299 | 365 | $0.00069 |
| saat | hazirlanmis | 31 | 0 | %89.3 | %75.0 | %100.0 | 0 | %100.0 | 279 | 367 | $0.00090 |

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

Ortalama güven — doğru: 0.96, yanlış: 0.64

| Eşik | Otomatik | Otomatikte doğruluk | Emin ama yanlış |
|---|---|---|---|
| 0.5 | %99.4 | %98.2 | 3 |
| 0.6 | %97.1 | %98.8 | 2 |
| 0.7 | %94.2 | %99.4 | 1 |
| 0.8 | %91.9 | %100.0 | 0 |
| 0.9 | %83.7 | %100.0 | 0 |

**Etikete göre (en zayıftan):** gecikme %91.7 (12) · ret %91.7 (12) · randevu_tasi %93.8 (16) · bilgi_sorusu %100.0 (19) · randevu_iptal %100.0 (18) · randevu_al %100.0 (17) · fiyat_sorusu %100.0 (15) · onay %100.0 (15) · sikayet %100.0 (15) · memnuniyet %100.0 (12) · insan_istiyor %100.0 (11) · diger %100.0 (10)

**Zorluk etiketine göre:** coklu %91.7 (12) · baglam %96.2 (26) · olumsuzluk %96.3 (27) · duz %97.5 (80) · kisa %100.0 (30) · yazim %100.0 (20) · emoji %100.0 (7) · ironi %100.0 (3) · spam %100.0 (2)

**Yanlışlar (en emin olunandan):**

| Mesaj | Bağlam | Beklenen | Seçilen | Güven |
|---|---|---|---|---|
| Kızımın randevusunu benimkiyle aynı saate alabilir miyiz |  | randevu_tasi | randevu_al | 0.78 |
| cumartesi değil pazar olabilir mi | Cumartesi 12:00 için yer ayıralım mı? | randevu_al / ret | randevu_tasi | 0.64 |
| Park yeri arıyorum birazdan ordayım |  | gecikme | bilgi_sorusu | 0.51 |

## niyet · hazirlanmis

Ortalama güven — doğru: 0.95, yanlış: 0.57

| Eşik | Otomatik | Otomatikte doğruluk | Emin ama yanlış |
|---|---|---|---|
| 0.5 | %98.3 | %99.4 | 1 |
| 0.6 | %95.3 | %99.4 | 1 |
| 0.7 | %92.4 | %99.4 | 1 |
| 0.8 | %91.3 | %99.4 | 1 |
| 0.9 | %85.5 | %99.3 | 1 |

**Etikete göre (en zayıftan):** gecikme %91.7 (12) · ret %91.7 (12) · bilgi_sorusu %94.7 (19) · randevu_iptal %100.0 (18) · randevu_al %100.0 (17) · randevu_tasi %100.0 (16) · fiyat_sorusu %100.0 (15) · onay %100.0 (15) · sikayet %100.0 (15) · memnuniyet %100.0 (12) · insan_istiyor %100.0 (11) · diger %100.0 (10)

**Zorluk etiketine göre:** coklu %91.7 (12) · baglam %96.2 (26) · olumsuzluk %96.3 (27) · duz %97.5 (80) · kisa %100.0 (30) · yazim %100.0 (20) · emoji %100.0 (7) · ironi %100.0 (3) · spam %100.0 (2)

**Yanlışlar (en emin olunandan):**

| Mesaj | Bağlam | Beklenen | Seçilen | Güven |
|---|---|---|---|---|
| cumartesi değil pazar olabilir mi | Cumartesi 12:00 için yer ayıralım mı? | randevu_al / ret | randevu_tasi | 0.93 |
| Park yeri arıyorum birazdan ordayım |  | gecikme | diger | 0.42 |
| Instagramdaki fotoğraftaki modeli yapabilir misiniz |  | bilgi_sorusu | diger | 0.37 |

## hizmet · duz

Ortalama güven — doğru: 0.90, yanlış: 0.50

| Eşik | Otomatik | Otomatikte doğruluk | Emin ama yanlış |
|---|---|---|---|
| 0.5 | %92.6 | %92.0 | 2 |
| 0.6 | %92.6 | %92.0 | 2 |
| 0.7 | %81.5 | %95.5 | 1 |
| 0.8 | %63.0 | %100.0 | 0 |
| 0.9 | %55.6 | %100.0 | 0 |

**Etikete göre (en zayıftan):** kesim_erkek %0.0 (1) · kesim_kadin %0.0 (1) · balyaj %50.0 (2) · keratin %50.0 (2) · yok %100.0 (4) · tum_boya %100.0 (2) · protez_tirnak %100.0 (2) · manikur %100.0 (2) · fon %100.0 (2) · dip_boya %100.0 (1) · kalici_oje %100.0 (1) · pedikur %100.0 (1) · kas %100.0 (1) · lazer %100.0 (1) · gelin %100.0 (1) · makyaj %100.0 (1) · cilt %100.0 (1) · sakal %100.0 (1)

**Zorluk etiketine göre:** yazim %0.0 (1) · tuzak %33.3 (3) · esanlam %78.6 (14) · duz %100.0 (6) · katalog_disi %100.0 (4) · kisa %100.0 (1) · coklu %100.0 (1)

**Yanlışlar (en emin olunandan):**

| Mesaj | Bağlam | Beklenen | Seçilen | Güven |
|---|---|---|---|---|
| brezilya fönü |  | keratin | fon | 0.78 |
| oğluma tıraş |  | kesim_erkek | sakal | 0.65 |
| sac kesimi kisa bob |  | kesim_kadin | sakal | 0.32 |
| röfle yaptırmak istiyorum |  | balyaj | yok | 0.23 |

## hizmet · hazirlanmis

Ortalama güven — doğru: 0.86, yanlış: 0.47

| Eşik | Otomatik | Otomatikte doğruluk | Emin ama yanlış |
|---|---|---|---|
| 0.5 | %88.9 | %87.5 | 3 |
| 0.6 | %81.5 | %95.5 | 1 |
| 0.7 | %70.4 | %100.0 | 0 |
| 0.8 | %59.3 | %100.0 | 0 |
| 0.9 | %40.7 | %100.0 | 0 |

**Etikete göre (en zayıftan):** kesim_erkek %0.0 (1) · balyaj %50.0 (2) · keratin %50.0 (2) · protez_tirnak %50.0 (2) · manikur %50.0 (2) · yok %100.0 (4) · tum_boya %100.0 (2) · fon %100.0 (2) · dip_boya %100.0 (1) · kalici_oje %100.0 (1) · pedikur %100.0 (1) · kas %100.0 (1) · lazer %100.0 (1) · gelin %100.0 (1) · makyaj %100.0 (1) · cilt %100.0 (1) · sakal %100.0 (1) · kesim_kadin %100.0 (1)

**Zorluk etiketine göre:** coklu %0.0 (1) · tuzak %33.3 (3) · esanlam %71.4 (14) · duz %100.0 (6) · katalog_disi %100.0 (4) · kisa %100.0 (1) · yazim %100.0 (1)

**Yanlışlar (en emin olunandan):**

| Mesaj | Bağlam | Beklenen | Seçilen | Güven |
|---|---|---|---|---|
| brezilya fönü |  | keratin | fon | 0.61 |
| oğluma tıraş |  | kesim_erkek | sakal | 0.53 |
| manikür pedikür ikisi |  | manikur / pedikur | yok | 0.51 |
| tırnak uzatma |  | protez_tirnak | manikur | 0.40 |
| röfle yaptırmak istiyorum |  | balyaj | fon | 0.32 |

## saat · duz

Ortalama güven — doğru: 0.88, yanlış: 0.51

| Eşik | Otomatik | Otomatikte doğruluk | Emin ama yanlış |
|---|---|---|---|
| 0.5 | %85.7 | %87.5 | 3 |
| 0.6 | %78.6 | %95.5 | 1 |
| 0.7 | %78.6 | %95.5 | 1 |
| 0.8 | %67.9 | %100.0 | 0 |
| 0.9 | %60.7 | %100.0 | 0 |

**Etikete göre (en zayıftan):** hicbiri %50.0 (4) · s3 %80.0 (5) · s1 %88.9 (9) · s2 %90.0 (10)

**Zorluk etiketine göre:** dakika %40.0 (5) · listede_yok %50.0 (4) · tuzak %50.0 (2) · kisa %75.0 (4) · olumsuzluk %80.0 (5) · goreli_gun %83.3 (6) · gun_dilimi %100.0 (6) · duz %100.0 (1) · tarih %100.0 (1) · 12_24_saat %100.0 (1)

**Yanlışlar (en emin olunandan):**

| Mesaj | Bağlam | Beklenen | Seçilen | Güven |
|---|---|---|---|---|
| iki |  | s1 | s2 | 0.76 |
| bugün olmaz yarın aynı saat |  | s3 | hicbiri | 0.58 |
| dördü çeyrek geçe |  | hicbiri | s2 | 0.53 |
| 12 buçukta |  | hicbiri | s1 | 0.41 |
| 3'ü biraz geçe |  | hicbiri / s2 | s3 | 0.25 |

## saat · hazirlanmis

Ortalama güven — doğru: 0.89, yanlış: 0.58

| Eşik | Otomatik | Otomatikte doğruluk | Emin ama yanlış |
|---|---|---|---|
| 0.5 | %89.3 | %92.0 | 2 |
| 0.6 | %89.3 | %92.0 | 2 |
| 0.7 | %89.3 | %92.0 | 2 |
| 0.8 | %75.0 | %100.0 | 0 |
| 0.9 | %71.4 | %100.0 | 0 |

**Etikete göre (en zayıftan):** hicbiri %75.0 (4) · s1 %77.8 (9) · s2 %100.0 (10) · s3 %100.0 (5)

**Zorluk etiketine göre:** kisa %50.0 (4) · tuzak %50.0 (2) · listede_yok %75.0 (4) · dakika %80.0 (5) · goreli_gun %100.0 (6) · gun_dilimi %100.0 (6) · olumsuzluk %100.0 (5) · duz %100.0 (1) · tarih %100.0 (1) · 12_24_saat %100.0 (1)

**Yanlışlar (en emin olunandan):**

| Mesaj | Bağlam | Beklenen | Seçilen | Güven |
|---|---|---|---|---|
| dördü çeyrek geçe |  | hicbiri | s2 | 0.76 |
| iki |  | s1 | s2 | 0.73 |
| dört |  | s1 | s2 | 0.24 |
