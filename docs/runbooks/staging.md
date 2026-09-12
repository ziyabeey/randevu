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

GitHub Environment `staging` içinde yalnız aşağıdaki **6 dış değer** tanımlanır. Bunlar repo içinde tutulmaz.

### Cloudflare deploy erişimi

- `CLOUDFLARE_API_TOKEN` — Workers script deploy, account Workers subdomain okuması ve Worker secret binding varlık kontrolü için gereken en dar yetki. Token Workers Scripts Read/Write erişimini karşılamalıdır.
- `CLOUDFLARE_ACCOUNT_ID`

### Supabase privileged staging erişimi

- `STAGING_DATABASE_URL` — yalnız staging Postgres bağlantısı; percent-encoded bağlantı URL'si.
- `SUPABASE_ADMIN_KEY` — **yalnız workflow'da** test Auth kullanıcılarını oluşturmak/güncellemek için server-side secret/service-role key. Worker runtime secret bundle'ına girmez.

Staging project ref, API URL ve düşük yetkili `sb_publishable_...` API key public metadata olarak workflow'da sabittir. `STAGING_DATABASE_URL` aynı project ref'i içermelidir ve workflow bunu fail-closed kontrol eder. Env binding adı geriye dönük uyumluluk için şimdilik `SUPABASE_ANON_KEY` olarak kalır; staging değeri modern publishable key'dir.

### Bildirim sağlayıcısı

- `RESEND_API_KEY`
- `NOTIFICATION_FROM_EMAIL`

Resend erişimi ve doğrulanmış gönderici dış provider sözleşmesidir.

## Cloudflare'da kalıcı management encryption key

`MANAGEMENT_LINK_ENCRYPTION_KEY_V1` artık GitHub Environment secret'ı değildir. Değer **Cloudflare Worker secret** olarak kalıcı tutulur ve normal deploy'larda geri okunmaz.

Workflow `npm run build:staging` sonrasında generated Worker adını bulur ve Cloudflare'ın script-secret endpoint'inde yalnız `MANAGEMENT_LINK_ENCRYPTION_KEY_V1` binding'inin varlığını kontrol eder:

- binding varsa değer okunmadan korunur,
- Worker veya binding henüz yoksa workflow `crypto.randomBytes(32).toString('base64url')` ile tek seferlik bootstrap key üretir, GitHub masking'e ekler ve yalnız o deploy'un geçici secret bundle'ına koyar,
- `wrangler deploy --secrets-file` mevcut olup dosyada yer almayan Worker secret'larını koruduğu için sonraki deploy'lar key'i değiştirmez,
- deploy sonrasında binding yeniden kontrol edilir; management key gerçekten Cloudflare'da yoksa smoke çalıştırılmaz.

Bu model recovery ciphertext'lerinin aynı key ile çözülebilir kalmasını sağlar ve encryption key'i hem staging DB'den hem GitHub secret deposundan ayırır. Key rotasyonu ayrı, bilinçli bir operasyon olmalıdır.

## Run başına üretilen secret'lar

Aşağıdaki değerler GitHub Environment secret'ı değildir; workflow her run başında `crypto.randomBytes()` ile üretir, GitHub log masking'e ekler ve yalnız o job'ın `GITHUB_ENV` dosyasında taşır:

- `PUBLIC_BOOKING_GATE_SECRET`
- `NOTIFICATION_DISPATCH_SECRET`
- `STAGING_OWNER_A_PASSWORD`
- `STAGING_OWNER_B_PASSWORD`

Gate/dispatch secret'ları veri şifrelemez. PostgreSQL yalnız SHA-256 hash'lerini tutar; aynı job içindeki raw değerler hem `npm run staging:config` ile DB hash'lerine hem de Worker secret bundle'ına gider. Böylece her staging deploy bu iki capability secret'ını birlikte döndürür ve repo/GitHub'da kalıcı raw kopya tutmaz.

## Otomatik staging origin

`STAGING_APP_ORIGIN` GitHub secret değildir. Workflow:

1. `npm run build:staging` ile generated `dist/yzt_randevu/wrangler.json` üretir,
2. generated config içinden Worker adını okur ve `workers_dev=true` olduğunu doğrular,
3. Cloudflare `GET /accounts/{account_id}/workers/subdomain` endpoint'inden account Workers subdomain'ini okur,
4. gerçek origin'i `https://<worker-name>.<account-subdomain>.workers.dev` biçiminde üretir,
5. Worker adını ve origin'i yalnız o job için `GITHUB_ENV` içine yazar,
6. aynı Cloudflare erişimiyle persistent management secret binding varlığını kontrol eder.

Bu kontroller PostgreSQL migration/fixture işlemlerinden **önce** çalışır. Cloudflare token, account, workers.dev subdomain veya beklenmeyen secret-lookup hatası varsa workflow staging DB'ye dokunmadan fail-closed durur. Worker secret bundle'ında `PUBLIC_APP_ORIGIN`, bu türetilmiş HTTPS origin'den üretilir.

## İki sahte owner hesabı

Fixture hesaplarının email adresleri workflow metadata'sıdır:

- `randevu-staging-owner-a@example.com`
- `randevu-staging-owner-b@example.com`

Parolalar her workflow run'ında yeniden üretilir. `scripts/staging-ensure-users.mjs` Supabase Admin Auth üzerinden email-confirmed kullanıcıları oluşturur veya aynı kullanıcıların parolasını o run'ın geçici parolasına günceller. Smoke aynı job içindeki maskelenmiş değeri kullanır.

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

Ardından run başında üretilen gate/dispatch secret'larının **yalnız SHA-256 hash'leri** PostgreSQL config tablolarına yazılır:

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
2. ephemeral owner parolaları + public-booking gate + notification dispatch secret'larının üretilip maskelenmesi,
3. 6 dış değer + workflow metadata/ephemeral sözleşmesinin fail-closed doğrulanması,
4. `npm run build:staging`,
5. Cloudflare account subdomain lookup, gerçek `STAGING_APP_ORIGIN` türetimi ve persistent management secret varlık kontrolü,
6. management secret yoksa yalnız bu run için maskelenmiş bootstrap key üretimi,
7. PostgreSQL client kurulumu ve migration push,
8. gerçek Auth test owner'larının hazırlanması,
9. aynı job gate/dispatch secret'larıyla DB runtime hash provisioning,
10. fixture reset + seed,
11. geçici `/tmp` secret bundle'ının hazırlanması; management bootstrap key yalnız ilk gerektiği run'da eklenir,
12. `wrangler deploy --secrets-file` ile deploy; mevcut management secret dosyada yoksa Cloudflare'da korunur,
13. Cloudflare management secret binding doğrulaması,
14. gerçek staging smoke,
15. geçici secret dosyasının her durumda silinmesi.

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

## Bildirim sağlayıcısı kabul sınırı

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
