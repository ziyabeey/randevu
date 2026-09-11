# YZT Randevu

YZT Digital'ın yerel hizmet işletmeleri için geliştirdiği randevu SaaS'ı.

**Mevcut geliştirme dalı: Faz 3 — Hizmet + ekip.** Faz 1 React/Worker temeli üzerine Faz 2'nin kimlik/tenant güvenlik sözleşmesi ve Faz 3 katalog/ekip modeli eklenmiştir.

## Yerel kurulum

```bash
cp .dev.vars.example .dev.vars
npm ci
npm run dev
```

`.dev.vars` içine Supabase proje URL'sini ve anon/publishable key'i girin. Service-role key bu uygulamada kullanılmaz.

Migration'ları sırayla uygulayın:

```text
supabase/migrations/20260911090000_phase2_auth_tenancy.sql
supabase/migrations/20260911100000_phase3_services_team.sql
```

## Faz 3 akışı

1. Kayıt ol veya giriş yap.
2. İlk işletmeyi oluştur. Oluşturan kullanıcı owner olur.
3. Hizmet ekle. Süre ve fiyat hem backend hem PostgreSQL tarafından doğrulanır.
4. Personel ekle.
5. Personelin verebildiği hizmetleri eşleştir.

Tenant izolasyonu her istekte güncel membership ve RLS üzerinden tekrar doğrulanır. `yzt_business` cookie'si tek başına erişim sağlamaz.

## API

| İstek | İşlev |
| --- | --- |
| `GET /api/health` | Worker sağlık kontrolü |
| `POST /api/auth/signup` | Supabase Auth hesabı oluşturur |
| `POST /api/auth/login` | HttpOnly cookie tabanlı oturum açar |
| `POST /api/auth/logout` | Oturumu kapatır |
| `GET /api/session` | Kullanıcı ve aktif membership'leri döndürür |
| `POST /api/businesses` | Business + owner membership oluşturur |
| `POST /api/businesses/select` | Aktif membership doğrulayıp işletme seçer |
| `GET /api/catalog` | Tenant'a ait services/staff/assignments okur |
| `POST /api/services` | Hizmet oluşturur |
| `PATCH /api/services/:id` | Hizmet günceller |
| `POST /api/staff` | Personel oluşturur |
| `PATCH /api/staff/:id` | Personel günceller |
| `PUT /api/staff/:staffId/services/:serviceId` | Personel-hizmet yetkinliği açar/kapatır |

## Güvenlik

- `Business` tenant köküdür.
- `Membership.active=false` olduğunda erişim sonraki istekte kesilir.
- Worker Supabase service-role key kullanmaz.
- PostgREST çağrıları giriş yapan kullanıcının access token'ıyla yapılır ve RLS son sınırdır.
- Staff-Service eşleştirmesi birleşik foreign key taşır; farklı tenant kayıtları bağlanamaz.
- Owner/manager katalog ve ekip mutasyonu yapabilir; staff yalnızca okur.

## Kabul kontrolü

```bash
npm ci
npm run typecheck
npm run build
```

Disposable Supabase veritabanında migration'ları uyguladıktan sonra:

```text
supabase/tests/phase3_services_team.sql
```

Test; tenant A'nın tenant B hizmet/personel kayıtlarını görememesini, membership iptalinde erişimin kesilmesini, geçersiz süre/fiyatın DB tarafından reddedilmesini ve cross-tenant StaffService bağının engellenmesini kapsar.

## Faz sınırı

Faz 3; hizmet, personel ve yetkinlik eşleştirmesinde biter. Mesai, mola, izin, slot hesabı ve timezone availability motoru Faz 4'te; gerçek appointment yazımı ve concurrency Faz 5'tedir.
