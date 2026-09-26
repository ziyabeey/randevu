# Randevu Kolay: mobil hizmet kurulumu, DM ve gerçek fotoğraf yardımcısı

**Ürün kararı kaydı:** 26 Eylül 2026  
**Bağlam:** [İşletme sayfası teslimat planı](public-salon-site-delivery.md), plan PR #637  
**Doğrulama:** S / LIGHT / docs-only; yeni davranış uygulanmadı  
**Repo gözlem tabanı:** `06b78dbdd756d61d1e119d2241a9b4fab2818a10`

Bu ek, ürün sahibinin mobilde hizmet kurulumunu kolaylaştırma, otomatik doldurma, DM üzerinden randevu ve gerçek fotoğraf çekimini yönlendiren sosyal medya yardımcısı hedeflerini kaydeder. Sonraki oturum aynı talebi yeniden keşfetmemelidir. Aşağıdaki arayüz ve yardımcı modeller hedef tasarımdır; mevcut özellik/API/veritabanı nesnesi olarak sunulmaz.

Canlı sahiplik ve kabul yalnız [TASKS](../../TASKS.md) içindedir. Bu plan 54 MVP görev sayısını, mevcut F17 kapılarını veya kabul edilmiş F10/F12 işlerini değiştirmez. Hizmet kurulumu mevcut sayfa planının B paketine bağlanır. DM ve sosyal içerik ayrı, sınırlı sonraki dilimlerdir; site/domain teslimini veya mevcut MVP pilotunu kendiliğinden bloke etmez. Kepenk'e genel amaçlı site/sosyal medya platformu taşınmaz; başka repo veya canlı kanal bu PR ile değiştirilmez.

## 1. Ortak ürün ilkesi

İşletme sahibine boş form doldurtmak yerine seçme, düzeltme ve onaylama deneyimi sunulur. İlk hedef salonun müşterisinin rezervasyon ekranı değil, bizim müşterimiz olan işletme sahibinin sayfa/hizmet kurulumudur. Son müşteriye aynı uzun-basış düzenleyicisi zorunlu tutulmaz.

Tek onaylı hizmet kataloğu sayfayı, randevu akışını, DM yanıtlarını ve içerik görevlerini besler. Yardımcılar öneri üretir; fiyat, süre, personel yetkinliği ve müsaitlik için ikinci doğruluk kaynağı olmaz. Sayfanın çalışması veya temel kurulum LLM çağrısına bağımlı değildir.

## 2. Mobil hizmet baloncukları

### Ekran ve etkileşim

- Üstte `Hizmetlerim` seçili alanı, altta işletme türüne göre önerilen hizmet baloncukları bulunur. Başlangıç örnekleri kuaför/berber/tırnak bakımına ait sözlüktür; işletmenin bunların hepsini sunduğu varsayılmaz.
- Ürün sahibinin istediği hareket: baloncuğu basılı tut, üstteki belirgin alana taşı/bırak; seçilen hizmet üstte yerleşsin. Yukarı atma hissi kısa yerleşme animasyonu olabilir; kabul hassas bir fırlatma hızına veya yörüngesine bağlı olmaz.
- Eşdeğer `+ Ekle` veya baloncuğa dokunarak ekleme yolu zorunludur. Klavye ve ekran okuyucu ile aynı işlem yapılır. Sürükleme tek kullanım yolu değildir; [W3C 2.5.7](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html) sınırı korunur.
- Seçilmiş baloncuğa dokununca alttan kısa düzenleme paneli açılır: hizmet adı, fiyat/fiyat aralığı ve süre. Gerektiğinde personel atamasına bağlantı gösterilir; personel yetkinliği otomatik varsayılmaz.
- `Kendi hizmetimi ekle`, arama ve az sayıda kategori bulunur. Yüzlerce hareket eden baloncuk, gizli menü veya boş ekrandan yazma zorunluluğu oluşturulmaz.
- Ekleme, çıkarma ve geri alma ayrı ve anlaşılırdır. Aynı seçimin tekrarı mükerrer hizmet oluşturmaz. İptal edilen sürükleme veri değiştirmez; parmağı basılı tutmak tek başına kayıt değildir.
- Dikey sayfa kaydırması, uzun-basış ve sürükleme birbirini yanlış tetiklemez. Ekran kenarına taşan hedefler gerekmez. En az 44 px dokunma hedefi, 360/390 px görünüm, klavye/safe-area ve azaltılmış hareket tercihi gerçek telefonda doğrulanır.

