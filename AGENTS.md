# Coding Agent Protocol

## Start here

1. Read `PROJECT_STATE.md` first.
2. Read `DECISIONS.md` only for the concern being changed.
3. Read the smallest implementation slice: feature page + worker + latest migration + matching SQL test.
4. Do not scan old PR history unless a failing regression requires it.

## Architecture rules

- `Business` is the tenant root. Never trust client business ID as authorization.
- Member authorization is Supabase Auth + active `Membership` + RLS. Never add a service-role key to Worker.
- Keep cross-tenant composite FKs/RLS intact.
- Stable merged migrations are immutable.
- Availability/calendar use business IANA timezone and real `timestamptz` instants.
- Same-staff overlap correctness belongs to PostgreSQL exclusion constraint.
- Booking create/reschedule/status remain idempotent; snapshots survive later catalog edits.
- Public booking stays opt-in; anonymous users receive only narrow RPC capability.
- Customer management uses `/m#<token>` and POST-body capability transport. Never log/store the plain token.
- **Calendar is projection, not authority.** Do not duplicate booking lifecycle/concurrency logic inside calendar code. Calendar mutations call existing booking endpoints.
- **Notification delivery is best-effort, not booking authority.** Provider failure must never roll back a valid appointment or capability.
- Phase 9 manage-link e-mail may receive the plaintext capability only transiently inside Worker/provider request memory. PostgreSQL delivery receipts must never contain the token or full management URL.

## Product boundary

After Phase 9 the MVP path is appointment reminders → UX/mobile polish → deployable MVP. Do not expand into payment, advanced CRM, loyalty, AI or ERP concerns unless explicitly requested.

## Change protocol

- One phase/concern per branch.
- Prefer feature modules over refactoring stable phases.
- If an invariant must change, add/adjust regression coverage first.
- DB remains final authority for booking correctness.
- Keep notification-provider code isolated behind `worker/email.ts`; do not spread Resend-specific calls across booking routes.

## Required gate

```bash
npm ci
npm run typecheck
npm run build
```

GitHub CI must pass all PostgreSQL migration/tests.

## Files by concern

- E-mail delivery: `worker/email.ts`, `worker/customer-manage.ts`, `src/PublicBookingPage.tsx`, `20260911160000_phase9_email_delivery.sql`, `phase9_email_delivery.sql`
- Calendar: `worker/calendar.ts`, `src/CalendarPage.tsx`, `src/calendar.css`, `20260911150000_phase8_calendar.sql`, `phase8_calendar.sql`
- Operator booking: `worker/bookings.ts`, `src/BookingPage.tsx`
- Availability: `worker/availability.ts`, `src/AvailabilityPage.tsx`
- Public booking: `worker/public-booking.ts`, `src/PublicBookingPage.tsx`
- Customer management: `worker/customer-manage.ts`, `src/ManageAppointmentPage.tsx`
- Auth/business/catalog: `worker/index.ts`, `src/App.tsx`
- State: `PROJECT_STATE.md`

## Context-saving principle

Assume Phases 1–9 are correct when tests are green. Pull deeper history only when the current task directly requires it.
