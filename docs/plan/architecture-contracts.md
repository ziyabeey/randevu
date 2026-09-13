# Plan v3 — Ortak mimari sözleşmeler

12 Eylül 2026; dayanak `main@3b73bf827346542cd36f5bc6ed32d4d8a0b30cea` ve ürün sahibinin üç kol/MVP kararı. Bu belge **plan revizyonunun tasarım teslimidir**; yeni tablo, API veya limitin uygulandığını söylemez. `K01`, `K02`, `K03` aşağıdaki sözleşmelerdir; TASKS'ta tamamlanacak kod görevleri değildir. Revizyon main'e alındığında bağımlı işlere tasarım girdisi olur; kod kabulü ayrıca gerekir.

## Korunan mimari ve sınır

- Tek React/TypeScript/Vite uygulaması, Cloudflare Worker/Hono backend, Supabase Auth/PostgreSQL ve mevcut HTTP/RPC erişimi korunur. Eski ilk önerideki pg/Hyperdrive geçişi bu revizyonun işi değildir.
- Müşteri paneli, randevu paneli ve SalonApp aynı iş kurallarını kullanır. Modüller sorumluluğa göre ayrılır; yeni framework, mikroservis, ikinci takvim/mali motor veya genel amaçlı eklenti sistemi kurulmaz.
- Auth, business context, API hata eşleme ve istek iptali ortak altyapıdır. Public capability ve sunucu gönderici yetkileri kullanıcı oturumundan farklı, açıkça tanımlı yollardır. Worker service-role taşımaz.
- PostgreSQL transaction, tenant ilişkileri ve exclusion constraint son bütünlük sınırıdır. Dış HTTP, e-posta ve dosya işlemleri DB kilidi tutan transaction içinde beklenmez.
- Mevcut durable outbox geliştirilir. Bu ihtiyacın çözümü için ek kuyruk hizmeti veya olay kaynaklı genel mimari gerekmez.
- Ürün kapsamı Faz 17'ye kadar korunur. MVP sonrası PDF bağımsız kalır, repoya kopyalanmaz. Yeni kullanıcı dostu özellik fikirleri ve görsel yön ayrı ürün çalışmasıdır; bu belge onları icat etmez.

## K01

### Randevu kimliği, grup ve uyum sözleşmesi

**Kaynak ve tüketenler:** Faz 5–9 randevu, `booking_commands`, audit, capability/recovery, bildirim işleri; F11-01…04, F12-04/05, F13, F14 ve F16. Fiziksel yeni adlar F11-01'in dar şema tasarımında mevcut isimlerle eşleştirilir; aşağıdaki anlamlar değişmez.

| Kavram | Tek sorumluluk / sabit kural |
| --- | --- |
| Rezervasyon grubu | `business_id`, müşteri, grup kimliği, durum ve iyimser sürüm; müşterinin tek oluşturma/taşıma/iptal işlemi |
| Hizmet satırı | Değişmeyen satır kimliği, açık sıra, hizmet/personel, gerçek başlangıç/bitiş ve tamponlar, süre ve fiyat snapshot'ı |
| Eski appointment kimliği | Silinmez veya yeniden üretilmez; deterministik olarak tek satırlı gruba eşlenir. Eski FK/audit/komut/bağlantı referansı korunur |
| İşlem anahtarı | İşletme + yetki sahibi/booking oturumu + işlem + anahtar + içerik parmak izi; bütün grup için tek sonuç |
| Yönetim yetkisi | Bir gruba ait dar capability; grup üyeliği DB'de açıkça eşlenir. Rastgele ilk hizmet satırı grubun yetki kökü olmaz |
| Olay / bildirim | Değişmeyen olay kimliği, grup kimliği, olay türü ve grup sürümü; S03'ün içerik/sağlayıcı anahtarı sözleşmesi |
| Mali bağlantı | Randevu grubundan en çok bir adisyon açılması tekrar güvenlidir; mali kayıt randevuyu kopyalamaz |

