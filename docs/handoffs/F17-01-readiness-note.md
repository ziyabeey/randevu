# F17-01 staging readiness note

Gerçek `Staging deploy #3` run `34679524911` attempt 2 aşağıdaki canlı zinciri doğruladı:

- external staging secret contract geçti,
- Supabase session-pooler DB credential smoke geçti,
- migrations up-to-date olarak geçti,
- gerçek staging Auth owner hesapları hazırlandı,
- runtime capability hash'leri provision edildi,
- iki-business fixture reset + seed geçti,
- Cloudflare Worker deploy edildi,
- `MANAGEMENT_LINK_ENCRYPTION_KEY_V1` binding'i doğrulandı.

Deploy tamamlandıktan yaklaşık 350 ms sonra başlayan ilk `/api/health` smoke isteği HTTP 404 döndürdü. Cloudflare'ın yeni Workers route/assets deploy'larında kısa readiness gecikmesi görülebileceği için smoke yalnız health readiness aşamasında bounded retry uygular. Auth/session/business/catalog kontrolleri retry edilmez ve gerçek uygulama hatalarını fail-closed bırakır.

F17-01 bu değişiklik merge edildikten ve yeni main `Staging deploy` run'ı health + login + session + business select + catalog zincirini tamamen yeşil kanıtlayana kadar tamamlanmış sayılmaz.
