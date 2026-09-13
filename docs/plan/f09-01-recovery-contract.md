# F09-01 — Rezervasyon kurtarma ve bildirim sözleşmesi

Durum: **F09-01 sözleşme teslimi**  
Başlangıç main: `f48ee3735171bbb8b9c7d3e41864ea73ffa91cbe`  
İncelenen eski taslak: PR #8 / `phase-9-email-delivery` / head `9b5a6ceab648c70b8c892d831d041021d8568e37`

**13 Eylül 2026 eki:** [S07 v2 sonuç kesinleştirme sözleşmesi](s07-recovery-resolution.md), erken recovery 404'ün kesin yokluk sayılmasını düzeltmek üzere yazıldı. V2 deadline/atomik kapatma, ortak tarayıcı pending kaydı ve TTL sonrası sınırlı commit teyidi bu ekte tanımlıdır; bu belge v1'in tarihsel/proof sınırını korur. Ekin yazılması kodun uygulanmış veya S07'nin tamamlanmış olduğu anlamına gelmez.

Bu belge Faz 9 uygulamasının bağlayıcı hata, güvenlik ve veri yaşam döngüsü sözleşmesidir. F09-01 kodlanmış kurtarma, kuyruk veya rate-limit teslim etmez. Bunlar sırasıyla F09-02, F09-03 ve F09-04 görevleridir.

## 1. Sorun ve değişmezler

Main'deki akış bugün iki ayrı işlemdir:

1. `create_public_appointment` randevuyu commit eder.
2. Tarayıcı daha sonra `/api/manage/provision` çağırıp management capability oluşturur.

İkinci çağrı veya onun HTTP cevabı kaybolursa randevu oluşmuş olduğu halde müşteri hata görebilir. Eski PR #8 bu ikinci çağrı içinde e-posta sağlayıcısını da beklediği için sağlayıcı kesintisini aynı kritik yola ekler.

Faz 9 sonrasında şu değişmezler korunmalıdır:

- **Booking commit edildiyse müşteri hiçbir zaman “randevu oluşmadı” sonucu almamalıdır.** Sonuç ilk cevapta veya recovery ile bulunabilir olmalıdır.
- Aynı idempotency key + aynı istek tek appointment üretir; eşzamanlı tekrar aynı sonucu döndürür.
- Aynı idempotency key farklı booking veya farklı bootstrap secret'larıyla kullanılırsa `IDEMPOTENCY_CONFLICT` olur.
- Management capability appointment ile aynı atomik oluşturma sınırında doğar. “Appointment var, capability yok” yeni akışta mümkün değildir.
- Management token URL path/query'de, uygulama logunda veya PostgreSQL plaintext alanında bulunmaz.
- E-posta/SMS sağlayıcısı booking otoritesi değildir. Provider kesintisi appointment'ı geri almaz ve booking başarı yanıtını hata yanıtına çevirmez.
- Tarayıcı kapanmış olsa bile Faz 9 tamamlandığında daha önce commit edilmiş notification işi yeniden denenebilir.
- Public/anon istemci gerçek provider gönderimi olmadan authoritative `sent/delivered` receipt yazamaz.
- Worker service-role key kullanmaz.

## 2. Secret ve kanıt rolleri

Dört değerin rolü ayrıdır; birbirinin yerine kullanılmaz.

### 2.1 `Idempotency-Key`

- Booking komut kimliğidir, 8–128 karakter mevcut kural korunur.
- Duplicate create'i önler ve aynı komut sonucunu bulmaya yardım eder.
- **Tek başına recovery authority veya notification-delivery authority değildir.**
- Client tarafından bilindiği için “provider gerçekten gönderdi” kanıtı sayılamaz.

### 2.2 Management token

- En az 256 bit rastgele bearer capability'dir.
- Tek appointment için görüntüleme/taşıma/iptal yetkisidir.
- Browser booking başlamadan üretir ve ilk istek süresince bellekte tutar.
- DB yalnız SHA-256 hash'ini kalıcı capability tablosunda tutar.
- `/m#<token>` fragment olarak kullanılır; fragment HTTP isteğine gitmez.
- F09-02 atomik create sırasında hash capability kaydını appointment ile birlikte oluşturur.

