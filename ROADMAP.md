# YZT Randevu — Faz Planı

Güncelleme: 11 Eylül 2026. Ürün hedefi: [müşteri paneli + randevu paneli + SalonApp](PRODUCT_SPEC.md).

Bu belge planı, [PROJECT_STATE.md](PROJECT_STATE.md) uygulanmış durumu tutar. Faz 1–8 numaraları ve birleştirilmiş migration dosyaları korunur. Yeni kapsam geçmiş fazları yeniden numaralandırmaz.

## Durum sözlüğü

| Durum | Anlam |
| --- | --- |
| Main'de | Kod birleştirilmiş; hangi kontrollerin geçtiği ayrıca yazılır |
| PR / kısmi | Çalışma var, fazın tüm kabul ölçütleri tamamlanmamış |
| Planlandı | Hedef kabul edilmiş, işlev henüz uygulanmamış |
| Pilot doğrulandı | Gerçek ortamda ilgili kullanıcı yolculukları doğrulanmış |

Yeşil derleme/SQL testi tek başına tarayıcı, e-posta teslimi veya ticari kullanıma hazır olma kanıtı değildir. Yeni üç kol kapsamına eski %75–80 tahmini taşınmaz. İlerleme, kabul edilen işlevler ve üç kolun ortak yolculukları üzerinden raporlanır.

## Korunan geçmiş

| Faz | Teslim edilen temel | 11 Eylül durumu ve sınırı |
| --- | --- | --- |
| 1 | React/Vite + Cloudflare Worker/Hono | Main'de |
| 2 | Supabase Auth, Business/Membership, RLS | Main'de; davet/üyelik yönetimi ve parola kurtarma henüz tamamlanmış değil |
| 3 | Hizmet, personel, hizmet-personel eşleştirme | Main'de; düzenleme/pasifleştirme arayüzleri eksik |
| 4 | Mesai, kapanış, saat dilimine uygun müsaitlik | Main'de |
| 5 | Tek hizmetli randevu, müşteri, çakışma koruması, tekrar güvenliği, işlem geçmişi | Main'de; çoklu hizmet ve adisyon bu fazın mevcut çıktısı değil |
| 6 | Müşteriye açık rezervasyon | Main'de; yeni estetik/eşdeğerlik hedefi Faz 12 |
| 7 | Güvenli bağlantıyla görüntüleme/taşıma/iptal | Main'de; bağlantı kurtarma ve bildirim güvenilirliği Faz 9'da tamamlanacak |
| 8 | İşletme gün/hafta takvimi | Main'de; liste görünümü ve açık takvim güncelliği Faz 13 |

## Faz 9 — Güvenilir rezervasyon sonucu ve bildirim temeli

