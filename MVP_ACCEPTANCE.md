# YZT Randevu — MVP kabul matrisi

Bu dosya plan v3 birleşik release/pilot kabul matrisidir. Bu birleşik sürüm için tüm satırlar **Bekliyor**; tarihsel F09/F10/F17 staging kanıtı ilgili alt davranışları gösterir, yeni modelle ürün kabulünün yerine geçmez. F17-04, M23 hariç satırları; F17-05 gerçek pilot M23’ü tamamlar. G17 bütün matrisi ister. Kapsam [ROADMAP.md](ROADMAP.md), görevler [TASKS.md](TASKS.md), ekran kaynağı [referans matrisi](docs/references/README.md) içindedir.

## Doğrulama ortamı

- Birleşmiş release adayı commit'i, test tarihi ve ortam adresi kaydedilir; farklı branch'lerden alınan başarılı parçalar tek ürün kabulü sayılmaz.
- En az iki ayrı işletme, owner/manager/staff rolleri; iki personel ve çoklu hizmet; sabit/aralık fiyat; mesai/mola/kapanış; örnek müşteri, ürün, paket, promosyon ve masraf verisi hazırlanır.
- Tarayıcı/HTTP/SQL fixture'ları test verisidir. Gerçek Auth ve sağlayıcı doğrulaması test hesap/alıcılarıyla; gerçek işletme verisi yalnız yetkili pilot kapsamında kullanılır.
- 360/390 px mobil, tablet ve masaüstü; en az bir gerçek mobil cihaz ve iki eşzamanlı istemci kullanılır. Uygunluk için Europe/Istanbul yanında DST kullanan bir test saat dilimi eklenir.

## Kabul senaryoları

