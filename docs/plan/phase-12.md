# Faz 12 — Müşteri paneli

**Sonuç:** Referansın temel rezervasyon işlevlerini koruyan, özgün ve daha estetik müşteri deneyimi. **Kapı:** G12. [TASKS.md](../../TASKS.md) görev durumlarının kaynağıdır.

Okuma başlangıcı: `src/PublicBookingPage.tsx`, `src/ManageAppointmentPage.tsx`, ilgili CSS/Worker dosyaları ve [üç müşteri referansı](../references/README.md). Yorumlar F16-04, kampanyalar F16-06 ile tamamlanır; G12 bu bağımlılıkları bitmiş saymaz.

**Faz direktifi / kaynak head `5e789ad`:** `/r/:slug` müşteri yüzeyi mobil 4G ilk-yük maliyetine göre düşünülür. Public route operator/private bundle'ını taşımamalıdır. Bu head'deki repo-durumu ayrıntıları kart açılırken current main'de yeniden doğrulanır; aşağıdaki bütçeler başlangıç hedefidir, ölçümlü gerekçeyle değiştirilebilir.

## F12-01

**Görsel yön ve akış sözleşmesi**

- **Bağımlılık:** TEMEL.
- **Sorumluluk:** Tasarım + ürün sahibi. **Çakışma alanı:** Tasarım belgeleri; mevcut ortak CSS henüz değiştirilmez.
- **İş ve çıktı:** Üç kol için tipografi, renk, ikon, alan ve durum dili; müşteri için salon → hizmetler → saat/personel → özet → sonuç/yönetim akışını çiz. 360/390 px müşteri, tablet/masaüstü işletme örneklerini ve yükleniyor/boş/hata durumlarını tanımla. SalonApp'in sabit alt menüsünü ve işletme tarafındaki küçük fark sınırını koru.
- **Kabul:** Referanstaki her temel alan bir hedef ekrana bağlıdır. Çoklu hizmet, fiyat aralığı, seçili özet ve geri dönüş davranışı görünürdür. Rakip kimliği/fotoğrafları üretim tasarımına taşınmaz. Ziya'nın sağlayacağı gerçek logo/fotoğraf/metin listesi açıkça çıkarılır; eksik varlıklar gerçek veri gibi sunulmaz.
- **Devir:** Ekran/alan eşleştirmesi, görsel kurallar ve ürün sahibinin geri bildirim notları. Bu çıktı çalışan müşteri paneli sayılmaz.
- **v3 kapsam:** Görsel yön ve yeni kullanıcı dostu fikirler ayrı kullanıcı çalışmasıdır; bu teknik revizyon tasarım yapmaz. Mevcut onaylı işlevler korunur. Ortak metin/formatlama sınırı F16-08 için baştan tanımlanır; yeni tasarım sistemi altyapısı sırf gelecekte lazım olabilir diye kurulmaz.

## F12-02

**Salon profili ve public fotoğraflar**

- **Bağımlılık:** F12-01, F10-03.
- **Sorumluluk:** Backend + müşteri/ayar arayüzü. **Çakışma alanı:** Salon profili ve public görsel erişimi.
- **İş ve çıktı:** Salon adı, açıklama, iletişim/adres, çalışma bilgileri ve işletmenin yayınlayacağı fotoğrafları ekle; Hizmetler/Bilgiler yüzeylerine bağla. Fotoğraf yükleme/boyut/tür kısıtları, silme ve yayın görünürlüğü tanımlansın.
- **Kabul:** İşletme yalnız kendi profilini/görsellerini değiştirir; public API özel operasyon verisini döndürmez. Public yayın kapalıyken sayfa uygun yanıtı verir. Eksik/hatalı görsel yerleşimi bozmaz. Müşteriye ait özel hizmet fotoğrafı bu public alana otomatik konulmaz.
- **Devir:** Alan ve depolama izinleri, kullanılabilir gerçek varlıklar ve erişim/boş durum testleri.
- **v3 depolama:** K03 girdi/adet sınırlarını ve S08 erişim kapısını uygula. Public medya için boyutlandırma/çıktı formatı ve silme/orphan temizliği testlidir; özel görseli public bucket’a taşıma.
- **Hazır olan:** Marketing asset sözleşmesindeki açık byte/hash/binary-handoff yaklaşımı medya bütçesi yazmak için örnektir; mekanizma aynen kopyalanmaz, prensip kullanılır.
- **Tuzak / medya bütçesi:** Kabul öncesi hem **görsel başına** hem **ilk public sayfa toplamı** için sayısal byte/ölçü bütçesi yazılır. “5 MB upload kabul ediyoruz” tek başına delivery budget değildir; encode edilmiş public çıktı ve sayfa toplamı ayrı sınırdır.

## F12-03

**Hizmet kategorileri ve fiyat aralığı**

