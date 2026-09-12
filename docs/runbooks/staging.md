# Staging runbook

Bu runbook F17-01 için **production'dan ayrılmış** Randevu staging ortamını tekrar üretilebilir biçimde kurar. Secret değerleri hiçbir zaman Git'e, PR'a veya handoff metnine yazılmaz.

## Ortam sınırı

Staging; ayrı Supabase proje/veritabanı, ayrı Cloudflare Worker environment ve test amaçlı bildirim göndericisi kullanır. Production müşteri verisi staging fixture'ına kopyalanmaz. `supabase db reset --linked` veya benzeri yıkıcı komutlar yalnız throwaway/staging projede kullanılabilir.

Cloudflare Vite plugin environment seçimini **build anında** yapar. Staging build komutu:

```bash
npm run build:staging
```

Bu komut `CLOUDFLARE_ENV=staging` ile `wrangler.jsonc` içindeki staging environment'ını düzleştirir. Sonraki `wrangler deploy` üretilmiş deploy config'ini kullanır; deploy aşamasında ayrıca `--env staging` verilmez.

## GitHub `staging` environment dış sözleşmesi

GitHub Environment `staging` içinde yalnız aşağıdaki **9 dış değer** tanımlanır. Bunlar repo içinde tutulmaz.

### Cloudflare deploy erişimi

- `CLOUDFLARE_API_TOKEN` — Workers script deploy ve account Workers subdomain okuması için gereken en dar yetki. Token Workers Scripts Read/Write erişimini karşılamalıdır.
- `CLOUDFLARE_ACCOUNT_ID`

### Supabase privileged staging erişimi

- `STAGING_DATABASE_URL` — yalnız staging Postgres bağlantısı; percent-encoded bağlantı URL'si.
- `SUPABASE_ADMIN_KEY` — **yalnız workflow'da** test Auth kullanıcılarını oluşturmak/güncellemek için server-side secret/service-role key. Worker runtime secret bundle'ına girmez.

Staging project ref, API URL ve mevcut Worker ile uyumlu legacy anon key public metadata olarak workflow'da sabittir. `STAGING_DATABASE_URL` aynı project ref'i içermelidir ve workflow bunu fail-closed kontrol eder. Legacy anon key public istemci anahtarıdır; modern publishable-key geçişi mevcut Worker'ın Authorization yardımcılarıyla birlikte ayrı bir auth/refactor işi olarak ele alınır.

### Worker runtime ve provider

- `MANAGEMENT_LINK_ENCRYPTION_KEY_V1`
- `PUBLIC_BOOKING_GATE_SECRET`
- `NOTIFICATION_DISPATCH_SECRET`
- `RESEND_API_KEY`
- `NOTIFICATION_FROM_EMAIL`

Bu anahtarlar stabil kalır. Management encryption key run başına üretilmez; mevcut recovery ciphertext'lerinin çözülebilir kalması gerekir. Gate/dispatch secret'ları da DB hash'i ile Worker runtime'ın eşleşmesini korur.

## Otomatik staging origin

`STAGING_APP_ORIGIN` artık GitHub secret değildir. Workflow:

1. `npm run build:staging` ile generated `dist/yzt_randevu/wrangler.json` üretir,
2. generated config içinden Worker adını okur ve `workers_dev=true` olduğunu doğrular,
3. Cloudflare `GET /accounts/{account_id}/workers/subdomain` endpoint'inden account Workers subdomain'ini okur,
4. gerçek origin'i `https://<worker-name>.<account-subdomain>.workers.dev` biçiminde üretir,
5. değeri yalnız o job için `GITHUB_ENV` içine `STAGING_APP_ORIGIN` olarak yazar.

Bu lookup PostgreSQL migration/fixture işlemlerinden **önce** çalışır. Cloudflare token, account veya workers.dev subdomain yanlışsa workflow staging DB'ye dokunmadan fail-closed durur. Worker secret bundle'ında `PUBLIC_APP_ORIGIN`, bu türetilmiş HTTPS origin'den üretilir.

## İki sahte owner hesabı

Fixture hesaplarının email adresleri workflow metadata'sıdır:

- `randevu-staging-owner-a@example.com`
- `randevu-staging-owner-b@example.com`

Parolalar her workflow run'ında `crypto.randomBytes()` ile yeniden üretilir, GitHub masking'e eklenir ve yalnız o job'ın `GITHUB_ENV` dosyasında tutulur. Repo veya GitHub Environment secret'ı değildir. `scripts/staging-ensure-users.mjs` Supabase Admin Auth üzerinden email-confirmed kullanıcıları oluşturur veya aynı kullanıcıların parolasını o run'ın geçici parolasına günceller. Smoke aynı job içindeki maskelenmiş değeri kullanır.

