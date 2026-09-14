# F12-01 - Görsel yön ve akış sözleşmesi

Durum: **F12-01 tasarım sözleşmesi**  
Sahip: **Ajan B**  
Başlangıç main: `364d0061a3ef1e54c7de89d57678fc2086e42e0a`  
Branch: `f12-01-visual-flow-contract`  
İnceleme: **bağımsız ürün/tasarım incelemesi gerekli**

Bu belge F12-01 için bağlayıcı görsel yönü, ekran/alan eşleştirmesini ve kullanıcı akışını tanımlar. Uygulama kodu, CSS, API, route, migration veya yeni çalışan ekran teslim etmez. Burada tarif edilen bir hedef yüzey, ilgili görev tamamlanmadan ürünün bugün çalışan parçası sayılmaz.

Kaynaklar: [PRODUCT_SPEC](../../PRODUCT_SPEC.md), [Faz 12 kartı](phase-12.md#f12-01), [11 referans ekran eşleştirmesi](../references/README.md) ve [K01-K03 mimari sözleşmeleri](architecture-contracts.md).

## 1. Ürün yönü ve değişmez sınırlar

Ürün üç ayrı kullanım yüzeyi taşır ancak tek ürün dili kullanır:

| Kol | Görsel rol | Değişmez ürün sınırı |
| --- | --- | --- |
| Müşteri paneli | Markayı ve salonu öne çıkaran, sakin, güven veren, mobil öncelikli deneyim | Referanstaki temel rezervasyon işlevleri korunur; estetik sadeleşme işlev eksiltme gerekçesi değildir |
| Randevu paneli | Bilgi yoğun, hızlı taranan, masaüstü/tablet ağırlıklı operasyon yüzeyi | Takvim ana çalışma alanıdır; alan ve işlem sırası referansa yakın kalır |
| SalonApp | Dokunma öncelikli, hızlı işlem yüzeyi | Alt menü sırası `Randevular / Adisyonlar / Yeni / Müşteriler / Diğer` olarak sabittir |

Müşteri paneli rakibin görünüşünü kopyalamaz. Referans ekranlar işlev, alan ve işlem sırası kanıtıdır. Rakip marka, logo, fotoğraf, kişi, tarih ve fiyat örnekleri üretim varlığı veya seed veri olarak kullanılmaz.

Randevu paneli ve SalonApp'te farklılaşma küçük ve ergonomiktir: boşluk, kontrast, ikon tutarlılığı, dokunma alanı, hata metni, kaydetme geri bildirimi ve erişilebilir durum gösterimi. Yeni ana navigasyon veya farklı işlem sırası bu görevde icat edilmez.

## 2. Görsel karakter

### 2.1 Temel yaklaşım

Müşteri panelinin hedef karakteri **sakin premium + açık hiyerarşi + salonu öne çıkaran editoryal sunum**dur. Arayüz dekorasyonu hizmet, saat ve fiyat bilgisinin önüne geçmez. Büyük fotoğraf yalnız gerçek salon varlığı olduğunda kullanılır; gerçek fotoğraf yoksa rakip veya stok salon fotoğrafı kullanılmaz.

İşletme yüzeylerinde aynı dilin daha nötr ve yoğun versiyonu kullanılır. Kart dekorasyonu azaltılır, tablo/takvim ayrımı güçlendirilir ve işlem yoğunluğu müşteri yüzeyinden daha yüksektir.

### 2.2 Tipografi

Tipografi font adına değil semantik role bağlanır. Uygulama aşamasında mevcut güvenli sistem fontu veya ürün sahibinin lisanslı marka fontu kullanılabilir; bu görev yeni font paketi zorunluluğu oluşturmaz.

| Rol | Hedef davranış |
| --- | --- |
| Display / salon adı | 28-32 px mobil, kısa satır, güçlü ama aşırı kalın olmayan ağırlık |
| Ekran başlığı | 22-24 px mobil, 24-28 px geniş yüzey |
| Bölüm başlığı | 18-20 px, hizmet kategorisi ve özet bölümleri |
| Gövde | 15-16 px, en az 1.45 satır yüksekliği |
| Yardımcı bilgi | 13-14 px, yalnız ikincil bilgi için |
| Fiyat / saat vurgusu | Gövde veya bölüm ölçeğinde, tabular rakam desteği tercih edilir |

Tamamı büyük harf yalnız kısa durum etiketi veya çok kısa navigasyon parçasında kullanılabilir. Uzun açıklama ve buton metni büyük harfe çevrilmez.

### 2.3 Renk ve durum dili

Arayüz tek bir ana marka vurgusu, nötr yüzeyler ve bağımsız semantik durum renkleri kullanır. F12-01 belirli bir marka hex değerini ürün sahibinden varlık gelmeden uydurmaz.

- Zemin: açık nötr, içerik kartı ile yeterli ayrım.
- Ana metin: yüksek kontrastlı koyu nötr.
- İkincil metin: kontrast eşiğini koruyan orta nötr.
- Marka vurgusu: ana CTA, seçili durum ve sınırlı vurgu alanlarında.
- Başarı, uyarı, hata ve bilgi: marka renginden bağımsız semantik tonlar.
- Dolu/kapalı/uygun/seçili gibi randevu durumları yalnız renkle anlatılmaz; metin, ikon, desen veya durum etiketi eşlik eder.

Metin kontrastı normal gövdede en az WCAG AA hedefler. Durum farkı renk körlüğünde kaybolmamalıdır.

### 2.4 Boşluk, şekil ve dokunma

- 4 px taban ritmi; yaygın aralıklar 8 / 12 / 16 / 24 / 32 px.
- Müşteri mobilinde yatay sayfa payı varsayılan 16 px; 390 px genişlikte gerekirse 20 px.
- Dokunulabilir hedef en az 44 x 44 px.
- Form alanı ve ana buton yüksekliği yaklaşık 48-52 px hedeflenir.
- Kartlar orta yuvarlak köşeli olabilir; yuvarlaklık bilgi hiyerarşisini zayıflatacak kadar yüksek tutulmaz.
- Chip/pill yalnız kısa filtre, kategori, personel veya durum seçimi için kullanılır.
- Sabit alt CTA, iOS safe-area dahil içerik üzerine binmez; son içerik bloğunda CTA yüksekliği kadar güvenli alt boşluk bulunur.

### 2.5 İkonlar

İkon dili tek aile ve tek stroke karakteri kullanır. 20-24 px temel ölçü tercih edilir. Geri, kapat, paylaş, favori, takvim, saat ve kişi gibi yaygın ikonlar anlamı destekler; belirsiz işletme işlemleri yalnız ikonla bırakılmaz ve metin etiketi alır. Rakibin özel ikon seti kopyalanmaz.

### 2.6 Fotoğraf ve görsel varlıklar

Gerçek salon fotoğrafları içerik, dekor değil. Kahraman görselde okunabilirlik için gerekirse nötr overlay kullanılabilir ancak görsel ağır filtreyle marka rengine boyanmaz.

Gerçek fotoğraf yoksa:

1. nötr yüzey + salon adı/baş harfleri,
2. açık `Fotoğraf henüz eklenmedi` durumu,
3. yerleşimi koruyan sabit oranlı placeholder

kullanılır. Stok veya rakip fotoğrafı gerçek salon içeriği gibi gösterilmez.

## 3. Müşteri rezervasyon akışı

Normatif sıra:

`Salon ve hizmetler -> Tarih / personel / saat -> Özet ve iletişim -> Sonuç -> Yönetim`

Her ileri adım seçimi özetler. Geri dönüşte bağımsız önceki seçimler korunur. Bir önceki değişiklik sonraki seçimi geçersiz kılıyorsa geçersiz seçim sessizce tutulmaz; ilgili adım temizlenir ve neden kısa metinle açıklanır.

### C01 - Salon ve hizmetler

**Amaç:** Müşteri işletmeyi tanır ve bir veya daha fazla hizmet seçer.

**Alanlar:**

- gerçek salon adı ve varsa gerçek kapak/görsel,
- `Hizmetler / Bilgiler / Yorumlar` bilgi mimarisi,
- paylaşım ve favori erişimi,
- kategori başlıkları,
- hizmet adı,
- süre,
- sabit fiyat veya fiyat aralığı,
- seçili hizmet durumu,
- seçili hizmet sayısı,
- seçim özeti ve devam eylemi.

**Varlık ve görev sınırı:** Salon profili/fotoğrafları F12-02, kategori/fiyat aralığı F12-03, gerçek çoklu seçim F11/F12-04, yorum F16-04 kapsamıdır. Bu sözleşme bunları uygulanmış saymaz. İlgili veri/işlev yoksa sahte sekme, yorum sayısı veya örnek fiyat üretilmez.

**Etkileşim:** Hizmet satırının tamamı seçilebilir hedef olur; checkbox/radio benzeri durum işareti metinle birlikte görünür. Seçim özeti mobilde alt sabit bölgede olabilir. En az bir hizmet olmadan ilerleme eylemi pasif kalabilir; pasifliğin nedeni anlaşılır olmalıdır.

### C02 - Tarih, personel ve saat

**Amaç:** Seçilen hizmet planı için gerçek uygunluğu taramak ve bir zaman seçmek.

**Alanlar:**

- geri eylemi ve kısa seçili hizmet özeti,
- `Bugün`, `Yarın` ve tarih gezinmesi,
- işletme saat dilimi bilgisi,
- destekleniyorsa tercih edilen veya uygun personel,
- uygun saatler,
- dolu/kapalı saatlerin seçilemez durumu,
- seçili saat/personel özeti,
- devam eylemi.

Uygunluk sunucu/veri kaynağından gelir; arayüz dolu saati yalnız görsel olarak gri yapmakla yetinmez, seçimi gerçekten engeller. Çok hizmetli planın sıra, personel ve gerçek saatleri K01'deki sunucu planına dayanır. Arayüz kendi başına hizmetleri üst üste bindirmez veya süre hesaplama otoritesi olmaz.

Slot yüklenirken önceki tarih sonuçları yeni tarih için doğruymuş gibi tutulmaz. Hızlı tarih/personel değişiminde eski cevap yeni seçimi ezemez.

### C03 - Özet ve iletişim

**Amaç:** Müşteri göndermeden önce ne talep ettiğini net görür ve gerekli iletişim bilgisini girer.

**Alanlar:**

- tüm seçili hizmetler,
- her satırın destekleniyorsa personeli ve süresi,
- tarih ve başlangıç saati,
- sabit toplam veya `Tahmini toplam` fiyat aralığı,
- ad,
- telefon,
- isteğe bağlı e-posta,
- not,
- gerekli bilgilendirme/onay bağlantıları,
- kampanya kodu yalnız F16-06 gerçek işlevi varsa,
- ana gönderme eylemi.

K02 gereği fiyat aralığının alt sınırı kesin tahsilat gibi gösterilmez. Para ve toplam, yetkili sunucu/veri sonucundan gelir; istemci tarafından hesaplanan örnek toplam gerçek fiyat otoritesi değildir.

Alan hatası üstte genel kırmızı kutuya yığılmak yerine ilgili alanın yanında gösterilir; ilk hatalı alana programatik ilişki ve klavye odağı sağlanır.

### C04 - Randevu sonucu

**Amaç:** Randevu sonucunu bildirim sonucundan ayırarak kesin bir durum göstermek.

**Başarılı durumda:**

- açık `Randevun oluşturuldu` başlığı,
- tarih/saat ve hizmet özeti,
- güvenli yönetim eylemi,
- bildirim durumu ayrı satır,
- gerekirse `E-posta gönderiliyor`, `E-posta gönderilemedi, randevun kaydedildi` gibi booking sonucunu tersine çevirmeyen ifade.

Randevu commit edilmişse e-posta/SMS hatası ekranda `Randevu oluşturulamadı` sonucuna dönüşmez. Refresh veya cevap kaybı sonrasında mevcut recovery davranışı korunur. K01/F09 recovery sözleşmeleri bu görsel sözleşmeden daha yetkilidir.

### C05 - Randevu yönetimi

**Amaç:** Güvenli yönetim bağlantısıyla mevcut randevuyu görüntülemek, desteklenen durumda taşımak veya iptal etmek.

**Alanlar:**

- salon ve randevu özeti,
- tüm hizmet satırları,
- tarih/saat/personel,
- randevu durumu,
- taşıma ve iptal eylemleri,
- bildirim durumu yardımcı bilgi olarak,
- işlem sonucu geri bildirimi.

Yönetim capability'si K01'e göre bütün rezervasyon grubuna aittir. Çoklu kaydı yalnız ilk hizmet gibi gösteren tasarım kabul edilmez. Planlanan çoklu grup modeli uygulanana kadar mevcut tek hizmet davranışı korunur ve yeni grup API'si varmış gibi tüketilmez.

## 4. Akışta geri dönüş ve seçim koruma

| Kullanıcı hareketi | Korunacak | Gerekirse temizlenecek |
| --- | --- | --- |
| C02 -> C01 geri | Salon bağlamı, geçerli hizmet seçimleri | Hizmet değişirse artık geçersiz tarih/saat/personel |
| C03 -> C02 geri | İletişim formundaki girilmiş güvenli alanlar ve hizmet seçimi | Yeni saat/personel seçimi eski özetle çelişiyorsa eski slot |
| C04 sonrası yenileme | Recovery ile doğrulanan booking sonucu | Geçici loading state |
| Yönetimde taşıma | Randevu kimliği/grup ve değişmeyen hizmet bağlamı | Eski slot yeni slot kabul edildiğinde |
| Ağ hatası | Kullanıcının güvenli yerel seçimleri | Sunucuda doğrulanmamış `başarılı` durumu |

Form PII'si URL query/path'e taşınmaz. Yönetim token'ı mevcut güvenli fragment/capability sözleşmesini korur.

## 5. Durum sözlüğü

Bütün üç kol aynı semantik durum dilini kullanır.

| Durum | Görsel davranış | Metin davranışı |
| --- | --- | --- |
| Yükleniyor | Yerleşimi koruyan skeleton veya kısa progress; eski sonucu yeni veri gibi göstermez | Gerektiğinde `Uygun saatler yükleniyor` gibi nesne adıyla |
| Boş | Büyük hata stili kullanılmaz | Neden ve sonraki eylem: `Bu gün için uygun saat yok. Başka tarih seç.` |
| Hata | Hata paneli + tekrar eylemi; form verisini gereksiz silmez | Teknik kod yerine kullanıcı dili; güvenli durumda tekrar önerisi |
| Seçili | Marka vurgusu + ikon/işaret + erişilebilir seçili semantiği | Seçimin adı görünür |
| Pasif | Kontrastı tamamen kaybetmez, tıklanamaz | Mümkünse neden: `Dolu`, `Kapalı`, `En az bir hizmet seç` |
| Başarı | Durum ikonu + başlık + sonuç özeti | Booking ve bildirim sonucu ayrı |
| Uyarı | Ana işi durdurmayan bilgi | Kısa, eyleme dönük metin |

Sonsuz spinner kabul edilmez. Ağ veya timeout aşımı boş sonuç gibi gösterilmez.

## 6. 360 / 390 px müşteri düzeni

### 360 px

- Tek kolon.
- 16 px yatay pay.
- Hizmet satırında ad ana satır; süre ve fiyat ikinci satır veya sağ blok.
- Çok uzun hizmet adı en az iki satıra izin verir; fiyatı gizlemez.
- Alt CTA tam genişlik veya içerik genişliği kadar, safe-area ile ayrılmış.
- Tarih chip'leri yatay kayabilir ancak seçili tarih ekran dışına itilmez.
- Saatler en az 2 kolon; içerik sığmıyorsa 3 kolona zorlanmaz.
- Form açıldığında klavye aktif alanı ve ana eylemi erişilemez bırakmaz.

### 390 px

- Aynı içerik mimarisi korunur; yalnız boşluk ve saat/grid yoğunluğu rahatlar.
- Yeni ikinci navigasyon veya masaüstü benzeri yan panel eklenmez.
- Seçim özeti daha fazla satırı gösterebilir; ana CTA yine görünür hiyerarşide kalır.

Müşteri akışının ana kabul genişlikleri 360 ve 390 px'tir. Daha geniş ekranda içerik sonsuza kadar yayılmaz; okunabilir bir maksimum içerik genişliği kullanılır.

## 7. İşletme yüzeylerinde ortak dil örnekleri

Bu bölüm F13/F14 uygulaması değildir; F12-01'in üç kol için görsel dil sınırıdır.

### Tablet

- Takvim ana içeriktir; salon hero/fotoğraf alanı kullanılmaz.
- Üst araç çubuğunda tarih, `Bugün`, görünüm ve çalışan filtresi gruplanır.
- Dokunma hedefleri 44 px sınırını korur.
- Randevu bloklarında saat, müşteri ve hizmet/personel bilgisi okunur; durum yalnız renge bağlanmaz.
- SalonApp'te `Randevular / Adisyonlar / Yeni / Müşteriler / Diğer` alt menüsü tablet dahil tüm SalonApp yerleşimlerinde sabit sıra ve sabit alt-menü değişmezi olarak korunur; SalonApp masaüstü gerekçesiyle başka bir ana navigasyon kabuğuna taşınmaz. Farklı masaüstü kabuk esnekliği yalnız Randevu paneli bağlamında düşünülebilir ve SalonApp bilgi mimarisini gevşetmez.

### Masaüstü

- İçerik yoğunluğu yükselir; müşteri panelindeki büyük kart/hero oranı taşınmaz.
- Panelde takvim veya liste çalışma yüzeyi sayfanın çoğunu kullanır.
- Formlar mümkünse tek uzun mobil kolon yerine mantıksal iki kolon gruplarına ayrılır; işlem sırası değişmez.
- Durum renkleri, metin stilleri, hata/başarı dili ve form kontrolleri müşteri tarafıyla aynı semantik sözlüğü kullanır.
- Masaüstü kabuk/navigasyon esnekliği bu bölümde yalnız Randevu paneline aittir; SalonApp'in sabit alt menü değişmezi yukarıdaki normatif sırayla korunur.

## 8. 11 referans ekran -> hedef yüzey eşleştirmesi

| Referans | Korunan temel alan/işlev | Hedef yüzey | Bu görevdeki çıktı |
| --- | --- | --- | --- |
| `mobil-online-randevu-1.png` | Salon görseli; Hizmetler/Bilgiler/Yorumlar; kategori; fiyat aralığı; çoklu seçim; seçili sayı; favori/paylaşım | C01 Salon ve hizmetler | Özgün müşteri hiyerarşisi, seçim özeti ve gerçek-varlık kuralı |
| `mobil-online-randevu-2.png` | Bugün/yarın/tarih; uygun/dolu saat | C02 Tarih/personel/saat | Erişilebilir slot dili, timezone ve stale-response sınırı |
| `mobil-online-randevu-3.png` | Hizmet özeti; tarih/saat; kampanya; not; bilgilendirme; talep eylemi | C03 Özet/iletişim | Çoklu özet, tahmini fiyat ve form hata dili; kampanya yalnız F16-06 sonrası |
| `mobil-takvim-gun.png` | Tarih; çalışan filtresi; personel sütunu/renk; saat ekseni; şimdi çizgisi; bloklar; alt menü | Randevu paneli gün + SalonApp Randevular | İşletme yoğunluğu, ortak durum/ikon dili; düzen F13/F14'te uygulanır |
| `mobil-takvim-liste.png` | Aynı filtrede saat sıralı liste; müşteri/hizmet/personel | Panel liste + SalonApp liste | Takvimle aynı veri/durum dili; uygulama F13/F14 |
| `mobil-yeni-randevu.png` | Zaman; müşteri; tekrar; çoklu hizmet/personel; SMS; not; saat kapatma | Panel/SalonApp yeni randevu | Form görsel dili; tekrar/SMS çalışıyor varsayılmaz |
| `mobil-randevu-detay.png` | Detay; Fotoğraf; Ödeme; müşteri; zaman; not; durum; hizmet/ürün | Panel/SalonApp detay | Bölüm, durum ve işlem hiyerarşisi; mali/fotoğraf işlevi sonraki fazlara bağlı |
| `mobil-yeni.png` | Yeni randevu; adisyon; ürün; paket; masraf | SalonApp `Yeni` | Sabit menü ve eylem kartı dili; ilgili işlevler F14-F16 |
| `mobil-diger-1.png` | Destek/online randevu/geri bildirim/fotoğraf; rapor girişleri | SalonApp `Diğer` | Liste/grup/ikon standardı; eksik modül çalışıyor gösterilmez |
| `mobil-diger-2.png` | Salon/mesai/çalışan/hizmet/fiyat/ürün/stok/fotoğraf/promosyon ayarları | SalonApp `Diğer > Kurulum` | Ayar listesi ve bölümleme dili; görev sahipliği F10/F12/F15/F16 |
| `mobil-diger-3.png` | Üyelik; işletme/şube; dil; şifre; çıkış | Ortak hesap menüsü | Hesap menüsü görsel dili; tam davranış F10/F16-08'e bağlı |

Bu tablo alan eşdeğerliğidir, çalışan özellik matrisi değildir. Uygulanmışlık [PROJECT_STATE](../../PROJECT_STATE.md) ve [TASKS](../../TASKS.md) üzerinden ayrıca doğrulanır.

## 9. K01-K03 uyum kuralları

### K01: rezervasyon grubu

- Müşteri açısından çok hizmet tek randevu işlemi olarak görünür.
- Her hizmet satırı özet ve yönetimde kaybolmaz.
- Personel/saat sırası sunucu planından gelir; tasarım kendi paralel planını uydurmaz.
- Create/taşıma/iptal sonucu bütün grup için tek sonuç olarak anlatılır.
- Yönetim yetkisi rastgele ilk hizmete bağlanmış gibi gösterilmez.

### K02: fiyat anlamı

- Sabit fiyat ile fiyat aralığı görsel olarak ayırt edilir.
- Aralık `tahmini` anlam taşır; alt sınır kesin fiyat değildir.
- Çoklu özet toplamı da sabit veya tahmini aralık olarak sunulur.
- İstemci tarafındaki biçimlendirme yetkili mali hesap değildir.
- Promosyon, adisyon veya tahsilat öğesi ilgili görev uygulanmadan müşteri akışında çalışıyor görünmez.

### K03: kaynak ve limitler

- Çok hizmetli akış sınırsız seçim varsaymaz; K03'teki mühendislik limitleri ürün metni ve gerçek uygulama tamamlandığında aynı davranışa bağlanmalıdır.
- Timeout veya kaynak aşımı `uygun saat yok` diye sessizce yutulmaz.
- Sayfalı/limitli işletme listeleri son kayıt gibi gösterilmez; devam davranışı açık olur.
- Fotoğraf yükleme, veri ömrü veya API bütçesi bu sözleşmeyle yeni teknik limit kazanmaz; ilgili görevlerin kabulü esas olur.

## 10. Metin ve formatlama sınırı

F16-08 ileride dil tercihini genişletebilir; F12-01 bugünden ortak Türkçe yüzey dilini tanımlar.

- Kullanıcıya `tenant`, `RPC`, `Faz`, tablo adı, migration veya hata stack'i gösterilmez.
- Eylem butonları fiil kullanır: `Devam et`, `Randevu oluştur`, `Başka saat seç`, `Randevuyu iptal et`.
- Başarı başlığı sonuç söyler, teknik süreç değil.
- Tarih ve saat işletme timezone'u ile gösterilir; timezone verisi yokmuş gibi tahmin edilmez.
- Para biçimi backend/veri para biriminden gelir; sabit `TL` varsayımı teknik kaynağın yerine geçmez.
- Fiyat aralığında `Tahmini` anlamı özet seviyesinde açıkça korunur.
- Telefon/e-posta hata metni neyin düzeltileceğini söyler; yalnız `Geçersiz` denmez.
- Bildirim ve randevu sonucu ayrı cümlelerdir.
- İşletme ekranlarında aynı kavram için müşteri yüzeyinden farklı durum adı icat edilmez.

## 11. Erişilebilirlik ve hareket

- Klavye odağı her etkileşimde görünür.
- Modal/drawer açılıyorsa odağı içine alır ve kapanınca çağıran kontrole döndürür.
- Form label'ları placeholder yerine geçmez.
- Hata metni alanla programatik ilişkilidir.
- Renk dışı durum işareti zorunludur.
- Sistem `prefers-reduced-motion` isteğinde dekoratif hareketi azaltır.
- Akış animasyonu navigasyonu geciktirmez; 150-250 ms kısa geçişler üst sınır yönüdür, teknik zorunluluk değildir.
- Skeleton hareketi yoğun titreşim/flash üretmez.

## 12. Ürün sahibinden gerekli gerçek varlıklar

F12-01'in kabulü için aşağıdaki listenin açık olması yeterlidir; varlıkların hepsinin bu görevde teslim edilmiş olması gerekmez.

### Marka

- YZT/Kepenk veya nihai ürün wordmark/logo kararı; logo yoksa metin wordmark onayı.
- Varsa onaylı ana marka rengi ve kullanılmaması gereken renkler.
- Varsa lisanslı marka fontu; yoksa sistem fontu kullanma onayı.

### Salon içeriği

- Gerçek salon kapak fotoğrafı.
- Galeri için gerçek fotoğraflar ve yayın izni.
- Salon kısa açıklaması.
- Adres/iletişim ve gösterilmesi onaylı bilgiler.
- Hizmet/kategori adları, süre ve fiyatları gerçek veri kaynağından; tasarım için sahte canlı kayıt üretilmez.

### Metin / yasal

- Rezervasyon öncesi gerekli bilgilendirme metni ve bağlantı hedefleri.
- Gizlilik/aydınlatma bağlantısı gerekiyorsa gerçek hedef.
- Destek iletişim kanalı.
- Yorum ve kampanya metni yalnız ilgili F16 işleri gerçek olduğunda.

### Eksik varlık davranışı

Eksik logo/fotoğraf/metin yerleşimi bozmamalıdır. Neutral placeholder açıkça placeholder olarak görünür. Eksik varlık hiçbir zaman gerçek salon içeriği, gerçek kullanıcı yorumu veya gerçek kampanya gibi sunulmaz.

## 13. F12-01 kabul kontrolü

F12-01 tasarım sözleşmesi ancak aşağıdaki maddeler birlikte sağlanırsa kabul adayıdır:

- [x] Üç kolun görsel rolü ve farklılaşma sınırı tanımlandı.
- [x] Müşteri akışı salon/hizmet -> tarih/personel/saat -> özet -> sonuç -> yönetim olarak tanımlandı.
- [x] 360 ve 390 px müşteri davranışı tanımlandı.
- [x] Tablet/masaüstü işletme örnekleri tanımlandı.
- [x] Yükleniyor, boş, hata, seçili, pasif, başarı ve uyarı dili tanımlandı.
- [x] 11 referanstaki her temel alan hedef yüzeye bağlandı.
- [x] Çoklu hizmet, fiyat aralığı, seçili özet ve geri dönüş davranışı görünür sözleşmeye girdi.
- [x] Rakip kimliği/fotoğrafı üretim varlığı olarak reddedildi.
- [x] Ürün sahibinden gereken gerçek logo/fotoğraf/metin listesi çıkarıldı.
- [x] K01-K03 ve üç kol ayrımı korunuyor.
- [x] Planlanan API/route/ekranlar uygulanmış gibi gösterilmiyor.
- [x] F16-08 için ortak metin/formatlama sınırı tanımlandı.
- [ ] Ürün/tasarım bağımsız incelemesi tamamlandı.

Bu belge tamamlandığında dahi çalışan müşteri paneli teslim edilmiş sayılmaz. F12-02, F12-03, F11, F12-04 ve F12-05 kendi bağımlılık ve kabul kanıtlarını ayrıca tamamlar.

## 14. Ürün sahibi geri bildirim kaydı

Bu sürümde ürün sahibinin bağlayıcı girdileri şunlardır:

- müşteri paneli estetik olarak rakipten ayrışacak,
- randevu paneli ve SalonApp işlem disiplini korunacak,
- SalonApp alt menüsü değişmeyecek,
- üç yüzey aynı ürün/backend bağlamını paylaşacak,
- F12-01 teknik uygulamadan ayrı tasarım çalışması olacak,
- gerçek olmayan özellik veya varlık çalışıyor gibi gösterilmeyecek.

Sonraki tasarım incelemesinde görsel ton, marka rengi, wordmark/logo ve gerçek salon varlıkları hakkında yeni ürün sahibi kararı gelirse bu bölüm ve yalnız ilgili görsel tokenlar güncellenir; işlev eşdeğerliği sessizce daraltılmaz.
