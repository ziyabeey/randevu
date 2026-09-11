# Faz 16 — Referanstaki kalan işlevler

**Sonuç:** Üç koldaki onaylanmış referans işlevleri çalışır biçimde tamamlanır. **Kapı:** G16. Eski 16A–E adları aşağıdaki görevlerle korunur. Durumlar [TASKS.md](../../TASKS.md) içindedir.

Bu işler MVP hedefinden çıkarılmamıştır. Her biri ayrı PR olabilir; görev kartı gerekirse kapsamı değiştirmeden alt işlere bölünür. Menü başlığı veya statik ekran, işlev kabulü değildir.

## F16-01

**Tekrarlayan randevu serisi · 16A**

- **Bağımlılık:** F11-04, F13-03.
- **Sorumluluk:** Veri/backend + randevu editörü. **Çakışma alanı:** Randevu serisi/grup işlemleri.
- **İş ve çıktı:** Sıklık/adet, seri önizlemesi, çakışma listesi, tek oluşum ve gelecek oluşumlar için açık değişiklik kapsamı ekle. İlk sürümde sınırlı adetli seri atomik oluşturulur; bir oluşum çakışırsa tüm seri reddedilir. Adet üst sınırını performans ölçümüyle belgeleyip sunucuda uygula.
- **Kabul:** DST/izin/kapanış içeren seri yanlış saate kaymaz; çakışmalar kullanıcıya hangi tarihte olduğunu gösterir. Tekrar istek ikinci seri üretmez. Tamamlanan geçmiş oluşum değişmez; geleceği taşıma/iptalde kapsam önizlemesi ve audit vardır.
- **Devir:** Seri/oluşum kimlikleri, durum olayları, limit ve F16-02'nin kullanacağı güncel sürüm bilgisi.

## F16-02

**Hatırlatma, SMS ve yaşam döngüsü bildirimleri · 16A**

- **Bağımlılık:** F09-05, F16-01, F17-01.
- **Sorumluluk:** Backend + işletme ayarları/QA. **Çakışma alanı:** Ortak bildirim işleri ve şablonlar.
- **İş ve çıktı:** E-posta/SMS hatırlatma, iptal/taşıma bildirimi ve randevu başına kanal/hatırlatma tercihlerini ekle. Zamanlanmış gönderim güncel durum/sürüme bağlı olsun; işlem mesajlarıyla pazarlama amaçları karıştırılmasın. Sağlayıcı hesabı/gönderici ve test alıcıları ortam notunda belirtilsin.
- **Kabul:** İptal edilen/taşınan randevunun eski saat mesajı gönderilmez. Kuyruk tekrarında aynı olay için kontrolsüz çift mesaj oluşmaz. Kanal yokluğu/sağlayıcı kesintisi randevuyu bozmaz; gerçek test alıcısında teslim doğrulanır. Mesaj içeriği başka tenant veya gereksiz özel bilgi taşımaz.
- **Devir:** Olay/kanal matrisi, şablonlar, yeniden deneme sınırları, gerçek teslim kanıtları ve maliyet/limit ayarlarının nereden yönetildiği.

## F16-03

**Özel hizmet/randevu fotoğrafları · 16B**

- **Bağımlılık:** F12-02, F13-03.
- **Sorumluluk:** Backend/depolama + detay arayüzü. **Çakışma alanı:** Özel fotoğraf erişimi.
- **İş ve çıktı:** Randevu detayındaki Fotoğraf sekmesi ve işletme hizmet fotoğrafı arşivi; yükleme, görüntüleme ve silme kuralları ekle. Özel müşteri fotoğrafı ile public salon fotoğrafını ayır; yayınlama açık bir işlem olsun.
- **Kabul:** Yetkisiz veya başka işletme kullanıcısı tahmin ettiği dosya yolu/URL ile erişemez. Geçici erişim süresi dolması/üyelik iptali davranışı testlidir. Dosya türü/boyutu doğrulanır; silinen veya başarısız yüklenen görsel ekranı bozmaz.
- **Devir:** Erişim/yayınlama modeli ve public/özel negatif testleri; veri saklama/silme çalışma notu.

## F16-04

**Yorum, geri bildirim ve destek · 16B**

- **Bağımlılık:** F12-05, F16-03.
- **Sorumluluk:** Backend + müşteri/SalonApp arayüzü. **Çakışma alanı:** Geri bildirim/yayın durumu.
- **İş ve çıktı:** Randevuya bağlı müşteri geri bildirimi, yayınlanacak yorumlar ve işletmenin geri bildirim listesi; ulaşılabilir destek yolu ekle. Kaynak doğrulama, mükerrer yorum, moderasyon/yayınlama ve kişisel bilgi görünürlüğünü açıklaştır.
- **Kabul:** Sahte/başka randevu kimliğiyle yorum oluşturulamaz. Özel geri bildirim onaylanmadan public olmaz; başka işletme yorumu değiştirilemez. Müşteri Yorumlar sekmesi gerçek yayınlanmış kayıtları gösterir; destek bağlantısı çalışır.
- **Devir:** Yorum durumları, kötüye kullanım testleri ve müşteri/işletme iki yüzündeki gerçek kayıt kanıtı.

