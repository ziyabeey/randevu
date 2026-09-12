# Faz 17 — MVP doğrulaması ve kontrollü pilot

**Sonuç:** Üç kollu ürün gerçek ortamda işletmenin temel gününü tamamlar; güvenilir yayın/geri dönüş prosedürüyle pilot yapılır. **Kapı:** G17 = MVP kabulü. Durumlar [TASKS.md](../../TASKS.md) içindedir.

F17-01 ve F17-02 hazırlığı en başta yürütülebilir; son faza ertelenmez. Bu görevler bugün erişim/ortam hazır olduğu iddiası değildir. Kod uygulaması veya ortam kurulumu bu planlama teslimatında başlatılmaz.

## F17-01

**Geliştirme ve staging ortamı**

- **Bağımlılık:** TEMEL.
- **Sorumluluk:** Altyapı + Ziya'nın hesap/varlık desteği. **Çakışma alanı:** Ortam yapılandırması ve kurulum dokümanı.
- **İş ve çıktı:** Mevcut Cloudflare/Supabase hesabı, repo bağlantısı, geliştirme/staging ortamı ve bildirim sağlayıcısı erişimini doğrula; eksik kurulumları tamamla. Callback/origin, secret adları, migration sırası, test alan adı/gönderici ve iki sahte işletmeli test veri setini belgeleyerek tekrarlanabilir kurulum hazırla.
- **Kabul:** Temiz checkout kurulabilir; staging'de gerçek test hesabıyla giriş ve mevcut API çalışır. Production ile test verisi/secrets ayrıdır; erişim doğrulanamadıysa görev engelli kalır, ortam uydurulmaz. Secret değerleri Git/PR/sohbete dökülmez. Yeni ücretli kaynak gerektiğinde önce somut gereksinim ve maliyet görünür olur; mevcut kullanıcı yetkisi tekrar sorulmaz.
- **Devir:** Çalışan ortam adresi, hesap erişiminin kimde olduğu, secret isimleri, test veri kurulum/sıfırlama komutları ve mevcut sınırlar. Gerçek müşteri verisi fixture yapılmaz.
- **v3 tarihsel not:** Bu temel tamamlandı; tekrar kurulum işi açılmaz. Run başına gate/dispatch rotasyonundaki kısmi dağıtım riski S05 ile ayrıca kapatılır.

## F17-02

**Test çalıştırma ve bağımlılık bakım temeli**

- **Bağımlılık:** TEMEL.
- **Sorumluluk:** QA/altyapı. **Çakışma alanı:** `.github/workflows/ci.yml`, test araçları ve lockfile.
- **İş ve çıktı:** Mevcut build/SQL kapısını koruyarak görevlerin kullanacağı HTTP ve tarayıcı test yolunu küçük bir gerçek akışla kur. Yeni migration/testin CI dışında unutulmamasını sağla. Önceden raporlanan 4 yüksek önem bağımlılık uyarısını güncel advisory/gerçek etkiyle doğrula ve gerekli dar düzeltmeleri yap.
- **Kabul:** Temiz kurulumda migration zinciri ile testlerin gerçekten çalıştığı görülür; kritik hata testi başarısızsa CI kırmızı olur. Canlı sağlayıcı testi ile stub testi ayrı raporlanır. İlgisiz framework sürüm değişimi yapılmaz; düzelen bağımlılıklar için build/gerileme kanıtı vardır.
- **Devir:** Çalıştırma komutları, fixture sınırları, hangi kanıtın CI/hangi kanıtın gerçek ortam gerektirdiği ve güncel bağımlılık bulguları.
- **v3 tarihsel not:** Bu temel tamamlandı. Tekrarlanan typecheck/docs CI maliyeti, zayıf kaynak eşleme ve repo koruması S06’nın ayrı kabulüdür; bu plan PR’ı mevcut CI’ı değiştirmez.

## F17-03

**İzleme, yedek ve yayın hazırlığı**

