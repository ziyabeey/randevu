export const MARKETING_RELEASE_GATES = {
  // Public web booking and recovery/integration acceptance are already complete.
  publicBooking: true,

  // Durable reminder/notification path is accepted; marketing stays channel-neutral.
  reminders: true,

  // F10-05 is still outside main while PR #74 is under review.
  customerMemory: false,

  // Commercial price / billing policy is not yet locked for publication.
  pricingPolicy: false,

  // Real pilot results/testimonials do not exist yet; never synthesize proof.
  pilotProof: false,

  // Final lead/contact destination is not wired in the shared app entry yet.
  contactFlow: false,
} as const;
