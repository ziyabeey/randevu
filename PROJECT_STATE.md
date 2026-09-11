# YZT Randevu — Current Project State

Bu dosya coding agent'ın repo durumunu minimum taramayla anlaması içindir. Önce bunu oku; yalnız dokunacağın concern için `DECISIONS.md` ve ilgili worker/page/migration/test'e in.

## Stable product boundary

Target state after Phase 9:

- Phase 1 ✅ React + Cloudflare Worker foundation
- Phase 2 ✅ Supabase Auth + multi-tenant `Business` / `Membership`
- Phase 3 ✅ Services + staff + staff/service assignment
- Phase 4 ✅ Working hours + blocks + timezone/DST-safe availability
- Phase 5 ✅ Customers + appointments + overlap lock + idempotency + lifecycle + audit
- Phase 6 ✅ Opt-in public self-booking
- Phase 7 ✅ Capability-link customer view / reschedule / cancel
- Phase 8 ✅ Operator day/week calendar projection
- Phase 9 ✅ Public booking confirmation e-mail + manage-link delivery

Do not redesign completed phases unless a failing regression proves it is required.

## Browser entry points

- `/calendar` → `src/CalendarPage.tsx` — primary operator calendar, day/week views and quick lifecycle actions
- `/bookings` → `src/BookingPage.tsx` — create/reschedule/full booking operations
- `/availability` → `src/AvailabilityPage.tsx`
- `/` → `src/App.tsx` — business, services, staff
- `/public-booking` → `src/PublicBookingSettingsPage.tsx`
- `/r/:slug` → `src/PublicBookingPage.tsx`
- `/m#<token>` → `src/ManageAppointmentPage.tsx`; secret fragment is not sent in page HTTP requests

## Worker entry points

- `worker/index.ts` — auth/business/catalog core
- `worker/availability.ts` — availability member API
- `worker/bookings.ts` — booking mutation/lifecycle API
- `worker/public-booking.ts` — public booking
- `worker/customer-manage.ts` — capability provisioning + customer management + Phase 9 delivery orchestration
- `worker/email.ts` — Resend REST adapter and booking confirmation template
- `worker/calendar.ts` — tenant-safe local-date calendar read API
- `worker/app.ts` mounts feature routers.

## Migration order

1. `20260911090000_phase2_auth_tenancy.sql`
2. `20260911100000_phase3_services_team.sql`
3. `20260911110000_phase4_availability.sql`
4. `20260911120000_phase5_booking_core.sql`
5. `20260911121000_phase5_booking_hardening.sql`
6. `20260911130000_phase6_public_booking.sql`
7. `20260911140000_phase7_customer_manage.sql`
8. `20260911150000_phase8_calendar.sql`
9. `20260911160000_phase9_email_delivery.sql`

Stable merged migrations are immutable. New behavior gets a new migration.

## Non-negotiable invariants

- `Business` is the tenant root; browser business selection is preference, not authorization.
- Member reads/mutations re-check active `Membership` and RLS. Worker never uses service-role key.
- Cross-tenant relationships remain impossible.
- Availability and calendar local-day boundaries use the business IANA timezone and real `timestamptz` instants.
- Appointment occupied range includes buffers. Same-staff overlap final lock is PostgreSQL `EXCLUDE USING gist`.
- `cancelled` releases a slot; `completed/no_show` keep historical occupancy.
- Booking mutations are idempotent and appointment snapshots survive later catalog edits.
- Public callers never receive direct tenant table grants.
- Public booking is opt-in.
- Management capability is single-appointment bearer authority; plain token is never stored and never appears in server-visible URL path/query.
- Calendar is a read projection over appointments, not a second booking model. Calendar quick actions reuse stable Phase 5 lifecycle endpoints.
- Calendar ranges are business-local dates converted to exact UTC instants in PostgreSQL.
- Notification provider failure must never roll back or invalidate a valid booking/capability.
- Phase 9 delivery receipts may persist recipient/provider metadata but never the plain management token or full manage URL.

## Phase 9 e-mail delivery

Public booking confirmation calls `/api/manage/provision` with the original public-create idempotency key and browser-generated management token. After capability provisioning succeeds:

1. `get_public_booking_email_payload` re-validates that the appointment belongs to that exact public-create command.
2. If no e-mail was supplied, delivery is skipped while the booking remains valid.
3. If `RESEND_API_KEY` / `NOTIFICATION_FROM_EMAIL` are not configured, delivery is disabled without affecting booking.
4. Otherwise the Worker sends the confirmation through Resend REST using a provider idempotency key.
5. Only the provider message ID + recipient delivery receipt is persisted. The management token is never written to PostgreSQL.
6. UI always retains the on-screen `/m#<token>` management link and reports the delivery result.

The outbound e-mail provider necessarily receives the manage URL in order to deliver it. Application logs and PostgreSQL must not persist that secret.

## Phase 8 calendar surface

`GET /api/calendar?date=YYYY-MM-DD&days=1|7&staffId=...` returns the active tenant's business context, staff list and appointment projection. If `date` is omitted, business-local today is used.

UI capabilities:

- day view: staff columns + timed appointment blocks
- week view: seven local-date columns
- staff filter
- optional cancelled visibility
- scheduled/confirmed/completed summary counts
- appointment detail drawer
- quick lifecycle actions: confirm, complete, no-show, cancel
- new/full booking operations remain in `/bookings`

## Acceptance gate

Every PR must pass:

```bash
npm ci
npm run typecheck
npm run build
```

CI builds PostgreSQL 17, applies every migration in order and runs Phase 3–9 regression tests. Never merge around a red DB gate.

Phase 9 regression checks booking-proof isolation, direct-table denial, durable delivery receipt idempotency and absence of management-link material in persisted receipts.

## Deployment configuration

Required core vars:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

Production e-mail delivery additionally needs Worker secrets/vars:

- `RESEND_API_KEY`
- `NOTIFICATION_FROM_EMAIL` — verified sender, for example `YZT Randevu <randevu@example.com>`

If the e-mail vars are absent, booking remains functional and the UI reports delivery as disabled.

## MVP roadmap

Stay close to the original competitor-equivalent appointment SaaS goal:

1. calendar ✅ Phase 8
2. confirmation e-mail + manage-link delivery ✅ Phase 9
3. appointment reminders
4. UX/mobile polish
5. deployable MVP hardening

Do not expand into payments, advanced CRM, loyalty, AI or broad ERP functionality before MVP unless scope explicitly changes.

## Known maintenance item

`npm ci` reported 4 high-severity audit warnings on 2026-09-11. Keep dependency upgrades in a dedicated maintenance PR.

## Agent efficiency rule

Read this file first. Then read only the relevant page + worker + latest migration + matching SQL test. Do not scan merged PR history or all old migrations unless a regression requires it.