### Taslak ve kaydetme

Seçimler önce kurulum taslağında birikir. `Kontrol et ve kaydet` özeti her hizmetin eksik/onay bekleyen alanını gösterir. Taslak, geçerli aktif hizmet kaydı demek değildir. Mevcut API'nin zorunlu alanları boş/uydurma değerlerle geçilmez; ihtiyaç duyulan taslak saklama modeli ayrıca tasarlanır.

Sunucu kabul etmeden `Kaydedildi` gösterilmez. Ağ kesilmesi, tekrar deneme ve başka cihazdaki değişiklik kullanıcı verisini sessizce ezmez; işletme bağlamı değişince eski taslak diğer işletmeye taşınmaz. Kurulum sonrası değişiklik mevcut katalog düzenleme yetkilerini ve geçmiş randevu/fiyat snapshot'larını korur. Başka hizmetlerle ilişkili kaydı silmek, yeni taslak baloncuğunu çıkarmakla aynı işlem değildir.

## 3. Otomatik doldurma

İlk katman, sürümlü ve gözden geçirilmiş sektör/hizmet sözlüğüdür. `Berber` seçimi ilgili hizmet önerilerini getirir; işletme topluca seçebilir, istemediklerini kaldırabilir. Bu yol LLM olmadan çalışır.

İkinci katman işletmenin kendi verisidir: daha önce kaydettiği katalog veya kendisinin yapıştırdığı hizmet listesi taslağa dönüştürülebilir. Mevcut onaylı veriler önerilerden üstündür. Üçüncü ve isteğe bağlı katman, işletmenin yüklediği kendi fiyat listesi fotoğrafını desteklenen bir belge/görsel okuyucuyla taslağa aktarmaktır; mevcut metin modelinin görme yeteneği olduğu varsayılmaz. Okunamayan alanlar sorulur, tahminle kesinleştirilmez.

Kurallar:
- Hizmet adı, kategori ve kısa açıklama önerilebilir. Benzer adlar eşleştirme önerisidir; farklı işlem/varyantlar otomatik birleştirilmez.
- Fiyat uydurulmaz. Kaynaksız fiyat `Belirle` durumunda kalır; boş değer 0 TL/ücretsiz diye kaydedilmez. İşletmenin kendi listesinden gelen fiyat da yayın öncesi kontrol edilir.
- Süre önerisi varsa açıkça `Önerilen süre` olarak görünür ve işletme onaylar. Saç uzunluğu, işlem türü veya personel farkı nedeniyle gereken varyantlar korunur; yanlış süre müsaitlik motoruna kesin veri olarak verilmez.
- Sabit fiyat ile fiyat aralığının anlamı korunur. Para dönüşümü ve doğrulama mevcut sunucu kurallarıyla yapılır.
- Seçili her hizmetin sunulması, süresi, fiyatı ve yetkin personel eşlemesi işletme tarafından doğrulanır. Otomatik doldurma otomatik yayın değildir.
- Yüklenen metin/görsel güvenilmeyen içeriktir; içerikteki talimatlar araç çalıştırma veya yayın yetkisi sayılmaz. Model çıktısı şema doğrulamasından ve kullanıcı kontrolünden geçer.
- Kaynak ve kullanıcı düzeltmesi taslakta izlenebilir. Kişisel veri veya başka işletmenin özel kataloğu ortak öneri havuzuna izinsiz taşınmaz.

Mevcut entegrasyon girişleri: [OnboardingPage](../../src/OnboardingPage.tsx), [profil ayarları](../../src/PublicBookingSettingsPage.tsx), [F10 planı](phase-10.md), [F12 planı](phase-12.md). Yeni toplu-kayıt endpoint'i veya veri modeli bu belgede hazırmış gibi tanımlanmaz.

## 4. DM randevu yardımcısı: gelen talep, sınırlı otomasyon