Başlangıç davranışı ardışık hizmetlerdir. Müşterinin hizmetleri çakışmaz; her personelin tampon dahil doluluğu DB'de korunur. Sıra, gerçek personel ve hesaplanmış saatler sunucunun döndürdüğü tek planı ifade eder. Kaynak/oda/boya bekleme kapasitesi bu sözleşmeyle eklenmez.

Grup create, reschedule ve cancel tek transaction'dır. Çok kaynaklı kilitler aynı kararlı sırada alınır; son satır başarısızsa tamamı geri alınır. Mevcut terminal durum kuralları korunur. Grup sürümü değişiminde koşullu yazım uygulanır. API çakışması ve eski sürüm ayrı makine kodlarıyla döner; istemci yalnız hata metnini ayrıştırmaz.

F11-01 migration tasarımı aşağıdaki eşlemeleri tek tabloda teslim eder:

1. Eski appointment → grup/satır, ilişkili müşteri/personel/hizmet ve snapshot'lar.
2. `booking_commands` içerik parmak izi, sonuç referansı ve eski anahtarın tekrar davranışı.
3. Mevcut audit aktör/zaman/olay bağlantıları; geçmiş yeniden yazılarak yeni olay yaratılmaz.
4. Capability hash'i, `/m#<token>` bağlantısı ve recovery proof/ciphertext/TTL. Eski link ve yenileme sonrası kurtarma yeni token gerektirmeden devam eder.
5. Pending/leased/retry/terminal/sent outbox işleri ve provider receipt'leri. Daha önce gönderilmiş iş yeni grup oluştu diye yeniden gönderilmez; sağlayıcı anahtarı değiştirilmez.
6. Calendar/list/public/manage ve operatör API tüketicileri. Eski tek hizmetli yanıtlar uyumlu kalır; çok satırlı kaydı sessizce ilk satıra indirgeyen adaptör kabul edilmez.

Geçiş **ekle → backfill → doğrula → tüketicileri geçir** biçiminde yapılır. Eski alanı kaldırma ayrı iş ve kanıt gerektirir; bu MVP planı toplu şema temizliği başlatmaz. Aynı migration dosyası geriye dönük değiştirilmez. Eski uygulama sürümüyle uyumluluk testi olmadan yayın sırası veya geri dönüş güvenli sayılmaz.

**Sözleşme kabul örnekleri:** Eski linkle görüntüleme/taşıma; eski create anahtarıyla aynı sonuç; migration öncesinde başlamış recovery; gönderilmiş ve cevabı kayıp provider işi; son satır çakışması; başka gruba ait satır kimliği; eski sürümlü eşzamanlı güncelleme. F11-04 bunları gerçek birleşik zincirde doğrular.

## K02

### Fiyat, adisyon ve mali hareket sözleşmesi

**Önce uygulama:** F12-03 fiyat/kategori veri desteği, F11-01 snapshot migration'ından önce tamamlanır. Bu görev müşteri görsel tasarımını beklemez. F10-04 mevcut sabit fiyat düzenlemeyi tamamlar; F12-03 aynı sözleşmeyi genişletir. F14/F15/F16 aynı para ve kaynak kimliklerini kullanır.

| Kavram | Yetkili veri ve kural |
| --- | --- |
| Katalog fiyatı | Para birimi, `fixed` veya `range`, alt/üst minor-unit tutar. Sabit fiyatta alt = üst; negatif veya alt > üst reddedilir |
| Rezervasyon tahmini | Her satırın fiyat türü, alt/üst, para birimi ve fiyat politika sürümü snapshot'ı; grup alt/üst toplamı sunucuda hesaplanır |
| Kesin hizmet bedeli | Yetkili personelin belirlediği tutar, aktör, zaman ve gerekçe. Tahmini alt sınır kendiliğinden kesin fiyat olmaz |
| Adisyon satırı | Hizmet/ürün/paket kaynak türü, değişmeyen kaynak/satır kimliği, personel, miktar, kesin fiyat ve iskonto snapshot'ı |
| Tahsilat / iade | Adisyon ve kaynak tahsilat referansı, yöntem, minor-unit tutar, aktör ve zaman; eklenen karşı hareketle düzeltilir |
| Paket hakkı | Para değildir; satış satırı ve müşteri/hizmet hakkıyla ilişkili ayrı kullanım/geri alma hareketidir |
| Promosyon | Koşul ve politika sürümü, uygulanan tutar, rezervasyon/kullanım kimliği; istemci indirim tutarı yetkili kaynak değildir |
| Prim | Kaynak hizmet/ürün satırı ve mali hareketler, tarihli oran/hesap temeli; kasa tahsilatından bağımsız rapor projeksiyonu |

