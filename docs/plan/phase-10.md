# Faz 10 — Hesap, ekip ve ortak işletme yönetimi

**Sonuç:** Bir salon gerçek hesaplarla kurulabilir ve birden çok çalışan güvenle kullanabilir. **Kapı:** G10. Durumlar [TASKS.md](../../TASKS.md) içindedir.

Okuma başlangıcı: `worker/index.ts`, `src/App.tsx`, `worker/app.ts`, `src/main.tsx`, Faz 2–3 migration'ları. Bu iki büyük dosyanın aynı anda farklı ajanlarca değiştirilmesi önlenir; görev başına ayrıştırılacak modüller önce PR'da adlandırılır.

## F10-01

**Ortak oturum ve parola akışları**

- **Bağımlılık:** F09-05.
- **Sorumluluk:** Backend + hesap arayüzü. **Çakışma alanı:** Oturum yardımcıları, Worker router ve giriş ekranı.
- **İş ve çıktı:** Mevcut oturum/RLS yaklaşımını koruyarak tekrar eden auth/istek yardımcılarını dar kapsamda ortaklaştır. Giriş, çıkış, e-posta doğrulama ve parola kurtarma/değiştirme akışlarını tamamla; Origin/CSRF, token yenileme ve oturum hatalarını tutarlı yönet.
- **Kabul:** Yanlış/süresi dolmuş kurtarma bağlantısı güvenle reddedilir; giriş/çıkış ve yenileme sonrası korunan ekranlar doğru davranır. CSRF/Origin negatif testleri geçer. Oturum sırları istemciye veya loga açılmaz; üyelik güncel DB kaydından denetlenir.
- **Devir:** Ortak yardımcıların sözleşmesi, kalan modül geçişleri, gerçek hesapla kurtarma kanıtı ve test komutları.
- **v3 inceleme notu:** Bu görevin tarihsel teslimi korunur. Recovery hata/expiry sınırı S01, bütün feature yardımcıları/CSRF kapsamı S02 ile ayrıca düzeltilir; eski staging kanıtı public posta/PKCE zincirinin tamamını kanıtlamaz.

## F10-02

**Davet, üyelik ve rol yönetimi**

- **Bağımlılık:** F10-01, GS.
- **Sorumluluk:** Backend/veri + ekip arayüzü. **Çakışma alanı:** Membership, davet ve personel-hesap bağlantısı.
- **İş ve çıktı:** Süreli/tek kullanımlı davet, kabul, aktiflik ve rol değişimi ekle. Operasyon personeli ile giriş üyeliği ayrımını ekranda anlaşılır yap. Son aktif owner'ı koru; manager/staff'ın verebileceği yetkiyi sınırla.
- **Kabul:** Yanlış e-posta/işletme, tekrar kabul ve süresi dolan davet reddedilir. Eşzamanlı owner kaldırma işletmeyi sahipsiz bırakmaz. Pasifleştirilmiş üye açık oturumuyla erişemez; staff kendine mali veya owner yetkisi veremez.
- **Devir:** Rol matrisi, davet yaşam döngüsü, SQL/API testleri ve iki test hesabının gerçek kabul akışı.
- **Mali izin sahipliği:** F10-02, sınırlı ve açık mali izin kaydını, owner’ın izin verme/geri alma arayüzünü ve audit’ini de teslim eder. İlk izin alanları tahsilat, fiyat/iskonto/iade düzeltmesi, mali rapor, stok yazımı ve masraf yazımıdır; genel amaçlı politika motoru kurulmaz. Staff kendine izin veremez; manager owner gibi izin dağıtamaz. Pasifleştirme/rol düşürme ve açık formda izin geri alma sonraki istekte etkili olur. Henüz olmayan mali işlev ekranda yapılabilir işlem gibi gösterilmez; F14/F15 yalnız verilen izinleri tüketir.
- **v3 sahiplenme:** Açık taslak PR #32 mevcut sahibindedir; incelenen head `5099ea3` yalnız devir kaydıdır. GS nedeniyle engellidir. Yeni ajan aynı kimlikte ikinci uygulama başlatmaz; güncel PR/main ve dosya sahibiyle devir kontrol edilir.

## F10-03

**İşletme geçişi ve kurulum akışı**

- **Bağımlılık:** F10-02.
- **Sorumluluk:** Ortak arayüz + backend. **Çakışma alanı:** İşletme seçimi ve onboarding.
- **İş ve çıktı:** İkinci işletme oluşturma, yetkili işletme seçme ve işletme → hizmet → personel → çalışma saatleri → önizleme → yayın akışını kur. Tek çalışanlı işletmede sahibi personel olarak kullanma seçeneği ekle; eksik adımlar kaybolmadan devam edilsin.
- **Kabul:** İşletme değiştiğinde eski liste, filtre, çekmece ve bekleyen ağ cevapları yeni işletmeye sızmaz. Client business ID/cookie yetki sayılmaz. Eksik hizmet/personel/mesai ile public yayın engellenir; işletme + owner atomik oluşur.
- **Devir:** Onboarding durumları, boş ekranlar, işletme değişim protokolü ve iki işletmeyle tarayıcı kanıtı.
- **v3 teknik sözleşme:** S02 ortak session/istek iptalini ve S04 business-create kotasını kullan. Yeni ekranlarda metin anahtarları ve tarih/tutar biçimleme ortak sınırda tutulur; F16-08 dil desteğinde bütün ekranları yeniden yazmak gerekmez.

