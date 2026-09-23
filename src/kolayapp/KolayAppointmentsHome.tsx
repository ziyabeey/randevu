export type KolayAppointmentItem = Readonly<{
  id: string;
  timeLabel: string;
  customerLabel: string;
  serviceLabel: string;
  staffLabel?: string;
  statusLabel: string;
}>;

type Props = {
  dateLabel: string;
  items: readonly KolayAppointmentItem[];
  onOpenAppointment?: (appointmentId: string) => void;
  emptyTitle?: string;
  emptyDescription?: string;
};

export default function KolayAppointmentsHome({
  dateLabel,
  items,
  onOpenAppointment,
  emptyTitle = 'Randevu görünmüyor',
  emptyDescription = 'Randevular hazır olduğunda burada görünecek.',
}: Props) {
  return (
    <section className="kolay-appointments" aria-labelledby="kolay-appointments-heading">
      <div className="kolay-section-heading">
        <div>
          <p className="kolay-kicker">RANDEVULAR</p>
          <h2 id="kolay-appointments-heading">{dateLabel}</h2>
        </div>
        <span className="kolay-count-badge" aria-label={`${items.length} randevu`}>{items.length}</span>
      </div>

      {items.length === 0 ? (
        <div className="kolay-empty-state" role="status">
          <span className="kolay-empty-state__mark" aria-hidden="true">○</span>
          <h3>{emptyTitle}</h3>
          <p>{emptyDescription}</p>
        </div>
      ) : (
        <div className="kolay-appointment-list">
          {items.map((item) => {
            const content = (
              <>
                <span className="kolay-appointment-card__time">{item.timeLabel}</span>
                <span className="kolay-appointment-card__body">
                  <strong>{item.customerLabel}</strong>
                  <span>{item.serviceLabel}</span>
                  {item.staffLabel && <small>{item.staffLabel}</small>}
                </span>
                <span className="kolay-appointment-card__status">{item.statusLabel}</span>
              </>
            );

            return onOpenAppointment ? (
              <button
                key={item.id}
                className="kolay-appointment-card kolay-appointment-card--button"
                type="button"
                onClick={() => onOpenAppointment(item.id)}
                aria-label={`${item.timeLabel}, ${item.customerLabel}, ${item.serviceLabel}, ${item.statusLabel}`}
              >
                {content}
              </button>
            ) : (
              <article key={item.id} className="kolay-appointment-card">
                {content}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
