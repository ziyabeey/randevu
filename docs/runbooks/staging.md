# Staging runbook

Bu runbook F17-01 ile kabul edilmiş **production'dan ayrılmış** Randevu staging ortamını tekrar üretilebilir biçimde kurar ve F09-05 gerçek rezervasyon/bildirim kabulünü çalıştırır. Secret değerleri hiçbir zaman Git'e, PR'a, handoff metnine veya sohbete yazılmaz.

## Canlı kabul durumu

- Supabase project: `randevu-staging`, ref `smizhsagjpqexveitbqu`, region `eu-central-1`.
- Cloudflare Worker: `yzt-randevu-staging`.
- Kabul edilen workers.dev origin: `https://yzt-randevu-staging.ziyabeey1.workers.dev`.
- F17-01 base environment acceptance: GitHub Actions `Staging deploy` run `34679959999` → **success**.
- F09-05 gerçek booking/provider delivery acceptance: run `34681540142` → **success**.
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

Acceptance key normal deploy'un zorunlu secret'ı değildir. Yalnız `run_f09_acceptance=true` seçildiğinde fail-closed doğrulanır. Worker secret bundle'a, Cloudflare binding'lerine veya uygulama runtime'ına girmez. Runtime gönderim anahtarının kapsamı kabul için genişletilmez.

Gerçek booking → notification → provider → güvenli test recipient delivery zinciri F09-05 run `34681540142` ile kanıtlanmıştır. Bu, production/pilot deliverability iddiası değildir.

## Workflow metadata ve ephemeral değerler

GitHub secret olmayan sabit metadata:

- `STAGING_SUPABASE_PROJECT_REF`
- `STAGING_SUPABASE_POOLER_HOST`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` binding adı altında modern `sb_publishable_...` public key
- `STAGING_OWNER_A_EMAIL`
- `STAGING_OWNER_B_EMAIL`
- `NOTIFICATION_FROM_EMAIL`

Run başına üretilen ve maskelenen değerler:

- `STAGING_OWNER_A_PASSWORD`
- `STAGING_OWNER_B_PASSWORD`
- `PUBLIC_BOOKING_GATE_SECRET`
- `NOTIFICATION_DISPATCH_SECRET`

Gate/dispatch secret'ları veri şifreleme anahtarı değildir. Aynı run içindeki raw değerler hem DB hash provisioning hem Worker runtime için kullanılır; DB yalnız SHA-256 hash'lerini tutar.

## Kalıcı management encryption key

`MANAGEMENT_LINK_ENCRYPTION_KEY_V1` GitHub Environment secret'ı değildir. Cloudflare Worker secret olarak kalıcı tutulur.

Workflow:

- binding varsa değerini okumadan korur,
- ilk deploy'da binding yoksa `crypto.randomBytes(32).toString('base64url')` ile bootstrap key üretir ve maskeler,
- yalnız ilk gerekli deploy'un geçici secret bundle'ına ekler,
- sonraki deploy'larda secret bundle'dan çıkararak Cloudflare'daki mevcut binding'i korur,
- deploy sonrasında binding varlığını API ile tekrar doğrular.

Key rotasyonu ayrı ve bilinçli operasyon olmalıdır.

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

## Runtime config ve fixture

DB runtime hash provisioning:

```bash
npm run staging:config
```

Fixture reset:

```bash
npm run staging:reset
```

Fixture seed:

```bash
STAGING_OWNER_A_ID=<uuid> STAGING_OWNER_B_ID=<uuid> npm run staging:seed
```

Fixture iki tenant oluşturur:

- `Staging Salon A` / `staging-salon-a`
- `Staging Salon B` / `staging-salon-b`

Her birinde ayrı owner membership, bir hizmet, bir personel, service↔staff eşleşmesi, Pazartesi–Cumartesi 09:00–18:00 işletme/personel saatleri ve açık public booking ayarı bulunur.

`supabase/tests/f17_staging_fixture.sql` tenant isolation ve reset sınırını CI'da doğrular.

## Worker deploy

Geçici secret bundle `/tmp/randevu-staging-secrets.json` altında `0600` izinle oluşturulur. İçerik yalnız o run'ın gerekli Worker runtime değerleridir.

Deploy:

```bash
npx wrangler deploy --secrets-file /tmp/randevu-staging-secrets.json
```

Workflow her durumda geçici dosyayı siler.

Deploy sonrası `MANAGEMENT_LINK_ENCRYPTION_KEY_V1` binding varlığı Cloudflare API ile tekrar doğrulanır. Binding yoksa smoke başlamaz.

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

## Tam workflow sırası

`.github/workflows/staging.yml` manual `workflow_dispatch` ile çalışır:

1. checkout / Node / Supabase CLI / `npm ci`
2. F09 opt-in ise acceptance read key kontrolü + HTTP failure/recovery kontratları
3. ephemeral owner + gate/dispatch secret üretimi ve masking
4. 4 dış runtime secret + workflow metadata contract doğrulaması
5. raw DB password'dan maskelenmiş session-pooler URL üretimi
6. `wrangler whoami --json` ile tek Cloudflare account çözümü
7. `npm run build:staging`
8. Workers subdomain lookup + staging origin çözümü + management secret lookup
9. PostgreSQL client kurulumu
10. DB credential smoke
11. migration push
12. Auth owner bootstrap
13. DB runtime hash provisioning
14. fixture reset + seed
15. geçici Worker secret bundle
16. Cloudflare Worker deploy
17. persistent management secret verification
18. bounded health readiness + gerçek login/session/business/catalog smoke
19. F09 opt-in ise gerçek booking/recovery/idempotency/capability/fake-receipt/Resend delivery acceptance
20. geçici dosya cleanup

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
- `RESEND_ACCEPTANCE_API_KEY` yalnız opt-in GitHub acceptance process'ine verilir; Worker bundle'a girmez.
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