Mali izinlerin tek sahibi F10-02’nin owner tarafından yönetilen grant/revoke kaydıdır. F14/F15 güncel rol + açık izin kararını endpoint ve DB seviyesinde uygular. İzin iptali açık formun sonraki yazımını reddeder; yalnız arayüzde buton gizlemek yeterli değildir.

Tüm tutarlar integer minor unit + aynı para birimidir; JS kayan noktalı ara toplam finansal doğruluk kaynağı olmaz. Yüzdelik oranlar tam sayı baz puanla temsil edilir; negatif olmayan tutarda yarım ve üstü yukarı yuvarlanır. Toplam indirim satırlara dağıtılıyorsa en büyük kalan yöntemi, eşitlikte kararlı satır sırası kullanılır; dağıtılan toplam tam eşit olmalıdır. Para birimi dönüşümü bu kapsamda yoktur.

Kesin fiyatın tahmini aralığın dışına çıkması sessizce olmaz; yetki, fark/gerekçe ve kullanıcıya gösterilecek sonuç açıkça kayıtlıdır. Mali işlem öncesi adisyon fiyatları kesinleşmiş olmalıdır. Tahsilat başladıktan sonraki fiyat/iskonto değişimi mevcut net tahsilatı aşan olumsuz bakiye yaratamaz; gerekli iade veya düzeltme aynı doğrulanmış işlem düzeninde yapılır.

Randevu, adisyon ve ödeme durumları ayrıdır. Adisyon açık/kapalı/iptal durumunu taşır; ödenmemiş/kısmi/ödenmiş durumu mali hareketlerden hesaplanır. Kapalı adisyonun orijinal satırı/ödemesi sessizce değiştirilmez. Düzeltilmiş sonuç orijinale referans veren auditli hareketlerden üretilir. İlk uygulamanın hangi yetkili düzeltme ekranını sunduğu F14-03'te somutlaştırılır; genel muhasebe defteri veya fatura sistemi kurulmaz.

**Zorunlu örnekler:**

- 200–300 TL hizmet + sabit 400 TL hizmet → 600–700 TL tahmin. İlk hizmet 250 TL kesinleşirse 650 TL bedel; eski rezervasyon katalogdaki sonraki değişimden etkilenmez.
- 600 TL adisyona 200 nakit + 400 manuel kart → 600 net tahsilat, 0 bakiye. Aynı anahtarla tekrar yeni ödeme değildir.
- 100 TL iade kaynak tahsilata bağlanır; tekrar anahtarıyla ikinci iade oluşmaz. Randevu iptali tek başına iade oluşturmaz.
- Paket satışı tahsilat doğurabilir; hizmette hak kullanımı yeni para girişi değildir. İki işlem son hakkı birlikte tüketemez.
- F16 promosyon/prim hesabı müşteri özeti, adisyon ve raporda aynı kaynak/snapshot'ı kullanır. Yüzde, paket iade koşulu ve prim hak kazanma temeli ürün politikasıdır: ilgili kartta Ziya'nın örnekleriyle karara bağlanır; bu teknik belge bunları uydurmaz. Oran/politika geçmişe sessizce uygulanmaz.

F14'te paket/promosyon/prim tabloları peşinen kurulmaz. Kaynak kimliği, para birimi, düzeltme bağlantısı ve politika sürümü korunarak F16'da dar modüller eklenir. F16-05…07 kartları uygulama başlamadan örnek hesaplarını ve belirsiz ürün kararını kaydeder; belirsizlik yalnız ilgili işi durdurur.

