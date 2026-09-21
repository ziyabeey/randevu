export type BookingInformationContact = {
  businessName: string;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  whatsapp?: string | null;
  address?: string | null;
  kvkkNoticeText?: string | null;
  kvkkNoticeUrl?: string | null;
  privacyPolicyUrl?: string | null;
  bookingTermsText?: string | null;
  bookingTermsUrl?: string | null;
};

function present(value: string | null | undefined) {
  return Boolean(value?.trim());
}

export function hasPublicSupportContact(contact: BookingInformationContact | null | undefined) {
  return Boolean(contact && (present(contact.phone) || present(contact.email) || present(contact.whatsapp)));
}

export function hasPublicBookingInformation(contact: BookingInformationContact | null | undefined) {
  return Boolean(
    contact
    && hasPublicSupportContact(contact)
    && (present(contact.kvkkNoticeText) || present(contact.kvkkNoticeUrl))
    && present(contact.privacyPolicyUrl)
    && present(contact.bookingTermsText),
  );
}

function phoneHref(value: string) {
  return `tel:${value.replace(/\s+/g, '')}`;
}

function whatsappHref(value: string) {
  return `https://wa.me/${value.replace(/\D/g, '')}`;
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
}

export default function PublicBookingInformation({
  contact,
  slug,
  prefix = 'booking',
  className = '',
}: {
  contact: BookingInformationContact | null | undefined;
  slug: string;
  prefix?: string;
  className?: string;
}) {
  const informationReady = hasPublicBookingInformation(contact);
  const informationBase = `/r/${encodeURIComponent(slug)}`;
  const ids = {
    notice: `${prefix}-aydinlatma`,
    privacy: `${prefix}-gizlilik`,
    terms: `${prefix}-kosullar`,
    support: `${prefix}-destek`,
  };

  return (
    <section className={`public-booking-information ${className}`.trim()} aria-label="Rezervasyon bilgilendirmeleri">
      <nav className="public-information-links" aria-label="Bilgilendirme bağlantıları">
        <a href={`${informationBase}/kvkk`} target="_blank" rel="noreferrer">Aydınlatma ve KVKK</a>
        <a href={`${informationBase}/privacy`} target="_blank" rel="noreferrer">Gizlilik</a>
        <a href={`${informationBase}/terms`} target="_blank" rel="noreferrer">Randevu koşulları</a>
        <a href={`${informationBase}/support`} target="_blank" rel="noreferrer">Destek</a>
      </nav>

      {!informationReady && (
        <p className="public-information-warning" role="alert">
          İşletmenin zorunlu rezervasyon bilgilendirmeleri henüz tamamlanmadı. Bu bilgiler yayınlanmadan yeni randevu oluşturulamaz.
        </p>
      )}

      <div className="public-information-sections">
        <article id={ids.notice} tabIndex={-1}>
          <h3>Aydınlatma ve KVKK</h3>
          {contact?.kvkkNoticeText?.trim()
            ? <p className="public-information-prewrap">{contact.kvkkNoticeText}</p>
            : <p className="public-muted">İşletmenin yayınladığı aydınlatma metni bu ekranda yer almıyor.</p>}
          {contact?.kvkkNoticeUrl?.trim() && <ExternalLink href={contact.kvkkNoticeUrl}>İşletmenin aydınlatma metnini aç</ExternalLink>}
        </article>

        <article id={ids.privacy} tabIndex={-1}>
          <h3>Gizlilik</h3>
          {contact?.privacyPolicyUrl?.trim()
            ? <ExternalLink href={contact.privacyPolicyUrl}>İşletmenin gizlilik politikasını aç</ExternalLink>
            : <p className="public-muted">İşletmenin gizlilik politikası bağlantısı henüz yayınlanmadı.</p>}
        </article>

        <article id={ids.terms} tabIndex={-1}>
          <h3>Randevu, iptal ve değişiklik koşulları</h3>
          {contact?.bookingTermsText?.trim()
            ? <p className="public-information-prewrap">{contact.bookingTermsText}</p>
            : <p className="public-muted">İşletmenin randevu koşulları henüz yayınlanmadı.</p>}
          {contact?.bookingTermsUrl?.trim() && <ExternalLink href={contact.bookingTermsUrl}>Ayrıntılı koşulları aç</ExternalLink>}
        </article>

        <article id={ids.support} tabIndex={-1}>
          <h3>Destek ve iletişim</h3>
          <p>Rezervasyonla ilgili destek için {contact?.businessName?.trim() || 'işletme'} ile iletişime geçin.</p>
          {contact && (
            <div className="public-information-contact">
              {contact.phone?.trim() && <a href={phoneHref(contact.phone)}>{contact.phone}</a>}
              {contact.email?.trim() && <a href={`mailto:${contact.email}`}>{contact.email}</a>}
              {contact.whatsapp?.trim() && <a href={whatsappHref(contact.whatsapp)} rel="noreferrer">WhatsApp</a>}
              {contact.website?.trim() && <ExternalLink href={contact.website}>İşletme web sitesi</ExternalLink>}
              {contact.address?.trim() && <address>{contact.address}</address>}
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
