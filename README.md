# YZT Randevu

YZT Digital'ın yerel hizmet işletmeleri için geliştirdiği randevu SaaS'ı.

**Mevcut geliştirme dalı: Faz 5 — Booking çekirdeği.** Faz 1 React/Worker temeli, Faz 2 kimlik/tenant güvenliği, Faz 3 hizmet/ekip ve Faz 4 müsaitlik motorunun üzerine müşteri, gerçek appointment, çakışma kilidi, idempotency, reschedule ve audit eklenmiştir.

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
supabase/migrations/20260911120000_phase5_booking_core.sql
supabase/migrations/20260911121000_phase5_booking_hardening.sql
```

## Faz 5 akışı

1. Ana çalışma alanında işletme, hizmet ve personeli oluştur.
2. `/availability` ekranında işletme/personel mesaisini, mola ve izin/kapanışları tanımla.
3. `/bookings` ekranında müşteri + hizmet + tarih + personel seçerek boş slotları getir.
4. Bir slot seçip randevuyu oluştur. Slot DB seviyesinde kilitlenir ve normal müsaitlikten düşer.
5. Planlanan randevuyu onayla, taşı veya iptal et.
6. Onaylı randevuyu tamamlandı ya da no-show olarak kapat.
7. `Geçmiş` ile append-only appointment audit kayıtlarını incele.

İptal edilen randevu slotu yeniden açar. Completed/no-show kayıtları tarihsel occupancy'yi korur.

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
| `GET /api/availability/setup` | Tenant'ın timezone, haftalık saat ve bloklarını okur |
| `PUT /api/availability/business-hours/:weekday` | İşletme gününün açık aralıklarını atomik değiştirir |
| `PUT /api/availability/staff/:staffId/hours/:weekday` | Personelin günlük çalışma aralıklarını atomik değiştirir |
| `POST /api/availability/blocks` | Tarih bazlı izin/kapanış ekler |
| `DELETE /api/availability/blocks/:id` | İzin/kapanış kaydını siler |
| `GET /api/availability/slots` | Mesai, bloklar ve mevcut randevulardan gerçek boş slot üretir |
| `GET /api/bookings` | Aktif tenant'ın randevularını listeler |
| `POST /api/bookings` | Müşteri + appointment oluşturur; `Idempotency-Key` zorunludur |
| `GET /api/bookings/:id/reschedule-slots` | Mevcut appointment'ı kendi çakışmasından hariç tutarak taşıma slotu üretir |
| `POST /api/bookings/:id/reschedule` | Appointment'ı atomik olarak yeni personele/saate taşır |
| `POST /api/bookings/:id/status` | Confirm/cancel/complete/no-show geçişlerini uygular |
| `GET /api/bookings/:id/events` | Append-only appointment audit geçmişini döndürür |

## Booking kuralları

- `appointments` hizmet/personel/müşteri kimliklerini ve oluşturma anındaki ad, fiyat, süre, buffer ve timezone snapshot'larını saklar.
- Personelin occupied aralığı `buffer_before + duration + buffer_after` ile belirlenir.
- PostgreSQL `EXCLUDE USING gist` aynı tenant/personel için çakışan non-cancelled occupied aralıklarını fiziksel olarak engeller.
- Uygulama önce availability kontrolü yapar; yarış koşulunda son söz yine exclusion constraint'indir.
- Public slot motoru `scheduled`, `confirmed`, `completed` ve `no_show` appointment'ları müsaitlikten düşer. `cancelled` slotu serbest bırakır.
- Reschedule slot motoru yalnız taşınan appointment'ı ignore eder; diğer bütün appointment'lar ve availability block'ları normal şekilde engel olmaya devam eder.
- Reschedule mevcut appointment'ın snapshot süre ve buffer değerlerini korur; hizmet kataloğu sonradan değişmiş veya pasifleşmiş olsa bile tarihsel booking semantiği bozulmaz.
- Create/reschedule/status komutları `booking_commands` tablosunda idempotent tutulur. Aynı key + aynı payload önceki sonucu döndürür; aynı key + farklı payload `IDEMPOTENCY_CONFLICT` üretir.
- Appointment event geçmişi append-only'dir; create, reschedule ve status değişiklikleri actor kullanıcı ile kaydedilir.
- Yaşam döngüsü DB seviyesinde sınırlıdır: `scheduled → confirmed/cancelled`, `confirmed → completed/no_show/cancelled`; terminal durumlar yeniden açılamaz.

## Güvenlik

- `Business` tenant köküdür; cookie tek başına yetki değildir.
- Her booking isteği güncel JWT + aktif `Membership` ile tekrar doğrulanır; RLS ikinci sınırdır.
- Worker Supabase service-role key kullanmaz.
- `customers`, `appointments` ve `appointment_events` authenticated kullanıcıya tenant-scoped read-only açılır.
- Booking mutasyonlarında tabloya doğrudan yazma grant'i yoktur; security-definer RPC'ler explicit `auth.uid()` + `is_active_member()` kontrolü yapar.
- Customer/Service/Staff foreign key'leri `business_id` ile birleşiktir; cross-tenant appointment bağı kurulamaz.
- `booking_commands` istemciye okunabilir/yazılabilir açılmaz.

## Kabul kontrolü

```bash
npm ci
npm run typecheck
npm run build
```

CI disposable PostgreSQL üzerinde Faz 2 → 5 migration zincirini ve şu testleri çalıştırır:

```text
supabase/tests/phase3_services_team.sql
supabase/tests/phase4_availability.sql
supabase/tests/phase5_booking_core.sql
```

Faz 5 testi; idempotent create, katalog mutasyonundan sonra exact retry, farklı payload/key çatışması, appointment'ın availability'den düşmesi, snapshot-reschedule, lifecycle gate'leri, eski slotun yeniden açılması, cancel ile slot release, status/audit, tenant izolasyonu ve DB exclusion constraint'ini kapsar.

## Faz sınırı

Faz 5 booking çekirdeğinde müşteri ve appointment yaşam döngüsü vardır. Henüz public müşteri rezervasyon sayfası, ödeme, SMS/e-posta hatırlatma, takvim entegrasyonu veya gelişmiş CRM yoktur; bunlar sonraki fazların konusudur.