## K03

### Kaynak kullanımı, veri ömrü ve işletim sözleşmesi

Bu değerler **başlangıç mühendislik bütçeleridir**, ölçülmüş performans veya sağlayıcı fiyatı iddiası değildir. S04/S07 sınırları uygular ve ölçer; değişiklik somut ölçümle belgelenir. Meşru kullanıcıya sessiz veri eksiltmek yerine sayfalama/devam veya anlaşılır limit sonucu verilir.

| Alan | Başlangıç sınırı / kabul |
| --- | --- |
| Liste sorguları | Varsayılan 25, en fazla 100 kayıt/sayfa; kararlı sıralama ve sayfalama. Takvim tarih/personel aralığıyla sorgulanır; dolu takvim sessizce kırpılmaz |
| Takvim yenileme | Görünür ekranda en geç 30 sn; focus sonrası tek yenileme. Aynı filtre için tek aktif istek; gizli sekmede polling durur |
| Çok hizmetli slot | En fazla 10 hizmet/grup, tek tarih sorgusu; sınırsız personel kombinasyonu taranmaz. F11-02 zaman/aday bütçesini ölçer, aşım boş müsaitlik gibi raporlanmaz |
| Seri oluşturma | Başlangıç en fazla 12 oluşum, atomik; F16-01 yük ölçümüyle doğrular. Sınır API ve ekranda aynı |
| Dış istek | Süre sınırı zorunlu. Auth/veri HTTP için başlangıç 10 sn; sağlayıcı mevcut 10 sn. Yazım timeout'u başarısız commit varsayılmaz; aynı anahtar/sonuç kurtarma kullanılır |
| Bildirim | Mevcut 8 deneme/72 saat üst sınırı genişletilmez; lease 45 sn, batch 10 tabanı ölçülür. DB/RPC süreleri dahil sahiplik süresi aşımı test edilir |
| Public/hesap kotası | Read, slot, create, güvenli tekrar, recovery, manage ve işletme oluşturma ayrı ölçülür. S04 mevcut limitleri envantere alır; yeni sayısal actor/network/business sınırlarını saldırı ve ortak ağ testleriyle sabitler |
| Görsel yükleme | İlk hedef en fazla 5 MB/girdi, 20 public görsel/işletme ve 10 özel görsel/randevu; dosya türü/içeriği sunucuda doğrulanır, public görseller uygun boyuta indirilir. F12-02/F16-03 uygular; storage toplamı izlenir |

HTTP timeout, DB işinin kesin iptal edildiği anlamına gelmez. Slot/read RPC'leri için DB tarafında da sınır ve ölçülmüş sorgu planı gerekir. Mevcut API'yi bozan limit adaptasyonu açıkça sözleşme/teste işlenir; geçmiş kayıt gizlenmez. Geniş veri üzerinde N+1, limitsiz liste veya gereksiz indeks eklenmez; sorgu ölçümü gerekçeyi gösterir.

S07'nin [v2 sonuç kesinleştirme sözleşmesi](s07-recovery-resolution.md) genel Auth/veri HTTP sınırından önce uygulanır: generic recovery 404 yokluk kanıtı değildir; mevcut commit doğrulanır veya aynı işlemin geç yazımı kilit altında kapatılır. Yeni kapanış satırları PII/sır içermez ve ilk yazım deadline'ı geçince sınırlı batch ile temizlenir. Komut/recovery sonuç referansı randevu yaşarken korunur. Tarayıcıda 72 saatlik proof ile süre aşımı sonrası sırsız belirsizlik işaretinin ayrımı bu ekte tanımlıdır; tek başına doküman runtime kabulü değildir.

### Saklama ve temizleme

