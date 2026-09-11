# YZT Randevu — Current Project State

Bu dosya yeni bir coding agent'ın repo durumunu minimum taramayla anlaması içindir. Önce bunu oku. Yalnız dokunacağın alan için `DECISIONS.md` ve ilgili test/migration'a in.

## Stable product boundary

Target state after the current Phase 6 PR:

- Phase 1 ✅ React + Cloudflare Worker foundation
- Phase 2 ✅ Supabase Auth + multi-tenant `Business` / `Membership`
- Phase 3 ✅ Services + staff + staff/service assignment
- Phase 4 ✅ Working hours + breaks + blocks + timezone/DST-safe availability
- Phase 5 ✅ Customers + appointments + concurrency lock + idempotency + reschedule + lifecycle + audit
- Phase 6 ✅ Opt-in public self-booking page and anonymous booking RPC surface

Do not redesign completed phases unless a failing test proves a regression or the task explicitly changes an invariant.

## Entry points

### Browser

- `/` → `src/App.tsx` — auth, business selection, services, staff
- `/availability` → `src/AvailabilityPage.tsx`
- `/bookings` → `src/BookingPage.tsx`
- `/public-booking` → `src/PublicBookingSettingsPage.tsx` — owner/manager public-page settings
- `/r/:slug` → `src/PublicBookingPage.tsx` — customer-facing self-booking, no login
- Route selection lives in `src/main.tsx`.

### Worker

- `worker/index.ts` — auth/business/catalog core
- `worker/availability.ts` — Phase 4 member availability API
- `worker/bookings.ts` — Phase 5 member booking API
- `worker/public-booking.ts` — Phase 6 settings + anonymous public API
- `worker/app.ts` mounts feature routers.

## Database migration order

1. `20260911090000_phase2_auth_tenancy.sql`
2. `20260911100000_phase3_services_team.sql`
3. `20260911110000_phase4_availability.sql`
4. `20260911120000_phase5_booking_core.sql`
5. `20260911121000_phase5_booking_hardening.sql`
6. `20260911130000_phase6_public_booking.sql`

Never edit an already-stable migration to implement a new phase. Append a new migration.

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

## Phase 6 public surface

Business owner/manager controls:

- `enabled`
- `step_minutes`
- `min_notice_minutes`
- `horizon_days`

Anonymous RPCs expose only:

- sanitized public business header
- active bookable services
- eligible staff names
- live slots
- one safe booking confirmation row after creation

Public creation writes `appointments.source='public'`; audit event uses `actor_type='public'` and a null authenticated actor.

## Tests / acceptance gate

Every PR must pass:

```bash
npm ci
npm run typecheck
npm run build
```

CI also builds a disposable PostgreSQL 17 database, applies every migration in order, then runs:

- `supabase/tests/phase3_services_team.sql`
- `supabase/tests/phase4_availability.sql`
- `supabase/tests/phase5_booking_core.sql`
- `supabase/tests/phase6_public_booking.sql`

Do not merge around a red SQL gate.

## Scope intentionally NOT implemented yet

- Public cancellation/reschedule links
- SMS/e-mail reminders or notifications
- Payments/deposits
- Cloudflare Turnstile / dedicated anti-bot layer
- Per-IP/distributed rate limiting
- Google/Apple/Outlook calendar sync
- CRM automations and marketing flows

These are future phases. Do not silently add them while fixing unrelated work.

## Known maintenance item

`npm ci` reported 4 high-severity audit warnings on 2026-09-11. They were pre-existing and did not fail typecheck/build/SQL CI. Resolve them in a dedicated dependency-maintenance PR so application behavior and dependency upgrades are not mixed.

## Agent efficiency rule

For a new task, read this file first. Then read only the feature worker/page, the latest relevant migration, and its test. Do not scan merged PR history or all previous migrations unless a regression requires it.
