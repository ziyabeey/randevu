# Faz 13 — Randevu paneli

**Sonuç:** Salonun takvim odaklı günlük planlama ekranı, referanstaki iş disiplinini korur. **Kapı:** G13. Durumlar [TASKS.md](../../TASKS.md) içindedir.

Okuma başlangıcı: `src/CalendarPage.tsx`, `src/calendar.css`, `worker/calendar.ts`, `src/BookingPage.tsx`, `src/AvailabilityPage.tsx`; gün/liste/yeni randevu/detay referansları. Takvim yeni bir randevu motoru oluşturmaz.

## F13-01

**Takvim güncelliği ve istek yarışı**

- **Bağımlılık:** F11-03.
- **Sorumluluk:** Frontend/backend. **Çakışma alanı:** Takvim veri yükleme katmanı.
- **İş ve çıktı:** Ortak grup/satır projeksiyonu, iptal edilebilir/sürümle korunan istekler, görünür sekmede en geç 30 saniyelik güncelleme ve odağa dönüşte hemen yenilemeyi uygula. Ağ hatasında eski verinin durumu ve yeniden deneme görünür olsun.
- **Kabul:** Başka operatör/public rezervasyon açık takvime süre sınırında yansır. Hızlı tarih/personel/işletme değişiminde eski cevap yeni seçimi ezmez. Gizli sekme gereksiz yoğun istek üretmez; yetki iptali eski kaydı erişilebilir bırakmaz.
- **Devir:** Yenileme/önbellek davranışı, yarış testi ve ölçülen güncellenme süresi.
- **v3 veri erişimi:** S02 auth/HTTP sözleşmesi ve K03 yenileme bütçesi kullanılır. Aynı filtreye tek aktif istek; başarısız yenilemede hızlanan retry döngüsü yoktur. Aktif business değişimi response/çekmece bağlamını geçersiz kılar.

## F13-02

**Gün, hafta ve liste görünümleri**

- **Bağımlılık:** F13-01, F12-01.
- **Sorumluluk:** İşletme arayüzü. **Çakışma alanı:** Takvim bileşenleri/CSS.
- **İş ve çıktı:** Tarih/Bugün/personel filtreleri, personel sütunları/renkleri, saat ekseni/şimdi çizgisi ve saat sıralı listeyi referansa göre düzenle. Grup satırlarının ve çok personelin temsili anlaşılır olsun.
- **Kabul:** Üç görünüm aynı aralık/filtrede aynı kayıtları gösterir; iptal görünürlüğü tutarlıdır. Durum yalnız renk değildir. Çok personel ve uzun müşteri/hizmet adı düzeni bozmaz; işletmenin saat dilimi gün sınırını belirler.
- **Devir:** Gün/hafta/liste karşılaştırmalı görüntüler ve filtre/veri eşitliği kanıtı.

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
