# Coding Agent Protocol

## Start here

1. Read `PROJECT_STATE.md` first.
2. Read `DECISIONS.md` only for the phase/invariant you are touching.
3. Read the smallest relevant implementation slice: feature page + feature worker + latest relevant migration + matching SQL test.
4. Do not scan old PR history unless a failing regression makes it necessary.

## Architecture rules

- `Business` is the tenant root. Never trust a client-supplied business ID as authorization.
- Member authorization is current Supabase Auth + active `Membership` + RLS.
- Do not add a service-role key to the Worker.
- Do not weaken cross-tenant composite foreign keys or RLS to make a feature easier.
- Existing stable migrations are immutable. New schema behavior gets a new migration.
- Availability is timezone/DST aware and uses real `timestamptz` instants.
- Appointment overlap correctness belongs to the PostgreSQL exclusion constraint, not only UI/API checks.
- Booking create/reschedule/status operations stay idempotent.
- Appointment snapshot semantics must survive later service/staff edits.
- Public booking remains opt-in. Anonymous users get narrow RPC capability only, never direct table grants.
- Customer management uses `/m#<token>`. The fragment is a bearer capability for exactly one appointment and must never be moved into a server-visible URL path/query, analytics event, log field or plaintext database column.
- Management API requests use stable paths (`/api/manage/view`, `/slots`, `/reschedule`, `/cancel`) and carry the token only inside POST JSON bodies.
- Management tokens are generated with 256 bits of browser cryptographic randomness; PostgreSQL stores only SHA-256 hashes.
- Disabling public booking must not invalidate already-issued management capabilities.
- Public management mutations stay idempotent and preserve public/null-actor audit provenance.

## Product boundary

After Phase 7, stay close to the original competitor-equivalent appointment SaaS goal. The preferred path is calendar UI → notifications/manage-link delivery → UX/mobile polish → deployable MVP. Do not expand into payments, advanced CRM, loyalty, AI or ERP concerns before MVP unless explicitly requested.

## Change protocol

- One phase/concern per branch.
- Prefer small feature modules over refactoring stable completed phases.
- If a stable invariant must change, add/adjust a regression test first.
- Keep UI validation and DB validation aligned, but DB is the final authority.
- Do not invent notification, payment, CRM, token recovery or calendar behavior outside the requested phase.

## Required gate before merge

```bash
npm ci
npm run typecheck
npm run build
```

GitHub CI must also pass all PostgreSQL migration/tests. Never merge around a red DB gate.

## Current files by concern

- Auth / business / catalog: `worker/index.ts`, `src/App.tsx`
- Availability: `worker/availability.ts`, `src/AvailabilityPage.tsx`
- Operator booking: `worker/bookings.ts`, `src/BookingPage.tsx`
- Public booking: `worker/public-booking.ts`, `src/PublicBookingPage.tsx`, `src/PublicBookingSettingsPage.tsx`
- Customer appointment management: `worker/customer-manage.ts`, `src/ManageAppointmentPage.tsx`, `src/customer-manage.css`
- Route assembly: `worker/app.ts`, `src/main.tsx`
- Current state: `PROJECT_STATE.md`
- Architectural rationale: `DECISIONS.md`

## Context-saving principle

Assume Phases 1–7 are correct when their tests are green. Do not re-derive them from scratch. Pull deeper history only when the current task or a failing test directly requires it.