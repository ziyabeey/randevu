# F09-01 — Rezervasyon kurtarma ve bildirim sözleşmesi

Durum: **F09-01 sözleşme teslimi**  
Başlangıç main: `f48ee3735171bbb8b9c7d3e41864ea73ffa91cbe`  
İncelenen eski taslak: PR #8 / `phase-9-email-delivery` / head `9b5a6ceab648c70b8c892d831d041021d8568e37`

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
- Tarayıcı kapanmış olsa bile daha önce commit edilmiş notification işi yeniden denenebilir.
- Public/anon istemci gerçek provider gönderimi olmadan authoritative `sent/delivered` receipt yazamaz.
- Worker service-role key kullanmaz.

## 2. Secret ve kanıt rolleri

Üç değerin rolü ayrıdır; birbirinin yerine kullanılmaz.

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

### 2.3 Recovery secret

- Management token'dan ayrı, en az 256 bit rastgele kısa ömürlü kanıttır.
- Browser booking başlamadan üretir.
- Browser yalnız pending booking kaydında `sessionStorage` içinde tutabilir; PII ve management token bu pending kayda yazılmaz.
- DB yalnız recovery secret hash'ini tutar.
- Varsayılan server recovery ömrü **72 saat**tir. Uygulama sabiti/config olabilir fakat sınırsız değildir.
- Recovery secret yalnız aynı public-create komutunun sonucunu kurtarmaya yarar; appointment üzerinde kalıcı yönetim yetkisi vermez.
- Yanlış veya süresi dolmuş secret, appointment'ın varlığını sızdırmayan tek biçimli `BOOKING_RECOVERY_NOT_FOUND` sonucu verir.

## 3. Management token'ın dayanıklı teslimi

Tarayıcı kapandıktan sonra notification retry yapılabilmesi için notification altyapısının yönetim bağlantısını tekrar üretebilmesi gerekir. Plain token kalıcı saklanmayacaktır.

F09-02/F09-03 uygulaması şu modeli kullanır:

- Worker booking isteğinde management token'ı **AES-256-GCM** ile şifreler.
- Şifreleme anahtarı yalnız Worker secret'ıdır: `MANAGEMENT_LINK_ENCRYPTION_KEY` (32 byte/base64 veya eşdeğer güvenli format).
- DB/outbox yalnız `ciphertext + iv/nonce + key_version` saklar; plaintext token veya full manage URL saklamaz.
- AAD, booking operasyonuna bağlı stabil bir değer kullanır (ör. business/booking command kimliği); uygulamada seçilen format belgelenir ve değiştirilmez.
- Dispatcher token'ı sadece Worker belleğinde decrypt eder, `/m#<token>` URL'sini o anda kurar ve provider request'ine verir.
- Provider'ın e-postayı teslim edebilmesi için linki görmesi beklenen bir sınırdır; uygulama DB/logları bu secret'ı persist etmez.
- Notification terminal `sent` olduktan ve recovery penceresi kapandıktan sonra encrypted token material cleanup edilebilir; F09-03 bunun kesin cleanup politikasını yazar ve test eder.

Bu tasarım server'ın tarayıcı kapalıyken retry yapmasını sağlar fakat DB dump'ının tek başına canlı management linkleri vermesini engeller.

## 4. Atomik create sözleşmesi — F09-02

Mevcut `POST /api/public/business/:slug/book` route'u korunur; davranış genişler. İstemci ayrıca bootstrap secret'larını aynı booking intent ile yollar.

Normatif istek:

```text
POST /api/public/business/:slug/book
Idempotency-Key: <booking-key>

{
  ...mevcut booking alanları,
  managementToken: <256-bit bearer>,
  recoverySecret: <256-bit short-lived proof>
}
```

Worker management token ciphertext'ini üretir ve yeni ileri migration RPC'sine create verisiyle birlikte verir. PostgreSQL transaction aşağıdakileri **tek transaction** içinde yapar:

1. public business/service/staff/slot kontrolleri,
2. `booking_commands` claim,
3. appointment + audit event,
4. management capability hash,
5. recovery proof hash + encrypted management material referansı,
6. notification işinin durable başlangıç kaydı (e-posta varsa),
7. booking command result bağlantısı.

Transaction'ın herhangi bir DB adımı başarısızsa appointment commit edilmez. Provider HTTP çağrısı bu transaction'ın içinde değildir.

Booking request hash'i mevcut booking payload'ına ek olarak **management token hash + recovery secret hash** ile bağlanır. Böylece aynı idempotency key farklı capability/recovery secret ile sessizce kullanılamaz.

Başarılı HTTP cevabı:

```json
{
  "appointment": { "...": "mevcut public confirmation snapshot" },
  "management": { "url": "/m#<token>" },
  "notification": { "status": "queued|skipped_no_email" },
  "recovery": { "expiresAt": "<timestamp>" }
}
```

`notification.status` booking sonucundan ayrıdır. `queued`, provider'a teslim edildi demek değildir.