| Veri | Başlangıç teknik politikası | Uygulama / kanıt |
| --- | --- | --- |
| Rate counter | Mevcut 48 saatlik eskime ve en çok 500 satırlık prune korunur | S04/S07; uzun süre iş yokken de sınırlı bakım |
| Recovery sırları | Mevcut recovery TTL ve aktif gönderim ihtiyacı sona erince temizlenir; S03 retry ve belirsiz teslim politikasıyla uyumlu | S07; aktif recovery/gönderim yetkisi erken silinmez |
| Terminal bildirim alıcısı/içeriği | Terminal olduktan 30 gün sonra PII temizlenir; olay/provider kimliği, içerik hash'i ve sonuç gibi asgari tekrar/denetim izi korunur | S07; token/full link hiçbir aşamada düz saklanmaz |
| Operasyon logları | Uygulama tarafından yönetilen hata/istek loglarında 14 günlük hedef; PII/token maskeleme. Sağlayıcıdaki gerçek saklama ayrıca envanterlenir | S07 temel ölçüm, F17-03 yayın teyidi |
| Idempotency/audit | Randevu/mali kayıt yaşarken tekrarı önleyen anahtar/fingerprint/sonuç referansı korunur; gereksiz kişisel request/response kopyası 30 gün sonra ayıklanır | S07 uygulanabilirlik ve replay testi; sırf maliyet için tekrar koruması silinmez |
| Müşteri/randevu/mali kayıt ve fotoğraf | Bu revizyon otomatik silme süresi belirlemez. İşletme saklama/silme gereksinimi ve ilişki etkisi F17-03'te, gerçek pilot öncesinde karara bağlanır | F17-03 + F12-02/F16-03; mali/audit veri sessizce silinmez |

Bakım küçük batch, kararlı checkpoint ve süre sınırıyla çalışır. Bakım RPC'si takılırsa dispatcher sınırsız beklemez. Kişisel içeriği ayıklanmış provider retry'nin yeniden gönderim yaratmaması ve aktif lease'in temizlenmemesi test edilir.

### Ölçüm, maliyet ve yayın

- Başlangıç yük verisi: en az 2 işletme, işletme başına 10 personel/50 hizmet/10.000 tarihsel randevu; ölçümde fixture, sürüm, ortam ve örnek sayısı yazılır. 100 aynı slot yarışı ayrı bütünlük testidir.
- İlk p95 hedefi tarih aralıklı okumalarda 750 ms, randevu yazımında 1.500 ms; dış e-posta süresi bunun dışındadır. Hedef aşımı sorgu/indeks/istek sayısı incelemesini tetikler; test ortamının ağ etkisi belirtilir, otomatik yeni altyapı satın alınmaz.
- S07 en az API/DB hata oranı, sorgu/istek sayısı, outbox yaşı/deneme, 429, storage büyümesi ve CI süresini kaydeder. F17-03 bunların eşik/uyarı/sorumlusunu ve yedek geri yükleme hedefini bağlar.
- Aylık altyapı maliyeti, başarılı rezervasyon başına istek/DB işi, mesaj başına sağlayıcı ücreti ve görsel saklama/çıkış ayrı hesaplanır. Güncel fiyatlar ölçüm tarihinde resmi kaynaktan doğrulanır; burada fiyat uydurulmaz. Bütçe alarmı mevcut randevu yönetimini veya gerçekleşmiş ödeme kaydını kapatmaz; yeni ücretli kanal/gönderim yükünü sınırlayabilir.
- Gelecekteki her tablo/sequence/fonksiyon/view için explicit grant ve RLS/API erişim kabulü gerekir; bu yeni nesne kapısı S08'de uygulanır. Yalnız mevcut tabloların yeşil testi yeterli değildir.

## Karar değişikliği kuralı

Uygulayıcı bu sözleşmeyle çelişen mevcut durum bulursa kanıt, en dar seçenek ve etkilenen görevleri koordinatöre iletir. Ortak sözleşme sessizce değiştirilmez. Yeni modül/dış servis ancak ölçülmüş ihtiyaç, bakım/maliyet ve veri geçişi etkisi yazıldıktan sonra değerlendirilir. Kullanıcının mevcut yetkisi geçerlidir; bu kayıt yeni bir genel onay kapısı oluşturmaz.