DM burada ilk olarak Instagram işletme mesajlarını ifade eder. WhatsApp'ın şablon/izin/fiyat kuralları Instagram'a, Instagram kuralları WhatsApp'a taşınmaz. `API erişimi var`, `bot yazıldı`, `müşteri hesabı yetkilendirdi` ve `gerçek konuşmada kabul edildi` ayrı durumlardır.

### Açılış koşulu

Hedef deneyim `Instagram hesabını bağla -> izinleri kontrol et -> test mesajı -> otomatik yanıtı aç` olur. Profesyonel hesap, seçilen login/provider yolunun gerekli erişimleri, uygulama incelemesi gereği, hesap yetkilendirmesi ve webhook/yanıt kabulü doğrulanmadan düğme başarı göstermez. Kendi test hesabındaki erişim, dış müşterilerin hesaplarına üretim erişimi kanıtı değildir. Mevcut hesapların bu koşulları sağladığı bu çalışma ile doğrulanmadı.

Meta'nın Instagram Send Messages açıklaması konuşmanın kullanıcı mesajıyla başlamasını tarif eder. Standart mesajlaşma politikası 24 saatlik yanıt penceresi tanımlar. Bu yüzden ilk ürün dilimi kullanıcı tarafından başlatılmış talep içindir; takipçi/işletme listesine izinsiz toplu ilk DM özelliği değildir. Pencere, geçerli son kullanıcı etkileşiminden hesaplanır; botun kendi yanıtı süreyi uzatmaz. Özel mesaj/yorumdan yanıt, pazarlama mesajı veya human-agent istisnaları bu ilk dilimde açılmaz; farklı izin yolları ayrıca değerlendirilir.

`Sosyal medyada yasal sınır yok` kabulü kullanılmaz. Platform kuralı, ticari ileti kuralları ve kişisel veri yükümlülükleri farklı kontrollerdir. Müşterinin randevu sorusu daha sonra sınırsız kampanya gönderimine izin sayılmaz. Kanal, alıcı ve amaç bakımından hukuki dayanak, aydınlatma, gerekli onay/ret ve veri saklama/aktarım düzeni üretimden önce doğrulanır. Tacir/esnaf istisnası varsa dahi bunu tüm Instagram kullanıcılarına veya platform kısıtlarına genellemek yoktur. Bu belge hukuki uygunluk onayı değildir.

### Sınırlı akış

1. Kullanıcı fiyat, hizmet veya randevu sorar. Yanıtlar yalnız işletmenin onaylı kataloğu ve güncel public bilgileriyle oluşturulur.
2. İlk küçük teslim, anlaşılır seçenekler ve canonical salon/randevu bağlantısı olabilir. DM içinde tam rezervasyon ayrı dilimde aynı randevu API'sini kullanır; ikinci motor kurmaz.
3. Tam DM akışı açılırsa kullanıcı hizmet, tarih/saat ve gerekli bilgileri seçer; açık son onaydan sonra sunucu müsaitliği yeniden kontrol ederek kayıt yapar. Model `randevunuz oluştu` sonucunu uyduramaz.
4. Tekrarlanan webhook aynı cevabı/rezervasyonu çoğaltmaz. Kullanıcı vazgeçebilir, işletmeden yardım isteyebilir; insan devralınca bot o konuşmada durur.
5. Pencere/izin/katalog bilgisi uygun değilse otomatik gönderim engellenir. Onaylı ve hâlâ geçerli kanal yolu dışında zamanlanmış takip gönderilmez.

LLM kullanılacaksa rolü niyet/hizmet eşleştirme ve kısa dil yardımıdır. Yayın/gönderim yetkisi, fiyat, müsaitlik ve kayıt sonucu kurallı sunucu akışında kalır. Harici model kullanımında asgari veri, saklama ve aktarım değerlendirmesi yapılır; tüm müşteri konuşmaları varsayılan olarak modele dökülmez.

## 5. Sosyal medya modeli: fotoğraf üretme, fotoğraf çektir

