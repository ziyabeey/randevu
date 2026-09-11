# Coding Agent Protocol

## Başlangıç ve kaynak sırası

1. `PROJECT_STATE.md`: main'de gerçekten ne var, aktif faz ve açık eksikler.
2. `PRODUCT_SPEC.md`: üç kolun işlev ve tasarım kuralları; `ROADMAP.md`: ilgili fazın kabul ölçütleri.
3. Yalnız ilgili teknik karar için `DECISIONS.md`; UI işinde `docs/references/README.md` ve ilgili görseller.
4. En küçük uygulama kesiti: ilgili sayfa + Worker + migration + test. Görev veya gerileme gerektirmedikçe eski PR geçmişini tarama.

Kullanıcının açık güncel talebi önceliklidir. Hedef, uygulanan durum ve doğrulanmış sonuç ayrı yazılır. Bir dosyadaki plan veya yeşil SQL testi tüm ürünün çalıştığı anlamına gelmez.

## Ürün kuralları

- Üç kol: **müşteri paneli, randevu paneli, SalonApp**. Tek repo, ortak backend ve ortak işletme/müşteri/randevu verisi kullanılır.
- Müşteri tarafında işlev eşdeğerliği korunarak daha estetik bir deneyim yapılır.
- Randevu paneli ve SalonApp'te referansın menü, alan ve işlem sırası korunur; farklar küçük görsel/ergonomik iyileştirmelerdir. Takvimin yerine başka bir ana deneyim koyma.
- SalonApp alt menüsü: **Randevular / Adisyonlar / Yeni / Müşteriler / Diğer**. İşletme müşteri kayıtları ile halka açık müşteri panelini karıştırma.
- 11 Eylül kararı adisyon, manuel tahsilat ve sınırlı ürün/stok/kasa genişlemesini kapsar. Eski genel ödeme/stok yasağını bu onaylı kapsama uygulama. Çevrimiçi ödeme, muhasebe, e-fatura, bordro, ERP, marketplace ve AI ayrı kapsamdır.
- Çok hizmet/personel, adisyon, tahsilat ve kalan referans işlevleri henüz yapılmadıysa eksik olarak tutulur; sahte veri/buton ile tamamlandı gösterilmez.
- Kullanıcı ekranları Türkçedir; faz, tenant, RPC ve benzeri uygulama ayrıntıları ürün metni değildir.
- Referans görseller yalnız dokümantasyondadır; rakip kimliği ve örnek verileri üretim varlığına dönüştürme.

## Mimari kurallar

- `Business` tenant köküdür. Client business ID veya işletme seçim cookie'si yetki değildir.
- Üye yetkisi Supabase Auth + aktif `Membership` + RLS ile doğrulanır. Worker'a service-role anahtarı ekleme; cross-tenant composite FK/RLS sınırlarını koru.
- Birleştirilmiş migration dosyaları değişmez. Onaylı yeni kapsam ileri migration ve gerileme testleriyle eklenir.
- Zaman işletme IANA timezone'u ve gerçek `timestamptz` anlarıyla hesaplanır. Tamponlar dahil personel çakışmasının son kontrolü PostgreSQL exclusion constraint'idir.
- Oluşturma/taşıma/durum işlemleri tekrar güvenlidir; geçmiş snapshot ve audit korunur. Çok hizmetli işlem yarım kayıt bırakmaz.
- Public rezervasyon opt-in'dir. Anon kullanıcı yalnız dar yetkili RPC'leri kullanır; tenant tablolarına doğrudan erişim verilmez.
- Yönetim bağlantısı `/m#<token>` ve POST body kullanır. Düz token/link loglanmaz veya veritabanına yazılmaz; kurtarma/yeniden gönderim de bu sınırı korur.
- Takvim ve SalonApp mevcut randevuların görünümüdür; ikinci randevu durum/çakışma motoru oluşturma.
- Adisyon ve tahsilat durumu randevu durumundan ayrıdır. Tutarlar sunucuda, tenant/yetki ve tekrar güvenliğiyle yönetilir; kapanmış mali kayıt sessizce değişmez/silinmez.
- Bildirim başarısızlığı randevu sonucunu belirsizleştirmez. Sağlayıcıya ait gönderim kaydına istemci beyanıyla güvenme.

## Branch ve değişiklik protokolü

- Yeni işe güncel main'den kısa ömürlü `phase-<n>-<concern>` veya `codex/<concern>` branch'iyle başla; PR tek faz/alt iş taşısın. Üç ürün kolu üç kalıcı geliştirme branch'i değildir.
- `phase-2-auth-tenant` eski temeldir; güncel main'in auth uygulamasıyla karıştırma. Başka oturumun kaydedilmemiş yerel işini ezme veya doğrudan main'e taşıma.
- Faz 1–8'i sırf yeni UI için yeniden yazma; kanıtlanan hata veya onaylı yeni gereksinim için ilgili kesiti genişlet.
- Eski branch/PR birleştirilirken dokümanları eski ürün sınırına döndürme. Güncel üç kol kararı ve fazların mevcut/planlanan ayrımı korunur.
- PR açıklamasında ürün kolunu, faz/alt işi, davranış değişimini ve doğrulama kanıtını belirt. Faz biterken `PROJECT_STATE.md` ve ilgili referans satırını güncelle.
- Kullanıcının verdiği devam/merge yetkisini uygula; bu belge kendiliğinden yeni bir kullanıcı onay adımı eklemez.

## Zorunlu kontrol

```bash
npm ci
npm run typecheck
npm run build
```

GitHub CI tüm PostgreSQL migration/gerileme testlerini geçmelidir. Kırmızı DB kontrolü atlanarak merge yapılmaz. İlgili fazın HTTP/hata/tarayıcı kabul ölçütleri ayrıca doğrulanır; test kapsamı dışındaki canlı kullanım hazır diye raporlanmaz.

## Dosya haritası

- Takvim: `worker/calendar.ts`, `src/CalendarPage.tsx`, `src/calendar.css`, Faz 8 migration/test.
- Randevu işlemleri: `worker/bookings.ts`, `src/BookingPage.tsx`.
- Müsaitlik: `worker/availability.ts`, `src/AvailabilityPage.tsx`.
- Public rezervasyon: `worker/public-booking.ts`, `src/PublicBookingPage.tsx`.
- Müşteri yönetimi: `worker/customer-manage.ts`, `src/ManageAppointmentPage.tsx`.
- Auth/işletme/katalog: `worker/index.ts`, `src/App.tsx`.
- SalonApp/adisyon/tahsilat: planlandı; henüz varmış gibi dosya/route varsayma.
