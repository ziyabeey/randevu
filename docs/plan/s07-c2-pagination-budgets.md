# S07-C2 — Liste sayfalaması ve DB bütçeleri

**Başlangıç main:** `098b92d2843c6c89c13692d16cbf3db070212a73`  
**Amaç:** K03'ün mevcut MVP yüzeylerine uygulanabilir liste ve sorgu bütçelerini sessiz veri eksiltmeden uygulamak. Bu paket yeni ürün UX'i değildir.

## Envanter ve sınıflandırma

### Gerçek liste yüzeyleri — keyset sayfalama gerekir

1. `GET /api/bookings`
   - Bugün `starts_at.asc` + sabit `limit=250` kullanıyor ve devam bilgisi vermiyor.
   - Bu sessiz kırpma riski K03 ile uyumsuzdur.
   - Yeni sözleşme: `limit` varsayılan 25, en fazla 100; sıralama `(starts_at,id)`; opaque cursor aynı iki değeri taşır; bir sonraki sayfa öncekinin son anahtarından **sonra** başlar.

2. `GET /api/bookings/:id/events`
   - Bugün `created_at.asc` ile limitsiz okunuyor.
   - Yeni sözleşme: `limit` varsayılan 25, en fazla 100; sıralama `(created_at,id)`; aynı keyset cursor kuralı.

Bu iki liste `limit+1` okuyarak `hasMore/nextCursor` üretir; kullanıcıya dönen kayıt sayısı hiçbir zaman 100'ü geçmez. Cursor bozuksa 400 döner, ilk sayfa gibi yorumlanmaz.

### Tam snapshot/range yüzeyleri — sessiz pagination uygulanmaz

1. `GET /api/calendar`
   - Takvim zaten business-local tarih + 1/7 gün + isteğe bağlı personel filtresiyle sınırlandırılmıştır.
   - K03 takvimin dolu olduğunda sessizce kırpılmamasını ister. Bu nedenle 100 randevuda kesilmez.
   - DB tarafında tarih/personel indeksleri ve ölçülmüş plan doğrulanır; sorgu için statement timeout uygulanır. Timeout boş takvim gibi dönmez, açık hata olur.

2. `/api/catalog`, auth membership snapshot, calendar staff selector, public service/staff katalogları
   - Mevcut ekranlar bu verileri atomik snapshot olarak kullanır; tek sayfayı sessizce kırpmak ilişkileri bozabilir.
   - C2 bunları keyfi ilk-100 cevabına dönüştürmez.
   - Her snapshot sorgusu **max+1 probe** ile açık aşım algılar. Sınır aşılırsa eksik başarılı cevap yerine anlaşılır `*_LIMIT_EXCEEDED` sonucu verir.
   - İlk teknik sınır: services 100, staff 100, active memberships 100. `staff_services` eşleşmesi 10×50 K03 yük fixture'ını taşıyabilmesi için 5.000 hard safety ceiling ile ölçülür; normal kabul fixture'ı 500 eşleşmedir. Bu eşleşme ürün listesi değil, iki bounded katalog kümesinin ilişki snapshot'ıdır.
   - F10-04/F12 ürün ekranları ileride gerçek yönetim sayfalamasını ekleyebilir; C2 mevcut davranışı sessiz veri kaybıyla değiştirmez.

## DB bütçesi

- Auth/data HTTP üst sınırı mevcut S07-B ile 10 saniyedir; bu DB işinin iptal edildiği anlamına gelmez.
- C2 read/list RPC'lerinde başlangıç DB `statement_timeout` **5 saniye** olarak uygulanır. Bu değer p95 hedefi değildir; sonsuz DB işi için fail-closed üst sınırdır.
- K03 kabul hedefi tarih-aralıklı okumalarda p95 750 ms'dir. C3 bunu örnek yükte ölçer; 5 saniyelik safety timeout hedefi gevşetmek için kullanılmaz.
- `appointments` keyset yolu `(business_id,starts_at,id)`; event yolu `(business_id,appointment_id,created_at,id)` indeksleriyle desteklenir. Yeni indeks yalnız `EXPLAIN`/fixture gerekçesiyle eklenir.
- Takvim mevcut `(business_id,starts_at,status)` ve `(business_id,staff_id,starts_at,status)` indekslerini kullanabilmelidir; ölçüm gerektirmeden fazladan indeks eklenmez.

## Cursor sözleşmesi

- Cursor sürümlü ve base64url JSON'dur: bookings için `{v:1,startsAt,id}`, events için `{v:1,createdAt,id}`.
- Cursor kullanıcı kimliği veya sır taşımaz; yine de biçim, sürüm, UUID ve timestamp doğrulanır.
- Cursor business/appointment yetkisini aşamaz. RPC her sayfada güncel membership/appointment kapsamını yeniden doğrular.
- Aynı timestamp'teki satırlar UUID tie-breaker ile kararlı ilerler.
- Sayfalar arasında yeni kayıt eklenmesi önceki cursor'dan önceki veriyi yeniden göstermeye veya sonraki eski kayıtları atlamaya yol açmaz.

## Negatif kabul

- 0, 1, 24, 25, 26, 99, 100, 101+ satır sınırları.
- Aynı `starts_at` / `created_at` değerine sahip çok kayıt.
- Bozuk/sürüm dışı cursor -> 400.
- Başka işletme kaydı -> görünmez.
- İlk sayfa ile ikinci sayfa birleşiminde atlama/çoğaltma yok.
- İlk sayfa sonrası daha eski/sıralamada önce kalan yeni kayıt eklemek mevcut continuation'ı bozmaz.
- DB timeout -> açık `*_READ_TIMEOUT/UNAVAILABLE`, boş dizi değil.
- Calendar 100+ fixture -> eksiksiz tarih aralığı sonucu veya açık timeout; 100'de sessiz kesme yok.

## Dosya sınırı

Beklenen dar değişim alanı:

- `worker/bookings.ts` ve dar cursor yardımcı modülü/testi.
- İleri SQL migration: paged booking/event RPC'leri, gerekçeli indeksler, function-level timeout ve açık ACL.
- `supabase/tests/s07_*pagination*.sql` ve canonical PG17 planı.
- Calendar DB timeout/plan kabulü aynı migration/test içinde, runtime response semantiği gerekiyorsa yalnız `worker/calendar.ts`.
- Snapshot max+1 sınırları yalnız somut mevcut yüzeylerde; davranış/test kapsamı büyürse C2a/C2b olarak ayrı PR'lara bölünür.

`auth.ts`, recovery v2, retention C1, notification send semantics, rate limits, workflow secrets ve ürün fazı dosyaları kapsam dışıdır.

## Rollback

- Pagination RPC/migration geri alınabilir; eski Worker aynı anda deploy edilmeden önce compatibility korunur.
- İndeks eklemeleri veri semantiğini değiştirmez ve gerektiğinde ayrı `DROP INDEX` ile geri alınabilir.
- C2 destructive veri işlemi yapmaz.
- Runtime rollback eski 250-limit davranışına dönecekse bu geçici gerileme açıkça kaydedilir; production/pilot kabulünde sessiz kırpma kabul edilmez.
