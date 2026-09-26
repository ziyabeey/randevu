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

**WhatsApp OTP ile public telefon doğrulama · 16A**

- **Bağımlılık:** F12-05, F17-01.
- **Sorumluluk:** Public booking + provider doğrulama. **Çakışma alanı:** Public müşteri telefonu ve booking create proof'u.
- **Ürün kararı (2026-09-24):** SMS, SMS hatırlatma ve SMS yaşam döngüsü kapsamdan çıkarıldı. F16-02 telefon sahipliğini Kepenk tarafından üretilen tek kullanımlık kod ve Zernio WhatsApp template transportu ile doğrular. Zernio doğrulama otoritesi değil taşıma katmanıdır; WhatsApp pazarlama/reminder kanalı değildir.
- **İş ve çıktı:** Public booking formunda telefon için WhatsApp OTP başlat/check akışı ekle. Başarılı check sonrası 10 dakikalık, slug+normalize telefon numarasına bağlı imzalı proof üret. Tekli ve çoklu public booking create bu proof olmadan fail-closed reddedilir.
- **Güvenlik:** Zernio API anahtarı istemciye çıkmaz; OTP düz halde DB/log/challenge içine yazılmaz. İmzalı OTP challenge ve booking proof başka slug/telefon için kullanılamaz ve 10 dakika sonunda geçersizdir. `phone_verify` rate sınıfı start/check toplamını aktör başına 8/10 dk, network başına 80/10 dk ile sınırlar. Challenge stateless olduğundan tahmin sınırı aktör/network'e bırakılmaz: her start/check ayrıca telefonun Worker HMAC anahtarıyla (ham numara DB'ye yazılmaz) telefon başına 3 gönderim/10 dk, 5 kontrol/10 dk ve 30 işlem/24 saat bütçesi tüketir; aktör veya network değiştirmek bu bütçeyi yenilemez. Telefon değişirse UI challenge ve proof'u sıfırlar.
- **Zernio sınırı:** Production WABA Zernio'ya bağlı olmalı; runtime `accountId`, onaylı template adı ve dilini kullanır. Business-initiated gönderim `POST /v1/inbox/conversations` üzerinden yapılır. Sandbox yalnız transport/webhook testi içindir ve kilitli `sandbox_start` template'i numeric OTP kabul etmediğinden production OTP kabulü sayılmaz. Provider/template hazır değilse booking doğrulaması bypass edilmez.
- **Kabul:** Gerçek Zernio isteğinde WhatsApp `accountId`, digits-only participant, template adı/dili ve OTP parametresi kanıtlanır; yanlış/süresi dolmuş OTP proof üretmez; challenge/proof başka telefon/slug'da reddedilir; verified telefonla tekli ve grup booking geçer; OTP olmadan ikisi de reddedilir; 390/360 px mobil akış kod gönder → doğrula → booking sırasını açık gösterir.
- **Devir:** Zernio WhatsApp account id, onaylı template adı/dili, WABA provisioning durumu, hosted verified-recipient kanıtı, OTP challenge/proof TTL sözleşmesi ve Zernio hata/rate-limit davranışı.
- **Kapsam dışı:** SMS, SMS fallback, appointment reminder mesajları, WhatsApp kampanya/marketing, çalışan login OTP, yeni auth/session sistemi veya ikinci notification queue.

## F16-03

**Özel hizmet/randevu fotoğrafları · 16B**

