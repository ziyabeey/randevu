# Faz 16 — Referanstaki kalan işlevler

**Sonuç:** Üç koldaki onaylanmış referans işlevleri çalışır biçimde tamamlanır. **Kapı:** G16. Eski 16A–E adları aşağıdaki görevlerle korunur. Durumlar [TASKS.md](../../TASKS.md) içindedir.

Bu işler MVP hedefinden çıkarılmamıştır. Her biri ayrı PR olabilir; görev kartı gerekirse kapsamı değiştirmeden alt işlere bölünür. Menü başlığı veya statik ekran, işlev kabulü değildir.

**Faz direktifi / kaynak head `5e789ad`:** Çoğu F16 işi LIGHT/FOCUSED yürür; fiyat/para etkisi olan F16-05/06 ve bunların mali entegrasyonu daha yüksek kanıt ister. Var olmayan capability marketing veya ürün UI'ında canlıymış gibi gösterilmez; accepted feature production claim gate'iyle birlikte açılır.

## F16-01

**Tekrarlayan randevu serisi · 16A**

- **Bağımlılık:** F11-04, F13-03.
- **Sorumluluk:** Veri/backend + randevu editörü. **Çakışma alanı:** Randevu serisi/grup işlemleri.
- **İş ve çıktı:** Sıklık/adet, seri önizlemesi, çakışma listesi, tek oluşum ve gelecek oluşumlar için açık değişiklik kapsamı ekle. İlk sürümde sınırlı adetli seri atomik oluşturulur; bir oluşum çakışırsa tüm seri reddedilir. Adet üst sınırını performans ölçümüyle belgeleyip sunucuda uygula.
- **Kabul:** DST/izin/kapanış içeren seri yanlış saate kaymaz; çakışmalar kullanıcıya hangi tarihte olduğunu gösterir. Tekrar istek ikinci seri üretmez. Tamamlanan geçmiş oluşum değişmez; geleceği taşıma/iptalde kapsam önizlemesi ve audit vardır.
- **Devir:** Seri/oluşum kimlikleri, durum olayları, limit ve F16-02'nin kullanacağı güncel sürüm bilgisi.
- **v3 olay kabulü:** Her seri oluşumu K01 grup kimliği ve S03/F16-02 olay-sürüm sözleşmesini kullanır. K03 başlangıç seri sınırı uygulanır. F16-02 henüz bitmediyse olay kontratı test edilir; G16’da gelecek seriyi taşıma/iptal ile eski hatırlatma baskılama birlikte doğrulanır.

## F16-02

**Hatırlatma, SMS ve yaşam döngüsü bildirimleri · 16A**

- **Bağımlılık:** F09-05, F11-03, F17-01.
- **Sorumluluk:** Backend + işletme ayarları/QA. **Çakışma alanı:** Ortak bildirim işleri ve şablonlar.
- **İş ve çıktı:** E-posta/SMS hatırlatma, iptal/taşıma bildirimi ve randevu başına kanal/hatırlatma tercihlerini ekle. Zamanlanmış gönderim güncel durum/sürüme bağlı olsun; işlem mesajlarıyla pazarlama amaçları karıştırılmasın. Sağlayıcı hesabı/gönderici ve test alıcıları ortam notunda belirtilsin.
- **Kabul:** İptal edilen/taşınan randevunun eski saat mesajı gönderilmez. Kuyruk tekrarında aynı olay için kontrolsüz çift mesaj oluşmaz. Kanal yokluğu/sağlayıcı kesintisi randevuyu bozmaz; gerçek test alıcısında teslim doğrulanır. Mesaj içeriği başka tenant veya gereksiz özel bilgi taşımaz.
- **Devir:** Olay/kanal matrisi, şablonlar, yeniden deneme sınırları, gerçek teslim kanıtları ve maliyet/limit ayarlarının nereden yönetildiği.
- **v3 sıra ve sınır:** Seri özelliğini beklemez; tek/çok hizmetli normal grup olaylarına bağlanır. Aynı notification motoru ve S03 provider anahtarı/sabit içerik modeli kullanılır. Seri hazır olduğunda yalnız olay üreticisi entegre edilir; G16 ortak kabulü ikisini test eder. SMS sağlayıcı/ücret/limit ve güvenli test alıcısı uygulama öncesi somutlaştırılır.
- **Hazır olan / dispatcher:** Faz 9 outbox lease/retry/max-attempt ve provider receipt modeli tek bildirim dispatcher'ıdır. SMS bunun üzerinde yeni kanal/adapter'dır; ikinci kuyruk/cron/retry motoru kurulmaz.
- **Production claim kapanışı:** F16-02 accepted+main olduktan sonra MKT-01 `MARKETING_RELEASE_GATES.reminders` aynı teslimin kabul checklist'inde `true`'ya çevrilir ve “Yakında” proof/copy'si gerçek accepted davranışla hizalanır. Feature henüz kabul edilmediyse gate fail-closed kalır.