**Durum:** `phase-9-email-delivery`, [PR #8](https://github.com/ziyabeey1-ai/randevu/pull/8), taslak/kısmi. Mevcut e-posta çalışması aşağıdaki kabul ölçütleriyle tamamlanır; dokümantasyon değişikliği PR'ı kendiliğinden birleştirmez.

**Bağımlılık:** Faz 5–7. **Kollar:** müşteri + ortak çekirdek.

**İşler:** rezervasyon/yönetim bağlantısı ara hatalarını toparlama; güvenli ve kalıcı yeniden deneme tasarımı; e-posta işini kullanıcı sonucundan ayırma; sağlayıcı zaman aşımı; sunucu tarafından doğrulanmış gönderim kaydı; uygulama ve açık RPC yolunu kapsayan kötüye kullanım kontrolü. Yönetim bağlantısı kurtarma/yenileme tasarımı düz token saklamama kuralını korur.

**Kabul:**

- Rezervasyon kaydolup bağlantı isteği/cevabı kaybolduğunda yenileme ve tekrar deneme aynı randevuyu kurtarır; ikinci kayıt oluşturmaz.
- E-posta sağlayıcısı yavaş/kapalı olsa da müşteri doğru randevu sonucunu ve ulaşılabilir yönetim yolunu görür.
- Başarısız bildirim, tarayıcı kapandıktan sonra belirlenmiş güvenli mekanizmayla yeniden denenebilir; anahtarlar/linkler loga veya düz metin veritabanı alanına yazılmaz.
- İstemci kendi rezervasyon anahtarıyla sahte sağlayıcı gönderim kaydı oluşturamaz; sağlayıcı kabulü ile gerçek teslimat aynı durum olarak adlandırılmaz.
- Yetkisiz/aşırı istekler ve doğrudan RPC çağrıları sınırlandırılır; HTTP/Worker hata testleri ve SQL gerileme testleri geçer.

İptal/taşıma bildirimi ve zamanlanmış hatırlatma için ortak olay temeli hazırlanır; SMS sağlayıcısı ve tekrarlayan randevular Faz 16A'dadır.

## Faz 10 — Hesap, ekip erişimi ve ortak işletme yönetimi

**Bağımlılık:** Faz 9. **Kollar:** randevu paneli + SalonApp ortak temeli.

**İşler:** parola kurtarma/değiştirme; davet, üyelik, rol/aktiflik yönetimi; görünür işletme değiştirme ve ikinci işletme oluşturma; hizmet/personel düzenleme/pasifleştirme; süre/fiyat/tampon düzenleme; ortak oturum/istek yardımcıları; Origin/CSRF ve giriş/çıkış hata davranışı; müşteri arama/düzenleme. Mevcut Business tenant sınırı korunur; şube hiyerarşisi kendiliğinden eklenmez.

**Kabul:** iki gerçek test hesabı davet/rol değişimi/erişim iptalini tamamlar; son owner korunur; parola kurtarma çalışır; işletme değişiminde tüm ekranlar yeni işletmeye geçer; diğer işletmenin kimliğiyle erişim reddedilir; pasif hizmet/personel yeni rezervasyonda seçilemez, geçmiş kaybolmaz. Ortak UI'da geliştirme terimleri bulunmaz.

## Faz 11 — Çok hizmetli randevu temeli

**Bağımlılık:** Faz 10. **Kollar:** üç kolun ortak veri modeli.

**İşler:** aynı müşteri işlemi altında birden çok hizmet/personel satırı; her satırın süre, başlangıç/bitiş, personel, fiyat ve tampon snapshot'ı; tek hizmetli kayıtların geriye uyumu; randevu grubuna bağlı güvenli yönetim kapsamı. Yeni veri yapıları ileri migration ile eklenir.

**Kabul:**

- Saç kesimi + manikür gibi bir seçim aynı veya farklı uygun personele açık sıra/zamanla atanır.
- Grubun tamamı tek işlemde kaydolur; bir satır çakışırsa yarım rezervasyon kalmaz. Aynı personelin doluluk kuralı her satırda işler.
- Tekrar gönderim aynı grubu döndürür. Grup taşıma/iptal atomiktir; satır bazlı istisna uygulanacaksa etkisi ve yetkisi ayrı tanımlanır/test edilir.
- Eski tek hizmetli rezervasyon, bağlantı, takvim ve audit testleri geçer; grup yetkisi başka randevulara genişlemez.

## Faz 12 — Müşteri paneli: estetik ve temel işlev eşdeğerliği

**Bağımlılık:** Faz 9–11. **Referans:** `mobil-online-randevu-1/2/3.png`.

**İşler:** salon profili/bilgileri ve gerçek fotoğraflar; hizmet kategorisi/fiyat aralığı desteği; çoklu seçim ve görünür özet; tarih/personel/saat akışı; iletişim/not ve sonuç ekranı; cihazda favori/paylaşım; güvenli randevu yönetimi. Yorum/promosyon gibi Faz 16 bağımlılıkları açık eksik olarak izlenir.

**Kabul:** hizmetlerden yönetim bağlantısına kadar gerçek API'lerle 360/390 px mobil yolculuk tamamlanır; iki hizmet, son anda dolan saat, boş müsaitlik, bağlantı kesilmesi ve mesaj hatası denenir; toplam/süre/personel bilgisi adımlar arasında tutarlıdır; fotoğraf erişimi işletme sınırlarını korur. Müşteri yüzeyi özgün YZT/salon kimliği taşır; referanstaki temel işlevler kaybolmaz.

## Faz 13 — Randevu paneli: alışılmış takvim disiplini

**Bağımlılık:** Faz 11–12. **Referans:** gün/liste takvimi, yeni randevu ve detay ekranları.

**İşler:** gün/hafta/liste, tarih ve personel filtreleri, tutarlı çalışan renkleri, güncel saat çizgisi; referansa yakın yeni randevu/saat kapatma ve detay düzeni; çoklu hizmet satırları; yenileme ve eski cevap koruması. Tekrar/SMS ve fotoğraf/ödeme bölümleri ilgili sonraki fazlarla bağlanır.

**Kabul:** üç görünüm aynı filtrede aynı kayıtları gösterir; hızlı gezinmede eski yanıt son seçimi ezmez; yeni public rezervasyon açık takvime en geç 30 saniyede, sekmeye dönüşte hemen yapılan yenilemeyle yansır; oluşturma/taşıma/iptal aynı backend kurallarını kullanır. Mobil/tablet/masaüstünde alan ve işlem sırası referansla karşılaştırılır; takvim ana ekran olarak kalır.

## Faz 14 — SalonApp ve adisyon/tahsilat çekirdeği

**Bağımlılık:** Faz 10–13. **Referans:** alt menü, Yeni, randevu detayı ve Diğer.

Bu faz iki küçük PR ile yürütülebilir: **14A** mobil kabuk + adisyon; **14B** tahsilat + mali yetkiler.

**İşler:** Randevular/Adisyonlar/Yeni/Müşteriler/Diğer navigasyonu; aynı oturum/işletme; randevudan veya bağımsız adisyon; hizmet/personel satırları; manuel nakit/kart, kısmi/bölünmüş tahsilat, bakiye ve kapatma; yetkili iskonto/düzeltme/iptal kaydı. Ürün satırları Faz 15'te bağlanır. Native mağaza dağıtımı bu fazın hazır sayılma ölçütü değildir.

**Kabul:**

- Müşterinin çok hizmetli randevusu panel ve SalonApp'te aynı kayıt olarak görünür; tekrar adisyon açma mükerrer kayıt üretmez.
- Hizmet tutarları ve bakiye sunucuda hesaplanır; aynı tahsilat isteğinin tekrarı ikinci tahsilat oluşturmaz; eşzamanlı işlemler bakiyeyi bozmaz.
- Tamamlanan randevu otomatik ödendi sayılmaz. Randevu iptali tahsilatı sessizce silmez; düzeltme ayrı kayıt ve yetki ister.
- Mali izinler API ve DB'de test edilir; iki işletmenin adisyon/tahsilat verileri ayrıdır; fiyat değişikliği geçmişi değiştirmez.
- Mobil alt menü/klavye içerik örtmez; bağlantı kesilince işlem sonucu belirsizse güvenli tekrar/sorgulama yapılır. Çevrimdışı ödeme tamamlandı gösterilmez.

## Faz 15 — Ürün, stok, masraf ve kasa

**Bağımlılık:** Faz 14. **Kollar:** SalonApp + işletme yönetimi.

Küçük teslimatlar: **15A** ürün kataloğu/temel stok hareketi/ürün satışı; **15B** masraf ve kasa/gün sonu/ürün satış/gelir-gider raporları.

**Kabul:** ürün adisyona veya bağımsız satışa eklenir; satış/iptal ile stok hareketi işlem bütünlüğünde ve tekrar güvenli yürür; miktar/eksi stok politikası açık test edilir; masraf ve düzeltmenin aktörü/tarihi korunur. Kasa raporu randevu fiyatlarından değil gerçek tahsilat/düzeltme kayıtlarından hesaplanır; günlük sınır işletme saat dilimidir; rapor toplamları kaynak kayıtlarla mutabıktır. Tam muhasebe/e-fatura/ERP bu faza eklenmez.

## Faz 16 — Referansın kalan operasyon işlevleri

**Bağımlılık:** Faz 12–15. Her alt faz ayrı kapsam ve PR'dır; menü varlığı işlev tamamlanması değildir.

| Alt faz | İşlev | Kabul ölçütü |
| --- | --- | --- |
| 16A | Tekrarlayan randevu, e-posta/SMS hatırlatma, iptal/taşıma bildirimi | Sıklık/adet görünür; seri oluşumunda çakışmalar önizlenir; ilk sürümde seri atomik oluşur, kısmi kayıt bırakılmaz; tek kayıt/gelecek kayıtlar değişikliğinin etkisi açıktır; eski saat için mesaj gitmez, tekrar görev çift mesaj üretmez; gerçek sağlayıcıyla doğrulanır |
| 16B | Hizmet/randevu fotoğrafı, müşteri geri bildirimi/yorumlar, destek erişimi | İşletme ve public görünürlük ayrılır; yetkisiz fotoğraf erişimi engellenir; yorumun kaynak/doğrulama ve yayınlama davranışı bellidir; gerçek geri bildirim müşteri sekmesine yansır; destek kanalı gerçekten erişilebilirdir |
| 16C | Paket satışı/kullanımı ve promosyon | Paket bakiyesi çift kullanımda eksiye düşmez; süre/hizmet/işletme koşulları ve iskonto yetkisi sunucuda doğrulanır; kampanya kodu müşteri özetindeki fiyatla ve adisyonla tutarlıdır; iptalde bakiye etkisi izlenir |
| 16D | Çalışan primleri ve detaylı çalışan raporu | Hesap temeli, oran, hizmet/ürün ve personel payı açık kurallıdır; düzeltmeler rapora yansır; toplam kaynak adisyon/tahsilat kayıtlarıyla doğrulanır; bordro/maaş motoruna genişlemez |
| 16E | Hesap/üyelik bilgisi, dil tercihi ve menü eşdeğerliğinin kapanışı | Şube/işletme değiştirme, parola değiştirme ve çıkış ortak hesap akışını kullanır; desteklenen dil seçimi gerçekten uygulanır; plan bilgisi gerçektir; otomatik abonelik tahsilatı varsayılmaz |

## Faz 17 — Üç kollu pilot ve yayın hazırlığı

**Bağımlılık:** Faz 9–16 kabul ölçütleri. **Durum:** planlandı.

**İşler:** gerçek Supabase/Worker ortamı, gerçek bildirim sağlayıcısı, mobil/masaüstü tarayıcı doğrulaması, bağımlılık güvenlik uyarılarının kapatılması, hata/gönderim izleme, yedekten geri dönüş ve yayın/geri alma prosedürü.

**Kabul:** iki ayrı işletme ve owner/manager/staff test hesaplarıyla müşteri rezervasyonu → takvim → SalonApp → adisyon → tahsilat → rapor zinciri tamamlanır; çoklu hizmet, randevusuz satış, tekrar istek, ağ/sağlayıcı kesintisi, yetki iptali ve eşzamanlı slot/tahsilat durumları denenir. Gerçek mobil cihaz kontrolü ve referans eşleştirmesi yapılır. İşletmeler arası yetkisiz erişim reddedilir. Kritik açıklar kapatılır; 1–3 işletmeyle kontrollü pilot sonucu kaydedilir.

## Ara teslimatlar ve çalışma disiplini

- **Faz 13 sonrası:** müşteri + randevu paneli için dar kapsamlı kullanım denemesi yapılabilir; SalonApp/adisyon ve tam referans eşdeğerliği tamamlandı denmez.
- **Faz 14 sonrası:** üç kolun temel rezervasyon → adisyon → tahsilat zinciri denenebilir; Faz 15–16 açıkları görünür kalır.
- **Faz 17:** üç kol hedefi için pilot doğrulaması. Tarih/süre taahhüdü kabul kanıtı yerine kullanılmaz.
- Her PR tek alt işe, ilgili ürün koluna ve yukarıdaki kabul ölçütüne bağlanır. Mevcut yeşil migration zinciri korunur; kullanıcı tarafından onaylı yeni kapsam ileri migration ile genişletilir.
- Faz bitişinde `PROJECT_STATE.md`, ilgili referans satırı ve kanıt bağlantıları güncellenir. Bir fazın açıklarını sonraki faza sessizce taşıyarak tamamlandı işareti konulmaz.
- Zorunlu mevcut kapı: `npm ci`, `npm run typecheck`, `npm run build` ve GitHub CI'daki tüm PostgreSQL migration/gerileme testleri. Ek HTTP, hata ve tarayıcı testleri ilgili fazın gerçek riskini doğrular.
