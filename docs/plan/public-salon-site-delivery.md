# Randevu Kolay: işletmeye özel sayfa teslimat planı

**Kayıt tarihi:** 26 Eylül 2026  
**İlgili kapsam:** DOMAIN-01 plan netleştirmesi; Randevu müşteri yüzeyi  
**Planlama boyutu / doğrulama bütçesi:** S / LIGHT, yalnız dokümantasyon  
**İnceleme tabanı:** `06b78dbdd756d61d1e119d2241a9b4fab2818a10`

Bu kayıt, ürün sahibinin işletmelere kendi sayfalarını Randevu içinde verme ve işi unutmamak için plan PR'ı açma talebini somut teslimat sınırına bağlar. Yeni bir site motoru veya Kepenk platform işi başlatmaz. Planın birleşmesi uygulama, DNS değişikliği veya canlı yayın kabulü değildir.

Canlı görev, sahiplik ve kabul durumu yalnız [TASKS.md](../../TASKS.md) içindedir. Burada ikinci bir durum tablosu tutulmaz. 54 MVP görev sayısı ve mevcut F17 kapıları değiştirilmez. Aşağıdaki paketler uygulamaya alınmadan önce tek kimlik, sahip, dosya sınırı ve bağımlılıkları TASKS'ta kaydedilir; tamamlanmış F12 işleri tekrar sahiplenilmez.

## 1. Teslim edeceğimiz şey

Her işletmeye, kendi gerçek bilgileriyle doldurulan **salon tanıtımı + hizmetler + online randevu** sayfası verilir. Sayfa Randevu Kolay ürününün müşteri yüzeyidir; Kepenk'in genel amaçlı website üreticisi, pazaryeri veya ayrı bir SaaS ürünü değildir.

İlk teslimatta ortak, mobil uyumlu bir şablon kullanılır. İşletmenin adı, açıklamaları, kapak fotoğrafı, galerisi, iletişim bilgileri, hizmetleri ve çalışma düzeni bu şablonu doldurur. Her işletme için ayrı repo, uygulama, veritabanı, build veya manuel deployment üretilmez. Sayfa üretimi LLM/Jev çağrısına bağlı değildir.

İçerik işletmeye özeldir; ilk teslimat serbest tasarım editörü, işletmeye özel kod veya sınırsız tema seçimi vaat etmez. Logo ve sınırlı marka rengi seçimi mevcut özellik sayılmaz; gerekirse daha sonra açık kapsamlı kişiselleştirme işi olur.

## 2. Mevcut temelin sınırı ve kanıt girişleri

Bu bölüm yalnız yukarıdaki inceleme SHA'sına bağlı kod gözlemidir. Uygulama kartı açılırken current main üzerinde yeniden doğrulanır; üretimde çalıştığına dair kanıt yerine geçmez.

| Gözlenen temel | Kaynak | Teslimat açısından anlamı |
| --- | --- | --- |
| İşletme adından adres adı üretimi ve işletme oluşturma | [worker/index.ts](../../worker/index.ts) | Sayfa ayrı kod üretiminden değil işletme kaydından beslenebilir; mevcut adres çakışması davranışı yeni domain akışında ele alınmalıdır. |
| İşletme, hizmet, personel, saat, önizleme ve yayın adımları | [OnboardingPage.tsx](../../src/OnboardingPage.tsx) | Mevcut kurulum kullanılmalı; ikinci katalog veya randevu motoru açılmamalıdır. |
| Profil alanları, public fotoğraf yükleme ve online randevu ayarları | [PublicBookingSettingsPage.tsx](../../src/PublicBookingSettingsPage.tsx) | İçerik yönetimi temeli vardır; mevcut bağlantı üretimi uygulama origin'i + `/r/{slug}` biçimindedir. |
| Salon sunumu ve rezervasyon bileşenlerinin birleşimi | [PublicSalonPage.tsx](../../src/PublicSalonPage.tsx) | Mevcut müşteri yüzeyi genişletilir; yeni bir website renderer yazmak başlangıç işi değildir. |
| Yayın ve medya görünürlüğü sözleşmesi | [F12-02 devri](../handoffs/F12-02.md) | Public görünürlük online randevunun açık, kurulumun yayınlanabilir ve medyanın uygun durumda olmasına bağlıdır. |

