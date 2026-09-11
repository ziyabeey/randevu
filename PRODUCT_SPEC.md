# YZT Randevu — Ürün Kuralları

Karar tarihi: 11 Eylül 2026. Kaynak: ürün sahibinin üç kol kararı ve paylaştığı 11 mobil ekran.

Bu dosya hedef davranışı tanımlar. Uygulanan özellikler için [PROJECT_STATE.md](PROJECT_STATE.md), sıra ve kabul ölçütleri için [ROADMAP.md](ROADMAP.md) esas alınır. Buradaki bir özelliğin listelenmesi, kodda hazır olduğu anlamına gelmez.

## 1. Üç kol, ortak ürün

| Kol | Kullanıcı ve amaç | Deneyim kuralı | Veri kaynağı |
| --- | --- | --- | --- |
| Müşteri paneli | Salonun müşterisi; hizmet seçer, randevu alır ve yönetir | Rakiple işlev eşdeğerliği; daha estetik, anlaşılır ve iyi mobil kullanım | Ortak hizmet, personel, müsaitlik ve randevu motoru |
| Randevu paneli | Salon sahibi, yönetici ve çalışan; günlük işi planlar | Referanstaki takvim disiplini, bilgi yoğunluğu ve işlem sırası korunur; küçük iyileştirmeler yapılır | Aynı randevular, müşteriler ve yetkiler |
| SalonApp | Salon içi mobil kullanım; randevu, adisyon ve tahsilat işlemleri | Referansa yakın menü ve adisyon akışı; küçük görsel/ergonomik farklar | Aynı operasyon çekirdeği; eklenecek adisyon ve tahsilat kayıtları |

- Bunlar üç ayrı veritabanı, müşteri listesi veya randevu motoru değildir. Tek repo ve ortak backend üzerinde ayrı kullanım yüzeyleridir.
- Randevu paneli masaüstü/tablet ağırlıklı, SalonApp mobil işlem ağırlıklıdır. Aynı kullanıcı aynı işletme ve yetkileriyle ikisini de kullanır.
- Müşteri paneli salonun halka açık yüzeyidir; SalonApp içindeki **Müşteriler** sekmesi işletmenin müşteri kayıtlarını yönetir. Bu iki kavram karıştırılmaz.
- `SalonApp` bu projedeki mobil işletme kolunun çalışma adıdır. Üretimde YZT kimliği kullanılır.
- İlk uygulama hedefi ortak web altyapısı üzerinde mobil uyumlu/PWA deneyimidir. Mağaza dağıtımı ve native paketleme ayrı teslimat kararıdır; üç kol kararı tek başına üç ayrı uygulama altyapısı gerektirmez.

## 2. Farklılaşma sınırı

**Asıl estetik farklılaşma müşteri panelindedir.** Güçlü salon sunumu, gerçek fotoğraflar, iyi tipografi, okunaklı fiyat/süre, net adım ilerlemesi ve erişilebilir saat seçimi kullanılır. İşlevler görsel sadelik uğruna kaldırılmaz.

**Randevu paneli ve SalonApp alışılmış iş düzenini korur.** Navigasyon, temel alan sırası, takvim mantığı, durum isimleri ve adisyon işlemleri referansa yakın kalır. Uygun küçük farklar: boşluk/kontrast, ikon tutarlılığı, dokunma alanları, anlaşılır hata metinleri ve kaydetme geri bildirimi. Yeni bir işlem sırası, eksik işlev veya farklı bir ana menü "görsel iyileştirme" diye sunulmaz.

Randevu panelinin ana çalışma ekranı takvimdir. Takvimin yerine tanıtım sayfası veya yalnız özet kartları konulmaz. Müşteri tarafına işletme raporları ve geliştirme terimleri taşınmaz.

## 3. Müşteri paneli sözleşmesi

Temel sıra: **salon ve hizmetler → tarih/saat/personel → özet ve iletişim → randevu sonucu → yönetim**.

