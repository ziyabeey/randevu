export const MARKETING_CONTACT_HREF: string | null = null;

export const MARKETING_RELEASE_GATES = {
  publicBooking: true,
  calendarAvailability: true,
  reminders: true,
  onboardingAssistance: true,
  dailyAppointmentSummary: true,
  customerMemory: false,
  pricingPolicy: false,
  pilotProof: false,
  contactFlow: MARKETING_CONTACT_HREF !== null,
} as const;