- **Bağımlılık:** F12-02, F13-03.
- **Sorumluluk:** Backend/depolama + detay arayüzü. **Çakışma alanı:** Özel fotoğraf erişimi.
- **İş ve çıktı:** Randevu detayındaki Fotoğraf sekmesi ve işletme hizmet fotoğrafı arşivi; yükleme, görüntüleme ve silme kuralları ekle. Özel müşteri fotoğrafı ile public salon fotoğrafını ayır; yayınlama açık bir işlem olsun.
- **Kabul:** Yetkisiz veya başka işletme kullanıcısı tahmin ettiği dosya yolu/URL ile erişemez. Geçici erişim süresi dolması/üyelik iptali davranışı testlidir. Dosya türü/boyutu doğrulanır; silinen veya başarısız yüklenen görsel ekranı bozmaz.
- **Devir:** Erişim/yayınlama modeli ve public/özel negatif testleri; veri saklama/silme çalışma notu.
- **v3 sınır:** K03 boyut/adet/saklama ve S08 storage/DB erişim kuralları kullanılır. Kalıcı public URL ile özel içerik sunulmaz; üyelik iptali ile geçici erişimin geçerlilik sınırı açıkça kaydedilir. Restore kapsamına görseller eklenir.
- **Uygulanan erişim modeli (2026-09-24):** Özel görseller public olmayan `appointment-private-media` bucket'ında `<business>/<group>/<media>.webp` yolunda durur; WebP, ≤5 MB, ≤2000 px ve randevu grubu başına en fazla 10 görsel (pending/ready/deleting sayılır; grup advisory lock'u ile). İmzalı veya public URL üretilmez: her görüntüleme Worker'da kullanıcının JWT'siyle `private, no-store` olarak akıtılır ve storage RLS aktif üyeliği her istekte yeniden doğrular. Okuma politikası yalnızca Supabase Storage'ın doğrudan kimlikli indirme işlemini (`storage.operation = storage.object.get_authenticated`) kabul eder; `object/sign`, `sign_many`, kopyalama, taşıma, listeleme ve görsel dönüştürme nesneyi hiç görmez. Böylece üye, iptalden sonra da çalışacak bir imzalı URL üretemez. Storage silmeyi çağıranın rolüyle `DELETE … RETURNING` olarak çalıştırdığından, silinmekte olan (`deleting`/`cleanup`) ve çağıranın silmeye yetkili olduğu nesne yalnız `storage.object.delete` işlemi sırasında görünür; bayt gerçekten silinir, başka işlem bu nesneyi göremez. Bu yüzden “geçici erişim” penceresi yoktur; üyelik iptali bir sonraki istekte erişimi keser. Recovery oturumu reddedilir.
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
  - **Rezervasyonda ayırma.** Müşteri rezervasyon formunda kodu kontrol eder (`GET /api/public/business/:slug/promo`: yalnız koşullar, kullanım sayısı yok). Randevu oluşunca kod, randevunun kendi yönetim bağlantısıyla (`POST /api/manage/promo`, token gövdede) sunucuda yeniden doğrulanır ve bir kullanım hakkı `reserved` olarak ayrılır. Rezervasyon RPC'si değişmedi; ayırma başarısız olursa randevu yine vardır ve kod yönetim sayfasından yeniden denenebilir. Public çağrılar `execute_public_promo_operation` kapısından (aynı gate secret ve S04 sınıfları) geçer. Salon randevunun adisyonunu açtıktan sonra müşteri bağlantısıyla kod eklenemez (`PROMO_NOT_ATTACHABLE`): kod artık salonda adisyon sürümü ve ödeme korumasıyla uygulanır. Müşteri tarafındaki ekleme, adisyon açılışı ve işletmenin kod uygulaması aynı grup kilidini (F14 `ticket-group`) paylaşır; eşzamanlı açılışla yarışan ekleme reddedilir. Ekleme ayrıca randevu grubunun satırını kilitleyip durumu yeniden okur; eşzamanlı iptal/gelmeme ile yarışan ekleme kod ayırmaz, böylece iptal edilmiş randevuda kullanım hakkı takılı kalmaz (iki dblink testi).
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
- **Uygulanan model (2026-09-24, Ziya kararı: kapanan adisyon satırına göre; çalışan + hizmet/ürün istisnası):**
  - **Hak kazanma.** Prim adisyon kapanınca satır bazında yazılır: oran × (satır fiyatı − satır iskontosu − kampanya payı). Ziya örneği: 1.000 TL hizmet, 100 TL iskonto, %10 → 90 TL. Müşteri 450 TL ödemişken adisyon açıktır ve prim yazılmaz. Adisyon yalnız tamamen ödenince kapanır; kısmi tahsilat primi değiştirmez.
  - **Paket, ürün ve personelsiz satırlar.**
    - Paketten karşılanan seans, paket birim değeri (satış ÷ seans, `customer_package_usages.value_minor`) üzerinden prim alır. Paket satış satırının kendisi prim üretmez.
    - Ürün satırı, satırı giren üyenin personel profiline, o personelin ürün oranıyla yazılır.
    - Personeli olmayan hizmet satırı ve personel profili olmayan üyenin ürün satışı prim üretmez.
  - **Oran sürümleri.**
    - `staff_commission_rates`: personel başına varsayılan hizmet ve ürün oranı (baz puan).
    - `staff_service_commission_rates`: personel × hizmet istisnası; `null` istisnayı kaldırır.
    - Her ikisi de eklemeli, sürüm CAS'lı ve değiştirilemez. Yalnız owner/manager yazar; staff kendi oranını değiştiremez.
    - Kapanışta geçerli olan sürüm `staff_commission_lines` satırına snapshot'lanır: oran, kaynak (`service_default`/`service_override`/`product_default`/`none`) ve sürüm kimliği. Sonraki oran değişikliği eski raporu değiştirmez.
  - **Kapanış sonrası hareketler.** `staff_commission_entries` değiştirilemez bir hareket defteridir; her hareket satırın kümülatif matrahını ve primini taşır.
    - **Ürün iadesi:** aynı personel satırına negatif `product_return` hareketi yazar.
    - **Diğer iadeler ve düzeltmeler:** iyi niyet iadesi ve tahsilat düzeltmesi, adisyonun kalan bakiyesidir (toplam − tahsilat). Bu tutar satırların adisyon tutarındaki payına göre, en büyük kalan yöntemiyle dağıtılır ve aynı personele `payment_adjustment` olarak yazılır. Paket satışı ve personelsiz satırlar kendi paylarını alır ama prim üretmez.
    - **Paket iadesi:** kullanılmış seansın primini değiştirmez.
    - **Yuvarlama:** prim her zaman yarım kuruşta yukarı yuvarlanmış `oran × kümülatif matrah` değeridir. Bu yüzden yuvarlama birikmez ve dağıtılan matrah adisyonun tuttuğu parayı aşmaz. Kümülatif matrah hiçbir ara adımda negatife düşmez.
    - **İade ile satır ayrımı:** ürün iadesinin iade kaydı, toplamı düşüren satırdan önce yazıldığı için tahsilat tetikleyicisi commit anına ertelenmiştir. Commit'lenen yol ve iki eşzamanlı iade dblink testiyle kanıtlanır.
  - **Rapor.** `GET /api/reports/commission` en fazla 92 günlük aralık kabul eder; hareket zamanı işletme saat dilimine göre alınır.
    - Kapsam: mali rapor yetkisi olan üye tüm personeli, diğer üyeler yalnız kendi personel profilini görür.
    - Personel satırında hizmet, paket seansı, ürün ve iade/düzeltme matrahları ile prim yer alır. Son 500 hareket listelenir.
    - Hesap tanımı raporla birlikte döner.
    - Oran düzenleyici "Kasa ve raporlar" sayfasındadır. Bordro/maaş motoru eklenmez.

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
- **Uygulanan model (2026-09-25):** Devir listesi ve üç kolun eylem audit'i [f16-08-action-audit.md](f16-08-action-audit.md) içindedir.
  - **Hesap menüsü.** Randevu panelinin üst barında bir `Hesap` menüsü, SalonApp'in "Diğer" sekmesinde de "Hesap ve üyelik" paneli vardır. İkisi de `GET /api/account` okur. Gösterilenler: giriş yapan hesap, aktif işletme, üyelik rolü, staff için mali yetkiler, plan ve dönem sonu. İşletme menüden değil membership'ten gelir. Dil seçimi, parola değiştirme ve çıkış mevcut ortak akışlara bağlıdır. İşletme geçişi var olan üyelik seçicisidir; yeni bir üst tenant hiyerarşisi eklenmez.
  - **Plan.** Kaynak `core.subscriptions`'tır. Kayıt yoksa pilot plan geçerlidir ve manuel etkinleştirilir. `cancelled` salt okunurdur:
    - paylaşılan hazırlık kontrolü `PLAN_INACTIVE` ile yeni public randevuyu kapatır;
    - Worker üye yazmalarını RPC'den önce `PLAN_READ_ONLY` ile reddeder;
    - mevcut müşteri randevusu yönetim bağlantısıyla görüntülenebilir, taşınabilir ve iptal edilebilir.

    `past_due` yalnız uyarıdır. Otomatik tahsilat yoktur.
  - **Dil.** Türkçe varsayılan ve kaynak dildir. İngilizce kataloğu tembel yüklenir; seçim sırası `?lang=`, cihaz tercihi, sonra Türkçe. Eksik çeviri Türkçeye düşer, teknik anahtar görünmez. Üç kolun arayüz metinleri ve tarih/sayı/tutar biçimleri seçilen dile uyar. İşletmenin girdiği içerik çevrilmez.
  - **Boş eylemler.** SalonApp'te "Henüz kullanıma açık değil" diye bekleyen yedi eylem F16-03…F16-07 yüzeylerine bağlandı; "Yeni paket satışı" F16-05 satış route'uyla kendi adisyonunu açar. Disabled kalan tek eylem, nedeni yazılı olan Destek'tir.
