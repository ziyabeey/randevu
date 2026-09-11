# Faz 9 — Güvenilir rezervasyon ve bildirim

**Sonuç:** Müşteri randevusunun oluşup oluşmadığını bilir; bağlantı ve e-posta hataları güvenle toparlanır. **Kapı:** G09. Görevlerin canlı durumu [TASKS.md](../../TASKS.md) içindedir.

Okuma başlangıcı: `worker/public-booking.ts`, `worker/customer-manage.ts`, `src/PublicBookingPage.tsx`, `src/ManageAppointmentPage.tsx`, Faz 6–7 migration/testleri. [PR #8](https://github.com/ziyabeey1-ai/randevu/pull/8) yararlı fakat eksik bir girdidir; mevcut main'e göre yeniden değerlendirilir. Eski PR'ın dokümanları güncel ürün kapsamının üzerine yazılmaz.

## F09-01

**Taslak incelemesi ve kurtarma sözleşmesi**

- **Bağımlılık:** TEMEL.
- **Sorumluluk:** Backend/veri. **Çakışma alanı:** Yönetim bağlantısı ve bildirim sözleşmeleri.
- **İş ve çıktı:** PR #8'de yeniden kullanılacak parçaları, main ile çatışmaları ve açık bulguları kaydet. Rezervasyon sonucu, idempotency anahtarı, yönetim yetkisi, sağlayıcı kabulü/teslimi ve hata durumları için istek/yanıt sözleşmesi yaz. Düz token saklamadan yenileme sonrası kurtarma ve tarayıcı kapandıktan sonra gönderim yapılabilmesini birlikte çöz.
- **Kabul:** Cevap kaybı, sayfa yenileme, yanlış sahiplik kanıtı, eşzamanlı tekrar, anahtar değişimi ve sağlayıcı kesintisi için beklenen sonuçlar somut örneklerle bellidir. Dar sunucu gönderim yetkisi tariflidir; Worker service-role kullanmaz. Yalnız idempotency anahtarını istemci beyanı olarak kabul edip sahte gönderim kaydı açılmaz.
- **Devir:** Seçilen token yaşam döngüsü, hassas verinin nerede/ne kadar tutulduğu, hata kodları ve PR #8 parça eşleştirmesi. Bu görev sözleşmeyi teslim eder; kodlanmış kurtarma veya kuyruk olarak işaretlenmez.
- **Bağlayıcı teslim:** [F09-01 rezervasyon kurtarma ve bildirim sözleşmesi](f09-01-recovery-contract.md).

## F09-02

**Rezervasyon sonucunu ve yönetim erişimini kurtarma**

- **Bağımlılık:** F09-01.
- **Sorumluluk:** Backend + müşteri arayüzü. **Çakışma alanı:** Public oluşturma/provision ve sonuç ekranı.
- **İş ve çıktı:** F09-01 sözleşmesini uygula; kayıt sonrası bağlantı hatasını randevu hatasından ayır. Güvenli tekrar/sorgulama ve yenileme sonrası devam akışı ekle. Kurtarma verisinin yaşam süresi ve temizlenmesi uygulanır; telefon bilmek erişim sağlamaz.
- **Kabul:** Kayıt commit edildikten sonra cevap kesilse de aynı işlem ikinci randevu yaratmaz. Provision kesintisi/yenilemesi mevcut kayda ulaşır; yanlış kanıt ve başka işletme reddedilir. Token URL query/path'ine, loga veya düz DB alanına düşmez. Eski yönetim bağlantıları çalışır.
- **Devir:** Uygulanan API/istemci akışı, ileri migration varsa sıra, HTTP hata testleri ve tarayıcıda kesinti/yenileme kanıtı.

## F09-03

**Kalıcı gönderim ve güvenilir sağlayıcı kaydı**

- **Bağımlılık:** F09-02.
- **Sorumluluk:** Backend/veri. **Çakışma alanı:** Bildirim modülü, zamanlanmış görev ve yeni migration.
- **İş ve çıktı:** Kalıcı iş kaydı, dar yetkili gönderici, zaman aşımı, yeniden deneme aralığı/sınırı ve başarısız işleri izleme ekle. Randevu olayı ve gönderim işi aynı güvenilir işlem sınırından doğar. Sağlayıcı sırrı ve düz yönetim bağlantısı iş payload'ına/loglara yazılmaz; F09-01'de kararlaştırılan güvenli teslim yöntemi kullanılır.
- **Kabul:** Tarayıcı kapalıyken yeniden deneme çalışır. Sağlayıcının kabul edip cevabının kaybolması test edilir; desteklenen idempotency süresi ve sınırı belgelenir, mutlak tek teslim iddiası yapılmaz. İstemci/anon sahte receipt yazamaz. Birden fazla çalışan aynı işi kontrolsüz göndermez; başarısız e-posta randevuyu geri almaz.
- **Devir:** İş durumları, sahiplenme/kilit süresi, yeniden deneme politikası, gerekli secret adları ve sağlayıcı stub testleri. Gerçek teslim kanıtı yoksa açıkça kaydet.

## F09-04

**Public rezervasyonda kötüye kullanım kontrolü**

- **Bağımlılık:** F09-02.
- **Sorumluluk:** Backend/güvenlik. **Çakışma alanı:** Public Worker uçları ve public RPC yetkileri.
- **İş ve çıktı:** İstek sıklığı, tekrar deneme ve otomatik slot doldurmaya karşı ölçülebilir sınırlar belirle/uygula. Açık Supabase RPC'nin Worker kontrolünü atlayıp atlamadığını sınayıp aynı güvenlik sınırına al. Gerekli challenge/kanıt sunucuda doğrulanır.
- **Kabul:** Worker ve doğrudan RPC üzerinden toplu denemeler sınırlanır; yalnız IP'ye güvenen bir modelle meşru ortak ağlar tamamen engellenmez. Aynı başarılı işlemin güvenli tekrarı bozulmaz; 429 ve tekrar deneme mesajı anlaşılırdır. Public kapalı işletme ve geçersiz hizmet/personel erişimi reddedilir.
- **Devir:** Yapılandırılabilir sınırlar, atlama testleri, meşru kullanıcıya etkisi ve izlenecek hata oranları.

## F09-05

**Rezervasyon/bildirim entegrasyon kapısı**

- **Bağımlılık:** F09-03, F09-04, F17-01, F17-02.
- **Sorumluluk:** QA + backend. **Çakışma alanı:** Faz 9 entegrasyon testleri; uygulama düzeltmeleri ilgili görev sahibiyle koordine edilir.
- **İş ve çıktı:** Yeni kurulum ve mevcut Faz 8 verisi üzerinde yükseltme; gerçek test ortamında rezervasyon, sonuç kurtarma, bağlantı yönetimi ve e-posta kabul/teslim zinciri.
- **Kabul:** Ağ kopması, sağlayıcı kesintisi, tarayıcının kapanması, mükerrer istek, süresi dolan/yanlış yetki ve anonim sahte receipt senaryoları geçer. Önceki SQL zinciri ve ilgili HTTP/tarayıcı testleri yeşildir. Gerçek teslim gerçekleşmediyse G09 doğrulaması açık kalır.
- **Devir:** CI ve tarayıcı kanıtı, test ortamı/commit, bilinen sınırlamalar ve PR #8'in ne şekilde tüketildiği. Eski PR yalnız onun kapsamı gerçekten taşındığında kapatılır.

G09 için beş görevin kabulü tamamlanır. İptal/taşıma ve SMS hatırlatma F16-02'de aynı bildirim altyapısını kullanır; yeni bir gönderim motoru kurulmaz.