| Yüzey | Korunacak işlev | Tasarım yönü |
| --- | --- | --- |
| Salon sayfası | Salon görseli; Hizmetler / Bilgiler / Yorumlar; paylaşım ve favori | Özgün YZT/salon sunumu, net bilgi hiyerarşisi |
| Hizmet seçimi | Kategoriler, fiyat veya fiyat aralığı, süre, birden fazla seçim, seçili hizmet sayısı | Kolay taranan liste/kartlar, görünür seçim özeti ve devam eylemi |
| Tarih ve saat | Bugün/yarın/tarih gezinmesi, uygunluk, tercih edilen veya uygun personel | Renk yanında yazı/ikon; dolu saat seçilemez, saat dilimi açıktır |
| Randevu özeti | Tüm hizmetler/personeller, tarih/saat, toplam veya tahmini bedel, iletişim, not, destekleniyorsa kampanya kodu | Eksikleri yerinde gösteren kısa form, erişilebilir bilgilendirme bağlantıları |
| Sonuç ve yönetim | Başarı durumu, randevu özeti, güvenli yönetim bağlantısı, taşıma/iptal, bildirim durumu | Randevu sonucu ile e-posta/SMS sonucu ayrı görünür |

- Temel rezervasyon ve yönetim için müşteri hesabı zorunlu değildir. Favori ilk sürümde cihazda tutulabilir; cihazlar arası hesap senkronu ayrı kapsamdır.
- Çoklu hizmet seçimi tek bir müşteri işlemi olarak yürür; her hizmetin gerçek süresi, personeli ve doluluk kontrolü vardır. Bunun veri temeli Faz 11'dir.
- Fiyat aralığı tahmini bedel olarak gösterilir; alt sınır kesin tahsilat gibi sunulmaz. Mevcut tek fiyat modelinin genişletilmesi Faz 12'de açıkça uygulanır.
- Salon bilgisi ve fotoğraflar gerçek işletme verisidir. Yorum, promosyon veya SMS altyapısı tamamlanmadan çalışıyor görünen denetimler yayımlanmaz; eşdeğerlik matrisi bunları açık eksik olarak tutar.
- Randevu kaydolduktan sonra bağlantı/mesaj işlemi hata verirse müşteriye "randevu oluşmadı" denmez. Yenileme ve tekrar deneme aynı sonucu kurtarabilmelidir.

## 4. Randevu paneli sözleşmesi

| Yüzey | Korunacak düzen ve davranış |
| --- | --- |
| Takvim | Tarih gezinmesi, Bugün, gün/hafta/liste görünümü, çalışan filtresi, personel sütunları, saat ekseni, güncel saat çizgisi |
| Randevu blokları | Saat, müşteri, hizmet ve personel okunur; personel renkleri görünümler arasında tutarlıdır; durum yalnız renge bağlı değildir |
| Liste | Aynı tarih/personel filtresinin saat sıralı randevuları; takvimle aynı kayıt ve durumlar |
| Yeni randevu | Zaman → müşteri → hizmet/personel satırları → desteklendiğinde tekrar ve hatırlatma → not → oluştur |
| Saat kapatma | Yeni randevu akışına yakın erişim; personel veya salon kapanışının müsaitliğe etkisi görünür |
| Detay | Müşteri, zaman, not, hizmet satırları ve durum işlemleri; sonraki fazlarla Fotoğraf ve Ödeme/Adisyon bölümleri |
| Güncellik | Müşteri rezervasyonu ve diğer operatör işlemleri açık takvime belirlenmiş yenileme süresi içinde yansır; eski cevap son filtreyi ezmez |

Sürükle-bırak zorunlu ilk teslimat değildir; taşıma mevcut güvenli işlemle yapılabilir. Referanstaki görsel çakışmalar mevcut veritabanı çakışma kuralını gevşetme izni değildir. İşlem arası bekleme/kapasite modeli ayrı tanımlanmadıkça personel doluluğu korunur.

## 5. SalonApp sözleşmesi

Alt menü sırası: **Randevular · Adisyonlar · Yeni · Müşteriler · Diğer**. Masaüstü karşılığında aynı adlar ve gruplama korunur.

| Bölüm | İşlevler |
| --- | --- |
| Randevular | Ortak takvim/liste, detay, yeni randevu, saat kapatma |
| Adisyonlar | Açık/kapalı adisyonlar, müşteri, hizmet/personel satırları, ürün satırları, toplam, tahsilat ve işlem geçmişi |
| Yeni | Yeni randevu, yeni adisyon, yeni ürün satışı, yeni paket satışı, yeni masraf |
| Müşteriler | Aynı işletmenin müşteri arama/kayıt/düzenleme ve randevu/adisyon geçmişi |
| Diğer — genel | Destek erişimi, Online Randevu ayarları, müşteri geri bildirimleri, hizmet fotoğrafları |
| Diğer — raporlar | Kasa, çalışan primleri, masraflar, ürün satışları, gelir-gider ve detaylı çalışan raporu |
| Diğer — kurulum | Salon bilgileri, çalışma saatleri, çalışanlar, hizmetler, süreler, fiyatlar, randevu ayarları, ürün/stok, salon fotoğrafları, promosyonlar |
| Hesap menüsü | Üyelik bilgisi, işletme/şube değiştirme, dil tercihi, şifre değiştirme, çıkış |