## 5. Recovery sözleşmesi — F09-02

Browser booking'e başlamadan önce sessionStorage'a yalnız şu pending kaydı koyar:

```json
{
  "slug": "business-slug",
  "idempotencyKey": "...",
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
  slug,
  idempotencyKey,
  recoverySecret
}
```

Recovery işlemi:

- booking command + recovery hash + business bağını birlikte doğrular,
- yanlış business/key/secret kombinasyonunda tek biçimli 404 döner,
- appointment snapshot'ını döndürür,
- Worker encrypted management token'ı decrypt edip manage URL'yi yalnız başarılı proof sonrasında döndürür,
- provider delivery durumunu `queued|sent|failed|skipped_no_email` gibi ayrı alan olarak bildirir,
- yeni appointment veya yeni management capability oluşturmaz.

Recovery başarılı olunca UI “RANDEVU OLUŞTURULDU” ekranına geçer. Notification başarısızlığı bu ekranı gizlemez.

Pending sessionStorage kaydı recovery penceresi dolduğunda veya müşteri akıştan bilinçli çıktığında temizlenir. Tab kapanınca sessionStorage kaybolabilir; bu durum durable notification retry'ını etkilemez.

## 6. Notification dispatcher sözleşmesi — F09-03

Booking request provider HTTP çağrısını beklemez. F09-03 durable outbox/job mekanizması kurar.

Minimum iş durumları:

```text
pending -> leased -> sent
                -> retry_wait -> leased
                -> failed_terminal
```

Her işte en az `appointment_id`, `kind`, `channel`, `attempt_count`, `available_at`, lease süresi, provider ve provider message id/son hata sınıfı bulunur. Plain token/full manage URL bulunmaz.

Kurallar:

- Birden fazla dispatcher aynı işi kontrolsüz gönderemez; DB claim/lease serialize eder.
- Provider timeout'u açıkça tanımlıdır; sonsuz bekleme yoktur.
- Retry backoff ve maksimum pencere F09-03'te sabitlenir; varsayılan hedef 72 saatlik sınırlı retry penceresidir.
- Provider idempotency key `notification job/event identity` ile stabildir; yalnız appointment ID kullanmak ileride aynı appointment'taki farklı notification türlerini çarpıştırmamalıdır.
- Provider “accepted” deyip HTTP cevabı kaybolursa aynı provider idempotency key ile retry yapılır. Provider'ın garanti penceresi dışında mutlak exactly-once iddiası kurulmaz.
- `sent` receipt yalnız server dispatcher tarafından yazılır.

### Dar server gönderim yetkisi

Worker service-role kullanmayacaktır. DB claim/complete RPC'leri genel anon caller'ın kullanamayacağı **server-only dispatcher proof** ister. Uygulama F09-03'te tek yöntem seçip belgeler; kabul edilebilir model:

- raw dispatcher secret yalnız Worker env'de,
- DB'de yalnız bu secret'ın hash'i private/config alanda,
- security-definer claim/complete RPC proof hash'ini doğrular,
- public/anon doğrudan tablo grant'i almaz ve proof olmadan job claim/receipt yazamaz.

Secret repo/migration içine düz değer olarak commit edilmez; environment/staging provisioning F17-01 ile belgelenir.

## 7. Hata kodları ve kullanıcı davranışı

| Kod / durum | HTTP | Anlam | UI davranışı |
| --- | ---: | --- | --- |
| `SLOT_UNAVAILABLE` | 409 | Appointment commit olmadı | Saat listesini yenile, başka slot seçtir |
| `IDEMPOTENCY_CONFLICT` | 409 | Aynı key farklı booking/bootstrap intent ile kullanıldı | Yeni booking otomatik yaratma; kullanıcıya tekrar başlatma mesajı |
| `BOOKING_RECOVERY_NOT_FOUND` | 404 | Key/secret/business eşleşmedi veya proof expired | Randevu var/yok bilgisini sızdırma; destek/yeniden rezervasyon yönlendirmesi |
| `BOOKING_RECOVERY_EXPIRED` | 410 veya generic 404 | Recovery penceresi kapalı | Uygulamada seçilecek tek dış davranış F09-02 testinde sabitlenir; enumeration yaratılmaz |
| booking response network loss | n/a | Commit durumu belirsiz | Yeni key üretmeden recovery dene |
| `notification: queued` | 2xx booking | Booking committed, mail bekliyor | Başarı ekranını göster; “E-posta hazırlanıyor” |
| `notification: failed` | 2xx recovery/status | Booking committed, delivery terminal/geçici sorun | Başarı ekranını koru; manage link ekranda göster; mail durumunu ayrı açıkla |
| provider timeout/outage | n/a | Booking'i etkilemez | Background retry; müşteri booking hatası görmez |