### 2.3 Recovery ID

- Browser booking başlamadan bir UUID üretir.
- Secret değildir; recovery kaydını ve encrypted material için AAD bağını tanımlar.
- Aynı idempotency key retry'larında değişmez.
- Booking request hash'ine bağlanır; aynı key + farklı recovery ID conflict'tir.

### 2.4 Recovery secret

- Management token'dan ayrı, en az 256 bit rastgele kısa ömürlü kanıttır.
- Browser booking başlamadan üretir.
- Browser yalnız pending booking kaydında `sessionStorage` içinde tutabilir; PII ve management token bu pending kayda yazılmaz.
- DB yalnız recovery secret hash'ini tutar.
- Varsayılan server recovery ömrü **72 saat**tir. Uygulama sabiti/config olabilir fakat sınırsız değildir.
- Recovery secret yalnız aynı public-create komutunun sonucunu kurtarmaya yarar; appointment üzerinde kalıcı yönetim yetkisi vermez.
- Yanlış veya süresi dolmuş secret, appointment'ın varlığını sızdırmayan tek biçimli `BOOKING_RECOVERY_NOT_FOUND` sonucu verir.

## 3. Management token'ın encrypted recovery material olarak saklanması

Refresh sonrası manage linkin kurtarılabilmesi ve F09-03'te tarayıcı kapalıyken notification retry yapılabilmesi için Worker'ın management token'ı sınırlı süre yeniden üretebilmesi gerekir. Plain token kalıcı saklanmayacaktır.

F09-02 şu modeli kurar:

- Worker booking isteğinde management token'ı **AES-256-GCM** ile şifreler.
- Aktif anahtar yalnız Worker secret'ıdır: `MANAGEMENT_LINK_ENCRYPTION_KEY_V1` (32 byte, deployment'ta güvenli formatta sağlanır).
- DB recovery kaydında yalnız `ciphertext + iv/nonce + key_version` saklanır; plaintext token veya full manage URL saklanmaz.
- AAD formatı sabittir: `public-booking-recovery:v1|<recoveryId>`.
- Recovery endpoint başarılı proof sonrasında token'ı yalnız Worker belleğinde decrypt eder ve `/m#<token>` URL'sini o anda kurar.
- `MANAGEMENT_LINK_ENCRYPTION_KEY_V1` yoksa veya geçersizse Worker **DB create RPC'sini çağırmadan** `BOOKING_RECOVERY_UNAVAILABLE` / HTTP 503 döndürür. Recovery'siz appointment commit edilmez.
- `key_version` rotation için zorunludur. Eski ciphertext'in recovery/retry ömrü boyunca decrypt edilebilmesi gerekir; key rotation eski aktif key'i bu pencere dolmadan silmez.

F09-03 aynı encrypted material'ı notification dispatcher için yeniden kullanır; ikinci bir plaintext veya full-URL kopyası oluşturmaz. Encrypted material ancak hem recovery penceresi kapanmış hem ilgili notification terminal duruma gelmişse temizlenebilir. F09-03 kesin cleanup ve retry politikasını test eder.

Bu tasarım server'ın refresh/retry yapmasını sağlar fakat DB dump'ının tek başına canlı management linkleri vermesini engeller.

## 4. Atomik create sözleşmesi — F09-02

Mevcut `POST /api/public/business/:slug/book` route'u korunur; davranış genişler. İstemci bootstrap secret'larını aynı booking intent ile yollar.

Normatif istek:

```text
POST /api/public/business/:slug/book
Idempotency-Key: <booking-key>

{
  ...mevcut booking alanları,
  managementToken: <256-bit bearer>,
  recoveryId: <uuid>,
  recoverySecret: <256-bit short-lived proof>
}
```

