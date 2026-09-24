# Staging runbook

S05, anahtar değişimini rutin dağıtımdan ayırır. Rutin deploy ve açık rotation gerçek staging'de doğrulanmış ve PR #41 ile main'e alınmıştır; kanıtın kapsamı ve operasyon sınırları [S05 devrinde](../handoffs/S05.md) tutulur. Bu kayıt production/pilot kabulü değildir. Secret, DB verifier, probe yanıtı, parola ve şifresiz yönetim bağlantısı Git'e, loga veya artifact'a yazılmaz.

## Canlı kabul durumu

- Supabase project: `randevu-staging`, ref `smizhsagjpqexveitbqu`, region `eu-central-1`.
- Cloudflare Worker: `yzt-randevu-staging`.
- Kabul edilen workers.dev origin: `https://yzt-randevu-staging.ziyabeey1.workers.dev`.
- F17-01 base environment acceptance: GitHub Actions `Staging deploy` run `34679959999` → **success**.
- F09-05 gerçek booking/provider delivery acceptance: run `34681540142` → **success**.
- S05 aynı `7133650` kodunda [routine #18](https://github.com/ziyabeey1-ai/randevu/actions/runs/34747433290) ve [rotate #19](https://github.com/ziyabeey1-ai/randevu/actions/runs/34747719210) → **success**; yeni pair/önceki S05 management canary/Cron/F09 ve atomik DB promote doğrulandı. F09 sağlayıcı teslimi Resend test alıcısınadır.
- Base smoke: health → login → session → business select → catalog.
- F09 acceptance: lost-response recovery → idempotency/capability/receipt authority → durable outbox → Resend provider record → güvenli test recipient `delivered`.
- Production verisi staging fixture'a kopyalanmaz.

## Alan adı planı

- Production: `https://randevu.kepenk.ai`
- Staging temel origin: `https://yzt-randevu-staging.ziyabeey1.workers.dev`
- Staging custom-domain hedefi: `https://staging.randevu.kepenk.ai`
- Transactional sending domain: `notify.kepenk.ai`
- Sender: `randevu@notify.kepenk.ai`

Custom staging domain temel F17-01/F09-05 kabulünün önkoşulu değildir; workers.dev origin ile staging ve delivery zinciri canlı doğrulanmıştır.

## GitHub `staging` environment dış sözleşmesi

Normal staging deploy için GitHub Environment `staging` altında şu **4 runtime/provisioning secret** gerekir:

### Cloudflare

- `CLOUDFLARE_API_TOKEN`

Token mümkünse yalnız Randevu'nun bulunduğu tek Cloudflare hesabına ve gerekli Workers işlemlerine scope'lanır.

`CLOUDFLARE_ACCOUNT_ID` secret değildir. Workflow `wrangler whoami --json` ile tokenın görebildiği hesapları okur ve **tam olarak bir hesap** görmeyi fail-closed şart koşar.

### Supabase privileged erişim

- `SUPABASE_DB_PASSWORD`
- `SUPABASE_ADMIN_KEY`

`SUPABASE_DB_PASSWORD` ham veritabanı parolasıdır. Tam connection string GitHub secret olarak tutulmaz. Workflow şu metadata ile session-pooler URL'sini kendisi üretir:

- project ref: `smizhsagjpqexveitbqu`
- pooler host: `aws-0-eu-central-1.pooler.supabase.com`
- user: `postgres.smizhsagjpqexveitbqu`
- database: `postgres`
- SSL: required

Parola `encodeURIComponent` ile percent-encode edilerek job içinde `STAGING_DATABASE_URL` üretilir ve maskelenir.

`SUPABASE_ADMIN_KEY` yalnız workflow'da test Auth owner'larını oluşturmak/güncellemek için kullanılır; Worker runtime'a girmez.

### Resend

- `RESEND_API_KEY`: Worker runtime için gönderimle sınırlı anahtar.

`NOTIFICATION_FROM_EMAIL` secret değildir; workflow metadata'sı olarak `randevu@notify.kepenk.ai` kullanılır.

F09-05 opt-in gerçek delivery kabulü için ayrıca:

- `RESEND_ACCEPTANCE_API_KEY`: yalnız GitHub acceptance adımında kullanılan `full_access` anahtar.

Acceptance key normal deploy'un zorunlu secret'ı değildir. `run_f09_acceptance=true`, `operation=rotate` veya `operation=resume` seçildiğinde fail-closed doğrulanır. Worker secret bundle'a, Cloudflare binding'lerine veya uygulama runtime'ına girmez. Runtime gönderim anahtarının kapsamı kabul için genişletilmez.

Gerçek booking → notification → provider → güvenli test recipient delivery zinciri F09-05 run `34681540142` ile kanıtlanmıştır. Bu, production/pilot deliverability iddiası değildir.

### NetGSM / F16-02 opt-in SMS acceptance

Normal staging deploy'un dört temel dış secret sözleşmesi değişmez. NetGSM yalnız F16-02 SMS kanıtı seçildiğinde ek provider sözleşmesi olarak açılır. GitHub Environment `staging` altında runtime için birlikte sağlanması gereken secret'lar:

- `NETGSM_USERCODE`
- `NETGSM_PASSWORD`
- `NETGSM_MSGHEADER`

`NETGSM_APPNAME=kepenk` workflow metadata'sıdır. Üç runtime credential'dan yalnız bir kısmı mevcutsa deploy fail-closed durur; tam üçlü mevcutsa Worker secret bundle'a birlikte verilir.

Hosted kabul için ayrıca:

- `NETGSM_TEST_RECIPIENT`: yalnız acceptance process'inin güvenli test alıcısıdır; Worker secret bundle'a yazılmaz.
- `NETGSM_SMS_SEGMENT_PRICE_TRY`: GitHub Environment **variable** olarak hesapta geçerli segment başı TRY fiyatını taşır; secret değildir.

Actions ekranında `run_f16_sms_acceptance=true` seçildiğinde bu beş kabul girdisi eksiksiz değilse deploy trafik değişiminden önce durur. Acceptance, staging fixture üzerinde SMS açık gerçek bir F16 lifecycle job'ı oluşturur; mesajı ürünün kullandığı aynı NetGSM length preflight ile ölçer ve 1–6 segment sınırını kanıtlar. Sonra ayrı bir provider çağrısı yapmak yerine gerçek scheduled Worker'ın aynı job'ı göndermesini, provider `jobid` kaydını ve mevcut delivery-report reconciler'ın `delivered` durumunu yazmasını bekler. Log yalnız segment sayısı, konfigüre segment fiyatı, hesaplanan mesaj maliyeti ve provider jobid içerir; telefon, credential veya mesaj gövdesi yazılmaz.

Bu gate gerçek bir test SMS'i gönderir. Müşteri numarası kullanılmaz; yalnız önceden onaylanmış güvenli test alıcısı kullanılır. `referansID` correlation anahtarıdır, provider idempotency garantisi sayılmaz; belirsiz send sonucu otomatik ikinci SMS üretmez.

## Workflow metadata ve ephemeral değerler

GitHub secret olmayan sabit metadata:

- `STAGING_SUPABASE_PROJECT_REF`
- `STAGING_SUPABASE_POOLER_HOST`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` binding adı altında modern `sb_publishable_...` public key
- `STAGING_OWNER_A_EMAIL`
- `STAGING_OWNER_B_EMAIL`
- `NOTIFICATION_FROM_EMAIL`
- `NETGSM_APPNAME`

Her run yalnız iki test owner parolası yeniden üretilir ve maskelenir. Gate/dispatch anahtarları rutin dağıtımda üretilmez; veritabanındaki hash'ler korunur. Cloudflare'ın desteklediği `inherit.version_id: latest` yalnız trafiğe alınmamış adayı yüklerken kullanılır. Yeni incelenmiş kodun gerçek binding'leri doğrulanmadan aday aktive edilmez. Rotasyonda yalnız yeni gate/dispatch üretilir; plaintext job sonu silinir, DB yalnız SHA-256 verifier tutar.

## Kalıcı management encryption key

`MANAGEMENT_LINK_ENCRYPTION_KEY_V1` yalnız Cloudflare'da tutulur. Rutin deploy ve rotasyon bu binding'i latest upload'dan adaya devralır; eski aktif sürümün management canary'si yeni adayda çözülmeden trafik değiştirilmez. Bilinmeyen eski adayın kodu kanıt kaynağı yapılmaz. Mevcut ortamda binding'in eksik olması bootstrap izni vermez. Bootstrap yalnız Worker sürümü ve işletme/şifreli materyal olmayan açıkça seçilmiş boş ortamda 32 byte anahtar oluşturur.

S05 baseline sonrası authenticated probe; eski sürümde AES-GCM ile şifrelenmiş deneme materyalini yeni sürümde çözer ve nonce'a bağlı management HMAC'ini karşılaştırır. Bu kontrol gerçek müşteri token'ını açığa çıkarmaz. Management anahtarı rotasyonu bu işin kapsamında değildir; ayrı sürümlü veri geçişi gerektirir.

## Build ve Cloudflare runtime çözümü

Staging build:

```bash
npm run build:staging
```

`CLOUDFLARE_ENV=staging` ile generated `dist/yzt_randevu/wrangler.json` oluşur. Workflow generated config içinden Worker adını ve `workers_dev=true` değerini doğrular.

Sonra Cloudflare account Workers subdomain API'sinden account subdomain okunur ve:

```text
https://<worker-name>.<account-subdomain>.workers.dev
```

biçiminde `STAGING_APP_ORIGIN` üretilir.

Bu Cloudflare kontrolleri DB migration/fixture adımlarından önce çalışır. Token/account/origin çözümü başarısızsa workflow staging DB'ye dokunmadan fail-closed durur.

## Database credential smoke ve migration

PostgreSQL client kurulduktan sonra migration'dan **önce** gerçek bağlantı test edilir:

```bash
psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -Atqc "select current_database(), current_user"
```

Beklenen bağlantı `postgres|postgres` sonucunu vermelidir.

Ardından:

```bash
supabase db push --db-url "$STAGING_DATABASE_URL" --include-all --yes
```

çalışır.

Supabase password reset sonrası Supavisor/pooler propagation kısa gecikme gösterebilir. Credential smoke `28P01` verirse aynı secret'ı değiştirmeden kısa süre sonra retry etmek güvenli ilk kontroldür; kalıcı hata halinde parola/secret eşleşmesi yeniden doğrulanır.

## Auth owner bootstrap

Fixture owner e-postaları:

- `randevu-staging-owner-a@example.com`
- `randevu-staging-owner-b@example.com`

Parolalar her workflow run'ında yeniden üretilir, maskelenir ve job sonu kaybolur.

`scripts/staging-ensure-users.mjs` Supabase Admin Auth ile email-confirmed test kullanıcılarını oluşturur veya var olan kullanıcıların parolasını o run'ın geçici parolasına günceller.

## İşlem seçimi ve fixture

GitHub Actions → **Staging deploy** → **Run workflow**; incelenen branch/commit seçilir.

| operation | Davranış |
| --- | --- |
| `deploy` (varsayılan) | Mevcut gate/dispatch/management korunur. Pending rotasyon varsa durur. S04'ten S05'e ilk yükseltme bu modla yapılır. |
| `rotate` | S05 probe'u bulunan çalışan sürümden başlar. İki yeni anahtar owner-only CAS ile pending olur; eski yetki açık kalır. F09 otomatik zorunludur. |
| `resume` | Kesilen rotasyonun aynı commit'inde, kayıtlı tek aday sürümü yeniden doğrular/gerekirse etkinleştirir. İlk run'ın F10/S01/F16-SMS seçimleri düşürülemez. F09 zorunludur. |
| `rollback` | Pending rotasyonun kayıtlı önceki sürümüne döner. Eski HTTP/key/canary ve Cron doğrulandıktan sonra pending'i kaldırır. Yeni ürün/veri migration'ını geri almaz. |
| `bootstrap` | Yalnız boş yeni ortam için. Mevcut staging'de seçilmez. Üç kritik anahtar bir kez üretilir. |

Fixture iki işletmedir: `staging-salon-a` ve `staging-salon-b`. S05 otomatik reset yapmaz. İkisi de yoksa yalnız ilk deploy/bootstrap sırasında mevcut seed çalışır. Tek işletme eksikse veya rotasyonda fixture yoksa işlem durur. Test owner parolaları değişebilir; randevular, recovery ciphertext ve bildirim geçmişi korunur. `staging:reset` ve `staging:seed` komutları silici bakım araçlarıdır; rotasyon kabulünün parçası değildir.

Eski `staging:config` ve hash'leri koşulsuz değiştiren seed kaldırılmıştır. Önceki F17 devirlerindeki bu komut tarihsel bilgidir; kullanılmaz.

## Dağıtım, doğrulama ve anahtar geçişi

1. Dış credential ve Cloudflare origin/aktif sürüm/binding metadata doğrulanır; DB credential kontrolünden sonra yalnız ileri migration uygulanır.
2. Mevcut hash çifti ile aktif Worker'ın kısa süreli HMAC challenge yanıtı karşılaştırılır. İlk S04 yükseltmesinde henüz probe/canary olmadığından latest==active, eksiksiz sürüm sırası ve tek yazıcı şartı aranır. Bu tek geçiş eski-yeni management canary kanıtı üretmez; rotasyon bu istisnayı kullanamaz.
3. Rotasyonda owner-only `begin_staging_key_rotation` tek pending çift ve önceki sürüm/commit/kabul/canary kaydı oluşturur. Mevcut iki verifier henüz değişmez.
4. Latest kaynak UUID ve sequential number kaydedilir. Generated config desteklenen literal `latest` inheritance kullanır; `bindings_inherit=strict` korunur. Rutin deploy üç anahtarı, rotasyon yalnız management anahtarını devralır. API şeması UUID tarif etse de staging #16/#17 canlı API'si yalnız latest kabul etti; tekrar UUID gönderilmez.
5. Sadece gerekli değerleri içeren `/tmp/randevu-staging-secrets.json` (0600) ile pinned `wrangler versions upload` yapılır. Admin ve Resend acceptance credential'ları bundle'a girmez. Aday tek operation etiketiyle bulunmalı; newest olmalı; hemen önceki UUID kaydedilmiş kaynak ve sıra numarası kaynak+1 olmalıdır. Çakışma/eksik metadata aktivasyonu durdurur; bu kontrol atomik provider CAS yerine geçmez.
6. `wrangler triggers deploy` mevcut workers.dev/preview/Cron ayarlarını uygular; kod yüklemez. Aday henüz deployment'a %0 ile dahi eklenmez. Yeni build'in immutable version preview URL'sinde yalnız kesin `GET /api/deployment-health` açıktır; diğer bütün Worker yolları request URL origin kontrolüyle routing/auth/DB öncesinde kapanır. Preview ayarı Worker genelindedir; bu kod koruması tarihsel sürümlere geriye dönük uygulanmaz. [Preview URL](https://developers.cloudflare.com/workers/versions-and-deployments/preview-urls/) ve [%0 version override sınırı](https://developers.cloudflare.com/workers/versions-and-deployments/version-overrides/).
7. Bizim yüklediğimiz adayın tam UUID, gerçek gate/dispatch çifti ve eski management canary'si doğrulanır. Bilinmeyen orphan kodu çalıştırılarak güven kurulmaz. Aktif önceki UUID ve DB çift/pending sahipliği yeniden kontrol edilir; yalnız bu kanıtlanmış aday %100 aktive edilir.
8. Çalışan sürüm/proof ve gerçek scheduled heartbeat doğrulanır. Cron başlangıcı için 15 dakika ayrılır; [Cron yayılımı](https://developers.cloudflare.com/workers/configuration/cron-triggers/) ile F09'un değişmeyen 180 saniyelik provider teslimat bütçesi ayrıdır.
9. Base smoke ve seçilmiş/zorunlu gerçek kabul geçer. Son çalışan sürüm/proof yeniden kontrol edilir. Tek DB transaction yeni çiftin ikisini promote eder, pending'i kaldırır; eski çift artık kabul edilmez.
10. Geçici secret dosyası başarı/hata durumunda silinir. Migration dosyaları, anahtarlar ve acceptance sonuçları birbirinin yerine kanıt sayılmaz.

## Kısmi hata ve geri dönüş

| Gözlenen durum | Güvenli devam |
| --- | --- |
| Rutin deploy başlamadan hata | DB anahtarları değişmez; sebebi düzeltip `deploy` yeniden çalıştırılır. |
| Rotasyon DB hazırlığından sonra upload/deploy/smoke hatası | Runner bilinen önceki sürüme dönüşü dener. Eski anahtarlar bu sırada geçerlidir. Eski sürüm/canary/Cron ispatlanınca pending temizlenir. |
| Runner öldürüldü veya rollback kanıtlanamadı | İki verifier geçerli kalır; ikinci rotasyon/rutin deploy engellenir. Pending operation, previous version ve commit metadata owner DB erişimiyle okunur; hash/evidence loglanmaz. Aynı commit'te `resume` veya `rollback` seçilir. |
| Upload var, deployment yok | Pending'in UUID etiketiyle eşleşen tek aday bulunursa `resume` önce aday preview/proof'unu ve DB sahipliğini doğrular, sonra etkinleştirir. Aday yoksa/kanıtı geçmiyorsa `rollback` eski sürümü doğrulayıp pending'i kaldırır; sonra yeni `rotate` açılır. |
| Resume commit'i/kabul seçimi farklı | İşlem durur. Önce kayıtlı commit/seçimle devam edilir; kod düzeltmesi gerekiyorsa `rollback`, ardından düzeltilmiş commit'te açık `rotate` uygulanır. |
| Modern routine rollback sonrası aynı anahtarlı orphan | Yeni routine run yalnız yeni incelenmiş adayı yükler; aynı DB çifti ve eski management canary kanıtıyla trafik değiştirmeden doğrular. |
| Rotasyon abort edildi, latest farklı gate/dispatch taşıyor | Trafik eski sürüme dönmüş olsa da upload geçmişi değişmez. Routine aday pair kontrolünde durur; abort doğrulandıktan sonra açık `rotate` yeni çifti sağlar, management canary korunur. Otomatik kritik anahtar reseti yapılmaz. |
| İlk legacy baseline'da latest aktiften farklı | Eski canary bulunmadığından otomatik inheritance/aktivasyon durur. Yetkili operatör önceki run'ın kaynak/adayı ve geçtiği proof adımını inceler; kanıtlanmamış aday veya rastgele eski sürüm aktive edilmez. |
| Finalize DB cevabı kayboldu | DB zaten yeni çift + boş pending gösteriyorsa eski anahtarlı sürüme dönülmez. `resume` tekrar doğrulama yapar. |
| Bootstrap, ilk upload'dan önce kesildi | Worker sürümü/işletme/şifreli materyal hâlâ yoksa açık `bootstrap` yeniden çalıştırılabilir. |
| Bootstrap upload edildi fakat etkin sürüm yok | Otomatik yeni anahtar üretimi durur. Aşağıdaki operatör adımlarıyla o run'ın etiketli adayı, aktivasyon öncesi proof kaydı ve değişmemiş DB config'i eşleştirilir. Kanıt yoksa doğrudan etkinleştirilmez; kanıtlı aday %100 etkinleştirildikten sonra `deploy` gerçek kabulü çalıştırır. Worker silme veya management anahtarı değiştirme uygulanmaz. |

Rollback hedefi UUID ile sabittir; varsayılan 'önceki' veya 'latest' kullanılmaz. Cloudflare `force=true`, yalnız kanıtlanmış aday veya kayıtlı önceki sürümün aktivasyonunda kullanılır; secret'lar sürümlü olduğu için gereklidir. Bağlı DB kaynakları geri alınmaz. [Cloudflare rollback](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/).

Başarılı rotasyondan sonra eski secret taşıyan sürümü doğrudan aktif etmek uygun değildir. Kod geri dönüşü gerekiyorsa eski ürün kodu, mevcut S05 karantina/probe korumasını ve güncel anahtar doğrulamasını koruyan yeni aday olarak hazırlanır. Operasyon sırasında GitHub concurrency grubu dışından dashboard/CLI ile paralel yayın veya DB verifier değişikliği yapılmaz. Beklenmeyen aktif sürüm bulunursa runner müdahale etmeden durur. İlk legacy yükseltmede bu tek yazıcı sınırı özellikle gereklidir; latest liste/sıra kontrolü sağlayıcı tarafında atomik kilit değildir.

## S05 canlı kabul sırası

Önce bu dalda `operation=deploy`, `run_f09_acceptance=true`; başarıdan sonra aynı incelenmiş commit'te `operation=rotate`. İki run'ın head, CF version ve sonuçları devirde kaydedilir. Rutin yükseltmenin yeşil olması rotasyon kabulünü kapatmaz. S05, gerçek rotasyon ve bağımsız inceleme tamamlanmadan tamamlandı gösterilmez.

## Readiness ve gerçek smoke

Cloudflare deploy dönüşü ile edge route readiness arasında kısa yarış görülebilir. Bu nedenle `scripts/staging-smoke.mjs` yalnız `/api/health` readiness kapısı için bounded retry kullanır.

Login/session/business/catalog hataları retry edilmez ve fail-closed kalır.

Smoke:

```bash
npm run staging:smoke
```

Gerçek uygulama API zinciri:

- `/api/health`
- `/api/auth/login`
- HttpOnly access/refresh cookies
- `/api/session`
- `/api/businesses/select`
- `/api/catalog`

Owner'ın fixture üyeliği, hizmeti ve personeli görünmezse workflow kırılır.

## F09-05 opt-in gerçek delivery acceptance

Actions ekranında `Staging deploy` çalıştırılırken branch/ref seçilir ve `Run real F09-05 booking and Resend delivery gate` girişi açılır. Normal staging deploy'da bu kutu kapalı kalır.

Acceptance komutu:

```bash
npm run staging:f09-acceptance
```

Acceptance şunları kanıtlar:

- create response body bilerek tüketilmeden bırakıldığında recovery aynı appointment'ı bulur,
- same-intent duplicate aynı appointment'ı döndürür,
- aynı idempotency key ile farklı intent reddedilir,
- doğru management capability çalışır; yanlış capability generic 404 alır,
- yanlış ve süresi dolmuş recovery authority generic not-found alır,
- anon/publishable istemci sahte provider receipt yazamaz,
- outbox scheduled Worker tarafından `sent` olur ve provider message ID kaydedilir,
- Resend Retrieve Email API kaydı beklenen sender/recipient/subject ve staging `/m#` origin'ini taşır,
- güvenli `delivered+...@resend.dev` test recipient'i `last_event=delivered` üretir.

Kişisel mailbox veya gerçek müşteri adresi kullanılmaz. Acceptance job sonrasında recovery authority'yi bilinçli biçimde expire eder; management bearer ve secret değerleri loglanmaz.

## F16-02 opt-in gerçek SMS acceptance

Actions ekranında `Staging deploy` çalıştırılırken incelenen branch/ref seçilir ve `Run real F16-02 NetGSM SMS delivery and segment/tariff gate` girişi açılır.

Acceptance komutu:

```bash
npm run staging:f16-sms-acceptance
```

Acceptance şunları kanıtlar:

- staging fixture için gerçek F16 lifecycle SMS job'ı üretilir,
- test mesajı ürünün aynı `measureNetgsmSmsParts` preflight'ıyla ölçülür ve altı segment sınırı aşılmaz,
- hesapta geçerli segment fiyatıyla o mesajın maliyet zarfı kaydedilir,
- scheduled Worker shared F09/S03 outbox'tan işi claim eder,
- immutable request fingerprint ve provider correlation korunur,
- NetGSM kabulündeki gerçek `jobid` DB'ye yazılır,
- aynı scheduled notification entry delivery-report reconciliation çalıştırır,
- güvenli test alıcısında provider sonucu `delivered` olur.

Test recipient, credential ve SMS gövdesi loglanmaz. Bu kanıt staging provider entegrasyonuna aittir; production müşterilerine gönderim veya genel deliverability garantisi değildir.

## Kesilmiş ilk kurulumun operatör adımları

Bu yol yalnız hiç aktif deployment oluşmamış **boş bootstrap** içindir. Yerleşik staging veya pending rotasyon için yukarıdaki `resume`/`rollback` kullanılır.

1. GitHub'daki başarısız run'ın head SHA'sını ve Wrangler upload çıktısındaki version UUID/operation tag'ini kaydet. Cloudflare **Workers & Pages → yzt-randevu-staging → Deployments/Versions** ekranında aynı UUID ve etiketi doğrula; aynı run'a ait tek aday yoksa dur.
2. Yetkili DB bağlantısıyla yalnız işletme ve şifreli recovery sayısının sıfır, iki runtime config kaydının mevcut olduğunu kontrol et. Hash veya gerçek credential'ları ekran görüntüsü/loga alma. Bu koşullar sağlanmıyorsa bootstrap kurtarması uygulanmaz.
3. Aynı run'da bu aday için `Candidate <UUID> verified before activation` kaydı bulunmalı ve kanıttan sonra DB config'i değiştirilmemiş olmalıdır. Bu kanıt oluşmadan kesilen upload doğrudan aktive edilmez; aday doğrulaması yeniden kurulmadan burada durulur. Kanıtı bulunan bu **belirli UUID** için Cloudflare'da **Deploy → 100%** seç; yeni secret üretme, binding düzenleme veya Worker silme yapma.
4. GitHub'da **aynı head** için `operation=deploy`, `run_f09_acceptance=true` çalıştır. Runner etkin adayın DB hash çiftiyle uyuştuğunu authenticated probe ile doğrulamadan ilerlemez. Eşleşmezse iki sistemde de anahtarları elle değiştirme; incelenmek üzere metadata/hata adımını kaydet.

İlk upload'dan önce kesilmede bu manuel adımlar gerekmez; sürüm ve veri yoksa açık `bootstrap` tekrar kullanılabilir. Genel workflow tek koordinatör scripti üzerinden mevcut smoke ve kabul komutlarını çağırır; iş akışının ikinci bir sırası burada kopyalanmaz.

## Supabase Auth URL ayarı

F17-01 smoke email/password Admin Auth test kullanıcılarıyla çalışır ve email confirmation redirect'ine bağımlı değildir.

Custom staging domain bağlandığında veya gerçek redirect tabanlı auth akışlarına geçildiğinde Supabase Site URL / Allowed Redirect URLs ilgili staging origin ile ayrıca doğrulanmalıdır.

## Güvenlik ve sınırlar

- Production müşteri/personel verisi staging'e kopyalanmaz.
- `SUPABASE_ADMIN_KEY` Worker runtime'a verilmez.
- Raw DB password yalnız GitHub `staging` secret deposunda tutulur; generated DB URL job içinde maskelenir.
- Raw gate/dispatch secret DB'ye yazılmaz.
- Management encryption key DB veya GitHub secret deposunda tutulmaz.
- Fixture owner parolaları kalıcı değildir.
- Cloudflare account ID secret değildir.
- Runtime `RESEND_API_KEY` gönderimle sınırlı tutulur.
- `RESEND_ACCEPTANCE_API_KEY` yalnız seçilmiş/zorunlu GitHub acceptance process'ine verilir; Worker bundle'a girmez.
- NetGSM runtime credential üçlüsü yalnız tam set olarak Worker'a verilir; `NETGSM_TEST_RECIPIENT` ve segment fiyatı Worker bundle'a girmez.
- Provider API key değerleri Git/PR/handoff'a yazılmaz.
- Hosted migration'lar forward-only'dir; merge edilmiş eski migration'lar değiştirilmez.

## Clean checkout kontrolü

Repo-side doğrulama:

```bash
npm ci
npm run typecheck
npm run build
npm run build:staging
npm run test:http
npm run test:ci-coverage
```

F17-01 base environment kabulü `34679959999`, F09-05 gerçek provider delivery kabulü `34681540142` ile kanıtlanmıştır. Yeni workflow değişiklikleri kabul edilirken base staging smoke ve ilgili opt-in gate yeniden yeşil gösterilmelidir.