F09-02 `BOOKING_RECOVERY_EXPIRED` dışarıya 410 mu yoksa enumeration'ı azaltmak için generic 404 mü döndüreceğini tek seçim olarak sabitler; her iki durumda yanlış proof ile gerçek appointment varlığı ayrıştırılamaz.

## 8. Zorunlu senaryo matrisi

| Senaryo | Beklenen sonuç |
| --- | --- |
| DB commit'ten sonra booking HTTP cevabı kesilir | Aynı key/recovery proof ile tek mevcut appointment geri gelir; ikinci appointment yok |
| Sayfa booking sonrası refresh edilir | sessionStorage pending proof ile recovery çalışır ve başarı ekranı/manage link geri gelir |
| Tarayıcı booking commit'ten sonra kapanır | Booking kalır; durable notification job browser olmadan retry edebilir |
| Aynı create aynı key ile eşzamanlı iki kez gelir | Tek appointment/capability/job oluşur; iki çağrı aynı appointment sonucuna bağlanır |
| Aynı key, farklı booking payload | `IDEMPOTENCY_CONFLICT`; mevcut appointment açığa çıkmaz/değişmez |
| Aynı key, farklı management/recovery secret | `IDEMPOTENCY_CONFLICT`; capability sessizce değişmez |
| Recovery'de yanlış secret | Generic not-found; appointment summary/token/PII yok |
| Recovery'de farklı business/slug | Generic not-found; cross-tenant bilgi yok |
| Client yeni idempotency key ile “recovery” deniyor | Eski booking recover edilmez; create ise normal yeni booking intent kurallarına tabidir ve mevcut doluluk nedeniyle aynı slotta çakışır |
| Provider tamamen kapalı | Booking 2xx başarı + queued/pending; job retry; appointment rollback yok |
| Provider accepted, response kayboldu | Stable provider idempotency ile retry; DB receipt yalnız doğrulanmış server flow'dan |
| Anon caller booking key + appointment ID biliyor | Notification `sent` receipt yazamaz, outbox claim edemez |
| Recovery TTL doldu | Recovery proof geçersiz; management capability daha önce edinilmiş linklerde çalışmaya devam eder |

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
- Yeni atomik create yalnız yeni public booking'ler için recovery/outbox metadata üretir; eski appointment'lara geriye dönük sahte recovery secret oluşturulmaz.
- Faz 9 deployment'ı mevcut Faz 8 verisi üzerinde migration testinden geçer.
- PR #8'in `20260911160000_phase9_email_delivery.sql` dosyası main'e birleşmediği için yeni uygulama onun içeriğini kopyalamak zorunda değildir. Migration adı/sırası gerçek merge stratejisinde tek kez kullanılacak şekilde F09-02/F09-03 arasında koordine edilir.

## 11. Scope ayrımı

### F09-02 teslim edecek

- atomik appointment + management capability + recovery bootstrap,
- recovery endpoint ve refresh sonucu,
- booking UI'nın “commit edilmiş randevu = başarı” davranışı,
- recovery proof/TTL ve temel network-loss HTTP testleri.

### F09-03 teslim edecek

- durable notification outbox/job,
- encrypted management-token material lifecycle,
- provider timeout/retry/lease,
- server-only dispatcher proof,
- authoritative receipt ve provider stub testleri.

### F09-04 teslim edecek

- Worker rate-limit/abuse politikası,
- direct Supabase RPC bypass yüzeyinin kapatılması veya aynı server proof sınırına alınması,
- 429/retry davranışı ve bulk-attempt testleri.

### F09-05 teslim edecek

- F09-02/03/04 + staging/test temelinin birleşik gerçek ortam kabulü.

## 12. F09-01 kabul kontrolü

- [x] PR #8 yeniden kullanılacak/atılacak parçalar eşlendi.
- [x] Booking sonucu, idempotency, management capability, recovery proof ve provider delivery birbirinden ayrıldı.
- [x] Response loss, refresh, browser close, wrong proof, concurrent retry, key/payload değişimi ve provider outage somut sonuçlarla tanımlandı.
- [x] Plain management token'ın kalıcı DB/log alanına yazılmadığı yaşam döngüsü tanımlandı.
- [x] Browser kapalıyken notification retry için encrypted-at-rest token material sözleşmesi tanımlandı.
- [x] Client/anon'un provider receipt yazamayacağı dar server dispatcher authority tanımlandı; service-role kullanılmadı.
- [x] Eski Faz 7 management linkleri ve birleşmiş migration'ların uyumluluk sınırı tanımlandı.
- [x] F09-02, F09-03, F09-04 ve F09-05 sorumlulukları ayrıldı.

## Devir

F09-02'nin ilk somut adımı: bu sözleşmedeki atomik create/recovery modelini **ileri migration + Worker route + PublicBookingPage recovery state** olarak uygulamak ve senaryo matrisindeki F09-02'ye ait network-loss/refresh/wrong-proof/concurrent-retry testlerini eklemek. F09-02, provider HTTP çağrısı veya reminder motoru yazmaz.
