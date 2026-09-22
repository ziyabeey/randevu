# Faz 14 — KolayApp, adisyon ve tahsilat

**Sonuç:** Aynı salon verisi üzerinde mobil işlem, adisyon ve manuel tahsilat çalışır. **Kapı:** G14. Eski 14A = F14-01/02, 14B = F14-03/04; F14-05 ortak kabulüdür. Durumlar [TASKS.md](../../TASKS.md) içindedir.

Mevcut başlangıç: ortak kabuk, booking/calendar/customer API'leri. Adisyon/tahsilat tabloları ve KolayApp production yolları henüz yoktur. Yeni dosya/yol adları ilgili PR sözleşmesinde belirlenir; bağımsız auth/randevu motoru oluşturulmaz.

**Faz direktifi / kaynak head `5e789ad`:** Para dokunan F14-02/03 ve bunların mali bütünlük kabulü STRICT'tir. Tutarlar integer minor-unit veya exact `numeric` ile tutulur; `double precision` para kaynağı olmaz. F10-02'nin beş açık mali izni tüketilir, ikinci izin motoru kurulmaz.

## F14-01

**KolayApp mobil kabuğu**

- **Bağımlılık:** F13-04.
- **Sorumluluk:** Mobil frontend. **Çakışma alanı:** SalonApp kabuğu ve ortak router bağlantısı.
- **İş ve çıktı:** Randevular / Adisyonlar / Yeni / Müşteriler / Diğer alt menüsünü kur. Ortak oturum/işletme ve takvim/müşteri modüllerine bağla; Yeni ve Diğer gruplarını referans sırasıyla düzenle. Var olmayan özellik kullanıcıya tamamlanabilir işlem gibi sunulmasın.
- **Kabul:** İşletme değişimi tüm sekmeleri temizler; tarayıcı geri/ileri doğru ekranı açar. 360/390 px'te alt menü, cihaz güvenli alanı ve klavye içerik örtmez. Randevular paneldeki aynı kimliklerdir.
- **Devir:** Gerçek route/sekme haritası, ortak kabuk sınırı ve F14-04/F15/F16 bağlantı noktaları.
- **Hazır olan / router:** F13 sırasında kararlaştırılmış common-shell/router kontratı bu kartın girdisidir. F14-01 yedi mevcut ekranın router kararını yeniden keşfetmez; SalonApp sabit alt menüsü o canonical session/business context üzerine eklenir.

## F14-02

**Adisyon modeli ve hizmet satırları**

- **Bağımlılık:** F11-03, F10-02, F12-03.
- **Sorumluluk:** Veri/backend. **Çakışma alanı:** Yeni adisyon modeli ve mali izin sözleşmesi.
- **İş ve çıktı:** Randevu grubundan veya randevusuz adisyon aç; hizmet/personel/müşteri/fiyat snapshot'larını taşı. Açık/kapalı/iptal adisyon ile ödenmemiş/kısmi/ödenmiş bakiyeyi ayır. Fiyat aralığının kesin bedele dönüşümü ve iskonto yetkisini tanımla.
- **Kabul:** Aynı randevudan eşzamanlı tekrar açma tek adisyon döndürür. Tenant composite ilişkiler ve RLS çalışır. Açık adisyonu kimlerin değiştireceği bellidir; kapalı kayıt sessizce değişmez/silinmez. Kesin tutarı belirlenmemiş hizmet tahsilata hazır sayılmaz.
- **Devir:** Durum/izin matrisi, para birimi ve yuvarlama kuralları, API örnekleri, yeni migration/testler. Ürün satırı F15-02'de eklenir.
- **Bağlayıcı sözleşme:** K01 grup/satır kaynak kimliği ve K02 para/fiyat/finalization. F10-02’nin owner tarafından yönetilen açık mali izin kaydı endpoint ve DB’de güncel olarak uygulanır; ikinci izin sistemi kurulmaz. Bu görev paket/prim/promosyon tablolarını erkenden kurmaz; kaynak kimliği ve düzeltme/politika alanlarını korur. Fiyat aralığı sınır dışı kesinleştirmede aktör/gerekçe kaydı zorunludur.
- **Tuzak / immutable ledger:** Adisyon state'i sürümlenebilir; fakat mali olay geçmişi append-only'dir. Kapanmış satır veya mali olay UPDATE/DELETE ile “düzeltilmez”. Düzeltme ters/reversal kaydıyla yapılır ve aktör + gerekçe taşır. Appointment/service snapshot ilişkisi kaynak geçmişini yeniden yazmadan korunur.
- **Tuzak / idempotency:** Randevudan adisyon açma ve sonraki mali command'lar stable idempotency anahtarına sahiptir. Faz 5 `booking_commands` deseninin “aynı anahtar = aynı sonuç, farklı payload = conflict” değişmezi tüketilir; ikinci daha zayıf tekrar-koruma sistemi kurulmaz.

## F14-03

**Manuel tahsilat ve düzeltme**

