# YZT Randevu — teknik kararlar

## Faz 2 güvenlik sözleşmesi

Faz 2 yeniden tasarlanmaz. `Business` tenant köküdür; kimlik Supabase Auth tarafından sağlanır; `Membership` kullanıcının tenant içindeki güncel rolünü ve aktifliğini belirler. İstemcinin gönderdiği işletme kimliği yetki değildir. Her tenant isteği güncel membership kaydıyla ve PostgreSQL RLS ile yeniden doğrulanır. Service-role anahtarı uygulama Worker'ında kullanılmaz.

Tarayıcıdaki aktif işletme seçimi yalnızca kullanıcı tercihi taşıyan HttpOnly cookie'dir. Yetki kaynağı değildir. Üyelik pasifleştirildiğinde aynı oturumun sonraki isteği tenant erişimini kaybeder.

## Faz 3 — hizmet ve ekip

Faz 3 yalnızca işletme kataloğu ve randevu atanabilir ekip modelini ekler:

- `services`: işletmeye ait hizmet, süre, tampon süreler, fiyat ve aktiflik.
- `staff_profiles`: randevu atanabilir personel. Bir `Membership` ile bağlanabilir ama her personelin giriş hesabı olmak zorunda değildir.
- `staff_services`: hangi personelin hangi hizmeti verebildiği.

Bütün tablolarda `business_id` bulunur. Staff-Service bağlantısında birleşik foreign key kullanılır; farklı tenant'ın staff ve service kayıtları birbirine bağlanamaz.

Owner ve manager katalog/ekip yönetebilir. Staff okuyabilir fakat Faz 3 katalog mutasyonu yapamaz. Bu kural hem Worker hem RLS katmanında uygulanır.

Hizmet süresi 5–720 dakika, tamponlar 0–240 dakika, fiyat en küçük para biriminde sıfır veya pozitif tam sayı olmak zorundadır.

## Faz 4 — müsaitlik

Müsaitlik üç veri katmanıyla modellenir:

- `business_hours`: işletmenin haftalık açık pencereleri.
- `staff_hours`: personelin haftalık çalışma pencereleri.
- `availability_blocks`: belirli gerçek zaman aralığını kapatan işletme geneli veya personel özelinde izin/kapanış.

Haftalık mola ayrı bir "break" tablosu değildir. Aynı günün çalışma saatini iki veya daha fazla açık pencereye bölmek molayı doğal olarak oluşturur. Bu yaklaşım slot motorunda tek bir "açık aralıkların kesişimi eksi bloklar" kuralı bırakır.

Günlük schedule değişimi tek tek satır CRUD'u ile yapılmaz. `replace_business_hours` ve `replace_staff_hours` RPC'leri bütün günü tek transaction içinde değiştirir. Böylece eski saatlerin silinip yeni saatlerin yarım yazılması engellenir. Overlap aralıkları RPC içinde reddedilir.

Schedule tablolarında authenticated role doğrudan `insert/update/delete` yetkisi taşımaz. Owner/manager mutasyonları security-definer RPC'lerde `auth.uid()` ve `can_manage_business()` ile yeniden doğrulanır. Staff yalnızca kendi aktif tenant'ının availability verisini okuyabilir.

Slot hesabının kuralları:

1. Aktif hizmet ve aktif `StaffService` eşleşmesi olmayan personel aday değildir.
2. İşletme ve personel haftalık açık pencereleri yerel saat üzerinden kesiştirilir.
3. İşletmenin IANA timezone'u ile bu pencereler `timestamptz` gerçek anlarına çevrilir.
4. Hizmet başlangıcı, `buffer_before + duration + buffer_after` toplamı açık pencereye tamamen sığacak şekilde üretilir.
5. Slot grid adımı hizmet süresinden bağımsızdır.
6. İşletme seviyesindeki blok tüm personeli, staff seviyesindeki blok yalnız ilgili personeli eler.
7. `[başlangıç, bitiş)` mantığı kullanılır; bir blok tam slotun occupied başlangıcında biterse sonraki slotu engellemez.
8. Faz 4 appointment tablosunu okumaz. Dolu randevuların slotlardan düşülmesi Faz 5'te booking modeliyle birlikte eklenecektir.

### Timezone ve DST

Timezone adı serbest metin kabul edilmez; `pg_timezone_names` ile doğrulanır. Haftalık wall-clock pencereleri önce işletme timezone'unda gerçek UTC anlarına dönüştürülür, sonra slotlar gerçek timeline üzerinde `generate_series` ile üretilir.

Bu kararın sonucu açıktır:

- Spring-forward sırasında hiç yaşanmayan yerel saat için slot üretilmez.
- Fall-back sırasında aynı yerel saat iki kez yaşanıyorsa iki farklı `timestamptz` instant korunur. UI bu ayrımı UTC offset etiketiyle gösterebilir.

Bu davranış `Europe/Berlin` geçişleriyle CI testinde doğrulanır. `Europe/Istanbul` gibi DST kullanmayan işletmeler aynı motoru değişiklik olmadan kullanır.
