import { useEffect, useRef, useState } from 'react';
import { intlLocale, t } from './i18n';
import { api } from './api';
import './public-promo.css';

// F16-06: the customer only ever sends a code. The server shows its terms,
// reserves one usage for the booking through the booking's own management link
// and applies the real discount on the salon ticket; nothing here computes a
// price the salon would trust.

export type PromoTerms = {
  code: string;
  kind: 'percent' | 'fixed';
  percentBps: number | null;
  amountMinor: number | null;
  currency: string | null;
  endsAt?: string | null;
  applicable?: boolean;
  scoped?: boolean;
};

type ManagedPromo = {
  code: string | null;
  kind: 'percent' | 'fixed' | null;
  percentBps: number | null;
  amountMinor: number | null;
  currency: string | null;
  status: 'reserved' | 'consumed' | null;
  attachable: boolean;
};

const CODE = /^[A-Za-z0-9][A-Za-z0-9-]{2,31}$/;

export function promoValueText(terms: Pick<PromoTerms, 'kind' | 'percentBps' | 'amountMinor' | 'currency'>) {
  if (terms.kind === 'percent' && terms.percentBps !== null) {
    const percent = terms.percentBps / 100;
    return t('%{percent} indirim', { percent: Number.isInteger(percent) ? percent : percent.toFixed(2).replace('.', ',') });
  }
  if (terms.kind === 'fixed' && terms.amountMinor !== null) {
    try {
      return t('{amount} indirim', { amount: new Intl.NumberFormat(intlLocale(), { style: 'currency', currency: terms.currency ?? 'TRY' }).format(terms.amountMinor / 100) });
    } catch {
      return t('{amount} indirim', { amount: `${(terms.amountMinor / 100).toFixed(2)} ${terms.currency ?? ''}`.trim() });
    }
  }
  return t('İndirim');
}

function tokenFromManageUrl(value: string) {
  const match = /^\/m#([A-Za-z0-9_-]{43,128})$/.exec(value);
  return match ? match[1] : null;
}

export function PublicPromoField({ slug, serviceIds, onChange }: {
  slug: string;
  serviceIds: string[];
  onChange: (code: string | null) => void;
}) {
  const [value, setValue] = useState('');
  const [terms, setTerms] = useState<PromoTerms | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const serviceKey = serviceIds.join(',');
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    // A new service plan needs a fresh check of the scope.
    setTerms(null);
    setMessage('');
    onChangeRef.current(null);
  }, [serviceKey]);

  async function check() {
    const code = value.trim();
    if (!CODE.test(code)) {
      setTerms(null);
      onChange(null);
      setMessage(t('Kampanya kodu 3–32 harf, rakam veya tire olmalı.'));
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const params = new URLSearchParams({ code });
      if (serviceKey) params.set('serviceIds', serviceKey);
      const result = await api<{ promo: PromoTerms }>(`/api/public/business/${encodeURIComponent(slug)}/promo?${params}`, { csrf: 'skip' });
      if (!result.promo.applicable) {
        setTerms(null);
        onChange(null);
        setMessage(t('Bu kampanya seçtiğiniz hizmetleri kapsamıyor.'));
        return;
      }
      setTerms(result.promo);
      onChange(result.promo.code);
    } catch (error) {
      setTerms(null);
      onChange(null);
      setMessage(error instanceof Error ? error.message : t('Kampanya kodu doğrulanamadı.'));
    } finally {
      setBusy(false);
    }
  }

  return <div className="public-promo-field">
    <label><span>{t('Kampanya kodu')} <small>{t('(isteğe bağlı)')}</small></span>
      <span className="public-promo-row">
        <input
          name="promoCode"
          value={value}
          maxLength={32}
          autoComplete="off"
          autoCapitalize="characters"
          aria-describedby="public-promo-status"
          onChange={(event) => { setValue(event.target.value); setTerms(null); setMessage(''); onChange(null); }}
        />
        <button className="public-secondary" type="button" disabled={busy || !value.trim()} onClick={() => void check()}>
          {busy ? t('Kontrol ediliyor…') : t('Kodu kontrol et')}
        </button>
      </span>
    </label>
    <p id="public-promo-status" className={terms ? 'public-promo-ok' : 'public-field-hint'} role="status">
      {terms
        ? `${terms.code}: ${promoValueText(terms)}${terms.scoped ? ` ${t('(seçili hizmetlerde)')}` : ''}. ${t('Kesin indirim, randevu sonrası adisyonda uygulanır.')}`
        : message || t('Kodu kontrol ederseniz randevu oluşturulunca sizin için ayrılır.')}
    </p>
  </div>;
}

