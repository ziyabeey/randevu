# YZT Randevu

YZT Digital'ın yerel hizmet işletmeleri için geliştirdiği randevu SaaS'ı.

**Mevcut geliştirme dalı: Faz 4 — Müsaitlik motoru.** Faz 1 React/Worker temeli, Faz 2 kimlik/tenant güvenliği ve Faz 3 hizmet/ekip modelinin üzerine haftalık çalışma saatleri, mola, izin/kapanış, timezone ve gerçek slot hesabı eklenmiştir.

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
supabase/migrations/20260911110000_phase4_availability.sql
```

## Faz 4 akışı

1. Ana çalışma alanında işletme, hizmet ve personeli oluştur.
2. `/availability` ekranında işletmenin haftalık açık aralıklarını tanımla.
3. Her personelin haftalık çalışma aralıklarını tanımla.
4. Mola için aynı günü iki veya daha fazla açık aralığa böl.
5. Tarih bazlı personel izni veya tüm işletme kapanışı ekle.
6. Hizmet + tarih + personel seçerek gerçek slotları önizle. `Fark etmez` seçimi uygun tüm personellerin slotlarını döndürür.

Slot önizleme appointment oluşturmaz. Booking yazımı Faz 5 kapsamındadır.

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
| `GET /api/availability/setup` | Tenant'ın timezone, haftalık saat ve bloklarını okur |
| `PUT /api/availability/business-hours/:weekday` | Bir işletme gününün açık aralıklarını atomik değiştirir |
| `PUT /api/availability/staff/:staffId/hours/:weekday` | Bir personelin günlük çalışma aralıklarını atomik değiştirir |
| `POST /api/availability/blocks` | Tarih bazlı izin/kapanış ekler |
| `DELETE /api/availability/blocks/:id` | İzin/kapanış kaydını siler |
| `GET /api/availability/slots` | Hizmet süresi, tamponlar, mesai ve bloklardan slot üretir |

## Müsaitlik kuralları

- İşletme ve personel haftalık aralıkları kesiştirilir.
- Haftalık aralıklar arasındaki boşluklar mola kabul edilir.
- Personelin hizmeti verebilmesi için aktif `StaffService` eşleşmesi gerekir.
- Hizmet süresi ile `buffer_before` ve `buffer_after` birlikte açık pencereye sığmalıdır.
- Slot adımı hizmet süresinden bağımsızdır; örneğin 15 dakikalık grid üzerinde 45 dakikalık hizmet üretilebilir.
- İşletme seviyesindeki blok bütün personeli, personel seviyesindeki blok yalnız ilgili kişiyi kapatır.
- `00:00 → 00:00` tarih bloğu o yerel günün tamamını kapatır.
- Haftalık saatler işletmenin IANA timezone'u ile gerçek `timestamptz` anlarına çevrilir.
- İlkbahar DST sıçramasında var olmayan yerel saat slot üretemez. Sonbaharda tekrarlanan yerel saat iki farklı UTC offset'e sahip iki gerçek zaman aralığı olarak korunur.

## Güvenlik

- `Business` tenant köküdür.
- `Membership.active=false` olduğunda erişim sonraki istekte kesilir.
- Aktif işletme cookie'si tek başına yetki değildir; her availability isteği JWT + güncel Membership + RLS ile doğrulanır.
- Worker Supabase service-role key kullanmaz.
- Schedule tablolarına authenticated kullanıcılar doğrudan yazamaz. Mutasyonlar atomik RPC'lerden geçer ve owner/manager yetkisi tekrar kontrol edilir.
- Staff availability verisini okuyabilir fakat schedule, izin veya kapanış mutasyonu yapamaz.
- Staff-Service ve Staff-Hours ilişkilerinde birleşik tenant foreign key'leri cross-tenant bağlantıyı engeller.
- İşletme timezone'u PostgreSQL `pg_timezone_names` listesine göre doğrulanır.

## Kabul kontrolü

```bash
npm ci
npm run typecheck
npm run build
```

CI ayrıca disposable PostgreSQL üzerinde migration'ları ve şu testleri çalıştırır:

```text
supabase/tests/phase3_services_team.sql
supabase/tests/phase4_availability.sql
```

Faz 4 testi; işletme/personel saat kesişimini, mola davranışını, hizmet tamponlarını, personel iznini, tüm gün kapanışı, staff read-only rolünü, tenant izolasyonunu, geçersiz timezone reddini ve Europe/Berlin yaz/kış saati geçişlerini kapsar.

## Faz sınırı

Faz 4 gerçek appointment yazmaz ve mevcut randevu çakışması henüz hesaba katılmaz. Appointment oluşturma, aynı personelin zaman aralığında concurrency/exclusion constraint, idempotency, reschedule ve audit Faz 5 booking çekirdeğinde eklenecektir.
