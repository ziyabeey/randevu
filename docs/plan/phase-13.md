# Faz 13 — Randevu paneli

**Sonuç:** Salonun takvim odaklı günlük planlama ekranı, referanstaki iş disiplinini korur. **Kapı:** G13. Durumlar [TASKS.md](../../TASKS.md) içindedir.

Okuma başlangıcı: `src/CalendarPage.tsx`, `src/calendar.css`, `worker/calendar.ts`, `src/BookingPage.tsx`, `src/AvailabilityPage.tsx`; gün/liste/yeni randevu/detay referansları. Takvim yeni bir randevu motoru oluşturmaz.

**Faz direktifi / kaynak head `5e789ad`:** Calendar hot-path ve router/shell kararları bu fazın performans/kapsam riskidir. Aşağıdaki mevcut-hop ve RPC imzası gözlemleri kart açılırken current main'de yeniden ölçülür; head etiketi olmadan ileri taşınmaz.

## F13-01

**Takvim güncelliği ve istek yarışı**

- **Bağımlılık:** F11-03.
- **Sorumluluk:** Frontend/backend. **Çakışma alanı:** Takvim veri yükleme katmanı.
- **İş ve çıktı:** Ortak grup/satır projeksiyonu, iptal edilebilir/sürümle korunan istekler, görünür sekmede en geç 30 saniyelik güncelleme ve odağa dönüşte hemen yenilemeyi uygula. Ağ hatasında eski verinin durumu ve yeniden deneme görünür olsun.
- **Kabul:** Başka operatör/public rezervasyon açık takvime süre sınırında yansır. Hızlı tarih/personel/işletme değişiminde eski cevap yeni seçimi ezmez. Gizli sekme gereksiz yoğun istek üretmez; yetki iptali eski kaydı erişilebilir bırakmaz.
- **Devir:** Yenileme/önbellek davranışı, yarış testi ve ölçülen güncellenme süresi.
- **v3 veri erişimi:** S02 auth/HTTP sözleşmesi ve K03 yenileme bütçesi kullanılır. Aynı filtreye tek aktif istek; başarısız yenilemede hızlanan retry döngüsü yoktur. Aktif business değişimi response/çekmece bağlamını geçersiz kılar.
- **S07 carry-forward / mutable key:** Dışarıdan eşzamanlı sıralama-anahtarı mutasyonu yoksa `(timestamp,id)` keyset continuation sayfalar arasında skip/repeat üretmeden ilerler. Takvim/listede mutable risk `appointments.starts_at` kolonudur; sayfalar arasında `starts_at` değişirse continuation skip veya repeat üretebilir ve snapshot-consistency garantisi yoktur. `created_at` bu mutable-key riskinin parçası değildir. F13-01 gerçek eşzamanlı yazar + stale continuation yarışını sahiplenir ve kanıtlar. Bu özel yarış C4 rollback paketine geri taşınmaz; C4 bu dblink commit testinin sahibi değildir.
- **Hazır olan:** K03 görünür sekme ≤30 sn, gizli sekmede polling yok, odakta tek yenileme, aynı filtreye tek aktif istek, hızlanan retry yok ve 10 sn HTTP timeout sınırları yeniden tasarlanmaz. F12-04 ile aynı stale-request/generation primitive'i kullanılır.
- **Tuzak / hot-path hop budget:** `5e789ad` gözleminde calendar request zinciri `auth/v1/user → rest/v1/memberships → businesses + staff_profiles (paralel) → rpc/get_calendar_appointments` şeklinde dört ağ aşaması taşır. 30 saniyelik polling bu maliyeti tekrarlar. Kart açılırken network waterfall yeniden ölçülür ve hop azaltma kararı burada alınır; F17-03'e kadar görünmez borç olarak ertelenmez. Adaylar güvenlik sınırını bozmadan değerlendirilir: Worker'da doğrulanabilir JWT doğrulama, üyelik bilgisinin güvenli cache/claim stratejisi veya business+staff+appointments birleşik bounded RPC. Bunlar peşinen çözüm değildir; ölçüm + R1 authority sınırıyla seçilir.

## F13-02

**Gün, hafta ve liste görünümleri**