Worker management token ciphertext'ini üretir ve yeni ileri migration RPC'sine create verisiyle birlikte verir. PostgreSQL transaction F09-02'de aşağıdakileri **tek transaction** içinde yapar:

1. public business/service/staff/slot kontrolleri,
2. `booking_commands` claim,
3. appointment + audit event,
4. management capability hash,
5. recovery ID + recovery secret hash + encrypted management material,
6. booking command result bağlantısı.

Transaction'ın herhangi bir DB adımı başarısızsa appointment commit edilmez. Provider HTTP çağrısı ve notification job bu F09-02 transaction'ında henüz yoktur.

Booking request hash'i mevcut booking payload'ına ek olarak **management token hash + recovery ID + recovery secret hash** ile bağlanır. Böylece aynı idempotency key farklı capability/recovery bootstrap ile sessizce kullanılamaz.

F09-02 minimum başarılı HTTP cevabı:

```json
{
  "appointment": { "...": "mevcut public confirmation snapshot" },
  "management": { "url": "/m#<token>" },
  "recovery": { "expiresAt": "<timestamp>" }
}
```

F09-03 aynı create transaction'ını ileri migration ile durable notification intent doğuracak şekilde genişletir ve response'a ayrıca `notification.status = queued|skipped_no_email` ekleyebilir. `queued`, provider'a teslim edildi demek değildir.

## 5. Recovery sözleşmesi — F09-02

Browser booking'e başlamadan önce sessionStorage'a yalnız şu pending kaydı koyar:

```json
{
  "slug": "business-slug",
  "idempotencyKey": "...",
  "recoveryId": "...",
  "recoverySecret": "...",
  "requestFingerprint": "client-side hash",
  "createdAt": "..."
}
```

Management token ve müşteri PII bu pending kayda yazılmaz.

İlk booking cevabı kaybolursa veya sayfa refresh olursa UI create'i yeni bir key ile tekrarlamaz. Önce recovery çağrısı yapar:

```text
POST /api/public/booking/recover

{
  recoveryId,
  idempotencyKey,
  recoverySecret
}
```

Recovery işlemi:

- recovery ID + booking command + recovery hash bağını birlikte doğrular,
- yanlış ID/key/secret kombinasyonunda tek biçimli 404 döner,
- appointment snapshot'ını döndürür,
- Worker encrypted management token'ı decrypt edip manage URL'yi yalnız başarılı proof sonrasında döndürür,
- F09-03 sonrasında notification durumunu ek bir alan olarak döndürebilir,
- yeni appointment veya yeni management capability oluşturmaz.

Recovery başarılı olunca UI “RANDEVU OLUŞTURULDU” ekranına geçer. F09-03 sonrasında notification başarısızlığı bu ekranı gizlemez.

Pending sessionStorage kaydı recovery penceresi dolduğunda veya müşteri akıştan bilinçli çıktığında temizlenir. Tab kapanınca sessionStorage kaybolabilir; bu durum F09-03 durable notification retry'ını etkilemez.

## 6. Notification dispatcher sözleşmesi — F09-03

F09-03 create transaction'ını, e-posta varsa **aynı DB transaction içinde durable notification job** doğuracak şekilde ileri migration ile genişletir. Booking request provider HTTP çağrısını beklemez.

Minimum iş durumları:

```text
pending -> leased -> sent
                -> retry_wait -> leased
                -> failed_terminal
```

Her işte en az `appointment_id`, `kind`, `channel`, `attempt_count`, `available_at`, lease süresi, provider ve provider message id/son hata sınıfı bulunur. Plain token/full manage URL bulunmaz. Job encrypted management material'a recovery ID üzerinden referans verir veya aynı güvenli kaydı kullanır; plaintext kopya üretmez.

Kurallar:

