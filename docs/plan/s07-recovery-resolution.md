# S07 — Belirsiz rezervasyon sonucunu kesinleştirme

**13 Eylül 2026 · Sözleşme ve uygulama devri. Henüz runtime teslimi değildir.** İncelenen main: `0238ce39fae3b3c8bfd3315599b4f130b152f2fb`. Görev S07; koordinatör ana ajan, bağımsız tasarım incelemesi GPT-5.6 Sol. Bildirim süre sınırının kabulü korunur; S07 ve GS açıktır. Canlı durum [S07 devrinde](../handoffs/S07.md), görev kaydı [TASKS](../../TASKS.md) içindedir.

Bu belge [F09 kurtarma sözleşmesini](f09-01-recovery-contract.md) aşağıda açıkça belirtilen **v2** davranışları ve geçiş sonunda yeni v1 oluşturmanın kapatılmasıyla günceller. Mevcut v1 recovery/proof ve güvenli replay sınırı korunur. [K03](architecture-contracts.md#k03), S03 gönderim tutarlılığı ve S04 kaynak sınırları korunur.

## 1. Kaynak incelemesinin kesin sonucu

| Kaynak | Doğrulanan davranış | Açık sınır |
| --- | --- | --- |
| `20260911160000_phase9_booking_recovery.sql` | Create ve recover aynı `recovery_id` için transaction advisory lock alır | Create bu kilide henüz ulaşmadıysa önce gelen recovery boş dönebilir |
| `20260913030912_s04_resource_limits.sql` | Book kolu da aynı kilidi kullanır; gate, istek kotası, prune ve argüman kontrolü bundan öncedir | İstemci/Worker/ağ veya kilit öncesindeki gecikme mümkündür |
| `20260911130000_phase6_public_booking.sql` | Kalıcı komut anahtarı ve normalize payload hash'i tekrarları sınırlar | İstemcinin farklı anahtarla başlatacağı işlemi eski anahtar koruyamaz |
| `src/PublicBookingPage.tsx` | Generic recovery 404 pending/key'i temizler; 72 saatlik yerel süre aşımı da kaydı siler | 404 yanlış proof veya süresi dolmuş gerçek rezervasyon anlamına da gelir; yokluk kanıtı değildir |
| `worker/auth.ts` | Ortak Auth/veri çağrısı gövdeyi kapsayan süre sınırına henüz bağlı değildir | HTTP iptali DB rollback kanıtı olarak kullanılamaz |

**Mevcut SQL'de kilit olmadığı iddiası yanlıştır.** Create kilidi aldıysa recover onun transaction sonucunu bekler. Yeni sözleşme kilit öncesindeki yarış ile generic 404'ün birden fazla anlamını kapatır. Canlıda çift kayıt gözlemlendiği iddia edilmez.

## 2. Seçim ve değişmezler

V2 işlem kimliği, kısa bir **ilk yazım son zamanı** ve recovery proof'a kriptografik bağ taşır. Sonuç kesinleştirme, mevcut recovery kilidi altında ya commit edilmiş randevuyu bulur ya da aynı kimliğin gelecekte yazılmasını kapatır. Bu kapatma randevu iptali değildir; mevcut randevuyu değiştirmez.

- Generic `BOOKING_RECOVERY_NOT_FOUND` **hiçbir sürümde yeni işlem açma kanıtı değildir**.
- Kesin `closed_absent` yalnız doğrulanmış v2 kimliği ve başarılı DB transaction sonucu için verilir.
- Timeout, HTTP iptali, 429, bozuk yanıt, kilit beklemesi veya kayıp yanıt `unknown` bırakır. Helper otomatik create tekrarı yapmaz.
- V2'de create'e gönderilmiş herhangi bir isteğin olumsuz cevabı tek başına pending'i temizlemez. Aynı kimlikle resolve gerekir. Böylece başka bir eşzamanlı create'in sonradan başarılı olma ihtimali de kapanır.
- Normal başarı mevcut atomik appointment/capability/audit/outbox işlemini kullanır. İkinci booking motoru veya genel bir iş akışı altyapısı kurulmaz.
- Management token bağımsız, rastgele 256 bit kalır; recovery secret'tan türetilmez. Plain token, form içeriği ve müşteri PII kalıcı tarayıcı pending kaydına yazılmaz.
- Yeni servis, paket bağımlılığı, imzalama anahtarı veya zorunlu bootstrap yazımı yoktur. Mevcut public business cevabına sunucu saat örneği eklenir.

### F09'dan açıkça değişen üç sınır

1. V2'de aynı tarayıcının sekmeleri pending proof'u atomik ortak kayıttan kullanır. `sessionStorage` yerine origin kapsamında IndexedDB seçilir; istemci kurtarma kullanım penceresi mevcut 72 saattir. Süresi dolan ham proof uygulamanın ilk sonraki okuma/temizlik işleminde silinir; tamamen kapalı tarayıcıda tam 72. saatte fiziksel silme garantisi verilmez. Bu, tarayıcı kapandıktan sonra da sürebilen bir capability saklama değişikliğidir. Proof, TTL içinde yönetim bağlantısı açabildiği için sır gibi korunur; loga/telemetriye gönderilmez.
2. Geçerli v2 proof, recovery TTL sonrasında **yalnız önceki işlemin commit edilmiş olduğunu** doğrulayabilir. Snapshot, PII, ciphertext veya yönetim yetkisi vermez. Yanlış proof ve v1'in expired proof'u aynı generic 404 sınırında kalır.
3. Pending süresinin dolması geçmişi yok saymaz. Sır silindiğinde sonuç doğrulanmamışsa asgari `expired_unverified` işareti kalır; yeni booking kendiliğinden açılmaz. Daha önce verilmiş yönetim bağlantısının yetkisi değiştirilmez.

## 3. V2 kimliği: tek ve kanonik format

Browser rastgele UUID v4 `recoveryId` ve birbirinden bağımsız 32 byte recovery secret/management token üretir. V2 secret validasyonu tam 43 base64url karakteri, decode sonucunda 32 byte ve tekrar encode edildiğinde birebir aynı metni gerektirir; mevcut v1'in 43–128 karakter kontrolü yeterli değildir. UUID lowercase kanonik biçimdedir.

```text
secretHash = lowercase_hex(SHA-256(UTF-8(recoverySecret)))
deadline = canonical base-10 epoch seconds
preimage = "yzt:public-booking:intent:v2" + LF
         + lowercaseRecoveryId + LF
         + deadline + LF
         + secretHash
binding = lowercase_hex(SHA-256(UTF-8(preimage)))
idempotencyKey = "pub2_" + deadline + "_" + binding
```

Tam key regex'i `^pub2_([1-9][0-9]{9})_([0-9a-f]{64})$` olur; 80 ASCII karakterdir ve mevcut 128 sınırına sığar. Boşluk, CRLF, büyük hex, leading zero, kesir, bilimsel gösterim veya sondaki LF kabul edilmez. Ayrıştırma regex ile sınırlıdır; serbest timestamp yorumu yapılmaz. Worker ve SQL aynı sabit test vektörlerini bağımsız hesaplar. SQL ham secret almaz; Worker'ın hesapladığı hash'i kullanır. Key/UUID tek başına proof değildir.

Sabit pozitif vektör (yalnız test verisi; üretim secret'ı değildir): UUID `8c000000-0000-4000-8000-000000000207`, deadline `1790000000`, recovery secret 43 ASCII `A` karakteri (32 sıfır byte'ın kanonik base64url biçimi). Beklenen secret hash `0f007385b6f9d4b7eeb2748605afe1a984a0a3bfa3f014d09e2a784ce9e5cd1a`; beklenen key `pub2_1790000000_b8b99f15340658f0c76387b36c46931170676b2964e9dde9314cb1be613f5f81`. Bu vektör format/hash kabulüdür; canlı saat penceresinde geçerli booking iddiası değildir.

`recoveryId`, key ve deadline ilk intent için değişmez. `pub2_` prefix'li bozuk key v1'e düşürülemez. V1 key'e yeni süre/format uygulanmaz. Mevcut bootstrap token-hash kontrolü ve booking payload conflict kontrolü korunur; yeniden şifreleme kalıcı capability'yi değiştirmez.

### Saat ve ilk yazım süresi

- Mevcut business GET cevabı `bookingClock: { serverNowEpochSeconds, submitWindowSeconds: 300 }` içerir; bu ek alan eski istemciyi bozmaz ve yeni DB yazımı doğurmaz. Paylaşılan cache kullanılmaz.
- İstemci örneği alırken monoton `performance.now()` kaydeder. Yeni intent için örnek 30 saniyeden eskiyse önce mevcut GET yenilenir. Başarısız saat yenilemesinden sonra create gönderilmez. Yerel duvar saati key veya deadline otoritesi değildir.
- Deadline örneğin sunucu zamanına 300 saniye eklenerek sabitlenir; sonradan uzatılmaz. Worker/DB en fazla mevcut zamandan 330 saniye ileri deadline kabul eder. Bu 30 saniye saat/ağ toleransıdır; ölçülmüş gecikme iddiası değildir.
- **Authoritative kontrol create kilidi aldıktan sonra yapılır: önce exact fence okunur, sonra son `clock_timestamp() >= deadline` kontrolü yazımı reddeder.** Tercihen tek SQL karar statement'ı kullanılır. Önce deadline kontrol edilip daha sonra fence okunması, arada prune olduğunda güvenli değildir. Transaction başlama zamanı olan `now()` geç gelen isteği yanlışlıkla kabul ettirebilir. Deadline slotu 5 dakika rezerve etmez; yalnız henüz başlamamış bu komutun yazım yetkisini sınırlar.
- Kilidi deadline'dan önce almış create çalışırken resolve aynı kilitte bekler. Create commit ederse sonuç döner; rollback olursa resolve kapatabilir. Toplam DB bekleme bütçesi ayrıca S07'de ölçülür; bu sözleşme DB süresini kendiliğinden sınırlamış sayılmaz.
- Aşırı gelecekteki/malformed kimlik için terminal yokluk sonucu verilmez, kapanış satırı yazılmaz. Saat/kontrat hatası kullanıcıya belirsizlik olarak gösterilir; kimlik otomatik değiştirilmez.

## 4. Sunucu kesinleştirme işlemi

V2 için ayrı `POST /api/public/booking/resolve` eklenir. Body yalnız mevcut `recoveryId`, `idempotencyKey`, `recoverySecret` alanlarıdır. V1 `/recover` geriye uyumlu kalır; `resolve` v1 isteği kabul etmez. V2 geçişinde istemci bu ayrımı açıkça bilir.

RPC yalnız mevcut Worker gate üzerinden erişilir. S04 actor/network recovery kotası resolve için de geçerlidir; quota/gate/prune/argüman sınırları atlanmaz. Yeni public table grant veya service-role yoktur.

İşlem sırası:

1. Biçim ve key/proof bağını doğrula; yanlış proof generic 404 olur, hiçbir kapanış kaydı yazılmaz.
2. Mevcut `pg_advisory_xact_lock(hashtextextended(recovery_id::text, 0))` kilidini al. Create'in aynı kilit alanını koru.
3. Aynı kimliğin recovery/appointment/`booking_commands` bağlantısını kontrol et. V2 proof otoritesi key binding'in yeniden hesaplanması ve kayıtlı exact recovery ID/key bağıdır; süresi dolmuş `recovery_secret_hash` eşitliğine dayanmaz. Komut aynı business/appointment'a bağlı, `source=public` ve `command=public_create` olmalıdır. Süresi dolmuş ciphertext'in temizlenmesi komut varlığını yok etmez. Tutarsız referans veya beklenmedik tamamlanmamış satır `unknown` olur; yok diye kapatılmaz.
4. Aşağıdaki sonucu aynı transaction içinde üret. Worker yalnız başarılı RPC zarfını terminal HTTP sonucuna çevirebilir; ağ koparsa aynı resolve güvenle tekrarlanır.

| Kilit altındaki durum | V2 sonucu | Veri ve sonraki yazım |
| --- | --- | --- |
| Commit var, geçerli TTL ve çözülebilen capability | `committed` | Mevcut confirmation/manage sonucu; yeni appointment/capability yok |
| Commit var, recovery TTL dolmuş veya yönetim linki sunulamıyor | `exists_nolink` | Yalnız commit teyidi; PII/snapshot/ciphertext yok. Link çözme hatası booking'i yok saymaz |
| Commit yok, deadline açık | `closed_absent` | Önce bu v2 key için kalıcı kapanış satırı; sonraki create reddedilir |
| Commit yok, deadline geçmiş | `closed_absent` | Yeni kapanış satırı gerekmez; kilit sonrası deadline denetimi geç create'i reddeder |
| Önceki resolve zaten kapatmış | `closed_absent` | Tekrarlanabilir aynı sonuç; yeni yan etki yok |
| Proof yanlış, v1, bozuk kimlik veya tutarsız veri | Generic 404 / `unknown` | Mevcut kaydı sızdırma; pending/key korunsun |

Başarılı HTTP zarfı açık `resolution` ve aynı `recoveryId` içerir. UI karşılığı tam doğrulanır; 2xx gövdesi okunamadı diye terminal varsayılmaz. `exists_nolink`, alınmış randevunun iptal edildiği anlamına gelmez. Decrypt sırasında hata oluştuysa Worker doğrulanmış commit bilgisini korur ve güvenli bağlantısız sonucu verir.

### Kapanış kaydı ve maliyet sınırı

Tek dar tablo yalnız v2 key (PK), recovery UUID, submit deadline ve closed-at tutar. Okunan fence'in UUID/deadline'ı da doğrulanır; yalnız PK eşleşmesiyle tutarsız satır terminal sayılmaz. PII, ham/hash recovery secret, management token/ciphertext, form içeriği ve full URL tutmaz. Explicit PUBLIC/anon/authenticated revoke, RLS ve gerekli internal function ACL'leri yeni migration'da yazılır ve mevcut ACL envanteri testine bağlanır. PK exact key araması ve deadline/kararlı anahtar prune erişimi dışında gerekçesiz indeks eklenmez. Mutation/DB kontrol fonksiyonları `VOLATILE`; yalnız saf key verifier `IMMUTABLE` olabilir. Yeni definer fonksiyonları sabit dar search_path ve schema-qualified nesne/fonksiyon adları kullanır; hash fonksiyonunun şeması varsayılmaz.

Create mevcut recovery kilidinden **hemen sonra**, bootstrap/appointment/outbox yan etkilerinden önce v2 proof, exact kapanış kaydı ve en son gerçek zaman sınırını kontrol eder. S04 wrapper kontrolü optimizasyon olabilir; asıl raw create sınırının yerini alamaz. Legacy write yolları v2 key ile bu guard'ı atlayamaz: iç Phase6 create yalnız doğrulanmış dış akıştan ulaşılabilir; doğrudan public grant kapalı kalır.

Kapanış satırları DB zamanına göre deadline + 60 saniye geçince mevcut maintenance yolundan temizlenir: en fazla 500 satır, `(submit_deadline, key)` sırası ve `FOR UPDATE SKIP LOCKED`. Bu 60 saniye küçük saat oynaması/bakım çekişmesi payıdır; doğruluk fence-first/final-clock sırasına dayanır. Yeni cron/queue yoktur. Temizleme başarısızsa kapanış güvenliği devam eder; maliyet/büyüme ölçümü S07'de yapılır. Create deadline kontrolü ile fence okumasının arasına prune koyan ters yarış testi zorunludur. Komut/recovery sonuç referansı randevu yaşarken korunur; expiry yalnız sır/ciphertext temizliğiyle karıştırılmaz.

## 5. İstemci, yenileme ve ikinci sekme

Tek amaçlı IndexedDB pending modülü kullanılır; genel storage/state framework kurulmaz. Kayıtlar intent kimliğiyle tutulur ve işletme slug'ı ile sorgulanır. Aynı origin/slug için **pending yok kontrolü ve yeni intent kaydı tek readwrite transaction'dır**. İki eşzamanlı sekme farklı anahtarları sessizce sahiplenemez. Bağımsız tarayıcı/cihazların aynı müşteri olduğunu takip etme kapsam dışıdır.

- İlk create yalnız pending transaction'ı commit olduktan sonra gönderilir. Storage açma/yazma başarısızsa güvenilir recovery varmış gibi POST atılmaz; anlaşılır tekrar deneme verilir.
- Ham proof dışında kayıt: version, slug, key, recovery ID, 64-lowerhex request fingerprint, örneklenmiş zaman/expiry, submit deadline, başlatan akış ve durum. Fingerprint formun yerine geçmez; payload saklanmadığı için reload sonrası yeniden oluşturma yetkisi değildir.
- İlk tab create cevabını beklerken ikinci tab hemen resolve edip isteği gereksiz kapatmamalıdır. Ortak kayıtta initial 10 saniyelik HTTP bütçesine 2 saniye pay veren `settleAfter` bulunur. Başlatan tab create cevabından sonra resolve edebilir; reload/diğer tab bu kısa pencere bitene kadar aynı işlemi bekler. Bu UX düzenidir; SQL güvenliği bu zamana bağlı değildir.
- Sekme olayları yalnız yeniden okumayı tetikler; storage kaydı otoritedir. Geç cevap veya başka sekmenin mesajı yeni intent'i silemez: bütün terminal yazımlar/silmeler **aynı intent kimliği ve beklenen durum** karşılaştırmasıyla yapılır.
- Belirsiz create sonrasında en fazla bir otomatik resolve vardır. Sürekli polling veya create retry döngüsü yoktur. Sonraki deneme kullanıcı eylemiyle; 429'da Retry-After korunarak yapılır. Worker→Supabase çağrısında mevcut helper fetch+body'yi 10 saniyeyle sınırlar. Ayrıca **browser create/resolve fetch+body** için caller signal'ı koruyan 10 saniyelik iptal gerekir; mevcut `src/api.ts` bunu henüz sağlamaz. Timer/listener temizliği ve body asılması ayrıca test edilir. Tarayıcı ve Worker süreleri aynı yolculuk için tek toplam bütçe diye raporlanmaz.
- `committed` ve `exists_nolink`: pending atomik olarak proof/PII/token içermeyen terminal commit kaydına çevrilir; diğer tab ve reload önceki işlemin alındığını görür. Yönetim linki yalnız mevcut ekran belleğinde kalır; kalıcı receipt'e yazılmaz. Bağlantısız sonuç işletmeyle bağlantı kurtarma bilgisini sunar; failure ekranı değildir. Başka randevu ancak açık yeni kullanıcı eylemidir.
- `closed_absent`: eski kimlik terminal kaydedilir, proof silinir, güncel slotlar tekrar okunabilir. Yeni anahtar ancak kullanıcının yeni gönderimiyle üretilir; arka planda booking yaratılmaz.
- Generic 404, timeout, 429/503 ve gövde/kimlik uyuşmazlığı pending'i korur. Pending varken form değişikliği yeni key üretmez.

### V1 ve süre aşımı geçişi

Eski `yzt-public-booking-pending-v1:<slug>` kayıtları değiştirilmiş v2 key ile yeniden gönderilmez. Import önce mevcut kaydı okur; yeni IndexedDB transaction'ı başarıyla tamamlanmadan session kaydı silinmez. İki sekmeden gelen farklı legacy intent'ler birbirinin üzerine yazılmaz; ikisi de bilinmeyen sonuç olarak korunur.

V1 geçerli proof yalnız eski recover yolunu kullanır. Generic 404, bozuk JSON/fingerprint veya 72 saatten eski kayıt otomatik `null/remove` ve yeni booking izni üretmez. Kurtarılabilir sır geçerliyse korunur; expired/bozuk kayıtta asgari `legacy_unknown`/`expired_unverified` işareti tutulur, PII/ham bozuk içerik taşınmaz. Eski sürümün zaten sildiği veya kapanmış sekmeyle kaybolmuş proof geri üretilemez.

Eski belirsiz intent'i server kanıtı olmadan güvenle kapatabildiğimiz iddia edilmez. Kullanıcı mevcut e-posta/yönetim bağlantısı veya işletmeyle önceki randevuyu kontrol edebilir. Yerel kaydı bilinçli kaldırma açıkça sadece cihazdaki hatırlatıcıyı kaldırır; randevu iptali veya yokluk kanıtı sayılmaz. Bu istisna normal v2 akışına üç günlük kilit getirmek için kullanılmaz. Tarayıcı verilerinin kullanıcı tarafından temizlenmesi, farklı origin/profil ve başka cihaz koordinasyonu bu yerel korumanın dışındadır.

## 6. Zorunlu kabul matrisi

| Senaryo | Gerekli kanıt |
| --- | --- |
| Create recovery kilidini tutuyor, resolve geliyor | Ayrı gerçek PG bağlantıları; resolve commit sonucunu görür, kapanış yazmaz |
| Create kilit öncesinde tutulmuş, resolve önce bitiyor | `closed_absent` commit; bırakılan eski create appointment/customer/event/capability/outbox üretemez |
| Kapanış commit edilmiş, HTTP cevabı kayıp | Aynı resolve aynı terminal sonucu verir; yeni booking yok |
| Kapanış prune edilmiş, eski create sonradan geliyor | Kilit sonrası gerçek saatle deadline reddi; fixture `now()` hatasını yakalar |
| Create kontrolü sürerken maintenance fence'i siliyor | Ayrı PG bağlantılarıyla prune/control yarışı; exact fence-first ve final clock kapatılmış komutun yazımını engeller |
| Geçerli proof + TTL/material temizliği + gerçek commit | `exists_nolink`; asla `closed_absent`, PII/link yok |
| Yanlış proof/key/UUID/deadline; sahte veya bozuk v2 prefix | Generic nonterminal sonuç, fence ve veri sızıntısı yok; v1 fallback yok |
| Canonical key vektörleri | TS/Worker ve PG aynı pozitif değer; LF/CRLF/case/zero/encoding negatifleri |
| Canonical v2 secret | Tam 43 karakter, decode 32 byte, encode round-trip; alias/padding/uzun secret reddi |
| Aynı key + farklı payload/bootstrap; create ve resolve yarışı | Tek komut sınırı, conflict/terminal ayrımı; capability/outbox değişmez |
| Slot reddi sonrası başka gecikmiş create | Client olumsuz booking cevabıyla temizlemez; resolve sonrası eski key yazamaz |
| Çok erken/bozuk saat; saat örneği yenilenemiyor | Belirsiz yanlış tarih için sahte `closed_absent` yok; pending oluşmadan saat hatasında POST yok |
| Reload/iki tab/çift tıklama ve gecikmiş eski callback | Gerçek tarayıcı IndexedDB transaction; aynı pending benimsenir, yeni intent silinmez; create sürerken erken resolve yok |
| Başarı sonrası reload/başka tab | Sırsız commit kaydı görünür; mevcut başarı yalnız bir tabın belleğine sıkışmaz; yeni randevu açık eylem ister |
| Storage kapalı/dolu; v1 import yarım; iki eski intent | Create öncesi güvenli hata; proof kaybolmaz/üzerine yazılmaz; generic 404 yeni key açmaz |
| Header/body timeout, Auth 503, refresh iptali | Aynı HTTP helper; status 0, oturum cookie'sini hatalı temizleme yok; otomatik write retry yok |
| S04 quota ve yeni nesne ACL | Resolve aynı recovery kotasında; gate olmadan RPC/tablolar erişilemez; PUBLIC/anon/authenticated negatif testleri |
| V1 geçiş sonu | Yeni v1 first-create reddi; eski mevcut komutun proof/replay sınırı korunur; eski tab yeni kayıt açmak için güncellenir |
| Gerçek staging | Aynı code head'de routine deploy + gerçek F09 zinciri + v2 timeout/resolve, refresh/iki tab; fixture temizliği ve version kanıtı |

Concurrency kanıtı kaynak regex'i, tek bağlantılı SQL veya yalnız mock sırasıyla tamamlanmış sayılmaz. Mevcut Node/typecheck/build, PG17, S05 ve tarayıcı kapıları korunur. Gerçek browser kabulünde `control-browser`; DB işlerinde `supabase:supabase` ve `supabase:supabase-postgres-best-practices` okunur. CLI migration adı `supabase migration new` ile alınır; birleştirilmiş migration değiştirilmez.

## 7. Uygulayıcıya sıralı paketler

Bunlar yeni TASKS kimliği veya ürün fazı değildir; **S07'nin sıralı alt paketleridir**. Her kod branch'i başlamadan güncel main SHA ve açık PR sahipliği tekrar kaydedilir. Ortak dosyalarda aynı anda iki yazıcı olmaz.

| Sıra | Tek sahip ve dosya sınırı | Çıkış ölçütü |
| --- | --- | --- |
| A — Sunucu uyumluluğu | Sol: CLI ile yeni ileri migration; `worker/public-booking-recovery.ts`, `worker/public-rpc.ts`, `worker/public-booking.ts` yalnız clock/resolve; bir dar key helper; `worker/notification-maintenance.ts` yalnız bounded closure prune bağlantısı gerekirse; ilgili Node/PG/concurrency testleri. CI kayıtları yalnız yeni gerçek testleri mevcut gate'e bağlamak için | V1 davranışı korunur; v2 guard/resolve/ACL/deadline yarışı gerçek PG'de geçer. UI ve ortak `auth.ts` timeout henüz değişmez. Root bağımsız migration incelemesi |
| B — İstemci ve ortak HTTP | A main tabanı. Sol: `src/PublicBookingPage.tsx`, dar pending/key modülü, `src/api.ts` yalnız açık create/resolve caller timeout desteği gerekirse, `worker/auth.ts` mevcut timeout helper bağlantısı; yeni v1 first-create'i kapatan ikinci ileri migration/Worker hata eşlemesi ve ilgili client/HTTP/PG/browser testleri; gerekli staging testleri. Root geçiş migration'ını bağımsız inceler | V2 atomik pending/reload/ikinci tab/legacy/TTL kanıtı; aynı değişimde genel Auth/veri fetch+body 10 sn sınırı. İşlem key'i sessiz değişmez. Sunucu deadline otoritesi ve mevcut v1 recovery/safe replay korunur |
| C — Gerçek kabul ve kayıt | Root: kod incelemesi, staging kabulü ve yalnız PROJECT_STATE/TASKS/S07 devir kanıtları; Sol ölçülü düzeltmede tanımlı dosya sahibi | CI ve gerçek staging aynı code head; commit/tree/version, gözlenen kapsam ve kalan S07 açıkları yazılır |

A'nın tek başına main'e alınması müşteri akışını düzeltmiş sayılmaz. B runtime geçişidir; gerçek kabul C'de tamamlanır. A'da clock/resolve çıkışı B sözleşmesine hazır değilse frontend geçişi veya genel HTTP timeout açılmaz. Production yayını bu doküman teslimiyle yapılmaz.

**Eski istemciyi kapatma sırası:** A, yeni sunucu sözleşmesini v1 first-create'i bozmadan ekler. B, UI'ı v2'ye geçirir ve sunucuda yeni v1 first-create'i kapatır. Mevcut v1 recovery ve mevcut komuta exact proof/payload ile izin verilen replay korunur; yeni v1 komutuna `BOOKING_CLIENT_UPDATE_REQUIRED` verilir. Bu karar mevcut recovery lock altında ve herhangi yeni bootstrap/domain kaydından önce alınır; yokluk yanıtı gibi yorumlanmaz. Eski açık tablar yeni rezervasyon için güncellenir; kayıtlı pending'leri kaybolmaz. Yeni config/feature-flag servisi eklenmez. Geçiş migration'ı, eski Worker/UI'ın reddi ve migration öncesi başlamış v1 DB işlerinin bitişi staging kabulünde ayrıca doğrulanır; eski kodla çalışan DB işi kalmışken tam cutover kabulü verilmez. A veya B'nin kısmi yayını S07 kabulü sayılmaz. Kurtarılamayan tarihsel v1 proof için bölüm 5'in dürüst manuel sınırı geçerlidir.

Kapsam dışı: yeni ürün fazı, hizmet/ekip/takvim UX revizyonu, tam payload'ı tarayıcıda saklayarak otomatik yeniden booking, bağımsız tarayıcılar arası müşteri takibi, yeni altyapı/telemetri paketi. S07 terminal PII retention, liste sayfalaması, DB sorgu/bekleme bütçesi ve p95/maliyet ölçümü ayrıca açıktır; S08 başlatılmış sayılmaz.

## Resmi dayanak ve inceleme sınırı

[PostgreSQL advisory locks](https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS) transaction kilidinin sahipliği/ömrü için; [PostgreSQL saat fonksiyonları](https://www.postgresql.org/docs/current/functions-datetime.html#FUNCTIONS-DATETIME-CURRENT) transaction zamanı ile gerçek saati ayırmak için; [Supabase timeout katmanları](https://supabase.com/docs/guides/database/postgres/timeouts) istemci ve DB sınırlarını ayırmak için kullanılır. [IndexedDB transaction scheduling](https://www.w3.org/TR/IndexedDB/#transaction-scheduling) aynı kapsamlı readwrite işlemlerinin sıralanmasına dayanak sağlar; gerçek hedef browser testi yine gereklidir. Hosted rol timeout'ları varsayılmadı. Bu belgelerdeki sağlayıcı varsayılanları gerçek staging ölçümü yerine geçmez.
