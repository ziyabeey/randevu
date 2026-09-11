# YZT Randevu — teknik kararlar

## Faz 2 güvenlik sözleşmesi

Faz 2 yeniden tasarlanmaz. `Business` tenant köküdür; kimlik Supabase Auth tarafından sağlanır; `Membership` kullanıcının tenant içindeki güncel rolünü ve aktifliğini belirler. İstemcinin gönderdiği işletme kimliği yetki değildir. Her tenant isteği güncel membership kaydıyla ve PostgreSQL RLS ile yeniden doğrulanır. Service-role anahtarı uygulama Worker'ında kullanılmaz.

Tarayıcıdaki aktif işletme seçimi yalnızca kullanıcı tercihi taşıyan HttpOnly cookie'dir. Yetki kaynağı değildir. Üyelik pasifleştirildiğinde aynı oturumun sonraki isteği tenant erişimini kaybeder.

## Faz 3 — hizmet ve ekip

- `services`: tenant hizmeti, süre, buffer, fiyat ve aktiflik.
- `staff_profiles`: randevu atanabilir personel.
- `staff_services`: hangi personelin hangi hizmeti verebildiği.

Bütün ilişkiler tenant kimliği taşır. Staff-Service bağlantısındaki birleşik foreign key farklı işletmelerin kayıtlarının birbirine bağlanmasını engeller. Owner/manager katalog mutasyonu yapabilir; staff katalog için read-only'dir.

## Faz 4 — müsaitlik

Müsaitlik üç veri katmanıyla modellenir:

- `business_hours`: işletmenin haftalık açık pencereleri.
- `staff_hours`: personelin haftalık çalışma pencereleri.
- `availability_blocks`: tarih bazlı işletme geneli veya personel özelinde kapalı gerçek zaman aralıkları.

Haftalık mola ayrı tablo değildir. Aynı günün açık saatlerini iki aralığa bölmek molayı doğal olarak oluşturur. Schedule değişiklikleri `replace_business_hours` ve `replace_staff_hours` RPC'leriyle bir gün için atomik değiştirilir.

Slot hesabı işletme/personel pencerelerini kesiştirir; hizmet `buffer_before + duration + buffer_after` toplamının tamamı bu pencereye sığmalıdır. Pencereler işletmenin IANA timezone'u ile `timestamptz` anlarına dönüştürülür ve slot grid'i gerçek timeline üzerinde üretilir. Spring-forward'da var olmayan yerel saat üretilmez; fall-back'de tekrarlanan saat iki farklı gerçek instant olarak korunur.

## Faz 5 — booking çekirdeği

### Appointment snapshot modeli

Appointment yalnız foreign key taşımaz. Oluşturma anındaki müşteri adı/iletişim, hizmet adı, personel adı, süre, buffer, fiyat, para birimi ve timezone ayrıca snapshot olarak saklanır. Sonradan hizmet fiyatı veya personel adı değişse bile tarihsel randevu kaydı semantiğini kaybetmez.

`starts_at` ve `ends_at` müşterinin gördüğü hizmet süresidir. `occupied_starts_at` ve `occupied_ends_at` ise buffer'lar dahil personelin gerçekten kilitlendiği aralıktır.

### Concurrency son sınırı PostgreSQL'dir

Availability kontrolü UX için yapılır fakat rezervasyon doğruluğunun tek dayanağı değildir. İki istemci aynı slotu aynı anda boş görebilir. Bu nedenle `appointments` üzerinde `btree_gist` ile şu invariant DB seviyesinde tutulur:

- aynı `business_id`
- aynı `staff_id`
- `status <> cancelled`
- çakışan `[occupied_starts_at, occupied_ends_at)` aralıkları

aynı anda var olamaz.

Uygulama availability kontrolünden sonra insert/update yapar; yarış oluşursa exclusion constraint işlemlerden yalnız birini geçirir. Worker bunu `APPOINTMENT_CONFLICT` olarak 409'a çevirir.

Cancelled appointment slotu serbest bırakır. Completed ve no-show kayıtları tarihsel occupancy'yi korur; geçmişte aynı personele üst üste ikinci appointment yazılarak tarihçe yeniden yazılamaz.

### Booking-aware slot motoru

Faz 4'ün public `compute_availability_slots` sözleşmesi korunur fakat Faz 5 migration'ı implementasyonu booking-aware hale getirir. Schedule, block ve service kurallarından geçen aday slotlar ayrıca non-cancelled appointment occupied aralıklarıyla karşılaştırılır.

Reschedule için ayrı `compute_reschedule_slots` vardır. Bu fonksiyon sadece taşınan appointment kimliğini occupancy hesabından hariç tutar. Böylece appointment aynı saate veya kendi eski aralığıyla kısmen kesişen yeni bir saate taşınabilir; diğer randevular yine normal şekilde engeldir. Son update yine exclusion constraint tarafından korunur.

### Idempotency

Create, reschedule ve status komutları `booking_commands` tablosunda `(business_id, idempotency_key)` primary key'iyle claim edilir. İstek payload'ı deterministik hash ile kaydedilir.

- aynı key + aynı command/payload: önceki appointment sonucu döner;
- aynı key + farklı command/payload: `IDEMPOTENCY_CONFLICT`;
- concurrent aynı-key istekleri PK üzerinde serialize olur.

Command ledger istemciye doğrudan açılmaz. Dış mutasyon yüzeyi yalnız RPC'dir.

### Customer kimliği

Faz 5 ayrı `customers` tablosu ekler. Yeni booking sırasında aynı tenant içinde normalize edilmiş telefon veya lower-case e-posta birebir eşleşirse mevcut customer yeniden kullanılır; aksi halde yeni kayıt açılır. Bu dedup kolaylık katmanıdır, global kimlik iddiası değildir. Customer PII tenant RLS ile sınırlandırılır.

### Appointment yaşam döngüsü ve audit

Başlangıç durumu `scheduled`'dır. Aktif durumlar `scheduled` ve `confirmed`; terminal durumlar `cancelled`, `completed`, `no_show` olarak kabul edilir. Terminal bir appointment tekrar aktif duruma açılamaz.

Create, reschedule ve status değişiklikleri `appointment_events` tablosuna append-only event bırakır. Event actor kullanıcıyı, önceki/yeni status'u ve gereken delta payload'ını saklar. Authenticated role event tablosuna doğrudan insert/update/delete yapamaz.

### Yetki yüzeyi

Booking operasyonları aktif tenant üyesine açıktır; owner/manager/staff randevu operasyonu yapabilir. Bunun nedeni staff rolünün randevu operasyonunda ön büro veya hizmet veren personel olarak çalışabilmesidir. Tenant dışına erişim yine `Membership`, explicit RPC check, birleşik foreign key ve RLS katmanlarıyla engellenir.

## Sonraki sınır

Faz 5 public müşteri self-booking, ödeme, bildirim/h hatırlatma, dış takvim senkronizasyonu ve CRM otomasyonunu içermez. Booking çekirdeği önce transaction ve concurrency doğruluğunu sabitler; dağıtım kanalları bunun üzerine eklenir.
