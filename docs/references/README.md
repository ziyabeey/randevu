# Mobil referanslar — işlev ve düzen eşleştirmesi

Kaynak: ürün sahibinin 11 Eylül 2026 tarihinde sağladığı 11 ekran görüntüsü. Dosyalar orijinal halleriyle bu klasördedir; uygulamanın public varlıklarına dahil edilmez. İnceleme tabanı: `main` / `7c78be88fd1ed99bf37cd603eb503f2b1b4d4e3f`; Faz 9 ayrı taslak PR'dır.

Bu ekranlar işlev/işlem sırası ve işletme tarafındaki kullanım disiplini için referanstır. Müşteri kolu estetik olarak yeniden tasarlanır; randevu paneli ve SalonApp küçük görsel/ergonomik değişikliklerle bu düzeni korur. Rakibin logosu, salon fotoğrafı, örnek kişi/tarih/fiyatları üretim varlığı veya seed verisi değildir.

| Referans | Kol | Gözlenen işlev/düzen | Mevcut fark | Hedef faz | Görevler |
| --- | --- | --- | --- | --- | --- |
| [mobil-online-randevu-1.png](mobil-online-randevu-1.png) | Müşteri | Salon görseli, Hizmetler/Bilgiler/Yorumlar, kategoriler, fiyat aralığı, çoklu seçim, seçili sayı, favori/paylaşım | Mevcut booking tek hizmetli; profil/kategori/yorum/favori eşdeğerliği tamamlanmamış | 11–12, yorumlar 16B | F12-01…04, F16-04 |
| [mobil-online-randevu-2.png](mobil-online-randevu-2.png) | Müşteri | Bugün/yarın/tarih, saat listesi, uygun/dolu gösterimi | Slot motoru var; yeni görsel akış ve çok hizmetli slot desteği gerekli | 11–12 | F11-02, F12-04 |
| [mobil-online-randevu-3.png](mobil-online-randevu-3.png) | Müşteri | Hizmet özeti, tarih/saat, kampanya kodu, not, bilgilendirme/onay alanı, talep eylemi | Tek hizmet özeti var; çoklu hizmet, kampanya ve tam referans akışı eksik | 9, 11–12, kampanya 16C | F09-02, F12-05, F16-06 |
| [mobil-takvim-gun.png](mobil-takvim-gun.png) | Panel + SalonApp | Tarih, çalışan filtresi, personel renkleri/sütunları, saat ekseni, şimdi çizgisi, randevu blokları, alt menü | Gün/hafta var; renk/şimdi çizgisi/güncellik ve mobil menü eşdeğerliği eksik | 13–14 | F13-01/02, F14-01 |
| [mobil-takvim-liste.png](mobil-takvim-liste.png) | Panel + SalonApp | Takvimle aynı filtrede saat sıralı liste; müşteri/hizmet/personel; aynı alt menü | Ayrı liste görünümü eksik | 13–14 | F13-02/04, F14-01 |
| [mobil-yeni-randevu.png](mobil-yeni-randevu.png) | Panel + SalonApp | Yeni randevu/saat kapatma, zaman/müşteri, tekrar sıklığı/adedi, birden çok hizmet/personel, SMS, not | Tek hizmetli oluşturma ve ayrı kapanış ekranı var; çoklu hizmet/tekrar/SMS eksik | 11, 13–14, 16A | F11-02, F13-03, F16-01/02 |
| [mobil-randevu-detay.png](mobil-randevu-detay.png) | Panel + SalonApp | Detay/Fotoğraf/Ödeme, müşteri/zaman/not, iptal/gelmedi, hizmet ve ürün satırları, kaydet | Temel detay/durum var; çoklu satır/fotoğraf/adisyon/ürün bağlantıları eksik | 11, 13–15, 16B | F11-03, F13-03, F14-04, F15-02, F16-03 |
| [mobil-yeni.png](mobil-yeni.png) | SalonApp | Yeni randevu, adisyon, ürün satışı, paket satışı, masraf | Yalnız randevu yolu var; birleşik Yeni yüzeyi yok | 14–15, paket 16C | F14-01/04, F15-02/03, F16-05 |
| [mobil-diger-1.png](mobil-diger-1.png) | SalonApp | Destek, Online Randevu, geri bildirim, fotoğraflar; kasa/prim/masraf/ürün/gelir-gider/çalışan raporları | Public ayarlar var; birleşik menü ve rapor modülleri yok | 14–15, 16B/16D | F14-01, F15-04, F16-03/04/07 |
| [mobil-diger-2.png](mobil-diger-2.png) | SalonApp | Salon, mesai, çalışan, hizmet, süre/fiyat, randevu ayarları, ürün/stok, fotoğraf, promosyon | Temel katalog/mesai var; düzenleme ve genişleme işlevleri eksik | 10, 12, 14–15, 16C | F10-04, F12-02/03, F15-01, F16-06 |
| [mobil-diger-3.png](mobil-diger-3.png) | Panel + SalonApp | Üyelik, şube değiştirme, dil, şifre, çıkış | Giriş/çıkış ve işletme seçimi API'si var; tam hesap menüsü/yönetimi eksik | 10, 14, 16E | F10-01/03, F16-08 |

Görev kimliklerinin kapsamı ve durumu [TASKS.md](../../TASKS.md) içindedir. Bu eşleştirme planlama kaydıdır; mevcut fark sütunu ancak ilgili uygulama ve kabul kanıtıyla güncellenir.

## Ekranda görünmeyen davranışlar

Adisyon listesinin içeriği, ödeme formu, rapor hesaplama kuralları ve stok/paket motoru bu görsellerde bütünüyle görünmüyor. Bunların [ürün kurallarındaki](../../PRODUCT_SPEC.md) davranışı YZT için kabul edilen hedef tasarımdır; rakibin görünmeyen işleyişi hakkında doğrulanmış iddia değildir.

Çok hizmet ve farklı personel seçimi ekranlarda görünür; eşzamanlı çalışma/işlem arası bekleme semantiği yalnız görüntüden çıkarılamaz. Mevcut çakışma koruması bu nedenle kaldırılmaz.

## Her ilgili PR'da kontrol

1. İlgili ekran dosyasını aç; ürün kolunu ve satırdaki işlevleri belirle.
2. Müşteri yüzeyinde işlev koruması + estetik kaliteyi; işletme yüzeylerinde işlem/alan sırası + küçük fark sınırını kontrol et.
3. Gerçek uygulama görüntüsünü ve API/işlem sonucunu birlikte doğrula; statik benzerlik işlev kanıtı değildir.
4. Tamamlanan işlevin durumunu bu matriste ve `PROJECT_STATE.md` içinde kanıtıyla güncelle. Sonraki faza bağlı öğeleri eksik olarak tut.