**Kalıcı ilke:** Yapay müşteri, salon, saç/tırnak sonucu veya önce/sonra fotoğrafı üretmek yoktur. LLM'nin görevi gerçek işi görünür kılacak çekim görevi ve metin taslağı hazırlamaktır. Generatif görsel sağlayıcısı bu planın ihtiyacı değildir.

İlk mobil yüzey bir sohbet kutusu veya ajans paneli değil, `Bugün ne çekelim?` aksiyon kartıdır. Önerilen akış:

```text
Onaylı hizmet + eksik/güncel içerik ihtiyacı
  -> tek kısa çekim görevi
  -> gerçek fotoğrafı çek / yükle
  -> ilgili kişi ve yayın hakkını kontrol et
  -> kısa açıklama + uygun kırpma + randevu bağlantısı
  -> işletme önizlesin, düzenlesin ve onaylasın
  -> izinli kanalda yayımla veya paylaşılabilir taslak olarak bırak
```

Örnek görev: `Bugünkü saç kesiminden, yayın izni alınmış bir sonuç fotoğrafı çek. Pencere ışığını kullan, arka planı sade tut, arkadan ve yandan iki kare al.` Bu, gerçek bir randevuya ilişkin iddia değil örnek görev metnidir. İzinli müşteri fotoğrafı yoksa salonun çalışma alanı/ekipmanı gibi kişisel veri içermeyen bir çekim önerilir; sahte sonuç üretilmez.

Modelin işi hizmet sözlüğü ve çekim rehberinden uygun görevi seçmek, kısa yönlendirme ve açıklama/başlık/alternatif metin taslağı üretmektir. Gerçek fotoğrafı inceleme ancak seçilen model/araç bunu destekliyorsa eklenir; bu yetenek varsayılmaz. Kamera akışının her karesi LLM'ye gönderilmez. Basit boyut/format kontrolleri kurallı yapılabilir; belirsiz fotoğraftan kalite veya hizmet sonucu uydurulmaz.

Az sayıda onaylı şablonla gerçek fotoğrafın farklı oranlarda kırpılması, metin yerleşimi ve logo eklenmesi mümkündür. Orijinal korunur; saç rengi, yoğunluğu, cilt veya işlem sonucu yapay olarak iyileştirilmez. Aynı izinli fotoğraf site galerisi, gönderi ve hikâye için ancak ayrı kullanım izinleri uygunsa yeniden kullanılabilir.

### Haklar ve insan onayı

- Özel randevu/hizmet fotoğrafı otomatik olarak public galeriye veya sosyal hesaba taşınmaz. Mevcut F16 private fotoğraf yetkisi sosyal yayın yetkisi değildir.
- Tanınabilir müşteri/çalışan fotoğrafının çekimi, saklanması ve ilgili kanalda tanıtım kullanımı için uygun hukuki dayanak ve gerektiğinde özgür, belirli, bilgilendirilmiş açık rıza doğrulanır. Yayın onayı ile randevu hizmetini satın alma birbirine bağlanmaz.
- Aydınlatma ve açık rıza ayrı sunulur. Web galerisi ve sosyal paylaşım izinleri ayrı ele alınır. İşletme yöneticisinin `Yayımla` demesi, fotoğraftaki kişinin izninin yerine geçmez.
- Yüz görünmemesi tek başına anonimlik kanıtı değildir; arka plan, dövme, ad etiketi ve diğer ayırt ediciler kontrol edilir. Rıza geri alındığında bekleyen yayın durdurulur, mevcut yayının kaldırılması ve saklama/silme süreci işletmeye izlenebilir iş olarak verilir.
- İlk sürümde her gönderi insan onaylıdır. Hesap bağlantısı ve yayın yetkisi doğrulanmamışsa taslak hazırlanabilir ancak `Paylaşıldı` gösterilemez. Otomatik yayın kotası veya fiyatı bu belgede vaat edilmez.

## 6. Dilimler ve ölçüm

Uygulama açılırken güncel TASKS, main ve açık PR sahipliği tekrar kontrol edilir. Bu bölüm ikinci canlı iş tablosu değildir.

