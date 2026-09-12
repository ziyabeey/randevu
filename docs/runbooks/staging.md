# Staging runbook

Bu runbook F17-01 için **production'dan ayrılmış** Randevu staging ortamını tekrar üretilebilir biçimde kurar. Secret değerleri hiçbir zaman Git'e, PR'a veya handoff metnine yazılmaz.

## Ortam sınırı

Staging; ayrı Supabase proje/veritabanı, ayrı Cloudflare Worker environment ve test amaçlı bildirim göndericisi kullanır. Production müşteri verisi staging fixture'ına kopyalanmaz. `supabase db reset --linked` veya benzeri yıkıcı komutlar yalnız throwaway/staging projede kullanılabilir.

Cloudflare Vite plugin environment seçimini **build anında** yapar. Bu repo için staging build komutu:

```bash
npm run build:staging
```

Bu komut `CLOUDFLARE_ENV=staging` ile `wrangler.jsonc` içindeki staging environment'ını düzleştirir. Sonraki `wrangler deploy` üretilmiş deploy config'ini kullanır; deploy aşamasında ayrıca `--env staging` verilmez.

## GitHub `staging` environment secret sözleşmesi

GitHub Environment `staging` içinde yalnız aşağıdaki **11 dış değer** tanımlanır. Bunlar repo içinde tutulmaz.

### Cloudflare deploy erişimi

- `CLOUDFLARE_API_TOKEN` — yalnız Workers deploy için gereken en dar yetki.
- `CLOUDFLARE_ACCOUNT_ID`

### Supabase staging erişimi

- `STAGING_DATABASE_URL` — yalnız staging Postgres bağlantısı; percent-encoded bağlantı URL'si.
- `SUPABASE_ANON_KEY` — Worker'ın mevcut Data/Auth API istemcisi için publishable/legacy anon key.
- `SUPABASE_ADMIN_KEY` — **yalnız workflow'da** test Auth kullanıcılarını oluşturmak/güncellemek için server-side secret/service-role key. Worker runtime secret bundle'ına girmez.

`STAGING_SUPABASE_PROJECT_REF=smizhsagjpqexveitbqu` ve `SUPABASE_URL=https://smizhsagjpqexveitbqu.supabase.co` staging'e ait public metadata olarak workflow'da sabittir; secret değildir. `STAGING_DATABASE_URL` aynı project ref'i içermelidir ve workflow bunu fail-closed kontrol eder.

### Worker runtime ve provider

- `MANAGEMENT_LINK_ENCRYPTION_KEY_V1`
- `PUBLIC_BOOKING_GATE_SECRET`
- `NOTIFICATION_DISPATCH_SECRET`
- `RESEND_API_KEY`
- `NOTIFICATION_FROM_EMAIL`
- `STAGING_APP_ORIGIN` — staging Worker/custom-domain HTTPS origin'i.

Worker'a ayrıca `COOKIE_SECURE=true` verilir. `PUBLIC_APP_ORIGIN`, deploy sırasında `STAGING_APP_ORIGIN` değerinden üretilir.

## İki sahte owner hesabı

Fixture hesaplarının email adresleri workflow metadata'sıdır:

- `randevu-staging-owner-a@example.com`
- `randevu-staging-owner-b@example.com`

Parolalar her workflow run'ında `crypto.randomBytes()` ile yeniden üretilir, GitHub masking'e eklenir ve yalnız o job'ın `GITHUB_ENV` dosyasında tutulur. Repo veya GitHub Environment secret'ı değildir. `scripts/staging-ensure-users.mjs` Supabase Admin Auth üzerinden email-confirmed kullanıcıları oluşturur veya aynı kullanıcıların parolasını o run'ın geçici parolasına günceller. Smoke aynı job içindeki maskelenmiş değeri kullanır.

## Supabase Auth URL ayarı

Staging Supabase Auth ayarlarında:

- Site URL = `STAGING_APP_ORIGIN`
- Allowed redirect URLs = staging origin'in gerekli yolları; preview kullanılacaksa yalnız kontrollü staging pattern'i eklenir.
- Local geliştirme gerekiyorsa localhost callback ayrıca eklenebilir; production URL'si staging kabulünün yerine kullanılmaz.

Email/password staging owner hesapları Admin Auth ile email-confirmed yaratıldığı için CI smoke email onayı beklemez.

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

## Cloudflare deploy

`.github/workflows/staging.yml` manual `workflow_dispatch` ile çalışır. Sıra:

1. bağımlılık kurulumu,
2. ephemeral owner parolalarının üretilip maskelenmesi,
3. 11 dış değer + workflow metadata sözleşmesinin fail-closed doğrulanması,
4. migration push,
5. gerçek Auth test owner'larının hazırlanması,
6. DB runtime hash provisioning,
7. fixture reset + seed,
8. `npm run build:staging`,
9. runtime secret'larının geçici `/tmp` JSON dosyasından `wrangler deploy --secrets-file` ile yüklenmesi,
10. gerçek staging smoke,
11. geçici secret dosyasının her durumda silinmesi.

Cloudflare config `workers_dev: true` kullanır; custom domain daha sonra eklenebilir. `STAGING_APP_ORIGIN` deploy edilen gerçek HTTPS origin ile birebir aynı olmalıdır.

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

Canlı acceptance için ayrıca GitHub `Staging deploy` workflow'unun yeşil olması gerekir. Hesap/secret erişimi doğrulanamıyorsa F17-01 **Engelli** kalır; staging URL'si veya provider teslimi uydurulmaz.
