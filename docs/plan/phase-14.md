# Faz 14 — SalonApp, adisyon ve tahsilat

**Sonuç:** Aynı salon verisi üzerinde mobil işlem, adisyon ve manuel tahsilat çalışır. **Kapı:** G14. Eski 14A = F14-01/02, 14B = F14-03/04; F14-05 ortak kabulüdür. Durumlar [TASKS.md](../../TASKS.md) içindedir.

Mevcut başlangıç: ortak kabuk, booking/calendar/customer API'leri. Adisyon/tahsilat tabloları ve SalonApp yolları henüz yoktur. Yeni dosya/yol adları ilgili PR sözleşmesinde belirlenir; bağımsız auth/randevu motoru oluşturulmaz.

## F14-01

**SalonApp mobil kabuğu**

- **Bağımlılık:** F13-04.
- **Sorumluluk:** Mobil frontend. **Çakışma alanı:** SalonApp kabuğu ve ortak router bağlantısı.
- **İş ve çıktı:** Randevular / Adisyonlar / Yeni / Müşteriler / Diğer alt menüsünü kur. Ortak oturum/işletme ve takvim/müşteri modüllerine bağla; Yeni ve Diğer gruplarını referans sırasıyla düzenle. Var olmayan özellik kullanıcıya tamamlanabilir işlem gibi sunulmasın.
- **Kabul:** İşletme değişimi tüm sekmeleri temizler; tarayıcı geri/ileri doğru ekranı açar. 360/390 px'te alt menü, cihaz güvenli alanı ve klavye içerik örtmez. Randevular paneldeki aynı kimliklerdir.
- **Devir:** Gerçek route/sekme haritası, ortak kabuk sınırı ve F14-04/F15/F16 bağlantı noktaları.

## F14-02

**Adisyon modeli ve hizmet satırları**

- **Bağımlılık:** F11-03, F10-02, F12-03.
- **Sorumluluk:** Veri/backend. **Çakışma alanı:** Yeni adisyon modeli ve mali izin sözleşmesi.
- **İş ve çıktı:** Randevu grubundan veya randevusuz adisyon aç; hizmet/personel/müşteri/fiyat snapshot'larını taşı. Açık/kapalı/iptal adisyon ile ödenmemiş/kısmi/ödenmiş bakiyeyi ayır. Fiyat aralığının kesin bedele dönüşümü ve iskonto yetkisini tanımla.
- **Kabul:** Aynı randevudan eşzamanlı tekrar açma tek adisyon döndürür. Tenant composite ilişkiler ve RLS çalışır. Açık adisyonu kimlerin değiştireceği bellidir; kapalı kayıt sessizce değişmez/silinmez. Kesin tutarı belirlenmemiş hizmet tahsilata hazır sayılmaz.
- **Devir:** Durum/izin matrisi, para birimi ve yuvarlama kuralları, API örnekleri, yeni migration/testler. Ürün satırı F15-02'de eklenir.

## F14-03

**Manuel tahsilat ve düzeltme**

- **Bağımlılık:** F14-02, F12-03.
- **Sorumluluk:** Veri/backend. **Çakışma alanı:** Tahsilat, bakiye ve mali audit.
- **İş ve çıktı:** Gerçekleşmiş nakit/kart tahsilatı, kısmi/bölünmüş ödeme, kalan bakiye, kapatma ve yetkili düzeltme/iade kaydı ekle. Tutarlar en küçük para birimiyle sunucuda hesaplanır; mali kayıtlar izlenebilir hareketlerle düzeltilir.
- **Kabul:** Aynı tahsilat anahtarının tekrarı ikinci kayıt yaratmaz; farklı içerikle reddedilir. Eşzamanlı tahsilat/iskonto/iade bakiyeyi bozmaz, kalan tutardan fazla ödeme ve tahsil edilenden fazla iade engellenir. Staff varsayılan mali yetki alamaz. Randevu tamamlanması ödeme, iptali otomatik iade sayılmaz.
- **Devir:** Hareket/bakiye örnekleri, kapatma/yeniden açma politikası ve concurrency/tenant/rol testleri. Kart tahsilatını kaydetmek çevrimiçi kart çekimi değildir.

## F14-04

**Adisyon ve kasa işlem ekranları**

- **Bağımlılık:** F14-01, F14-03.
- **Sorumluluk:** Mobil/işletme arayüzü. **Çakışma alanı:** Adisyon listesi, editör ve tahsilat formu.
- **İş ve çıktı:** Açık/kapalı adisyon listesi; hizmet/personel satırları, toplam/iskonto/bakiye, tahsilat ve işlem geçmişini göster. Randevu detayından ve Yeni menüsünden erişim ver; müşteri geçmişine bağla.
- **Kabul:** 600 TL adisyonda 200 TL nakit + 400 TL kart toplamı 600, kalan 0 gösterir; tekrar gönderimde değişmez. Yetersiz yetki anlaşılırdır. Ağ belirsizliğinde sonucu sorgular; başarısız işlemi ödendi göstermez. Satır/toplamlar sunucu sonucunu izler.
- **Devir:** Referansa yakın alan/işlem düzeni, mobil görüntüler ve F15 ürün/masraf bağlantıları.

## F14-05

**Üç kol, mali bütünlük ve PWA kabulü**

- **Bağımlılık:** F14-04, F12-05.
- **Sorumluluk:** QA + frontend/backend. **Çakışma alanı:** Entegrasyon ve mobil uygulama yaşam döngüsü.
- **İş ve çıktı:** Müşteri → panel → SalonApp → adisyon → tahsilat zincirini iki işletmeyle doğrula. Kurulabilir web uygulaması/manifest ve sürüm güncelleme davranışını tamamla; hassas API verisi veya mali yazımlar çevrimdışı kuyruğa/kalıcı önbelleğe alınmaz.
- **Kabul:** Bağlantı kesilmesi, çift tıklama, ikinci cihaz, yetki iptali ve uygulama güncellemesi veri/tahsilat kaybı yaratmaz. Desteklenen mobil tarayıcıda ana ekrana ekleme denenir; native mağaza yayını varsayılmaz. Panel ve SalonApp aynı işlem sonucunu gösterir.
- **Devir:** G14 kanıtı, mobil destek sınırı ve açık F15–16 işleri. Bu ara teslimat tam referans eşdeğerliği sayılmaz.