## F16-03

**Özel hizmet/randevu fotoğrafları · 16B**

- **Bağımlılık:** F12-02, F13-03.
- **Sorumluluk:** Backend/depolama + detay arayüzü. **Çakışma alanı:** Özel fotoğraf erişimi.
- **İş ve çıktı:** Randevu detayındaki Fotoğraf sekmesi ve işletme hizmet fotoğrafı arşivi; yükleme, görüntüleme ve silme kuralları ekle. Özel müşteri fotoğrafı ile public salon fotoğrafını ayır; yayınlama açık bir işlem olsun.
- **Kabul:** Yetkisiz veya başka işletme kullanıcısı tahmin ettiği dosya yolu/URL ile erişemez. Geçici erişim süresi dolması/üyelik iptali davranışı testlidir. Dosya türü/boyutu doğrulanır; silinen veya başarısız yüklenen görsel ekranı bozmaz.
- **Devir:** Erişim/yayınlama modeli ve public/özel negatif testleri; veri saklama/silme çalışma notu.
- **v3 sınır:** K03 boyut/adet/saklama ve S08 storage/DB erişim kuralları kullanılır. Kalıcı public URL ile özel içerik sunulmaz; üyelik iptali ile geçici erişimin geçerlilik sınırı açıkça kaydedilir. Restore kapsamına görseller eklenir.
- **Uygulanan erişim modeli (2026-09-24):** Özel görseller public olmayan `appointment-private-media` bucket'ında `<business>/<group>/<media>.webp` yolunda durur; WebP, ≤5 MB, ≤2000 px ve randevu grubu başına en fazla 10 görsel (pending/ready/deleting sayılır; grup advisory lock'u ile). İmzalı veya public URL üretilmez: her görüntüleme Worker'da kullanıcının JWT'siyle `private, no-store` olarak akıtılır ve storage RLS aktif üyeliği her istekte yeniden doğrular. Bu yüzden “geçici erişim” penceresi yoktur; üyelik iptali bir sonraki istekte erişimi keser. Recovery oturumu reddedilir.
- **Yetki:** Aktif her üye yükler ve görür; silmeyi yükleyen üye ile owner/manager yapar; salon galerisinde yayınlamayı yalnız owner/manager, müşteri onayı işaretlenerek yapar. Yayınlama, F12 public galeride yeni ve bağımsız bir kayıt oluşturur (20 görsel sınırı korunur). Public kopyanın silinmesi özel orijinale dokunmaz ve yeniden yayınlamaya izin verir.
- **Arşiv ve saklama:** Hizmetler sayfasındaki “Hizmet fotoğraf arşivi”, işletmenin hazır özel görsellerini yeniden eskiye, hizmete göre filtreli ve keyset sayfalı (25, en çok 100) listeler. Otomatik silme süresi K03 gereği yoktur; F17-03 saklama kararı ve yedek/geri yükleme kapsamı bu bucket'ı içermelidir.

## F16-04

**Yorum, geri bildirim ve destek · 16B**

