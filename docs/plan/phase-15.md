# Faz 15 — Ürün, stok, masraf ve kasa

**Sonuç:** Salonun temel ürün satışı, gideri ve günlük para hareketi izlenir. **Kapı:** G15. Eski 15A = F15-01/02, 15B = F15-03/04. Durumlar [TASKS.md](../../TASKS.md) içindedir.

Başlangıç F14 adisyon/tahsilat sözleşmesidir. Ürün/stok/rapor modülleri henüz yoktur; burada belirtilenler yapılacak işlerdir. Tam muhasebe, e-fatura ve ERP kapsamı eklenmez.

## F15-01

**Ürün kataloğu ve stok hareketleri**

- **Bağımlılık:** F14-02.
- **Sorumluluk:** Veri/backend + katalog arayüzü. **Çakışma alanı:** Ürün ve stok modeli.
- **İş ve çıktı:** Ürün adı/kodu, birim, satış fiyatı ve aktiflik; başlangıç stoğu, giriş ve gerekçeli düzeltme hareketleri ekle. İlk kapsam adet bazlı stoktur; lot/seri/depo transferi yoktur. Eksi stok varsayılan olarak engellenir; değişiklik ayrı açık karardır.
- **Kabul:** Negatif/geçersiz miktar ve başka tenant ürünü reddedilir. Stok yalnız hareketlerden izlenebilir şekilde değişir; eşzamanlı değişiklik kaybolmaz. Arşivleme geçmiş satış/snapshot'ı bozmaz; staff izinsiz stok/fiyat değiştiremez.
- **Devir:** Stok/ürün izinleri, miktar politikası, API örnekleri ve stok hareketi testleri.

## F15-02

**Ürün satışı, adisyon ve iade etkisi**

- **Bağımlılık:** F15-01, F14-03.
- **Sorumluluk:** Backend + SalonApp. **Çakışma alanı:** Adisyon ürün satırı, bağımsız satış ve stok etkisi.
- **İş ve çıktı:** Ürünü hizmetle aynı adisyona veya Yeni ürün satışı yolundan bağımsız satışa ekle. Stok düşme anını kesinleştir; taslak adisyonda sessizce stok düşürme. Satış/iptal/iade ve stok hareketini aynı işlem/idempotency sınırına bağla.
- **Kabul:** Son bir ürünü eşzamanlı satan iki işlem stoğu eksiye düşüremez. Aynı satış tekrarında çift stok/tahsilat oluşmaz. İade tutarı ile stoğa fiziksel geri dönüş ayrı açık alanlardır; bozuk ürün otomatik satılabilir stoğa eklenmez. Kapalı satış geçmişi korunur.
- **Devir:** Satış yaşam döngüsü, stok anı ve düzeltme/iade senaryoları; ürün satış ekranı kanıtı.

## F15-03

**Masraf ve düzeltme kayıtları**

- **Bağımlılık:** F14-03.
- **Sorumluluk:** Backend + SalonApp. **Çakışma alanı:** Masraf modülü.
- **İş ve çıktı:** Kategori/açıklama/tutar/tarih/ödeme yöntemiyle masraf ekle; yetkili düzeltme/iptali izlenebilir kaydet. Yeni masraf ve Diğer → masraflar yollarını bağla; ortak para birimi/yetki kurallarını kullan.
- **Kabul:** Mükerrer istek ikinci masraf oluşturmaz. Aktör/işletme/zaman korunur; staff varsayılan olarak mali yazım yapamaz. Başka işletme kaydı okunamaz; gider silinerek geçmiş kasa sessizce değişmez.
- **Devir:** Masraf sorgu/hareket sözleşmesi ve raporun kullanacağı tarih/ödeme yöntemi alanları.

## F15-04

**Kasa, gün sonu ve temel raporlar**

- **Bağımlılık:** F15-02, F15-03, F14-03.
- **Sorumluluk:** Veri/backend + işletme arayüzü/QA. **Çakışma alanı:** Mali rapor projeksiyonları.
- **İş ve çıktı:** Nakit/kart tahsilat, iade/düzeltme, masraf, ürün satışı, kalan bakiye ve gelir-gider görünümü; işletme gününe göre filtre/gün sonu özeti ekle. Beklenen randevu bedeli, satış ve gerçekleşen tahsilatı ayrı adlandır; kasa toplamını randevu listesinden hesaplama.
- **Kabul:** Örnek 1.000 TL tahsilat − 100 TL iade − 150 TL masraf = 750 TL net hareket; nakit ve kart kırılımı kaynak kayıtlarla eşleşir. Tahsil edilmemiş 300 TL bakiye para girişine eklenmez. Gece/DST gün sınırı, tarih filtresi, yetki ve iki tenant sınırı geçer.
- **Devir:** Hesap tanımları, mutabakat veri seti ve G15 kanıtı. Gün sonu özeti mali kayıtları geriye dönük kilitleyen ayrı muhasebe motoru sayılmaz.
- **v3 sıra:** Rapor/mutabakat PWA veya üç kol kabulünü beklemez; F14-03 mali sözleşmesi yeterlidir. G14/G15 birleşik kabulü F17’de ayrıca aranır. K02/K03 kaynak hareketi, tarih, sayfalama ve maliyet sınırları kullanılır.