- **Bağımlılık:** F10-04.
- **Sorumluluk:** Veri/backend + katalog arayüzü. **Çakışma alanı:** Hizmet kataloğu ve fiyat snapshot sözleşmesi.
- **İş ve çıktı:** Kategori/sıra ve sabit fiyat/fiyat aralığı desteğini ileri migration ile ekle. Tek fiyatlı eski hizmetleri koru. Çok hizmetli tahmini toplam, para birimi ve fiyatın kesinleşme anını açıkça tanımla; adisyonun kesin fiyatına aktarılacak alanları belgele.
- **Kabul:** Negatif fiyat, alt > üst ve uyumsuz para birimi reddedilir. Fiyat değişimi geçmişi değiştirmez. Tahmini aralık kesin tahsilat olarak sunulmaz; istemci toplamı sunucu için yetkili kaynak değildir. Seçili/pasif hizmet davranışı korunur.
- **Devir:** Fiyat alanları, örnek sabit/aralık toplamları, geriye uyum testleri ve F14/F16 promosyon entegrasyon sözleşmesi.
- **Bağlayıcı sözleşme:** [K02](architecture-contracts.md#k02). Bu veri işi F11-01’den **önce**, F12 görsel işlerinden bağımsızdır. Eski fixed fiyat kayıpsız alt=üst olarak eşlenir; mevcut tek hizmetli appointment snapshot’ı değişmez. Sabit/aralık ayrımı ve ortak yuvarlama test edilir; F10-04 formu/API’si dar biçimde genişletilir.
- **Tuzak / claim gate:** Müşteri yüzeyi, backend fiyat aralığı/policy kabul edilmeden yeni fiyat davranışını varmış gibi göstermemelidir. MKT-01 `releaseGates` yaklaşımı desen olarak kullanılabilir: hazır olmayan capability UI/copy'de fail-closed kalır; ikinci genel-purpose feature flag sistemi kurulmaz.

## F12-04

**Çoklu hizmet, personel ve saat seçimi**

- **Bağımlılık:** F12-02, F12-03, F11-02.
- **Sorumluluk:** Müşteri arayüzü. **Çakışma alanı:** Public booking seçim adımları.
- **İş ve çıktı:** Kategori/hizmet seçimi, seçili adet/özet, hizmet sırası, tercih edilen/uygun personel, bugün/yarın/tarih ve slot seçimini gerçek API'ye bağla. Favoriyi ilk sürümde cihazda tut; paylaşımı güvenli public salon bağlantısıyla yap.
- **Kabul:** İki hizmetin süre/personel/fiyatı tüm adımlarda tutarlıdır. Dolu saat seçilemez; son anda dolan saatte seçim korunup yeni uygunluk sunulur. Hızlı filtre/tarih geçişinde eski cevap ekrana dönmez. İşlem kişisel veriyi URL'ye taşımaz.
- **Devir:** Gerçek API ile mobil akış görüntüleri, boş/çakışma/yavaş bağlantı testleri ve F12-05'in kullanacağı seçim durumu.
- **v3 uygulama sınırı:** K01 grup kimliği, K02 tahmin ve K03 limitleri tek sunucu yanıtından tüketilir. Yeni feature fetch/auth/formatlama kopyası eklenmez; S02 ortak istemci kullanılır.
- **Tuzak / stale request:** Tarih, personel, işletme veya filtre değişiminde eski cevabın yeni seçimi ezmemesi için kullanılan iptal/generation primitive'i F13-01 ile ortak kontrat olmalıdır. İki ayrı AbortController/stale-response altyapısı tasarlanmaz; S02 `src/api.ts` tek fetch/timeout/CSRF katmanı kalır.

## F12-05

**Özet, sonuç ve müşteri yönetimi**

- **Bağımlılık:** F12-04, F09-02, F11-03.
- **Sorumluluk:** Müşteri arayüzü + QA. **Çakışma alanı:** İletişim formu, sonuç ve yönetim ekranı.
- **İş ve çıktı:** Çok hizmetli özet, ad/telefon, isteğe bağlı e-posta, not ve gerekli bilgilendirmeyi ekle. Randevu/mesaj durumlarını ayır; aynı güvenli yönetim akışında taşıma/iptal ve yenileme sonrası kurtarmayı göster. Henüz uygulanmamış kampanya/yorum denetimleri işlevli gösterilmez.
- **Kabul:** 360/390 px'te hizmetten yönetim bağlantısına gerçek yolculuk tamamlanır; klavye/sabit alt eylem içerik örtmez. Ağ veya e-posta hatasında kayıt sonucu doğrudur; tekrar randevu oluşmaz. Klavye odağı, alan hata ilişkileri ve renk dışı durum işaretleri çalışır.
- **Devir:** Mobil ve masaüstü kabul kaydı; F16 entegrasyon yerleri. G12 kapanırken referans matrisi yalnız tamamlanan işlevler için güncellenir.
- **Public route performance acceptance:** Production candidate'ta `/r/:slug` için başlangıç hedefi **≤120 kB gzip initial JS**'dir ve public ilk yüklemede operator/private ekran implementasyon chunk'ları eager taşınmaz. Bütçe aşılırsa sayı sessizce büyütülmez; build manifest/network receipt ile gerekçe ve owner bırakılır. Route-level code splitting kararı F14/F17'ye ertelenmez.
