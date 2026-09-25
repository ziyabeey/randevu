import { useEffect, useState } from 'react';
import { t } from './i18n';
import { api } from './api';

type FeedbackState = {
  eligible: boolean;
  reason: 'not_completed' | 'submitted' | null;
  rating: number | null;
  comment: string | null;
  publishConsent: boolean | null;
  status: 'pending' | 'published' | 'hidden' | null;
  submittedAt: string | null;
};

const STATUS_TEXT: Record<'pending' | 'published' | 'hidden', string> = {
  pending: 'Değerlendirmeniz işletmeye iletildi.',
  published: 'Yorumunuz salon sayfasında yayında.',
  hidden: 'Değerlendirmeniz işletmeye iletildi; salon sayfasında yayınlanmıyor.',
};

// F16-04: a customer reviews a completed appointment through their own
// management link only. Publishing is opt-in and always shows a masked name.
export default function ManageFeedback({ token }: { token: string }) {
  const [state, setState] = useState<FeedbackState | null>(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let cancelled = false;
    void api<{ feedback: FeedbackState }>('/api/manage/feedback/view', {
      method: 'POST', csrf: 'skip', body: JSON.stringify({ token }),
    }).then((result) => { if (!cancelled) setState(result.feedback); })
      .catch((error: unknown) => { if (!cancelled) setNotice(error instanceof Error ? error.message : t('Değerlendirme bilgisi alınamadı.')); });
    return () => { cancelled = true; };
  }, [token]);

  async function submit() {
    if (rating < 1) {
      setNotice(t('Lütfen 1 ile 5 arasında bir puan seçin.'));
      return;
    }
    setBusy(true);
    setNotice('');
    try {
      const result = await api<{ feedback: FeedbackState }>('/api/manage/feedback', {
        method: 'POST', csrf: 'skip',
        body: JSON.stringify({ token, rating, comment: comment.trim() || null, publishConsent: consent }),
      });
      setState(result.feedback);
      setNotice(t('Teşekkürler, değerlendirmeniz alındı.'));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t('Değerlendirme gönderilemedi.'));
    } finally {
      setBusy(false);
    }
  }

  if (!state && !notice) return null;
  return <section className="manage-card manage-feedback" aria-labelledby="manage-feedback-title">
    <h2 id="manage-feedback-title">{t('Deneyiminizi değerlendirin')}</h2>
    {state?.reason === 'submitted' && state.status ? <>
      <p className="manage-feedback-rating" aria-label={t('{rating} / 5 puan', { rating: state.rating ?? 0 })}>{'★'.repeat(state.rating ?? 0)}{'☆'.repeat(5 - (state.rating ?? 0))}</p>
      {state.comment && <blockquote>{state.comment}</blockquote>}
      <p className="public-muted" role="status">{t(STATUS_TEXT[state.status])}</p>
    </> : state?.eligible ? <>
      <fieldset className="manage-feedback-stars">
        <legend>{t('Puanınız')}</legend>
        {[1, 2, 3, 4, 5].map((value) => <label key={value} className={value <= rating ? 'is-selected' : ''}>
          <input type="radio" name="feedback-rating" value={value} checked={rating === value} disabled={busy} onChange={() => setRating(value)} />
          <span aria-hidden="true">★</span><span className="manage-visually-hidden">{t('{value} puan', { value })}</span>
        </label>)}
      </fieldset>
      <label>
        <span>{t('Yorumunuz')} <small>{t('(isteğe bağlı)')}</small></span>
        <textarea value={comment} maxLength={1000} rows={4} disabled={busy} onChange={(event) => setComment(event.target.value)} />
      </label>
      <label className="manage-feedback-consent">
        <input type="checkbox" checked={consent} disabled={busy} onChange={(event) => setConsent(event.target.checked)} />
        <span>{t('Yorumumun salon sayfasında adımın baş harfiyle (ör. “Ayşe D.”) yayınlanmasına izin veriyorum. İşletme yayınlamadan önce inceler.')}</span>
      </label>
      <button className="public-primary" type="button" disabled={busy || rating < 1} onClick={() => void submit()}>{busy ? t('Gönderiliyor…') : t('Değerlendirmeyi gönder')}</button>
    </> : state?.reason === 'not_completed' ? <p className="public-muted">{t('Randevunuz tamamlandıktan sonra buradan değerlendirme yapabilirsiniz.')}</p> : null}
    {notice && <p className="public-muted" role="status">{notice}</p>}
  </section>;
}
