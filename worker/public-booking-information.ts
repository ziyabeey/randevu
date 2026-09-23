export type PublicBookingInformationProjection = {
  kvkk_notice_text?: string | null;
  kvkk_notice_url?: string | null;
  privacy_policy_url?: string | null;
  booking_terms_text?: string | null;
  booking_terms_url?: string | null;
};

function present(value: string | null | undefined) {
  return Boolean(value?.trim());
}

export function hasRequiredPublicBookingInformation(
  value: PublicBookingInformationProjection | null | undefined,
) {
  return Boolean(
    value
    && (present(value.kvkk_notice_text) || present(value.kvkk_notice_url))
    && present(value.privacy_policy_url)
    && present(value.booking_terms_text),
  );
}