## F16-05

**Paket satışı ve kullanım bakiyesi · 16C**

- **Bağımlılık:** F15-02.
- **Sorumluluk:** Veri/backend + SalonApp. **Çakışma alanı:** Paket hakları ve adisyon entegrasyonu.
- **İş ve çıktı:** Belirli hizmet/adet/süre koşullu paket, satış, kalan hak ve kullanım/düzeltme hareketlerini ekle. Yeni paket satışı yolunu aç; müşteri/adisyon geçmişine bağla. Hizmetin paketten karşılanması ile paket satış tahsilatının ilişkisini tanımla.
- **Kabul:** İki eşzamanlı kullanım son hakkı iki kez tüketmez; süresi dolan/başka işletmeye ait paket reddedilir. İptal/iade/kullanım geri alma hak ve mali kayıtları tutarlı etkiler. Paket satışı ve hizmet kullanımı kasa/primde yanlışlıkla iki gelir olarak sayılmaz.
- **Devir:** Hak/mali olay sözleşmesi, örnek hesaplar ve paket bakiye gerileme testleri.

## F16-06

**Promosyon ve kampanya kodu · 16C**

- **Bağımlılık:** F12-03, F14-03.
- **Sorumluluk:** Backend + müşteri/ayar arayüzü. **Çakışma alanı:** Fiyatlama ve promosyon koşulları.
- **İş ve çıktı:** Süre/hizmet/işletme/kullanım limiti ile sınırlı sabit veya yüzdelik indirim ekle. Müşteri özetindeki kodu adisyondaki gerçek hesapla bağla; indirimlerin birlikte kullanımı ve yuvarlamasını açık kurala bağla.
- **Kabul:** İstemci fiyatı/indirim oranı kabul edilmez; kod koşulları kayıt anında yeniden doğrulanır. Aynı son kullanım hakkı eşzamanlı iki işlemde tüketilmez. İndirim toplamı negatife düşürmez; tarih/iptal ve fiyat aralığı belirsizliği doğru gösterilir.
- **Devir:** Koşul/hesap sözleşmesi, yetki/limit testleri ve müşteri özetinden adisyona tutarlı örnek.

## F16-07

**Prim ve çalışan raporu · 16D**

- **Bağımlılık:** F15-04, F16-05, F16-06.
- **Sorumluluk:** Veri/backend + rapor arayüzü. **Çakışma alanı:** Prim hesap/projeksiyonu.
- **İş ve çıktı:** Hizmet/ürün/personel oranı ve hak kazanma temeli tanımla; paket, indirim, kısmi tahsilat ve iadeyi hesaba kat. Geçerli oranları geçmişe uygulayarak eski raporu sessizce değiştirme. Ziya'nın örnekleriyle tabloyu doğrula.
- **Kabul:** Hesap tanımı raporda görünür; dağıtılan pay kaynak tutarı aşmaz. Düzeltme/iade prim etkisi izlenir, personel doğru satıra bağlanır. Yetkisiz staff başkasının/işletmenin mali raporunu göremez. Bordro/maaş motoru eklenmez.
- **Devir:** Onaylı hesap örnekleri, tarihli oran/snapshot yaklaşımı ve kaynak hareketlerle mutabakat.

## F16-08

**Hesap menüsü, dil ve eksik menülerin kapanışı · 16E**

- **Bağımlılık:** F10-06, F14-01, F12-01.
- **Sorumluluk:** Ortak frontend + backend. **Çakışma alanı:** Hesap/plan bilgisi, dil ve navigasyon.
- **İş ve çıktı:** Üyelik/plan bilgisi, yetkili işletmeler arasında geçiş, parola değiştirme ve çıkışı ortak akışlara bağla. Varsayılan Türkçeyi koru; dil tercihi sunulacak ikinci dilde gerçekten uygulanır, başlangıç hedefi İngilizcedir. Pilot plan aktivasyonu manuel olabilir; hesap/işletme plan bilgisini gerçek veriden göster.
- **Kabul:** Şube seçimi yeni bir üst tenant hiyerarşisi varsaymaz. Dil seçimi tüm üç koldaki ilgili metin/tarih/sayıları etkiler; eksik çeviri teknik anahtar göstermez. Plan/erişim durumu API'de uygulanır; bakım/sona erme davranışı geçmiş müşteri randevusu yönetimini belirsiz bırakmaz. Otomatik abonelik çekimi yapılmış sayılmaz.
- **Devir:** Menü/route eşleştirmesi, desteklenen diller, plan durumları ve referanstaki kalan açıkların listesi.

G16 için sekiz görevin kabulü ve referans matrisi birlikte kapanır. Adisyon/rapor formunun görsellerde görünmeyen ayrıntıları YZT tasarımı olarak belgelenir; rakibin bilinmeyen davranışı hakkında iddia kurulmaz.