| Kimlik | Yolculuk / risk | Beklenen sonuç | Görev kaynağı | Durum |
| --- | --- | --- | --- | --- |
| M01 | Kayıt, e-posta doğrulama, giriş, parola kurtarma, çıkış | Geçerli akış tamamlanır; bozuk/süresi dolan link reddedilir; session/Origin/CSRF kontrolleri işler | S01, S02, F10-01, F10-06 | Bekliyor |
| M02 | İşletme kurulum, davet, rol düşürme ve işletme geçişi | Son owner korunur; pasif üyelik erişimi keser; eski işletmenin bekleyen cevabı yeni ekrana sızmaz | F10-02…04, F10-06 | Bekliyor |
| M03 | Salon profili → iki hizmet/farklı personel → uygun saat → özet → kayıt | Süre, sıra, fiyat/aralık ve gerçek atama tutarlıdır; aynı kayıt iki işletme yüzeyine yansır | F11-01/02, F12-01…05 | Bekliyor |
| M04 | Eski tek hizmetli randevu/link ve veri yükseltme | Eski kimlik/link/komut/capability/recovery, snapshot ve audit korunur; pending/leased/sent outbox geçişi yeniden mail veya kayıp yetki yaratmaz | F11-03/04 | Bekliyor |
| M05 | Commit sonrası cevap kaybı, provision hatası ve sayfa yenileme | Aynı sonuç/erişim kurtarılır; ikinci rezervasyon oluşmaz; yanlış kanıt yetki vermez | F09-01/02/05 | Bekliyor |
| M06 | 100 eşzamanlı aynı slot isteği ve çok satırlı çakışma | Tek kazanan; yarım grup yok; tamponlar, bitişik aralıklar, kapanış ve DST sınırları korunur | F11-02/04 | Bekliyor |
| M07 | Grup taşıma/iptal, eski sürüm ve başarısız yeni saat | Başarısız taşıma bütün eski saatleri korur; sürüm çakışması sessiz ezilmez; yetki yalnız ilgili gruptadır | F11-03/04 | Bekliyor |
| M08 | Gün/hafta/liste, hızlı filtre, başka cihazdan rezervasyon | Aynı veri/filtre; eski cevap koruması; görünür takvime en geç 30 saniyede, odağa dönüşte hemen yenilemeyle yansıma | F13-01…04 | Bekliyor |
| M09 | Operatör yeni randevu/kapanış/detay ve tekrarlayan seri | Referans alan sırası korunur; seri çakışmaları önizlenir; ilk seri atomik, geçmiş oluşum korunur | F13-03, F16-01 | Bekliyor |
| M10 | SalonApp alt menü, müşteri arama/geçmiş ve PWA | Aynı işletme/randevu kimlikleri; kurulum/geri gezinme/güncelleme doğru; özel API verisi çevrimdışı sızmaz | F10-05, F14-01/05 | Bekliyor |
| M11 | Randevudan/randevusuz adisyon; 600 TL için 200 nakit + 400 kart | Tek adisyon, 600 tahsilat/0 bakiye; tekrar tıklama çift işlem yaratmaz; randevu durumu ödeme yerine geçmez | F14-02…05 | Bekliyor |
| M12 | Eşzamanlı ödeme/iskonto/iade; izinsiz mali işlem | Bakiye bozulmaz; fazla ödeme/iade reddedilir; düzeltme auditlidir; staff varsayılan mali yetki kazanmaz; owner izni geri alınca açık formdan yazım da reddedilir | F14-03/05 | Bekliyor |
| M13 | Son ürün satışı, iptal/iade ve stok | Stok eksiye düşmez; tekrar satış stok/tahsilatı iki kez etkilemez; fiziksel geri dönüş açıkça kaydedilir | F15-01/02 | Bekliyor |
| M14 | Masraf, gün sonu, nakit/kart ve kalan bakiye raporu | 1.000 tahsilat − 100 iade − 150 masraf = 750 net hareket; tahsil edilmemiş bakiye giriş değildir; gün sınırı doğrudur | F15-03/04 | Bekliyor |
| M15 | Paket son hakkı, kampanya son kullanımı ve fiyat yansıması | Çift tüketim yok; koşullar sunucuda; müşteri özeti/adisyon tutarlı; paket satışı/kullanımı çift gelir sayılmaz | F16-05/06 | Bekliyor |
| M16 | İndirim/paket/kısmi tahsilat/iade sonrası prim raporu | Tanımlı hesapla kaynak hareketler mutabıktır; geçmiş oran/snapshot korunur | F16-07 | Bekliyor |
| M17 | E-posta/SMS, tarayıcı kapalı yeniden deneme, sağlayıcı kesintisi | Randevu sonucu korunur; eski saat mesajı gitmez; kabul/teslim ayrıdır; gerçek alıcıda teslim kanıtı ve tekrar sınırı vardır | S03, F09-03/05, F16-01/02 | Bekliyor |
| M18 | Özel fotoğraf, public salon görseli, yorum/geri bildirim, destek | Özel içerik yetkisiz açılmaz; yayın kararı uygulanır; yorumun kaynağı doğrulanır; destek yolu çalışır | F12-02, F16-03/04 | Bekliyor |
| M19 | Hesap menüsü, dil, gerçek plan/erişim durumu | İşletme/parola/çıkış ortak akışta; dil tercihi uygulanır; plan gerçek kayıttır; müşteri yönetimi erişim davranışı bellidir | F16-08 | Bekliyor |
| M20 | İki tenant, ID tahmini, doğrudan RPC, sahte receipt ve toplu public istek | Yetkisiz okuma/yazma/bağlantı engellenir; Worker atlama yolu kapalı; aşırı istek sınırlanır | S04, S08, F09-04, F10-02/06, F14-05, F17-02 | Bekliyor |
| M21 | Üç kolun görsel/erişilebilirlik karşılaştırması | 11 kaynak ekranın işlevleri eşleşir; müşteri estetiği özgün, işletme sırası tanıdık; klavye/alt menü örtmez; renk tek durum işareti değildir | F12-01/05, F13-04, F14-05, F17-04 | Bekliyor |
| M22 | Ortam/secrets, bağımlılık, migration, yedekten dönüş, sürüm geri alma | Kurulum tekrarlanır; test/production ayrıdır; engelleyici güvenlik açığı yok; DB ve görseller geri yüklenir; geri alma veri kaybetmez | F17-01…04 | Bekliyor |
| M23 | 1–3 işletmeyle bir tam iş günü ve mutabakat | Kurulumdan randevusuz satış/gün sonuna yolculuk tamam; kritik kusur kapalı, destek ve devir kaydı var | F17-05 | Bekliyor |
| M24 | Recovery sırasında hatalı/replay confirmation, marker expiry/tamper/refresh | Recovery yetkisi normal tenant yetkisine yükselmez; gerçek public e-posta/PKCE/parola akışı geçer | S01, S02 | Bekliyor |
| M25 | Feature API'de auth sağlayıcısı 503; Origin/CSRF eksik/yanlış | Geçici arıza oturumu silmez; bütün cookie mutation'lar ortak guard kullanır; public/capability sınırları ayrı çalışır | S02 | Bekliyor |
| M26 | Provider cevabı kayıp; randevu/işletme değişimi; cancel/send yarışı | Aynı anahtar farklı payload taşımaz; eski sürüm için yeni gönderim başlatılmaz; belirsiz dış teslim sınırı kayıtlıdır | S03, F11-03, F16-02 | Bekliyor |
| M27 | Çok sayıda proof'lu tekrar, manage slot/cancel ve direct RPC | Ayrı kaynak kotaları işler, meşru sonuç kurtarma ve idempotency korunur; bypass yok | S04 | Bekliyor |
| M28 | DB secret provisioning sonrası Worker deploy hatası / eşzamanlı run | Eski çalışan sürüm korunur veya tutarlı geri dönüş yapılır; tamamlanan rotasyon eski yetkiyi kapatır | S05 | Bekliyor |
| M29 | Docs-only ve code/migration PR, unutulan test, kırmızı check | Gereken davranış testleri gerçekten koşar; CI tekrarı azalır; required aggregate check test edilen HEAD'de zorunludur | S06 | Bekliyor |
| M30 | Büyük veri/listeler, yavaş RPC, bakım/retention ve timeout sonrası tekrar | K03 bütçeleri ölçülür; kişisel operasyon içeriği zamanında ayıklanır; aktif yetki/idempotency ve mali geçmiş korunur | S07, F11-02/04, F17-03 | Bekliyor |
| M31 | Yeni migration ile table/sequence/function/view ve medya | Explicit grant + RLS/erişim politikası doğru; anon/inactive/cross-tenant negatifleri ve yetkili pozitifler geçer | S08, F12-02, F16-03 | Bekliyor |