- **Bağımlılık:** F12-05.
- **Sorumluluk:** Backend + müşteri/SalonApp arayüzü. **Çakışma alanı:** Geri bildirim/yayın durumu.
- **İş ve çıktı:** Randevuya bağlı müşteri geri bildirimi, yayınlanacak yorumlar ve işletmenin geri bildirim listesi; ulaşılabilir destek yolu ekle. Kaynak doğrulama, mükerrer yorum, moderasyon/yayınlama ve kişisel bilgi görünürlüğünü açıklaştır.
- **Kabul:** Sahte/başka randevu kimliğiyle yorum oluşturulamaz. Özel geri bildirim onaylanmadan public olmaz; başka işletme yorumu değiştirilemez. Müşteri Yorumlar sekmesi gerçek yayınlanmış kayıtları gösterir; destek bağlantısı çalışır.
- **Devir:** Yorum durumları, kötüye kullanım testleri ve müşteri/işletme iki yüzündeki gerçek kayıt kanıtı.
- **v3 sıra:** Bu iş özel fotoğraf modülünü beklemez; doğrulanmış randevu/grup yetkisi yeterlidir. Public yorum yazımı S04 kaynak sınırları ve dar yetki modelini genişletir.

## F16-05

**Paket satışı ve kullanım bakiyesi · 16C**

- **Bağımlılık:** F15-02.
- **Sorumluluk:** Veri/backend + SalonApp. **Çakışma alanı:** Paket hakları ve adisyon entegrasyonu.
- **İş ve çıktı:** Belirli hizmet/adet/süre koşullu paket, satış, kalan hak ve kullanım/düzeltme hareketlerini ekle. Yeni paket satışı yolunu aç; müşteri/adisyon geçmişine bağla. Hizmetin paketten karşılanması ile paket satış tahsilatının ilişkisini tanımla.
- **Kabul:** İki eşzamanlı kullanım son hakkı iki kez tüketmez; süresi dolan/başka işletmeye ait paket reddedilir. İptal/iade/kullanım geri alma hak ve mali kayıtları tutarlı etkiler. Paket satışı ve hizmet kullanımı kasa/primde yanlışlıkla iki gelir olarak sayılmaz.
- **Devir:** Hak/mali olay sözleşmesi, örnek hesaplar ve paket bakiye gerileme testleri.
- **v3 mali sözleşme:** K02 kaynak satış/hak/para ayrımı kullanılır. Kullanım, iptal ve paket iadesi politikası Ziya’nın örnek hesabıyla başlarken netleştirilir; tüketilmiş hak ve iade tutarı ilişkisi deneysel rastgele karar değildir.
- **Tuzak / snapshot:** Paket kullanımı geçmiş appointment/service fiyat snapshot'ını yeniden yazmaz. Paketin mali etkisi ayrı hak/mali ledger hareketidir; randevu anındaki fiyat/süre/personel snapshot'ı tarihsel gerçek olarak kalır.

## F16-06

**Promosyon ve kampanya kodu · 16C**

- **Bağımlılık:** F12-03, F14-03.
- **Sorumluluk:** Backend + müşteri/ayar arayüzü. **Çakışma alanı:** Fiyatlama ve promosyon koşulları.
- **İş ve çıktı:** Süre/hizmet/işletme/kullanım limiti ile sınırlı sabit veya yüzdelik indirim ekle. Müşteri özetindeki kodu adisyondaki gerçek hesapla bağla; indirimlerin birlikte kullanımı ve yuvarlamasını açık kurala bağla.
- **Kabul:** İstemci fiyatı/indirim oranı kabul edilmez; kod koşulları kayıt anında yeniden doğrulanır. Aynı son kullanım hakkı eşzamanlı iki işlemde tüketilmez. İndirim toplamı negatife düşürmez; tarih/iptal ve fiyat aralığı belirsizliği doğru gösterilir.
- **Devir:** Koşul/hesap sözleşmesi, yetki/limit testleri ve müşteri özetinden adisyona tutarlı örnek.
- **v3 mali sözleşme:** K02 fiyat/politika snapshot’ı ve yuvarlama kullanılır. Başlarken paketle birlikte kullanım, kampanya limitinin rezervasyon anında ayrılması/kullanılması ve iptal sonrası serbest bırakılması örnekli karara bağlanır; kullanım kotası bu kararla transaction’da korunur.
- **Tuzak / tarihsel fiyat:** Promosyon/paket uygulaması yeni policy/ledger kaydıdır; eski appointment price snapshot alanlarını geçmişe dönük değiştirmez. Final charge/discount kaynağı adisyon/mali event zincirinde izlenebilir kalır.

