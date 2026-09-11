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

## F10-02

**Davet, üyelik ve rol yönetimi**

- **Bağımlılık:** F10-01.
- **Sorumluluk:** Backend/veri + ekip arayüzü. **Çakışma alanı:** Membership, davet ve personel-hesap bağlantısı.
- **İş ve çıktı:** Süreli/tek kullanımlı davet, kabul, aktiflik ve rol değişimi ekle. Operasyon personeli ile giriş üyeliği ayrımını ekranda anlaşılır yap. Son aktif owner'ı koru; manager/staff'ın verebileceği yetkiyi sınırla.
- **Kabul:** Yanlış e-posta/işletme, tekrar kabul ve süresi dolan davet reddedilir. Eşzamanlı owner kaldırma işletmeyi sahipsiz bırakmaz. Pasifleştirilmiş üye açık oturumuyla erişemez; staff kendine mali veya owner yetkisi veremez.
- **Devir:** Rol matrisi, davet yaşam döngüsü, SQL/API testleri ve iki test hesabının gerçek kabul akışı.

## F10-03

**İşletme geçişi ve kurulum akışı**

- **Bağımlılık:** F10-02.
- **Sorumluluk:** Ortak arayüz + backend. **Çakışma alanı:** İşletme seçimi ve onboarding.
- **İş ve çıktı:** İkinci işletme oluşturma, yetkili işletme seçme ve işletme → hizmet → personel → çalışma saatleri → önizleme → yayın akışını kur. Tek çalışanlı işletmede sahibi personel olarak kullanma seçeneği ekle; eksik adımlar kaybolmadan devam edilsin.
- **Kabul:** İşletme değiştiğinde eski liste, filtre, çekmece ve bekleyen ağ cevapları yeni işletmeye sızmaz. Client business ID/cookie yetki sayılmaz. Eksik hizmet/personel/mesai ile public yayın engellenir; işletme + owner atomik oluşur.
- **Devir:** Onboarding durumları, boş ekranlar, işletme değişim protokolü ve iki işletmeyle tarayıcı kanıtı.

## F10-04

**Hizmet, personel ve çalışma ayarları**

- **Bağımlılık:** F10-03.
- **Sorumluluk:** İşletme arayüzü. **Çakışma alanı:** Katalog ve müsaitlik ayarları.
- **İş ve çıktı:** Mevcut düzenleme/pasifleştirme API'lerini ekrana bağla. Hizmet fiyatı, süre/tampon; personel, hizmet yetkinliği; salon/personel mesaisi ve kapanış ayarlarını tamamla. Referanstaki ayar gruplarını kullan.
- **Kabul:** Geçersiz tutar/süre ve başka tenant bağlantısı reddedilir. Arşivleme geçmiş snapshot'ları bozmaz, yeni randevuda seçimden çıkarır. Mesai değişikliği mevcut randevuyu sessizce iptal/taşıma yapmaz; etkisi görünürdür.
- **Devir:** Güncel alan/doğrulama sözleşmesi, ayar ekranları ve snapshot/aktiflik gerileme kanıtları.

## F10-05

**İşletmenin müşteri kayıtları**

- **Bağımlılık:** F10-03.
- **Sorumluluk:** Backend + işletme arayüzü. **Çakışma alanı:** Müşteri modülü ve arama.
- **İş ve çıktı:** Tenant içinde arama, sayfalama, oluşturma, iletişim düzenleme ve randevu geçmişi ekle. Aynı telefon/e-posta ve eşzamanlı müşteri oluşturma davranışını tanımla; anonim rezervasyon mevcut ana müşteri kaydını değiştiremez.
- **Kabul:** Başka işletmenin müşterisi aranamaz/düzenlenemez; aynı isimler yanlış kişiye sessizce bağlanmaz. Kayıt düzeltmesi geçmiş randevu snapshot'ını ezmez. Public kullanıcı müşteri listesini göremez; adisyon geçmişi için genişleme noktası bellidir.
- **Devir:** Müşteri eşleştirme kuralları, izinler, arama/iletişim testleri ve sonraki SalonApp bağlantısı.

## F10-06

**Gerçek hesaplarla ortak yönetim kabulü**

- **Bağımlılık:** F10-04, F10-05, F17-01.
- **Sorumluluk:** QA + ürün sahibi. **Çakışma alanı:** Ortak hesap/kurulum senaryoları.
- **İş ve çıktı:** İki işletmede owner/manager/staff test hesaplarıyla kurulum, davet, parola kurtarma, rol düşürme, çıkış ve işletme değiştirmeyi tamamla.
- **Kabul:** Tarayıcı geri/ileri, açık ikinci sekme ve oturum süresi dolması doğru işletme/yetkiyi gösterir. Türkçe metinlerde faz/tenant/RPC gibi geliştirme terimleri yoktur. Yapılmamış hesap veya katalog işlemi çalışır görünmez.
- **Devir:** Hesap rolleri ve anonimleştirilmiş kanıtlar; gerçek sırlar/test parolaları Git'e yazılmaz. G10 ancak açık kabul kusurları kapandığında geçer.