- **Bağımlılık:** F14-02, F12-03.
- **Sorumluluk:** Veri/backend. **Çakışma alanı:** Tahsilat, bakiye ve mali audit.
- **İş ve çıktı:** Gerçekleşmiş nakit/kart tahsilatı, kısmi/bölünmüş ödeme, kalan bakiye, kapatma ve yetkili düzeltme/iade kaydı ekle. Tutarlar en küçük para birimiyle sunucuda hesaplanır; mali kayıtlar izlenebilir hareketlerle düzeltilir.
- **Kabul:** Aynı tahsilat anahtarının tekrarı ikinci kayıt yaratmaz; farklı içerikle reddedilir. Eşzamanlı tahsilat/iskonto/iade bakiyeyi bozmaz, kalan tutardan fazla ödeme ve tahsil edilenden fazla iade engellenir. Staff varsayılan mali yetki alamaz. Randevu tamamlanması ödeme, iptali otomatik iade sayılmaz.
- **Devir:** Hareket/bakiye örnekleri, kapatma/yeniden açma politikası ve concurrency/tenant/rol testleri. Kart tahsilatını kaydetmek çevrimiçi kart çekimi değildir.
- **v3 mali kabul:** Açık mali izni geri alınan staff’ın açık tahsilat formundan yazımı reddedilir; owner/manager rol ve staff izin örnekleri API/DB’de birlikte test edilir. K02 yuvarlama/dağıtım ve kaynak iade referansı örnekleri geçer. Kısmi tahsilat sonrası fiyat/iskonto ve eşzamanlı kapatma negatif bakiye üretmez; timeout sonrası sonuç aynı anahtarla kurtarılır. İş politikasındaki açık karar kodlamadan önce örnek hesapla yazılır.
- **Tuzak / hareket ayrımı:** Payment, correction ve refund aynı “tutar değişti” alanına sıkıştırılmaz; ayrı event/command türleridir. Her tahsilat/düzeltme/iade idempotent, tenant-bound ve auditlidir. Açık transaction'larda lock sırası kararlı tutulur; eşzamanlı ödeme + düzeltme + iade deadlock/negatif bakiye üretmez.
- **Kritik yol disiplini:** F14-03 birden çok downstream kartı açar. Online payment provider, muhasebe motoru, kampanya veya prim burada erkenden kurulmaz; yalnız manuel tahsilat + düzeltme/iade + bakiye sözleşmesi kapanır.

## F14-04

**Adisyon ve kasa işlem ekranları**

- **Bağımlılık:** F14-01, F14-03.
- **Sorumluluk:** Mobil/işletme arayüzü. **Çakışma alanı:** Adisyon listesi, editör ve tahsilat formu.
- **İş ve çıktı:** Açık/kapalı adisyon listesi; hizmet/personel satırları, toplam/iskonto/bakiye, tahsilat ve işlem geçmişini göster. Randevu detayından ve Yeni menüsünden erişim ver; müşteri geçmişine bağla.
- **Kabul:** 600 TL adisyonda 200 TL nakit + 400 TL kart toplamı 600, kalan 0 gösterir; tekrar gönderimde değişmez. Yetersiz yetki anlaşılırdır; F10-02 izin yönetimi tüketilir, bu ekran kendi başına yetki üretmez. Ağ belirsizliğinde sonucu sorgular; başarısız işlemi ödendi göstermez. Satır/toplamlar sunucu sonucunu izler.
- **Devir:** Referansa yakın alan/işlem düzeni, mobil görüntüler ve F15 ürün/masraf bağlantıları.
- **Tuzak:** UI hesapları gösterir ama mali hakikat kaynağı değildir. Client-side float toplama veya local-only “ödendi” state'i final authority olamaz; network belirsizliğinde idempotent command sonucu backend'den geri okunur.

## F14-05

**Üç kol, mali bütünlük ve PWA kabulü**

- **Bağımlılık:** F14-04, F12-05.
- **Sorumluluk:** QA + frontend/backend. **Çakışma alanı:** Entegrasyon ve mobil uygulama yaşam döngüsü.
- **İş ve çıktı:** Müşteri → panel → KolayApp → adisyon → tahsilat zincirini iki işletmeyle doğrula. Kurulabilir web uygulaması/manifest ve sürüm güncelleme davranışını tamamla; hassas API verisi veya mali yazımlar çevrimdışı kuyruğa/kalıcı önbelleğe alınmaz.
- **Kabul:** Bağlantı kesilmesi, çift tıklama, ikinci cihaz, yetki iptali ve uygulama güncellemesi veri/tahsilat kaybı yaratmaz. Desteklenen mobil tarayıcıda ana ekrana ekleme denenir; native mağaza yayını varsayılmaz. Panel ve KolayApp aynı işlem sonucunu gösterir.
- **Devir:** G14 kanıtı, mobil destek sınırı ve açık F15–16 işleri. Bu ara teslimat tam referans eşdeğerliği sayılmaz.
- **Tuzak / bundle:** Public müşteri yüzeyi, private workspace ve SalonApp/marketing bundle ayrımı F12/F13'te çözülmüş olmalıdır. F14-05 bunu ilk kez keşfeden kart değildir; kabul yalnız route/bundle budget'ın hâlâ korunduğunu doğrular.