- Birden fazla dispatcher aynı işi kontrolsüz gönderemez; DB claim/lease serialize eder.
- Provider timeout'u açıkça tanımlıdır; sonsuz bekleme yoktur.
- Retry backoff ve maksimum pencere F09-03'te sabitlenir; varsayılan hedef **72 saatlik** sınırlı retry penceresidir.
- Provider idempotency key `notification job/event identity` ile stabildir; yalnız appointment ID kullanmak ileride aynı appointment'taki farklı notification türlerini çarpıştırmamalıdır.
- Provider “accepted” deyip HTTP cevabı kaybolursa aynı provider idempotency key ile retry yapılır. Provider'ın garanti penceresi dışında mutlak exactly-once iddiası kurulmaz.
- `sent` receipt yalnız server dispatcher tarafından yazılır.

### Dar server gönderim yetkisi

Worker service-role kullanmayacaktır. F09-03 için seçilen model şudur:

- `NOTIFICATION_DISPATCH_SECRET` en az 256 bit rastgele değer olarak yalnız Worker environment'ında bulunur.
- PostgreSQL private/config alanında yalnız SHA-256 hash'i bulunur; raw secret repo veya migration içine yazılmaz.
- Security-definer `claim` ve `complete` RPC'leri `p_dispatch_secret` alır ve hash'i private config ile eşleşmeden job verisi döndürmez/değiştirmez.
- Test ortamı sahte secret/hash'i fixture üzerinden kurar; staging/production hash provisioning F17-01'de belgelenir.
- Public/anon delivery tablolarına doğrudan grant almaz. RPC teknik olarak anon key ile çağrılsa bile doğru 256-bit dispatcher proof olmadan job claim veya `sent` receipt yazılamaz.
- Completion ayrıca claim/lease kimliğini doğrular; bir dispatcher başka aktif lease'i rastgele tamamlayamaz.

Bu model Cloudflare Worker'ın mevcut anon Supabase bağlantısını kullanmasına izin verirken provider receipt authority'yi public istemciden ayırır.

## 7. Hata kodları ve kullanıcı davranışı

| Kod / durum | HTTP | Anlam | UI davranışı |
| --- | ---: | --- | --- |
| `SLOT_UNAVAILABLE` | 409 | Appointment commit olmadı | Saat listesini yenile, başka slot seçtir |
| `IDEMPOTENCY_CONFLICT` | 409 | Aynı key farklı booking/bootstrap intent ile kullanıldı | Yeni booking otomatik yaratma; kullanıcıya tekrar başlatma mesajı |
| `BOOKING_RECOVERY_UNAVAILABLE` | 503 | Worker encryption/recovery config hazır değil; DB create çağrılmadı | “Rezervasyon şu anda alınamıyor” göster; commit edilmiş booking varsayma |
| `BOOKING_RECOVERY_NOT_FOUND` | 404 | Recovery ID/key/secret eşleşmedi veya recovery TTL doldu | Randevu var/yok bilgisini sızdırma; yeni booking otomatik oluşturma |
| booking response network loss | n/a | Commit durumu belirsiz | Yeni key üretmeden recovery dene |
| `notification: queued` | 2xx booking (F09-03+) | Booking committed, mail işi bekliyor | Başarı ekranını göster; “E-posta hazırlanıyor” |
| `notification: failed` | 2xx recovery/status (F09-03+) | Booking committed, delivery terminal/geçici sorun | Başarı ekranını koru; manage link ekranda göster; mail durumunu ayrı açıkla |
| provider timeout/outage | n/a | Booking'i etkilemez | Background retry; müşteri booking hatası görmez |

Expired recovery de yanlış proof ile aynı dış 404 davranışını kullanır; public caller appointment'ın varlığını bu farktan çıkaramaz.

## 8. Zorunlu senaryo matrisi

