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
- Public booking remains opt-in. Anonymous users get RPC capability only, never direct table grants.

## Change protocol

- One phase/concern per branch.
- Prefer small feature modules over refactoring stable completed phases.
- If a stable invariant must change, add/adjust a regression test first.
- Keep UI validation and DB validation aligned, but DB is the final authority.
- Do not invent notification, payment, CRM or calendar behavior outside the requested phase.

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
- Route assembly: `worker/app.ts`, `src/main.tsx`
- Current state: `PROJECT_STATE.md`
- Architectural rationale: `DECISIONS.md`

## Context-saving principle

Assume Phases 1–6 are correct when their tests are green. Do not re-derive them from scratch. Pull deeper history only when the current task or a failing test directly requires it.