// Runs once on the confirmation screen: reserves the checked code for the new
// booking through its management link.
export function PromoAttachResult({ manageUrl, code }: { manageUrl: string; code: string }) {
  const [state, setState] = useState<{ ok: boolean; text: string } | null>(null);
  const started = useRef(false);

  useEffect(() => {
    const token = tokenFromManageUrl(manageUrl);
    if (!token || started.current) return;
    started.current = true;
    void api<{ promo: ManagedPromo }>('/api/manage/promo', {
      method: 'POST', csrf: 'skip', body: JSON.stringify({ token, code }),
    }).then((result) => {
      const promo = result.promo;
      setState({
        ok: true,
        text: promo.code && promo.kind
          ? `${t('Kampanya kodunuz ayrıldı: {code}', { code: promo.code })} · ${promoValueText({ kind: promo.kind, percentBps: promo.percentBps, amountMinor: promo.amountMinor, currency: promo.currency })}. ${t('İndirim salondaki adisyonda uygulanır.')}`
          : t('Kampanya kodu ayrıldı.'),
      });
    }).catch((error: unknown) => {
      setState({
        ok: false,
        text: `${error instanceof Error ? error.message : t('Kampanya kodu ayrılamadı.')} ${t('Randevunuz oluşturuldu; kodu randevu yönetim sayfasından yeniden deneyebilirsiniz.')}`,
      });
    });
  }, [manageUrl, code]);

  if (!state) return <p className="public-promo-attach" role="status">{t('Kampanya kodu randevunuz için ayrılıyor…')}</p>;
  return <p className={`public-promo-attach ${state.ok ? 'is-ok' : 'is-error'}`} role={state.ok ? 'status' : 'alert'}>{state.text}</p>;
}

export function ManagePromo({ token }: { token: string }) {
  const [state, setState] = useState<ManagedPromo | null>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let cancelled = false;
    void api<{ promo: ManagedPromo }>('/api/manage/promo/view', {
      method: 'POST', csrf: 'skip', body: JSON.stringify({ token }),
    }).then((result) => { if (!cancelled) setState(result.promo); })
      .catch(() => { if (!cancelled) setState(null); });
    return () => { cancelled = true; };
  }, [token]);

  async function attach() {
    const code = value.trim();
    if (!CODE.test(code)) {
      setNotice(t('Kampanya kodu 3–32 harf, rakam veya tire olmalı.'));
      return;
    }
    setBusy(true);
    setNotice('');
    try {
      const result = await api<{ promo: ManagedPromo }>('/api/manage/promo', {
        method: 'POST', csrf: 'skip', body: JSON.stringify({ token, code }),
      });
      setState(result.promo);
      setNotice(t('Kampanya kodunuz randevunuz için ayrıldı.'));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t('Kampanya kodu eklenemedi.'));
    } finally {
      setBusy(false);
    }
  }

  if (!state) return null;
  if (state.code && state.kind) {
    return <section className="manage-promo" aria-labelledby="manage-promo-title">
      <h2 id="manage-promo-title">{t('Kampanya kodu')}</h2>
      <p><strong>{state.code}</strong> · {promoValueText({ kind: state.kind, percentBps: state.percentBps, amountMinor: state.amountMinor, currency: state.currency })}</p>
      <p className="manage-promo-note">{state.status === 'consumed' ? t('İndirim adisyonunuzda uygulandı.') : t('Kod randevunuz için ayrıldı; kesin indirim salondaki adisyonda uygulanır. Randevu iptal edilirse kod serbest kalır.')}</p>
      {notice && <p role="status">{notice}</p>}
    </section>;
  }
  if (!state.attachable) return null;
  return <section className="manage-promo" aria-labelledby="manage-promo-title">
    <h2 id="manage-promo-title">{t('Kampanya kodu')}</h2>
    <p className="manage-promo-note">{t('Bu randevu için bir kampanya kodunuz varsa ekleyin. Kod, randevu saatinden önce eklenebilir.')}</p>
    <div className="public-promo-row">
      <input aria-label={t('Kampanya kodu')} value={value} maxLength={32} autoComplete="off" onChange={(event) => setValue(event.target.value)} />
      <button type="button" disabled={busy || !value.trim()} onClick={() => void attach()}>{busy ? t('Ekleniyor…') : t('Kodu ekle')}</button>
    </div>
    {notice && <p role="status">{notice}</p>}
  </section>;
}