- **Kurulum dilimi:** onaylı hizmet sözlüğü, baloncuk + tek dokunuş, ad/fiyat/süre düzenleme, kontrol özeti ve mevcut kataloğa güvenilir kayıt. LLM'siz yol önce; belge/fotoğraftan doldurma sonraki isteğe bağlı ek.
- **DM dilimi:** tek izinli hesapta gelen mesaj, katalogdan seçenek/bağlantı, pencere ve insan devri kabulü. Tam DM rezervasyonu ancak aynı motor ve tekrar güvenliği kanıtlandıktan sonra.
- **Fotoğraf dilimi:** tek çekim kartı, gerçek yükleme, hak/izin kontrolü, açıklama ve paylaşım taslağı. Doğrudan API yayınını ayrı yetki ve sağlayıcı kabulü izler.

Ölçülecek sonuçlar: ilk geçerli hizmet kataloğuna ulaşma süresi ve kurulum terk oranı; otomatik doldurma düzeltme/mükerrer kayıt oranı; DM'den tamamlanan rezervasyon ve insan devri; çekim görevi -> gerçek yükleme -> onaylı yayın dönüşümü; öneri başına model çağrısı/maliyet. Sayılar henüz ölçülmüş sonuç değildir. Pilot başlamadan küçük, ölçülebilir hedefler belirlenir; animasyon beğenisi tek başarı ölçütü değildir.

Kabulte yanlış fiyat/süreyle yayın, kullanıcı onayı olmadan katalog/rezervasyon/yayın mutation'ı, aynı mesajdan mükerrer kayıt, pencere dışı gönderim ve izinsiz fotoğraf paylaşımı negatif senaryolar olarak korunur. Bu plan testlerin çalıştırıldığı anlamına gelmez.

## 7. Kaynaklar ve doğrulama sınırı

26 Eylül 2026 tarihinde erişilen resmi kaynaklar; uygulama açılırken tekrar kontrol edilir:

- [W3C: Dragging Movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html): sürüklemeye tek-işaretçi alternatifi.
- [Meta: Instagram Send Messages](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api): profesyonel hesap ve kullanıcı tarafından başlayan konuşma modeli.
- [Meta: Messenger Platform and IG Messaging API policy](https://developers.facebook.com/documentation/business-messaging/messenger-platform/policy): standart 24 saatlik yanıt penceresi.
- [Meta: Business Login for Instagram](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login) ve [App Review](https://developers.facebook.com/documentation/instagram-platform/app-review): dış müşteri hesapları için erişim/inceleme gereği.
- [Ticaret Bakanlığı: Elektronik Ticaret SSS](https://ticaret.gov.tr/ic-ticaret/sikca-sorulan-sorular/elektronik-ticaret): ticari elektronik ileti ve ret hakkı çerçevesi; bu sayfa tek başına her DM senaryosuna hukuki uygunluk vermez.
- [KVKK 2021/572 karar özeti](https://www.kvkk.gov.tr/Icerik/7118/2021-572): okul fotoğrafı olayında rızanın kapsamı, geri alınması ve farklı paylaşım kanalları. Salonlara özgü karar olarak sunulmaz; bu tasarımda hak/izin kontrolüne dayanak ilkeler için kullanılır.
- [KVKK 2026/347 ilke kararı duyurusu](https://www.kvkk.gov.tr/Icerik/8710/veri-sorumlulari-tarafindan-acik-riza-ve-aydinlatma-metinlerinin-ayri-ayri-duzenlenmesi-gerektigi-hakkinda-kisisel-verileri-koruma-kurulunun-18-02-2026-tarihli-ve-2026-347-sayili-ilke-kararina-iliskin-kamuoyu-duyurusu): aydınlatma ve açık rıza metinlerinin ayrı düzenlenmesi.

Bazı doğrudan web okumaları başarısız olmuş; Meta belgeleri alternatif salt-okunur tarayıcı erişimi ve resmi kaynak arama alıntılarıyla kontrol edilmiştir. Bu inceleme uygulamanın/sağlayıcının gerçek izin durumunu, yürürlükteki tüm hukuk yükümlülüklerini veya canlı DM/yayın kabulünü doğrulamaz. Fiyat, kota, sağlayıcı seçimi, yeni model aboneliği veya üretim aktivasyonu yapılmamıştır.