| Senaryo | Beklenen sonuç |
| --- | --- |
| Encryption key eksik/bozuk | Worker DB create çağırmadan 503; appointment/capability oluşmaz |
| DB commit'ten sonra booking HTTP cevabı kesilir | Aynı recovery ID/key/secret ile tek mevcut appointment geri gelir; ikinci appointment yok |
| Sayfa booking sonrası refresh edilir | sessionStorage pending proof ile recovery çalışır ve başarı ekranı/manage link geri gelir |
| Tarayıcı booking commit'ten sonra kapanır | Booking kalır; F09-03 durable notification job browser olmadan retry edebilir |
| Aynı create aynı key ile eşzamanlı iki kez gelir | Tek appointment/capability/recovery oluşur; iki çağrı aynı appointment sonucuna bağlanır |
| Aynı key, farklı booking payload | `IDEMPOTENCY_CONFLICT`; mevcut appointment açığa çıkmaz/değişmez |
| Aynı key, farklı management/recovery secret veya recovery ID | `IDEMPOTENCY_CONFLICT`; capability sessizce değişmez |
| Recovery'de yanlış secret | Generic not-found; appointment summary/token/PII yok |
| Recovery'de farklı recovery ID/key | Generic not-found; cross-tenant/appointment bilgisi yok |
| Client yeni idempotency key ile “recovery” deniyor | Eski booking recover edilmez; create ise normal yeni booking intent kurallarına tabidir ve mevcut doluluk nedeniyle aynı slotta çakışır |
| Provider tamamen kapalı | F09-03 sonrası booking 2xx başarı + queued/pending; job retry; appointment rollback yok |
| Provider accepted, response kayboldu | Stable provider idempotency ile retry; DB receipt yalnız doğrulanmış server dispatcher flow'dan |
| Anon caller booking key + appointment ID biliyor | Notification `sent` receipt yazamaz, outbox claim edemez |
| Recovery TTL doldu | Recovery proof generic 404 olur; daha önce edinilmiş `/m#token` capability çalışmaya devam eder |

Bu senaryolar F09-02/F09-03 HTTP/SQL testlerinin minimum listesidir; F09-05 gerçek ortamda tekrarlar.

## 9. PR #8 parça eşleştirmesi

PR #8 **doğrudan merge edilmeyecektir**. Aşağıdaki parçalar yeni görevlerde elle taşınabilir veya yeniden yazılabilir.

| PR #8 parçası | Karar | Hedef görev | Gerekçe |
| --- | --- | --- | --- |
| `worker/email.ts` HTML/text escaping, Türkçe formatlama | **Yeniden kullan, harden et** | F09-03 | Provider adapter izolasyonu doğru; timeout/retryability/job-id idempotency eklenmeli |
| Resend REST, SDK'sız entegrasyon | **Yeniden kullan** | F09-03 | Küçük dependency yüzeyi; secret Worker env'de kalır |
| `RESEND_API_KEY`, `NOTIFICATION_FROM_EMAIL` env adları | **Yeniden kullan** | F09-03/F17-01 | Uygun provider config yüzeyi |
| `appointment_notification_deliveries` receipt fikri | **Yeniden kullan, yetkiyi değiştir** | F09-03 | Token saklamaması doğru; server-only completion/job bağı gerekli |
| Provider `Idempotency-Key` kullanımı | **Yeniden kullan, kimliği genişlet** | F09-03 | Appointment ID tek başına gelecekte notification türleri için yeterli değil |
| UI'da booking sonucu ve mail durumunu ayrı gösterme | **Yeniden kullan** | F09-02/F09-03 | Ürün kuralıyla uyumlu |
| `book -> /api/manage/provision` iki aşamalı başarı | **At** | F09-02 | Commit olmuş booking'i capability hatasıyla başarısız gösterebilir |
| `/api/manage/provision` içinde provider'ı await etmek | **At** | F09-03 | Provider latency/outage booking/customer response yoluna bağlanıyor |
| `record_public_booking_email_delivery(... )` için `grant execute ... to anon` | **At / yasak** | F09-03 | Client sahte provider receipt yazabilir |
| Booking key'e dayalı public email payload RPC | **Tek başına kullanma** | F09-03 | Key istemci tarafından bilinir; dispatcher authority değildir |
| Faz 9'u tamamlandı gösteren PR #8 docs | **At** | — | Güncel ROADMAP/TASKS ile çelişir; G09 beş görevle kapanır |