## F16-07

**Prim ve çalışan raporu · 16D**

- **Bağımlılık:** F15-04, F16-05, F16-06.
- **Sorumluluk:** Veri/backend + rapor arayüzü. **Çakışma alanı:** Prim hesap/projeksiyonu.
- **İş ve çıktı:** Hizmet/ürün/personel oranı ve hak kazanma temeli tanımla; paket, indirim, kısmi tahsilat ve iadeyi hesaba kat. Geçerli oranları geçmişe uygulayarak eski raporu sessizce değiştirme. Ziya'nın örnekleriyle tabloyu doğrula.
- **Kabul:** Hesap tanımı raporda görünür; dağıtılan pay kaynak tutarı aşmaz. Düzeltme/iade prim etkisi izlenir, personel doğru satıra bağlanır. Yetkisiz staff başkasının/işletmenin mali raporunu göremez. Bordro/maaş motoru eklenmez.
- **Devir:** Onaylı hesap örnekleri, tarihli oran/snapshot yaklaşımı ve kaynak hareketlerle mutabakat.
- **v3 mali sözleşme:** K02 kaynak hareketi, fiyat ve oran sürümü kullanılır. Hak kazanmanın hizmet mi tahsilat mı temelli olduğu, paket/iskonto/kısmi ödeme/iade etkisi koddan önce Ziya’nın örnekleriyle kesinleşir. Bu bir performans deneyi değildir; karar değişirse tarihli yeni politika olur.

## F16-08

**Hesap menüsü, dil ve eksik menülerin kapanışı · 16E**

- **Bağımlılık:** F10-06, F14-01, F12-01.
- **Sorumluluk:** Ortak frontend + backend. **Çakışma alanı:** Hesap/plan bilgisi, dil ve navigasyon.
- **İş ve çıktı:** Üyelik/plan bilgisi, yetkili işletmeler arasında geçiş, parola değiştirme ve çıkışı ortak akışlara bağla. Varsayılan Türkçeyi koru; dil tercihi sunulacak ikinci dilde gerçekten uygulanır, başlangıç hedefi İngilizcedir. Pilot plan aktivasyonu manuel olabilir; hesap/işletme plan bilgisini gerçek veriden göster.
- **Kabul:** Şube seçimi yeni bir üst tenant hiyerarşisi varsaymaz. Dil seçimi tüm üç koldaki ilgili metin/tarih/sayıları etkiler; eksik çeviri teknik anahtar göstermez. Plan/erişim durumu API'de uygulanır; bakım/sona erme davranışı geçmiş müşteri randevusu yönetimini belirsiz bırakmaz. Otomatik abonelik çekimi yapılmış sayılmaz.
- **Devir:** Menü/route eşleştirmesi, desteklenen diller, plan durumları ve referanstaki kalan açıkların listesi.
- **Boş eylem audit'i:** F16-08 genel “temizlik” diye kapanmaz. Üç ürün kolunda görünür CTA/menu/tab/button listesi çıkarılır ve her biri `çalışıyor | açıkça disabled/upcoming | kaldırıldı` olarak sınıflanır. PRODUCT_SPEC'in “var olmayan özellik tamamlanabilir işlem gibi sunulmaz” kuralı bu listeyle kanıtlanır; boş buton, sahte route veya sonsuz spinner açık bırakılmaz.

G16 için sekiz görevin kabulü ve referans matrisi birlikte kapanır. Adisyon/rapor formunun görsellerde görünmeyen ayrıntıları YZT tasarımı olarak belgelenir; rakibin bilinmeyen davranışı hakkında iddia kurulmaz.
- **v3 bakım sınırı:** F10/F12/F13’te kurulan ortak metin/tarih/tutar sınırını kullan; tüm ekranları yeni framework’le yeniden yazma. Plan/erişim modeli gelecekteki PDF abonelik/AI kredi sistemini bu MVP’ye taşımaz.
