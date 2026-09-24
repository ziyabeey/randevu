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

## F16-04

**Yorum, geri bildirim ve destek · 16B**

- **Bağımlılık:** F12-05.
- **Sorumluluk:** Backend + müşteri/SalonApp arayüzü. **Çakışma alanı:** Geri bildirim/yayın durumu.
- **İş ve çıktı:** Randevuya bağlı müşteri geri bildirimi, yayınlanacak yorumlar ve işletmenin geri bildirim listesi; ulaşılabilir destek yolu ekle. Kaynak doğrulama, mükerrer yorum, moderasyon/yayınlama ve kişisel bilgi görünürlüğünü açıklaştır.
- **Kabul:** Sahte/başka randevu kimliğiyle yorum oluşturulamaz. Özel geri bildirim onaylanmadan public olmaz; başka işletme yorumu değiştirilemez. Müşteri Yorumlar sekmesi gerçek yayınlanmış kayıtları gösterir; destek bağlantısı çalışır.
- **Devir:** Yorum durumları, kötüye kullanım testleri ve müşteri/işletme iki yüzündeki gerçek kayıt kanıtı.
- **v3 sıra:** Bu iş özel fotoğraf modülünü beklemez; doğrulanmış randevu/grup yetkisi yeterlidir. Public yorum yazımı S04 kaynak sınırları ve dar yetki modelini genişletir.
- **Uygulanan model (2026-09-24):** Müşteri yalnız kendi yönetim bağlantısıyla (`/m#token`, token POST gövdesinde) ve yalnız `completed` randevu grubu için tek değerlendirme bırakır (1–5 puan, ≤1000 karakter yorum, açık yayın izni). Tahmin/başka randevu token'ı `MANAGEMENT_NOT_FOUND`; ikinci farklı gönderim `FEEDBACK_ALREADY_SUBMITTED`, birebir tekrar idempotent aynı sonuç döner. Public çağrılar ayrı ve dar `execute_public_feedback_operation` kapısından geçer: aynı gate secret, aynı S04 rate sınıfları (`read`/`manage_read`/`manage_change`), kapalı action listesi ve ayrı hata sözlüğü; booking kapısı genişletilmez.
- **Moderasyon ve görünürlük:** Her geri bildirim `pending` başlar ve public değildir. Owner/manager yalnız müşteri izni olanı `published` yapabilir (DB kısıtı: yayında ⇒ izin var), her yorumu `hidden` yapabilir; işlem beklenen durum ile CAS'lıdır. Staff listeyi görür, moderasyon yapamaz. Public “Yorumlar” bölümü yalnız yayınlanabilir salonun yayınlanmış kayıtlarını, ortalama/adet ile ve maskeli adla (“Ayşe D.”) gösterir; telefon, e-posta, tam ad ve randevu ayrıntısı public'e çıkmaz. İşletme tarafı çalışma alanındaki “Yorumlar” sayfasıdır.
- **Destek yolu:** F12-05'in salon/yönetim sayfalarındaki “Destek ve iletişim” bölümü korunur; yönetim sayfasında değerlendirme kartı bu bölümün hemen üstündedir.

## F16-05

**Paket satışı ve kullanım bakiyesi · 16C**