PR #8, F09-03 adapter/şablon kodu taşındıktan ve yeni görevlerin ilgili kapsamı merge edildikten sonra superseded olarak kapatılabilir. O zamana kadar referans taslak olarak kalır.

## 10. Veri/migration uyumluluğu

- Faz 1–8 birleşmiş migration'lar değiştirilmez.
- F09-02 ve F09-03 yalnız **ileri migration** ekler.
- Mevcut Faz 7 capability'leri ve `/m#token` linkleri aynen çalışmaya devam eder.
- Yeni atomik create yalnız yeni public booking'ler için recovery metadata üretir; eski appointment'lara geriye dönük sahte recovery secret oluşturulmaz.
- F09-03 yeni create transaction'ına notification job ekler; F09-02 döneminde oluşmuş appointment'lara otomatik “gönderildi” kaydı uydurmaz.
- Faz 9 deployment'ı mevcut Faz 8 verisi üzerinde migration testinden geçer.
- PR #8'in `20260911160000_phase9_email_delivery.sql` dosyası main'e birleşmediği için yeni uygulama onun içeriğini kopyalamak zorunda değildir. Migration adı/sırası gerçek merge stratejisinde tek kez kullanılacak şekilde F09-02/F09-03 arasında koordine edilir.

## 11. Scope ayrımı

### F09-02 teslim edecek

- atomik appointment + management capability + recovery bootstrap,
- AES-GCM encrypted management recovery material + key version,
- recovery endpoint ve refresh sonucu,
- booking UI'nın “commit edilmiş randevu = başarı” davranışı,
- recovery proof/TTL ve temel network-loss HTTP testleri.

F09-02 provider HTTP çağrısı veya durable notification queue yazmaz.

### F09-03 teslim edecek

- create transaction ile atomik doğan durable notification outbox/job,
- F09-02 encrypted management material'ının notification için güvenli yeniden kullanımı,
- provider timeout/retry/lease,
- `NOTIFICATION_DISPATCH_SECRET` server-only authority,
- authoritative receipt ve provider stub testleri,
- recovery/retry penceresi sonrası encrypted material cleanup politikası.

### F09-04 teslim edecek

- Worker rate-limit/abuse politikası,
- direct Supabase RPC bypass yüzeyinin kapatılması veya aynı server proof sınırına alınması,
- 429/retry davranışı ve bulk-attempt testleri.

### F09-05 teslim edecek

- F09-02/03/04 + staging/test temelinin birleşik gerçek ortam kabulü.

## 12. F09-01 kabul kontrolü

- [x] PR #8 yeniden kullanılacak/atılacak parçalar eşlendi.
- [x] Booking sonucu, idempotency, management capability, recovery proof ve provider delivery birbirinden ayrıldı.
- [x] Response loss, refresh, browser close, wrong proof, concurrent retry, key/payload/secret değişimi ve provider outage somut sonuçlarla tanımlandı.
- [x] Plain management token'ın kalıcı DB/log alanına yazılmadığı yaşam döngüsü tanımlandı.
- [x] Refresh ve browser-kapalı retry için AES-GCM encrypted-at-rest token material sözleşmesi ve key version tanımlandı.
- [x] Recovery config yokken appointment oluşturmayan fail-closed davranış tanımlandı.
- [x] Client/anon'un provider receipt yazamayacağı `NOTIFICATION_DISPATCH_SECRET` tabanlı dar server authority tanımlandı; service-role kullanılmadı.
- [x] Eski Faz 7 management linkleri ve birleşmiş migration'ların uyumluluk sınırı tanımlandı.
- [x] F09-02, F09-03, F09-04 ve F09-05 sorumlulukları ayrıldı.

## Devir

F09-02'nin ilk somut adımı: bu sözleşmedeki atomik create/recovery modelini **ileri migration + Worker route + PublicBookingPage recovery state** olarak uygulamak ve senaryo matrisindeki F09-02'ye ait encryption-config/network-loss/refresh/wrong-proof/concurrent-retry testlerini eklemek. F09-02 provider HTTP çağrısı veya reminder motoru yazmaz.
