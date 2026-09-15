export const ROUTE_CUTOVER_STATUS = "domain-separated-pre-cutover" as const;

/**
 * Existing private-app surfaces that intentionally return to `/` on the
 * canonical operator origin. MKT-DOMAIN-01 no longer plans to rewrite these
 * links to same-origin `/app`; the public marketing site lives on a different
 * origin.
 */
export const PRIVATE_APP_ROOT_RETURN_FILES = [
  "src/App.tsx",
  "src/AvailabilityPage.tsx",
  "src/BookingPage.tsx",
  "src/CalendarPage.tsx",
  "src/CustomersPage.tsx",
  "src/InvitePage.tsx",
  "src/OnboardingPage.tsx",
  "src/PublicBookingSettingsPage.tsx",
  "src/TeamPage.tsx",
  "src/main.tsx",
] as const;
