import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { useWorkspace } from './workspace-context';
import './feedback.css';

type FeedbackStatus = 'pending' | 'published' | 'hidden';
type FeedbackItem = {
  id: string;
  groupId: string;
  customerName: string;
  displayName: string;
  rating: number;
  comment: string | null;
  publishConsent: boolean;
  status: FeedbackStatus;
  createdAt: string;
  publishedAt: string | null;
  appointmentStartsAt: string | null;
  serviceNames: string | null;
  canModerate: boolean;
};
type Cursor = { beforeCreatedAt: string; beforeId: string } | null;

const STATUS_LABEL: Record<FeedbackStatus, string> = { pending: 'İncelenmedi', published: 'Yayında', hidden: 'Gizli' };

function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
}

// F16-04 business feedback list: every customer review stays private until an
// owner/manager publishes it, and only reviews with customer consent can be.
export default function FeedbackPage() {
  const { activeBusinessId, scopeEpoch } = useWorkspace();
  const [status, setStatus] = useState<'' | FeedbackStatus>('');
  const [items, setItems] = useState<FeedbackItem[] | null>(null);
  const [next, setNext] = useState<Cursor>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const generation = useRef(0);

  const load = useCallback(async (cursor: Cursor, append: boolean) => {
    const token = ++generation.current;
    const params = new URLSearchParams({ limit: '25' });
    if (status) params.set('status', status);
    if (cursor) { params.set('beforeCreatedAt', cursor.beforeCreatedAt); params.set('beforeId', cursor.beforeId); }
    try {
      const result = await api<{ feedback: FeedbackItem[]; next: Cursor }>(`/api/feedback?${params}`);
      if (token !== generation.current) return;
      setItems((existing) => (append && existing ? [...existing, ...result.feedback.filter((item) => !existing.some((seen) => seen.id === item.id))] : result.feedback));
      setNext(result.next);
    } catch (error) {
      if (token !== generation.current) return;
      setItems((existing) => existing ?? []);
      setNotice(error instanceof Error ? error.message : 'Yorumlar yüklenemedi.');
    }
  }, [status]);

  useEffect(() => {
    setItems(null);
    setNext(null);
    setNotice('');
    void load(null, false);
    return () => { generation.current += 1; };
  }, [load, activeBusinessId, scopeEpoch]);

  async function moderate(item: FeedbackItem, action: 'publish' | 'hide') {
    setBusy(true);
    setNotice('');
    try {
      await api(`/api/feedback/${encodeURIComponent(item.id)}/moderate`, {
        method: 'POST', body: JSON.stringify({ action, expectedStatus: item.status }),
      });
      await load(null, false);
      setNotice(action === 'publish' ? 'Yorum salon sayfasında yayınlandı.' : 'Yorum gizlendi.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Yorum güncellenemedi.');
      await load(null, false);
    } finally {
      setBusy(false);
    }
  }

  return <main className="workspace-page">
    <section className="panel feedback-panel">
      <div className="section-head">
        <div><p className="eyebrow">MÜŞTERİ GERİ BİLDİRİMİ</p><h1>Yorumlar</h1></div>
        <label className="feedback-filter"><span>Durum</span><select value={status} onChange={(event) => setStatus(event.target.value as '' | FeedbackStatus)}>
          <option value="">Tümü</option><option value="pending">İncelenmedi</option><option value="published">Yayında</option><option value="hidden">Gizli</option>
        </select></label>
      </div>
      <p className="muted">Müşteriler tamamlanan randevularını yönetim bağlantısından değerlendirir. Yorumlar siz yayınlamadan salon sayfasında görünmez; yalnız müşterinin izin verdiği yorumlar yayınlanabilir ve adı baş harfle gösterilir.</p>
      {notice && <p className="notice" role="status">{notice}</p>}
      {items === null ? <p className="muted">Yorumlar yükleniyor…</p>
        : items.length === 0 ? <p className="empty">{status ? 'Bu durumda yorum yok.' : 'Henüz müşteri değerlendirmesi yok.'}</p>
          : <ul className="feedback-list">{items.map((item) => <li key={item.id} className={`feedback-item is-${item.status}`}>
            <div className="feedback-item-head">
              <strong>{item.customerName}</strong>
              <span aria-label={`${item.rating} / 5 puan`} className="feedback-stars">{'★'.repeat(item.rating)}{'☆'.repeat(5 - item.rating)}</span>
              <span className="status-pill">{STATUS_LABEL[item.status]}</span>
            </div>
            <p className="muted">{item.serviceNames ?? 'Hizmet'} · {formatDate(item.appointmentStartsAt)}</p>
            {item.comment ? <p className="feedback-comment">{item.comment}</p> : <p className="muted">Yorum yazılmadı.</p>}
            <p className="muted">{item.publishConsent ? `Yayın izni var · sayfada “${item.displayName}” olarak görünür.` : 'Müşteri yayın izni vermedi; yalnız işletmeye özeldir.'}</p>
            {item.canModerate && <div className="feedback-actions">
              {item.status !== 'published' && item.publishConsent && <button type="button" disabled={busy} onClick={() => void moderate(item, 'publish')}>Yayınla</button>}
              {item.status !== 'hidden' && <button type="button" className="secondary-button" disabled={busy} onClick={() => void moderate(item, 'hide')}>{item.status === 'published' ? 'Yayından kaldır' : 'Gizle'}</button>}
            </div>}
          </li>)}</ul>}
      {next && <button type="button" className="secondary-button feedback-more" disabled={busy} onClick={() => void load(next, true)}>Daha fazla yorum</button>}
    </section>
  </main>;
}
