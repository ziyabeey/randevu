# YZT Randevu — Current Project State

Bu dosya yeni bir coding agent'ın repo durumunu minimum taramayla anlaması içindir. Önce bunu oku. Yalnız dokunacağın alan için `DECISIONS.md` ve ilgili test/migration'a in.

## Stable product boundary

Target state after Phase 7:

- Phase 1 ✅ React + Cloudflare Worker foundation
- Phase 2 ✅ Supabase Auth + multi-tenant `Business` / `Membership`
- Phase 3 ✅ Services + staff + staff/service assignment
- Phase 4 ✅ Working hours + breaks + blocks + timezone/DST-safe availability
- Phase 5 ✅ Customers + appointments + concurrency lock + idempotency + reschedule + lifecycle + audit
- Phase 6 ✅ Opt-in public self-booking page and anonymous booking RPC surface
- Phase 7 ✅ Capability-link customer appointment view / reschedule / cancel

Do not redesign completed phases unless a failing test proves a regression or the task explicitly changes an invariant.

## Entry points

### Browser

- `/` → `src/App.tsx` — auth, business selection, services, staff
- `/availability` → `src/AvailabilityPage.tsx`
- `/bookings` → `src/BookingPage.tsx`
- `/public-booking` → `src/PublicBookingSettingsPage.tsx` — owner/manager public-page settings
- `/r/:slug` → `src/PublicBookingPage.tsx` — customer-facing self-booking, no login
- `/m/:token` → `src/ManageAppointmentPage.tsx` — bearer-capability appointment management
- Route selection lives in `src/main.tsx`.

### Worker

- `worker/index.ts` — auth/business/catalog core
- `worker/availability.ts` — Phase 4 member availability API
- `worker/bookings.ts` — Phase 5 member booking API
- `worker/public-booking.ts` — Phase 6 settings + anonymous public API
- `worker/customer-manage.ts` — Phase 7 capability bootstrap/view/reschedule/cancel API
- `worker/app.ts` mounts feature routers.

## Database migration order

1. `20260911090000_phase2_auth_tenancy.sql`
2. `20260911100000_phase3_services_team.sql`
3. `20260911110000_phase4_availability.sql`
4. `20260911120000_phase5_booking_core.sql`
5. `20260911121000_phase5_booking_hardening.sql`
6. `20260911130000_phase6_public_booking.sql`
7. `20260911140000_phase7_customer_manage.sql`

Never edit an already-stable merged migration to implement a new phase. Append a new migration.

## Non-negotiable invariants

- `Business` is the tenant root.
- Browser-selected business cookie is preference, never authorization.
- Member requests re-check current `Membership` and RLS.
- Worker never uses a Supabase service-role key.
- Cross-tenant foreign-key relationships remain impossible.
- Availability uses real `timestamptz` instants and business IANA timezone.
- Appointment occupied range includes service buffers.
- PostgreSQL `EXCLUDE USING gist` is the final same-staff overlap lock.
- `cancelled` releases a slot; `completed` and `no_show` retain historical occupancy.
- Booking mutation commands are idempotent.
- Existing appointment snapshots survive later catalog edits.
- Terminal appointment states do not reopen.
- Anonymous callers never receive direct table grants.
- Public booking is opt-in and defaults to disabled.
- Public booking can create only a currently valid public slot and requires phone or email.
- Public-created CRM matches may reuse an existing customer ID but never mutate that existing customer row.
- Management URL is a bearer capability: possession grants access to exactly one appointment.
- Plain management tokens are never stored in PostgreSQL; only SHA-256 hashes are stored.
- Capability table has no anon/authenticated direct table grants.
- Existing issued management capability remains valid if the business later disables public booking.
- Customer reschedule preserves the booked appointment duration/buffer snapshots and obeys current schedule, blocks, staff eligibility, notice and horizon.
- Customer reschedule/cancel are idempotent and write `actor_type='public'`, `actor_user_id=null` audit events.

## Phase 6 public surface

Business owner/manager controls:

- `enabled`
- `step_minutes`
- `min_notice_minutes`
- `horizon_days`

Anonymous booking surface exposes sanitized business/catalog/staff/live-slot data and one safe booking confirmation.

## Phase 7 customer management surface

Public booking confirmation generates a 256-bit browser-side capability token. Booking creation remains Phase 6 idempotent; capability provisioning uses the same original booking idempotency key to prove the appointment belongs to that public create command. Provisioning can therefore be retried after a network interruption without duplicating the booking.

The plain token exists only in the customer URL/browser. PostgreSQL stores `SHA-256(token)` in `appointment_management_capabilities`.

Anonymous management RPCs support only:

- sanitized single-appointment read
- reschedule slot computation for that appointment
- idempotent reschedule
- idempotent cancellation

There is no token recovery or token listing API in Phase 7.

## Tests / acceptance gate

Every PR must pass:

```bash
npm ci
npm run typecheck
npm run build
```

CI builds disposable PostgreSQL 17, applies every migration in order, then runs:

- `supabase/tests/phase3_services_team.sql`
- `supabase/tests/phase4_availability.sql`
- `supabase/tests/phase5_booking_core.sql`
- `supabase/tests/phase6_public_booking.sql`
- `supabase/tests/phase7_customer_manage.sql`

Phase 7 regression coverage includes hashed-only capability storage, direct-table denial, invalid-token isolation, management after public-page disable, snapshot-safe reschedule, mutation idempotency, public audit provenance and cancellation slot release.

Do not merge around a red SQL gate.

## Scope intentionally NOT implemented yet

- SMS/e-mail delivery of booking/manage links or reminders
- Token recovery / reissue flow
- Payments/deposits
- Cloudflare Turnstile / dedicated anti-bot layer
- Per-IP/distributed rate limiting
- Google/Apple/Outlook calendar sync
- CRM automations and marketing flows

These are future phases. Do not silently add them while fixing unrelated work.

## Known maintenance item

`npm ci` reported 4 high-severity audit warnings on 2026-09-11. They were pre-existing and did not fail typecheck/build/SQL CI. Resolve them in a dedicated dependency-maintenance PR so application behavior and dependency upgrades are not mixed.

## Agent efficiency rule

For a new task, read this file first. Then read only the feature worker/page, the latest relevant migration, and matching SQL test. Do not scan merged PR history or all previous migrations unless a regression requires it.