## Kanıt kaydı

Her satır için sonuç `Geçti`, `Kaldı` veya `Engelli` olarak güncellenir; sorumlu, release commit'i, ortam/tarayıcı, tarih ve CI/PR/ekran kaydı eklenir. Geçemeyen durumda bug kimliği ve düzeltme/tekrar doğrulama bağlantısı tutulur. `Bekliyor` veya `Engelli` kabul yerine geçmez.

```text
Senaryo:
Release commit / ortam / UTC tarih:
Sorumlu / cihaz-tarayıcı:
Kullanılan anonim test verisi:
Gerçek sonuç / beklenen sonuç:
CI veya PR / ekran / log kanıtı:
Durum / kusur / yeniden doğrulama:
```

Bir kez geçilmiş değişmeyen alanı sebepsiz tekrar tekrar test etmek gerekmez. Release adayı değişikliği ilgili davranışı etkiliyorsa o kabul zinciri ve zorunlu CI yeniden doğrulanır. F17-04 için M23 hariç bütün satırlar geçer; M23 F17-05’te gerçek pilotla kapanır. G17 için tüm satırlar geçer; Ziya'nın gerçek kullanım/tasarım değerlendirmesi ve pilot sonucu kaydedilir. Küçük açık işler MVP sonrası olarak açıkça listelenebilir; onaylı işlevi eksik bırakan madde küçük kozmetik kusur diye kapatılmaz.

## Plan v3 kanıt kapsamı

- Her S görevinin dar kabulü kendi PR'ında tamamlanır. M24–M31, bu kontrolün nihai ürün değişimleriyle bozulmadığını doğrular; aynı davranışı her oturumda baştan test etme şartı değildir.
- F16-01 seri ve F16-02 bildirim ayrı geliştirilebilir; G16/F17-04'te gelecek oluşumları taşıma/iptal ile eski hatırlatmaların durması birlikte test edilir.
- K02 para örneklerine sabit/aralık kesinleştirme, indirim yuvarlama/dağıtımı, paket kullanımı ve prim kaynak mutabakatı dahildir. İş politikası kararları ilgili kartlarda örneklerle tamamlanmadan mali kabul kapatılmaz.
- M30 süre/kapasite rakamlarını ortam ve örnek sayısıyla raporlar; K03 hedefi ölçüm yapılmış gibi sunulmaz. Geçemeyen zorunlu hedef için düzeltme veya gerekçeli açık hedef revizyonu gerekir.
- Plan v3'ün link/görev grafiği/bağımsız inceleme doğrulaması bu kullanıcı senaryolarını Geçti yapmaz.
