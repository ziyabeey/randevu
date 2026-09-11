# YZT Randevu — Current Project State

Bu dosya coding agent'ın repo durumunu minimum taramayla anlaması içindir. Önce bunu oku; yalnız dokunacağın concern için `DECISIONS.md` ve ilgili worker/page/migration/test'e in.

## Stable product boundary

Target state after Phase 8:

- Phase 1 ✅ React + Cloudflare Worker foundation
- Phase 2 ✅ Supabase Auth + multi-tenant `Business` / `Membership`
- Phase 3 ✅ Services + staff + staff/service assignment
- Phase 4 ✅ Working hours + blocks + timezone/DST-safe availability
- Phase 5 ✅ Customers + appointments + overlap lock + idempotency + lifecycle + audit
- Phase 6 ✅ Opt-in public self-booking
- Phase 7 ✅ Capability-link customer view / reschedule / cancel
- Phase 8 ✅ Operator day/week calendar projection

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
- `worker/customer-manage.ts` — customer capability management
- `worker/calendar.ts` — Phase 8 tenant-safe local-date calendar read API
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
- Calendar is a **read projection over appointments**, not a second booking model. Calendar quick actions must reuse stable Faz 5 lifecycle endpoints.
- Calendar ranges are expressed as business-local dates and converted to exact UTC instants in PostgreSQL.

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

CI builds PostgreSQL 17, applies every migration in order and runs Faz 3–8 regression tests. Never merge around a red DB gate.

Phase 8 regression specifically checks business-local day boundaries, staff filtering, cross-tenant denial and immediate membership revocation.

## MVP roadmap

Stay close to the original competitor-equivalent appointment SaaS goal:

1. calendar ✅ Phase 8
2. booking confirmations/reminders + manage-link delivery
3. UX/mobile polish
4. deployable MVP hardening

Do not expand into payments, advanced CRM, loyalty, AI or broad ERP functionality before MVP unless scope explicitly changes.

## Known maintenance item

`npm ci` reported 4 high-severity audit warnings on 2026-09-11. Keep dependency upgrades in a dedicated maintenance PR.

## Agent efficiency rule

Read this file first. Then read only the relevant page + worker + latest migration + matching SQL test. Do not scan merged PR history or all old migrations unless a regression requires it.
