export const MARKETING_CONTACT_HREF: string | null = null;

export const MARKETING_RELEASE_GATES = {
  publicBooking: true,
  calendarAvailability: true,
  // F16-02 is still planned. Keep reminder proof in explicit upcoming/concept language only.
  reminders: false,
  onboardingAssistance: true,
  dailyAppointmentSummary: true,
  // F10-05 code is on main, but independent acceptance reopened. Do not publish customer-memory proof yet.
  customerMemory: false,
  pricingPolicy: false,
  pilotProof: false,
  contactFlow: MARKETING_CONTACT_HREF !== null,
} as const;
