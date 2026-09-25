import { t } from '../i18n';

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
      <span className="kolay-unavailable__status">{t(statusLabel)}</span>
      <h2 id={`kolay-unavailable-${title.replace(/\s+/g, '-').toLowerCase()}`}>{t(title)}</h2>
      <p>{t(description)}</p>
      <div className="kolay-unavailable__note" role="note">
        {t('Bu bölüm kullanıma açılana kadar burada işlem yapılamaz.')}
      </div>
    </section>
  );
}
