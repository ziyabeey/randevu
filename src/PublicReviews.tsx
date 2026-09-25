import { useEffect, useState } from 'react';
import { intlLocale, t } from './i18n';
import { api } from './api';

type Review = { displayName: string; rating: number; comment: string | null; publishedAt: string };
type ReviewsPayload = { reviews: Review[]; summary: { count: number; average: number | null } };

// F16-04 public "Yorumlar": only reviews the salon published with the
// customer's consent, shown with a masked name.
export default function PublicReviews({ slug }: { slug: string }) {
  const [payload, setPayload] = useState<ReviewsPayload | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPayload(null);
    setFailed(false);
    void api<ReviewsPayload>(`/api/public/business/${encodeURIComponent(slug)}/reviews`)
      .then((result) => { if (!cancelled) setPayload(result); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [slug]);

  return <section id="salon-yorumlar" className="public-salon-reviews" aria-labelledby="salon-reviews-title">
    <div className="public-salon-section-head">
      <h2 id="salon-reviews-title">{t('Yorumlar')}</h2>
      {payload && payload.summary.count > 0 && payload.summary.average !== null
        && <p aria-label={t('Ortalama {average} / 5, {count} yorum', { average: payload.summary.average, count: payload.summary.count })}><strong>{payload.summary.average.toFixed(1)}</strong> / 5 · {t('{count} yorum', { count: payload.summary.count })}</p>}
    </div>
    {failed ? <p className="public-muted">{t('Yorumlar şu anda yüklenemiyor.')}</p>
      : !payload ? <p className="public-muted">{t('Yorumlar yükleniyor…')}</p>
        : payload.reviews.length === 0 ? <p className="public-muted">{t('Henüz yayınlanmış yorum yok.')}</p>
          : <ul className="public-review-list">{payload.reviews.map((review, index) => <li key={`${review.publishedAt}-${index}`}>
            <div><strong>{review.displayName}</strong><span aria-label={t('{rating} / 5 puan', { rating: review.rating })}>{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}</span></div>
            {review.comment && <p>{review.comment}</p>}
            <time dateTime={review.publishedAt}>{new Intl.DateTimeFormat(intlLocale(), { dateStyle: 'medium' }).format(new Date(review.publishedAt))}</time>
          </li>)}</ul>}
  </section>;
}