## F10-04

**Hizmet, personel ve çalışma ayarları**

- **Bağımlılık:** F10-03.
- **Sorumluluk:** İşletme arayüzü. **Çakışma alanı:** Katalog ve müsaitlik ayarları.
- **İş ve çıktı:** Mevcut düzenleme/pasifleştirme API'lerini ekrana bağla. Hizmet fiyatı, süre/tampon; personel, hizmet yetkinliği; salon/personel mesaisi ve kapanış ayarlarını tamamla. Referanstaki ayar gruplarını kullan.
- **Kabul:** Geçersiz tutar/süre ve başka tenant bağlantısı reddedilir. Arşivleme geçmiş snapshot'ları bozmaz, yeni randevuda seçimden çıkarır. Mesai değişikliği mevcut randevuyu sessizce iptal/taşıma yapmaz; etkisi görünürdür.
- **Devir:** Güncel alan/doğrulama sözleşmesi, ayar ekranları ve snapshot/aktiflik gerileme kanıtları.
- **v3 sıra:** Bu iş mevcut sabit fiyatın uyumlu düzenleme yoludur. [K02](architecture-contracts.md#k02) para doğrulaması/formatı ortak kalır; F12-03 aynı form ve API sözleşmesine aralık alanları ekler, ayrı katalog/fiyat motoru kurmaz.

## F10-05

**İşletmenin müşteri kayıtları**

- **Bağımlılık:** F10-03.
- **Sorumluluk:** Backend + işletme arayüzü. **Çakışma alanı:** Müşteri modülü ve arama.
- **İş ve çıktı:** Tenant içinde arama, sayfalama, oluşturma, iletişim düzenleme ve randevu geçmişi ekle. Aynı telefon/e-posta ve eşzamanlı müşteri oluşturma davranışını tanımla; anonim rezervasyon mevcut ana müşteri kaydını değiştiremez.
- **Kabul:** Başka işletmenin müşterisi aranamaz/düzenlenemez; aynı isimler yanlış kişiye sessizce bağlanmaz. Kayıt düzeltmesi geçmiş randevu snapshot'ını ezmez. Public kullanıcı müşteri listesini göremez; adisyon geçmişi için genişleme noktası bellidir.
- **Devir:** Müşteri eşleştirme kuralları, izinler, arama/iletişim testleri ve sonraki SalonApp bağlantısı.
- **v3 kaynak sınırı:** [K03](architecture-contracts.md#k03) sayfalama ve sorgu bütçesine uy; geçmişi sessizce ilk 250 kayıtla sınırlama. Sayfa/işletme değişiminde stale-response testini ekle.

## F10-06

**Gerçek hesaplarla ortak yönetim kabulü**

- **Bağımlılık:** F10-04, F10-05, F17-01.
- **Sorumluluk:** QA + ürün sahibi. **Çakışma alanı:** Ortak hesap/kurulum senaryoları.
- **Validation budget:** **FOCUSED.** Yeni şema tasarlamaz; hosted auth/PKCE/real-delivery ve ortak erişim zincirini kabul eder. R1/R2 yalnız bulunan risk alanına göre çağrılır; full staging zinciri her küçük değişiklikte tekrar koşturulmaz.
- **İş ve çıktı:** İki işletmede owner/manager/staff test hesaplarıyla kurulum, davet, parola kurtarma, rol düşürme, çıkış ve işletme değiştirmeyi tamamla.
- **Kabul:** Tarayıcı geri/ileri, açık ikinci sekme ve oturum süresi dolması doğru işletme/yetkiyi gösterir. Türkçe metinlerde faz/tenant/RPC gibi geliştirme terimleri yoktur. Yapılmamış hesap veya katalog işlemi çalışır görünmez.
- **Devir:** Hesap rolleri ve anonimleştirilmiş kanıtlar; gerçek sırlar/test parolaları Git'e yazılmaz. G10 ancak açık kabul kusurları kapandığında geçer.
- **v3 ek kabul:** S01’in gerçek public recovery/PKCE kanıtına bağlan; açık ikinci sekmede recovery sınırı ve Supabase geçici kesintisinde oturumun korunmasını ortak rollerle doğrula.
- **Hazır olan:** F10-01..05'in accepted main davranışları, `worker/team.ts`, `worker/customers.ts`, `worker/onboarding.ts` ve mevcut team/customer security/concurrency kabul testleri bu kartın girdisidir; kart açılırken current main'de exact dosya/head yeniden doğrulanır.
- **Tuzak / pahalı hosted zincir:** Gerçek Resend teslimatı ve PKCE içeren staging koşumu pahalıdır. Kör iterasyon yerine önce lokal/CI dar hata üretimi ve teşhis receipt'i alınır, sonra hosted zincir yalnız hosted davranışı doğrulamak için çalıştırılır. `staging-s07-acceptance` veya onun yerini alan runner hata sınıfını yutmamalı; bounded/redacted diagnostic ve exact-head rerun yolu F17-03 runner-hardening sözleşmesiyle uyumlu olmalıdır.
