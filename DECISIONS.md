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

Hizmet süresi 5–720 dakika, tamponlar 0–240 dakika, fiyat en küçük para biriminde sıfır veya pozitif tam sayı olmak zorundadır. Faz 3'te prim, bordro, availability ve appointment yoktur.