- **Bağımlılık:** F15-02.
- **Sorumluluk:** Veri/backend + SalonApp. **Çakışma alanı:** Paket hakları ve adisyon entegrasyonu.
- **İş ve çıktı:** Belirli hizmet/adet/süre koşullu paket, satış, kalan hak ve kullanım/düzeltme hareketlerini ekle. Yeni paket satışı yolunu aç; müşteri/adisyon geçmişine bağla. Hizmetin paketten karşılanması ile paket satış tahsilatının ilişkisini tanımla.
- **Kabul:** İki eşzamanlı kullanım son hakkı iki kez tüketmez; süresi dolan/başka işletmeye ait paket reddedilir. İptal/iade/kullanım geri alma hak ve mali kayıtları tutarlı etkiler. Paket satışı ve hizmet kullanımı kasa/primde yanlışlıkla iki gelir olarak sayılmaz.
- **Devir:** Hak/mali olay sözleşmesi, örnek hesaplar ve paket bakiye gerileme testleri.
- **v3 mali sözleşme:** K02 kaynak satış/hak/para ayrımı kullanılır. Kullanım, iptal ve paket iadesi politikası Ziya’nın örnek hesabıyla başlarken netleştirilir; tüketilmiş hak ve iade tutarı ilişkisi deneysel rastgele karar değildir.
- **Tuzak / snapshot:** Paket kullanımı geçmiş appointment/service fiyat snapshot'ını yeniden yazmaz. Paketin mali etkisi ayrı hak/mali ledger hareketidir; randevu anındaki fiyat/süre/personel snapshot'ı tarihsel gerçek olarak kalır.
- **Uygulanan model (2026-09-24, Ziya kararı: orantılı iade):**
  - **Tanım.** `service_packages` tek bir hizmetin 1–100 seansını, 1–730 gün geçerlilikle sabit fiyata tanımlar. Tanım/değişiklik `pricing_adjustments_write` ister ve sürüm CAS'lıdır. Değişiklik satılmış paketleri etkilemez; satışta ad, seans, fiyat, seans değeri ve bitiş tarihi `customer_packages` snapshot'ına yazılır.
  - **Para ile hak ayrımı (K02).** Satış, adisyonda `source_type = 'package'` satırıdır ve paketin tek gelir kaydıdır. Seans para değildir. Kullanım, hizmet satırını tam tutarlı paket karşılığıyla kapatır (iskonto = kesin tutar, net 0) ve append-only `use` hareketi yazar. Böylece kullanılan seans kasada/raporda ikinci kez gelir sayılmaz. Gün raporunda paket satışı `packageSaleMinor` olarak ayrı görünür; karşılanan seanslar yalnız adet/değer olarak mutabakata yazılır.
  - **Kullanım kuralları.** Paket aynı müşteriye, aynı hizmete, aynı işletmeye ve aynı para birimine bağlıdır; süresi dolan, tükenen, iptal edilen veya iade edilen paket reddedilir. Tahsil edilip kapatılmamış bir paket yalnız kendi satış adisyonundaki seansı karşılayabilir. İskontolu satıra paket uygulanmaz; karşılanan satırın iskontosu başka yoldan değiştirilemez (`LINE_COVERED_BY_PACKAGE`).
  - **Son hak.** Her kullanım, geri alma, iptal ve iade müşteri paketi satırını `FOR UPDATE` kilitler. İki eşzamanlı kullanımdan biri geçer, diğeri `PACKAGE_EXHAUSTED` alır (dblink yarış testi).
  - **Geri alma ve iptal.** Kullanım yalnız açık adisyonda gerekçeyle geri alınır (`reverse` hareketi, seans pakete döner). Adisyon iptali o adisyondaki kullanımları geri çevirir; seansı kullanılmamış paket satışını iptal eder, kullanılmışsa `PACKAGE_IN_USE`.
  - **Orantılı iade.** İade tutarı `round_half_up(fiyat × kalan / toplam)` ile hesaplanır; 5 seans 1.000 TL ve 2 kullanım için 600 TL. Satış adisyonu kapalı olmalı ve açık adisyonda bekleyen kullanım olmamalıdır. İade tutarı istemciden alınmaz; istemci yalnız gördüğü tutarı `expectedRefundMinor` ile teyit eder ve tutarı satış adisyonunun kendi tahsilatlarına dağıtır. Satış adisyonunun toplamı ürün iadesindeki gibi iade değeri kadar düşer; kalan seanslar düşer ve paket `refunded` olur.
  - **Yetki ve arayüz.** Satış, kullanım ve geri alma fiyat yetkisi; iade ödeme yetkisi ister. Paket tanımları Hizmetler sayfasındaki “Seans paketleri” bölümünden yönetilir. Adisyonda “Paket sat”, “Paketten düş”, “Paket kullanımını geri al”, kapalı satışta “Kalan seansları iade et” ve müşteri paketleri özeti bulunur.

## F16-06

**Promosyon ve kampanya kodu · 16C**

