# Faz 3 çalışma notu

Bu dalın kabul hedefi: tenant-safe hizmet ve ekip çekirdeği.

- Service: ad, süre, tampon süreler, fiyat, aktiflik.
- StaffProfile: randevu atanabilir personel; login hesabı zorunlu değil.
- StaffService: personel-hizmet yetkinliği.
- Owner/manager mutasyon yapabilir, staff yalnız okur.
- `business_id` her kayıtta bulunur ve RLS ile korunur.
- Cross-tenant personel/hizmet eşleştirmesi birleşik foreign key ile reddedilir.
- Süre/fiyat validasyonu hem API hem DB constraint katmanındadır.

Kapsam dışında: availability, slot üretimi, appointment, prim/bordro ve görsel takvim.