- **Bağımlılık:** F13-01, F12-01.
- **Sorumluluk:** İşletme arayüzü. **Çakışma alanı:** Takvim bileşenleri/CSS.
- **İş ve çıktı:** Tarih/Bugün/personel filtreleri, personel sütunları/renkleri, saat ekseni/şimdi çizgisi ve saat sıralı listeyi referansa göre düzenle. Grup satırlarının ve çok personelin temsili anlaşılır olsun.
- **Kabul:** Üç görünüm aynı aralık/filtrede aynı kayıtları gösterir; iptal görünürlüğü tutarlıdır. Durum yalnız renk değildir. Çok personel ve uzun müşteri/hizmet adı düzeni bozmaz; işletmenin saat dilimi gün sınırını belirler.
- **Devir:** Gün/hafta/liste karşılaştırmalı görüntüler ve filtre/veri eşitliği kanıtı.
- **S07 carry-forward / date-range:** Gün, hafta ve liste görünümünün tarih aralığı filtre sözleşmesi mutable-key yarışından ayrı bir bulgudur. F13-02 başlangıç/bitiş dahil-hariç sınırını, işletme timezone gün sınırını ve üç görünümün aynı range için aynı kayıt kümesini kullandığını açıkça tanımlar ve test eder. Bu madde `starts_at` continuation yarışının yerine geçmez; iki risk ayrı kapanır.
- **Tuzak / mevcut pagination gözlemi:** `5e789ad` üzerinde `list_appointments_page(uuid, integer, timestamptz, uuid)` date-range parametresi taşımıyordu ve `starts_at` artan traversal en eski kayıtlardan başlayabiliyordu. Current main'de aynıysa tarih aralığı ileri migration/API kontratıyla eklenir; UI tarafında sonsuz geçmişi tarayarak taklit edilmez. Mutable `starts_at` skip/repeat için gerçek concurrency testi PG lane'inde `dblink` tabanlıdır; staging allowlist'e zorla sokulmaz.
- **Ortak gün sınırı:** İşletmenin timezone'u gün/hafta/listenin sınır otoritesidir. F15-04 gün sonu aynı tanımı tüketir; ikinci “iş günü” hesabı yazılmaz.

## F13-03

**Randevu oluşturma, kapanış ve detay**

- **Bağımlılık:** F13-02, F11-03, F10-05.
- **Sorumluluk:** İşletme arayüzü + backend adaptasyonu. **Çakışma alanı:** Booking editörü, detay çekmecesi ve saat kapatma.
- **İş ve çıktı:** Zaman → müşteri → hizmet/personel satırları → not → oluştur sırasını uygula. Saat kapatmaya yakın erişim; taşıma, iptal, gelmedi/tamamlandı ve sürüm çakışması mesajlarını ekle. Sonraki tekrar/SMS, Fotoğraf ve Adisyon bölümlerinin bağlantı noktalarını koru.
- **Kabul:** Oluşturma/taşıma/iptal mevcut güvenli backend'i kullanır. Çakışan grup yarım kaydolmaz; başarısız taşıma eski saatleri korur. Bekleyen form/çift tıklama mükerrer kayıt üretmez. Müşteri değişimi yanlış geçmişe bağlanmaz.
- **Devir:** Editör alan sırası, durum geçişleri ve HTTP/tarayıcı hata senaryoları; gelecekteki tab içerikleri hazırmış gibi yayımlanmaz.

## F13-04

**İşletme navigasyonu ve kullanım kabulü**

- **Bağımlılık:** F13-03, F10-06, F12-05.
- **Sorumluluk:** Frontend + QA + ürün sahibi. **Çakışma alanı:** Ortak işletme kabuğu ve navigasyon.
- **İş ve çıktı:** Takvimi ana çalışma ekranı yap; müşteriler, hizmetler, ekip ve ayarlara tutarlı erişim ver. Masaüstü/tablet paneli ve mobil gündem davranışını tamamla; mevcut yolları çalışır tut. SalonApp aynı kabuğun oturum/işletme bağlamını kullanabilsin.
- **Kabul:** Gerçek müşteri rezervasyonu panelde görünür ve panelden değişiklik müşteri yönetimine yansır. Dar ekran, klavye, uzun liste ve sekme geçişi denenir. Referansın işlem sırası korunur; gereksiz tanıtım/özet ekranı takvimin yerine geçmez.
- **Devir:** G13 kullanım kanıtı ve ortak kabuk sözleşmesi. İki kollu deneme mümkündür; üç kollu MVP kabulü Faz 17'dedir.
- **Tuzak / router timing:** Ortak router/shell kararı F13-04 implementation'ına bırakılmaz. E'nin read-only common-shell contract'ı ve MKT `/`→marketing, `/app`→workspace URL migration kararı F13-02/F13-03 implementation'ı başlamadan tüketilir. `src/main.tsx` pathname ternary zincirine yedi ekran daha ekleyip sonra toplu refactor yapılmaz. F13-04 karar üretmekten çok önceden kararlaştırılmış shell'i kullanım kabulüne götürür.
