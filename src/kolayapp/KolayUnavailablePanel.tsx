type Props = {
  title: string;
  description: string;
  statusLabel?: string;
};

export default function KolayUnavailablePanel({
  title,
  description,
  statusLabel = 'Hazırlanıyor',
}: Props) {
  return (
    <section className="kolay-unavailable" aria-labelledby={`kolay-unavailable-${title.replace(/\s+/g, '-').toLowerCase()}`}>
      <span className="kolay-unavailable__status">{statusLabel}</span>
      <h2 id={`kolay-unavailable-${title.replace(/\s+/g, '-').toLowerCase()}`}>{title}</h2>
      <p>{description}</p>
      <div className="kolay-unavailable__note" role="note">
        Bu izole kabuk gerçek işlem yapmaz ve tamamlanmamış özelliği kullanılabilir göstermez.
      </div>
    </section>
  );
}