Bu menü hedefinin bazı bölümleri Faz 15–16'ya bağlıdır. Kapsam takibi gerçek işlev üzerinden yapılır; boş ekran veya çalışmayan buton tamamlanmış özellik sayılmaz.

### Adisyon kuralları

- Randevudan adisyon açılabilir; randevusuz gelen müşteri için bağımsız adisyon da açılabilir.
- Aynı randevudan tekrar açma yeni bir mükerrer adisyon üretmez. Çok hizmetli randevuda tüm ilgili satırlar ve personeller taşınır.
- Randevu durumu ile tahsilat durumu ayrıdır: "tamamlandı" kendiliğinden "ödendi" değildir; "iptal" de kendiliğinden para iadesi değildir.
- Nakit/kart gibi **işletmede gerçekleşmiş tahsilatı kaydetmek** ilk kapsamdır. Karttan çevrimiçi para çekmek veya ödeme kuruluşu entegrasyonu bu kararla uygulanmış sayılmaz.
- Tutarlar sunucuda hesaplanır; fiyat, iskonto, ürün/hizmet ve personel geçmişi korunur. Kısmi/bölünmüş tahsilat ve kalan bakiye açık gösterilir.
- Kapalı adisyon, tahsilat düzeltmesi ve iptal/geri ödeme kaydı yetkili ve izlenebilir işlemdir. Mali kayıt sessizce silinmez.
- İlk mobil sürümde çevrimdışı mali işlem kaydı yapılmaz; bağlantı yoksa işlem tamamlandı gösterilmez.

## 6. Kapsam kararı

11 Eylül 2026 kararıyla **SalonApp, adisyon ve manuel tahsilat** ürünün üçüncü koludur. Referans eşdeğerliği için temel ürün/stok, masraf, kasa raporu, paket/promosyon ve çalışan primi işlevleri sıralı genişleme kapsamına alınmıştır. Önceki genel "ödeme/stok/prim kapsam dışı" ifadeleri bu sınırlı operasyon kapsamı için geçerli değildir.

Tam muhasebe, e-fatura, bordro, karmaşık stok ERP, çevrimiçi ödeme altyapısı, marketplace, pazarlama otomasyonu ve AI ayrı kapsam olmaya devam eder. Menüdeki "üyelik" mevcut hesap/plan bilgisidir; otomatik abonelik tahsilatı eklenmiş sayılmaz.

## 7. Üç kol için ortak kabul

- Müşterinin oluşturduğu aynı kayıt panelde ve SalonApp'te görünür; birinde yapılan yetkili değişiklik diğerlerine yansır.
- Erişim aktif işletme üyeliği ve sunucu/veritabanı yetkisiyle kontrol edilir; arayüzde buton saklamak yetkilendirme değildir.
- Kullanıcı metinleri Türkçedir. `tenant`, `RPC`, `Faz`, `StaffService` gibi uygulama içi terimler müşteri/işletme ekranlarında kullanılmaz.
- Müşteri akışı 360/390 px; işletme ekranları mobil, tablet ve masaüstünde kontrol edilir. Sabit alt eylem/menü içerik veya klavye altında kalmaz; klavye odağı ve renk dışı durum işaretleri vardır.
- Referans ekranlar [görsel eşleştirme dosyasında](docs/references/README.md) saklanır. Rakibin marka/fotoğrafı uygulama varlığı olarak kullanılmaz; örnek isim, fiyat ve tarihler canlı veri yapılmaz.
- Özellik eşdeğerliği ve görsel kalite ayrı kontrol edilir. Tamamlanma, [fazın kabul ölçütleri](ROADMAP.md) ve gerçek doğrulama kanıtıyla kaydedilir.
- Bu üç kollu hedefin MVP kabulü Faz 17 sonundadır. Faz 9–16'daki onaylı referans işlevleri kapsamda kalır; Faz 13/14 ara teslimattır. İnsan/ajanlara devredilecek işler [TASKS.md](TASKS.md), birleşik ürün kabulü [MVP_ACCEPTANCE.md](MVP_ACCEPTANCE.md) içindedir.