## Supabase Auth URL ayarı

Staging Supabase Auth ayarlarında mümkün olduğunda:

- Site URL = türetilmiş `STAGING_APP_ORIGIN`,
- Allowed redirect URLs = staging origin'in gerekli yolları,
- local geliştirme gerekiyorsa localhost callback ayrıca eklenir.

Mevcut F17-01 smoke email/password Admin Auth kullanıcılarıyla çalışır ve email confirmation redirect'ine bağımlı değildir; ancak gerçek kullanıcı redirect akışları daha sonraki auth kabulünde ayrıca doğrulanır.

## Migration ve veri kurulumu

Workflow Supabase CLI `2.117.0` kullanır ve migration history'yi koruyarak:

```bash
supabase db push --db-url "$STAGING_DATABASE_URL" --include-all --yes
```

çalıştırır.

Ardından server-only gate secret'larının **yalnız SHA-256 hash'leri** PostgreSQL config tablolarına yazılır:

```bash
npm run staging:config
```

Fixture reset + seed:

```bash
npm run staging:reset
STAGING_OWNER_A_ID=<uuid> STAGING_OWNER_B_ID=<uuid> npm run staging:seed
```

`staging:config`, `staging:seed` ve `staging:reset` için `STAGING_DATABASE_URL` environment'ta olmalıdır. Config komutu raw gate/dispatch secret'larını PostgreSQL'e yazmaz; Node tarafında hashleyip yalnız hash'i `psql` değişkeni olarak geçirir.

## Fixture içeriği

Fixture iki tenant oluşturur:

- `Staging Salon A` / `staging-salon-a`
- `Staging Salon B` / `staging-salon-b`

Her birinde ayrı owner membership, bir hizmet, bir personel, service↔staff eşleşmesi, Pazartesi–Cumartesi 09:00–18:00 işletme/personel saatleri ve açık public booking ayarı bulunur. Sabit business UUID'leri reset'i güvenli ve dar tutar.

`supabase/tests/f17_staging_fixture.sql` CI'da iki tenant'ın birbirini RLS üzerinden görmediğini, fixture'ın tam kurulduğunu ve reset'in yalnız staging fixture işletmelerini kaldırdığını kanıtlar.

## Cloudflare deploy sırası

`.github/workflows/staging.yml` manual `workflow_dispatch` ile çalışır. Sıra:

1. bağımlılık kurulumu,
2. ephemeral owner parolalarının üretilip maskelenmesi,
3. 9 dış değer + workflow metadata sözleşmesinin fail-closed doğrulanması,
4. `npm run build:staging`,
5. Cloudflare account subdomain lookup ve gerçek `STAGING_APP_ORIGIN` türetimi,
6. PostgreSQL client kurulumu ve migration push,
7. gerçek Auth test owner'larının hazırlanması,
8. DB runtime hash provisioning,
9. fixture reset + seed,
10. runtime secret'larının geçici `/tmp` JSON dosyasından `wrangler deploy --secrets-file` ile yüklenmesi,
11. gerçek staging smoke,
12. geçici secret dosyasının her durumda silinmesi.

Cloudflare config `workers_dev: true` kullanır; custom domain daha sonra eklenebilir.

## Gerçek staging smoke

```bash
npm run staging:smoke
```

Smoke yalnız health endpoint'ine bakmaz. Uygulamanın kendi API'si üzerinden:

- `/api/health`,
- `/api/auth/login`,
- HttpOnly access/refresh cookies,
- `/api/session`,
- `/api/businesses/select`,
- `/api/catalog`

zincirini gerçek staging owner hesabıyla doğrular. Owner'ın fixture üyeliği, hizmeti ve personeli görünmezse workflow kırılır.

## Bildirim sağlayıcısı

`RESEND_API_KEY` ve `NOTIFICATION_FROM_EMAIL` staging'e ait gerçek sağlayıcı erişimiyle tanımlanmalıdır. Tercihen test amaçlı ayrı doğrulanmış sender/subdomain kullanılır. CI provider stub kanıtı, gerçek Resend acceptance yerine geçmez; gerçek teslim F09-05 ile kanıtlanır.

## Temiz checkout kontrolü

Repo-side doğrulama:

```bash
npm ci
npm run typecheck
npm run build
npm run build:staging
npm run test:http
npm run test:ci-coverage
```

Canlı acceptance için ayrıca GitHub `Staging deploy` workflow'unun gerçek hesaplarla yeşil olması gerekir. Hesap/secret erişimi doğrulanamıyorsa F17-01 **Engelli** kalır; staging URL'si veya provider teslimi uydurulmaz.