[DOMAIN-01 / #92](https://github.com/ziyabeey/randevu/issues/92), [22 Eylül kapanış notunda](https://github.com/ziyabeey/randevu/issues/92#issuecomment-5775114933) DNS/host geçişi ertelendiği için kapatılmıştır. Issue'nun kapalı olması alt alan adı tesliminin tamamlandığına kanıt değildir. Bu plan PR'ı #92'yi tamamlanmış saymaz veya kendiliğinden yeniden açmaz.

**Önemli ürün sınırı:** Mevcut yapıda "tanıtım sitesi açık, yalnız online randevu kapalı" bağımsız bir yayın modu değildir. İlk teslimat mevcut birlikte yayınlanma davranışını korur ve bunu işletmeye açıkça anlatır. Tanıtım sayfasını randevudan bağımsız yayımlamak istenirse ayrı ürün kararı, yayın durum modeli ve erişim kabulü gerekir; bir arayüz düğmesiyle bu sınır atlanmaz.

## 3. Domain ve ürün sınırı

[Randevu Kolay domain sözleşmesi](randevu-kolay-domain-contract.md) korunur:

| Yüzey | Hedef adres / sınır |
| --- | --- |
| Randevu Kolay tanıtım sitesi | `randevukolay.net`; MKT-01, işletme sayfası değildir. |
| İşletmenin müşteriye açık sayfası | `https://{business-slug}.randevukolay.net` |
| İşletmenin yönetim paneli ve KolayApp | `https://randevu.kepenk.ai`; tek private origin. |
| Eski müşteri bağlantıları | `/r/:slug` uyumluluğu ile mevcut yönetim/kurtarma akışları korunur. |
| İşletmenin kendi domaini | Gelecek kapsamı; mevcut sözleşmedeki doğrulama ve entitlement kararları beklenir. |

`kepenk.ai` altında yeni salon/müşteri subdomain'leri veya `app.randevukolay.net` gibi ikinci private origin oluşturulmaz. Kendi domainini bağlama, paket/fiyat kararı ve notification sender domain geçişi bu teslimata gizlice eklenmez. #94 ve #96 tarihsel takipleri domain sözleşmesinde korunur.

## 4. İşletmenin sayfa oluşturma deneyimi

Hedef deneyim:

```text
İşletmeyi oluştur / seç
  -> işletme adresini kontrol et
  -> hizmet, personel ve çalışma saatlerini tamamla
  -> gerçek profil bilgilerini ve fotoğrafları ekle
  -> sayfayı ve rezervasyon hazırlığını kontrol et
  -> yetkili kullanıcı yayını açsın
  -> canonical sayfa bağlantısını kopyala / paylaş
```

Bu bir hedef akıştır; mevcut ekranların tek bir tamamlanmış sihirbaz olduğu iddia edilmez. Mevcut kurulum ve Online Randevu ayarları, kullanıcıyı aralarında kaybetmeden birbirine bağlanır. Hizmet/fiyat/saat bilgisi ortak operasyon verisinden gelir; website için ikinci kez girilmez.

Adres seçimi kullanılabilirlik, geçerli biçim ve ayrılmış altyapı adlarını anlaşılır biçimde göstermelidir. Aynı isimli işletmeler yanlış işletmeye bağlanmamalı; adres değişikliği gerekiyorsa eski linklerin alias/yönlendirme davranışı önceden tanımlanmalıdır.

Yayın öncesi eksikler açıkça gösterilir. Mevcut müsaitlik önizlemesi tam sayfa görsel önizlemesi diye sunulmaz. Ek bir yayımlanmamış sayfa önizlemesi uygulanacaksa yalnız yetkili işletme oturumundan açılır; public readiness/medya koruması önizleme gerekçesiyle gevşetilmez.

Sahte salon fotoğrafı, yorum, adres veya fiyat kullanılmaz. Fotoğraf yoksa mevcut nötr durum korunur. İlk teslimatta fotoğraf yüklemeyi zorunlu kılan yeni bir yayın engeli icat edilmez.

### 4.1. Mobil kurulum ve gerçek içerik yönü

26 Eylül ürün devamı [mobil hizmet kurulumu, DM ve gerçek fotoğraf yardımcısı](mobile-service-setup-dm-real-photo.md) ekinde kayıtlıdır. İşletme sahibi hazır hizmet baloncuklarını basılı tutup üstteki seçili alana taşıyabilir veya tek dokunuşla ekleyebilir; ad, fiyat ve süreyi düzenleyip onaylar. Otomatik doldurma taslak önerisidir, kesin fiyat/süre veya otomatik yayın değildir. Bu deneyim aşağıdaki B paketine bağlanır.

Aynı ek, gelen Instagram DM talebini randevuya dönüştürme ve LLM ile fotoğraf üretmek yerine gerçek fotoğraf çektirme yönünü ayrı sonraki dilimler olarak korur. Site renderı LLM'ye bağlanmaz; DM/sosyal içerik site/domain veya mevcut F17 tesliminin yeni önkoşulu yapılmaz. Platform izinleri, yanıt penceresi ve fotoğraf yayın hakları doğrulanmadan aktivasyon/yayın kabulü verilmez.

## 5. Sınırlı uygulama paketleri

Bunlar uygulama sırası ve kabul sınırıdır; yeni aktif görev/durum kayıtları değildir. İşin sahibi ve current main belirlendiğinde her paket ayrıca boyutlandırılır; tüm paketler tek büyük implementation PR'ına sıkıştırılmaz.

### A. DOMAIN-01: gerçek işletme adresi

Başlangıçta #92 ve açık PR'lar kontrol edilir. Aynı scope için ikinci çalışma açılmaz; ertelenmiş iş yeniden etkinleştirilecekse #92 yeniden açılır veya ona bağlı tek, sınırlı devam kartı seçilir ve TASKS'a işlenir.

Çıktı:
- Wildcard DNS/TLS ve Worker/frontend host çözümleme birlikte çalışır. Geçerli hostname doğru işletmeye bağlanır; istemcinin gönderdiği başka bir işletme kimliği otorite olmaz.
- Private, marketing, public salon ve açıkça izinli test origin'leri ayrılır. Public host private oturum veya işletme yönetim yetkisi kazanmaz; cookie kapsamı parent domain'e genişletilmez.
- Profil, hizmet, müsaitlik ve public medya aynı host/işletme sınırını korur. Bilinmeyen, ayrılmış veya uyuşmayan adresler başka bir işletmeye düşmek yerine güvenli biçimde reddedilir.
- Canonical link üretimi merkezi bir sözleşmeye bağlanır; ayarlar ekranı, paylaşım ve yeni müşteri bağlantıları bunu tutarlı kullanır. Bu yardımcı mevcutmuş gibi tüketilmez, implementation'da tanımlanır.
- `/r/:slug`, yönetim ve kurtarma bağlantıları kırılmaz. Mevcut dondurulmuş bildirim içerikleri ve origin snapshot'ları sessizce yeniden yazılmaz; yeni gönderimlerin bağlantı politikası açıkça test edilir. Sender domain geçişi #96'nın ayrı işidir.
- Gerçek host kabulü, geri alma adımı ve eski adreslerle devam davranışı kanıtlanır. Yalnız DNS kaydının varlığı teslim değildir.

Bu paket host/tenant/cookie yetkisi ile gerçek browser/origin davranışını birlikte değiştirdiği için risk kapsamına uygun bağımsız R1 ve R2 kanıtı gerektirir. Docs-only plan PR'ı bu incelemelerin yapıldığı anlamına gelmez.

### B. Mevcut sayfayı teslim edilebilir kurulum akışına bağlama

Çıktı:
- Mevcut kurulum ve profil ayarları arasında açık ilerleme ve eksik bilgi yönlendirmesi.
- Sayfa adresi, içerik kontrolü, yayın durumu ve bağlantıyı paylaşma işlemlerinin anlaşılır sunumu.
- Ortak şablon ve mevcut rezervasyon motorunun korunması; hizmet/fiyat/saat verisinin ikinci kez tutulmaması.
- Mobil görünümde salon kimliğinin öne çıkması; hizmet, süre, fiyat ve ana rezervasyon eyleminin kolay bulunması.
- İşletme adına uygun başlık, açıklama, canonical URL ve paylaşım önizlemesinin gerçek sayfa yanıtında doğrulanması. Mevcut SPA'nın bunları zaten doğru ürettiği veya arama motoru görünürlüğünün garanti olduğu varsayılmaz.

UI paketi DNS/oturum yetkisini kendiliğinden değiştirmez. Shared router, entry veya stiller gerekiyorsa A paketi ve aktif diğer işler için tek-yazıcı/merge sırası belirlenir. Logo/tema editörü bu paketin zorunlu çıktısı değildir.

### C. Gerçek işletmeyle yayın ve teslim kabulü

Mevcut F17 yayın/pilot sürecine kanıt sağlar; [ROADMAP](../../ROADMAP.md) ve [ürün kurallarındaki](../../PRODUCT_SPEC.md) kabul kapılarını değiştirmez.

Asgari kanıt:
1. Gerçek ve yayın izni olan işletme bilgileriyle canonical adrese dışarıdan erişilir; görünen salon ve medya doğru işletmeye aittir.
2. 360/390 px mobil görünüm ile masaüstünde profil, hizmet/saat seçimi ve iletişim tamamlanır; taşma, klavye ve dokunma sorunları kontrol edilir.
3. Müşteri randevu alır; aynı kayıt Randevu Paneli ve KolayApp'te görünür. Yönetim bağlantısından izinli taşıma/iptal ve kurtarma akışı korunur.
4. Yayın kapalı, kurulum eksik, geçersiz/çakışan adres ve başka işletmenin public verisine yanlış host üzerinden erişim durumları beklenen güvenli sonucu verir.
5. Eski linkler, yeni canonical linkler, paylaşım önizlemesi ve yayın geçişini geri alma davranışı doğrulanır. Gerçek-host testi yerine yalnız mock sonucu teslim edilmez.

## 6. Bu plan PR'ının kapsam dışı

- Runtime, DNS/TLS, secret, CI workflow, migration veya production deploy değişikliği.
- Genel amaçlı website builder, çok sektörlü Kepenk çözümü, AI ile site üretimi veya yeni randevu motoru.
- Custom domain teslimi, ticari paket/fiyat değişikliği ve transactional sender domain geçişi.
- Yayın/randevu durumlarını ayıran yeni veri modeli, sınırsız tema ve özel kod editörü.
- F12/F17 kabulünü yeniden yazmak, MVP görev sayısını artırmak veya marketing ana sayfasını bu işle birleştirmek.

## 7. Sonraki tek somut adım

Uygulama çalışması açıldığında current main, TASKS ve #92'nin devam kaydı birlikte okunarak **yalnız DOMAIN-01 host/adres paketinin** sahibi, yazılabilir dosyaları, bağımlılıkları ve gerçek-host kabulü kaydedilir. Plan PR'ı bunu otomatik başlatmaz; buradaki inceleme SHA'sı yeni uygulamanın başlangıç SHA'sı yerine kullanılmaz.