- **Bağımlılık:** GS, G14, G15, G16, F17-01, F17-02.
- **Sorumluluk:** Altyapı/backend. **Çakışma alanı:** Yayın iş akışı, izleme ve işletim dokümanı.
- **İş ve çıktı:** API/gönderim başarısızlığı ve kuyruk birikimi görünürlüğü; hassas veriyi ayıklayan loglama; staging→production yayın/geri dönüş ve migration uyumluluğu prosedürü ekle. Veritabanı ve görsellerin yedek/geri yükleme kapsamını belirle; ayrı ortamda geri yükleme dene.
- **Kabul:** Sadece yedek varlığı değil, geri yüklenen kayıt ve ilişkilerin çalışması kanıtlanır. Uygulama sürümü geri alınırken şema/veri kaybı yaratılmaması için ileri düzeltme yolu bellidir. Planlanan veri saklama/silme ve kişisel fotoğraf görünürlüğü işletim notunda karşılık bulur; hukuki uygunluk kendiliğinden tamamlandı sayılmaz.
- **Devir:** Ortam/backup kapsamı, geri dönüş kanıtı, hata izleme adresleri, yayın kontrol listesi ve eksik hesap/ürün sahibi girdileri.
- **v3 sıra:** Erken timeout/retention/metrik ve DB erişim temelini S07/S08 sağlar. Bu görev G14/G15/G16 sonrası, paket/promosyon/prim ve özel görseller dahil nihai veri setiyle yayın kabulüdür. DB + storage tutarlılığı, fiili veri kaybı penceresi/geri dönüş süresi ve saklama/silme kararları pilot öncesi kanıtlanır.

## F17-04

**MVP kabul matrisi ve referans doğrulaması**

- **Bağımlılık:** GS, G09, G10, G11, G12, G13, G14, G15, G16, F17-03.
- **Sorumluluk:** QA + Ziya. **Çakışma alanı:** Uçtan uca kanıtlar ve kabul matrisi.
- **İş ve çıktı:** [MVP_ACCEPTANCE.md](../../MVP_ACCEPTANCE.md) senaryolarını birleştirilmiş release adayı üzerinde tamamla; 11 referans ekranını çalışan ürünle karşılaştır. İki işletme/üç rol, iki cihaz ve gerçek mobil tarayıcı kullan.
- **Kabul:** Müşteri → çoklu randevu → panel → SalonApp → adisyon → bölünmüş tahsilat → stok/rapor; ayrıca randevusuz satış, paket/kampanya, hatırlatma, yorum/fotoğraf akışları geçer. Çakışma/yenileme/yetki iptali/sağlayıcı kesintisi ve tenant sınırları doğrulanır. Ziya müşteri estetiğini ve işletme işlem sırasını değerlendirebilir. Açık engelleyici hata varken kabul verilmez.
- **Devir:** Commit/ortam/tarih, senaryo sonuçları ve ekran kanıtı; bulunan her kusurun sahibi/PR'ı. Düzeltme sonrası yalnız etkilenen kabul zinciri ve zorunlu kapı tekrar çalıştırılır.
- **v3 kabul sınırı:** MVP_ACCEPTANCE içindeki M23 hariç bütün release-adayı senaryoları geçer. M23 gerçek pilot görevi F17-05’in kabulüdür; bu görevin onu önceden istemesi bağımlılık döngüsü yaratır. Ortak sürümde GS kusurları ve F16 seri/bildirim/mali etkileşimleri yeniden doğrulanır.

## F17-05

**Kontrollü pilot ve MVP teslimi**

- **Bağımlılık:** F17-04.
- **Sorumluluk:** Ürün sahibi + altyapı + QA.
- **İş ve çıktı:** Hazır sürümü mevcut yayın yetkisi kapsamında 1–3 pilot işletmede devreye al; işletme kurulumu ve bir tam iş gününü gözle, destek/yayın geri alma yollarını erişilebilir tut. Kabul matrisinin gerçek pilot kanıtını tamamla.
- **Kabul:** En az bir gerçek işletme günü rezervasyon ve randevusuz işlemden gün sonu mutabakatına tamamlanır; her pilot işletmenin yetki/kurulum kontrolü kaydedilir. Kritik veri kaybı, çapraz işletme erişimi, çakışma veya yanlış tahsilat bulgusu kapalıdır. Ziya'nın kullanım geri bildirimi kayda alınır; açık küçük işler MVP sonrası listesine açıkça taşınır.
- **Devir:** Release commit'i, pilot sonuçları, işletim rehberi, destek sorumluluğu ve bilinen sınırlamalar. G17 ancak bu kanıtla MVP kabul edilir; plan yazılması veya faz numarası artması kabul yerine geçmez.
- **v3 kapanış:** M23 burada gerçek pilotla kapanır. G17 için M23 dahil tüm kabul matrisi ve GS tamamdır; plan veya staging testinin pilot yerine geçmesi kabul edilmez.
