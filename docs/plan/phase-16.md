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
- **v3 olay kabulü:** Her seri oluşumu K01 grup kimliği ve S03/F16-02 olay-sürüm sözleşmesini kullanır. K03 başlangıç seri sınırı uygulanır. 2026-09-24 ürün kararıyla hatırlatma/SMS kapsamı F16-02'den çıkarıldığı için G16'da seri–hatırlatma baskılama kabulü aranmaz; seri olay-sürüm kontratı ileride bir bildirim görevi açılırsa onun girdisidir.

## F16-02

**WhatsApp OTP ile public telefon doğrulama · 16A**

- **Bağımlılık:** F12-05, F17-01.
- **Sorumluluk:** Public booking + provider doğrulama. **Çakışma alanı:** Public müşteri telefonu ve booking create proof'u.
- **Ürün kararı (2026-09-24):** SMS, SMS hatırlatma ve SMS yaşam döngüsü kapsamdan çıkarıldı. F16-02 yalnız Twilio Verify üzerinden `Channel=whatsapp` ile telefon sahipliği doğrular. WhatsApp pazarlama/reminder kanalı değildir.
- **İş ve çıktı:** Public booking formunda telefon için WhatsApp OTP başlat/check akışı ekle. Başarılı check sonrası 10 dakikalık, slug+normalize telefon numarasına bağlı imzalı proof üret. Tekli ve çoklu public booking create bu proof olmadan fail-closed reddedilir.
- **Güvenlik:** OTP provider secret'ları istemciye çıkmaz. Proof başka slug/telefon için kullanılamaz ve süre sonunda geçersizdir. Mevcut public-abuse client/network gate korunur; Twilio Verify'ın provider limitleri ayrıca geçerlidir. Telefon değişirse UI proof'u sıfırlar.
- **Twilio sınırı:** Verify Service ve WhatsApp Sender hesabında hazır olmalıdır. Trial hesabında yalnız doğrulanmış test alıcısı kullanılabilir. Production sender/WABA kurulumu ayrı provider provisioning adımıdır; hazır değilse booking doğrulaması bypass edilmez.
- **Kabul:** `Channel=whatsapp` gerçek provider isteğinde kanıtlanır; yanlış/süresi dolmuş OTP proof üretmez; proof başka telefon/slug'da reddedilir; verified telefonla tekli ve grup booking geçer; OTP olmadan ikisi de reddedilir; 390/360 px mobil akış kod gönder → doğrula → booking sırasını açık gösterir.
- **Devir:** Verify Service SID, sender/WABA provisioning durumu, hosted verified-recipient kanıtı, proof TTL/sözleşmesi ve provider hata/rate-limit davranışı.
- **Kanıt anahtarı ve hosted kabul:** Telefon kanıtı public-abuse gate secret'ından ayrı `PHONE_VERIFICATION_PROOF_SECRET` ile imzalanır; anahtar yoksa OTP başlatma/kontrol ve booking fail-closed kalır. Staging bu anahtarı kalıcı DB secret'ından HMAC ile türetir; böylece deploy/rotate/resume aynı anahtarı yükler ve operatörün F09 kabulü kendi fixture telefonu için kanıt imzalayabilir. Worker'da bypass yolu yoktur. Gerçek WhatsApp kodu insan tarafından okunduğu için hosted verified-recipient kanıtı `npm run staging:f16-whatsapp-acceptance` operatör komutuyla alınır.
- **Kapsam dışı:** SMS, SMS fallback, appointment reminder mesajları, WhatsApp kampanya/marketing, çalışan login OTP, yeni auth/session sistemi veya ikinci notification queue.

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