- **Bağımlılık:** F12-03, F14-03.
- **Sorumluluk:** Backend + müşteri/ayar arayüzü. **Çakışma alanı:** Fiyatlama ve promosyon koşulları.
- **İş ve çıktı:** Süre/hizmet/işletme/kullanım limiti ile sınırlı sabit veya yüzdelik indirim ekle. Müşteri özetindeki kodu adisyondaki gerçek hesapla bağla; indirimlerin birlikte kullanımı ve yuvarlamasını açık kurala bağla.
- **Kabul:** İstemci fiyatı/indirim oranı kabul edilmez; kod koşulları kayıt anında yeniden doğrulanır. Aynı son kullanım hakkı eşzamanlı iki işlemde tüketilmez. İndirim toplamı negatife düşürmez; tarih/iptal ve fiyat aralığı belirsizliği doğru gösterilir.
- **Devir:** Koşul/hesap sözleşmesi, yetki/limit testleri ve müşteri özetinden adisyona tutarlı örnek.
- **v3 mali sözleşme:** K02 fiyat/politika snapshot’ı ve yuvarlama kullanılır. Başlarken paketle birlikte kullanım, kampanya limitinin rezervasyon anında ayrılması/kullanılması ve iptal sonrası serbest bırakılması örnekli karara bağlanır; kullanım kotası bu kararla transaction’da korunur.
- **Tuzak / tarihsel fiyat:** Promosyon/paket uygulaması yeni policy/ledger kaydıdır; eski appointment price snapshot alanlarını geçmişe dönük değiştirmez. Final charge/discount kaynağı adisyon/mali event zincirinde izlenebilir kalır.
- **Uygulanan model (2026-09-24, Ziya kararı: rezervasyonda gir, adisyonda düş):**
  - **Tanım.** `promo_codes` sabit (kuruş) veya yüzdelik (baz puan) indirimdir. Başlangıç/bitiş penceresi, isteğe bağlı hizmet kapsamı ve isteğe bağlı toplam kullanım sınırı vardır. Kod işletme içinde tekildir, büyük harfe normalize edilir. Tanım `pricing_adjustments_write` ister ve sürüm CAS'lıdır.
  - **Rezervasyonda ayırma.** Müşteri rezervasyon formunda kodu kontrol eder (`GET /api/public/business/:slug/promo`: yalnız koşullar, kullanım sayısı yok). Randevu oluşunca kod, randevunun kendi yönetim bağlantısıyla (`POST /api/manage/promo`, token gövdede) sunucuda yeniden doğrulanır ve bir kullanım hakkı `reserved` olarak ayrılır. Rezervasyon RPC'si değişmedi; ayırma başarısız olursa randevu yine vardır ve kod yönetim sayfasından yeniden denenebilir. Public çağrılar `execute_public_promo_operation` kapısından (aynı gate secret ve S04 sınıfları) geçer.
  - **Adisyonda düşme.** Randevudan açılan adisyon ayrılmış kodu otomatik taşır; işletme açık adisyona da kod uygulayabilir veya gerekçeyle kaldırabilir. Adisyon kapanınca ayırma `consumed` olur; indirim ve satır bazında dağılımı (`promo_redemption_lines`, kalan kuruşlar satır sırasıyla) dondurulur. Randevu iptali veya gelmeme, adisyon iptali ya da işletmenin kaldırması hakkı `released` yapar.
  - **Hesap kuralları.** Bir adisyonda tek kod. Yalnız kapsamdaki, kesinleşmiş hizmet satırları indirim tabanıdır; paketle karşılanan satır ve paket/ürün satışı indirim almaz. Önce satır iskontosu, sonra kampanya uygulanır. Yüzde indirim kuruşa aşağı yuvarlanır. İndirim tabanı aşmaz, toplam negatife düşmez. İstemci fiyat/oran göndermez. Ayırma koşulları snapshot'lar; sonradan kod değişse de ayrılmış/kullanılmış indirim değişmez.
  - **Kota ve ödeme koruması.** Son kullanım hakkı `promo_codes` satır kilidiyle serileşir; iki eşzamanlı ayırmadan biri `PROMO_EXHAUSTED` alır (dblink yarış testi). Ödeme alınmış adisyonda indirim veya iskonto toplamı tahsilatın altına düşüremez (`TICKET_TOTAL_BELOW_PAID`, tek para formülü `f16_ticket_money`).
  - **Rapor.** Gün raporunda hizmet satışı kampanya indirimi düşülmüş tutardır; indirim `promoDiscountMinor` olarak ayrı görünür.

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
