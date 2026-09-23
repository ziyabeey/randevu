import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { api, ApiRequestError } from './api';
import { useWorkspace } from './workspace-context';

type Product = {
  productId: string;
  businessId: string;
  name: string;
  code: string | null;
  unit: 'piece';
  salePriceMinor: number;
  currency: string;
  stockOnHand: number;
  version: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

type Movement = {
  movementId: string;
  productId: string;
  kind: 'initial' | 'receipt' | 'adjustment' | 'reversal';
  quantityDelta: number;
  balanceAfter: number;
  reason: string | null;
  reversesMovementId: string | null;
  createdAt: string;
};

type PageInfo = { limit: number; hasMore: boolean; nextCursor: string | null };
type ProductList = { products: Product[]; page: PageInfo };
type MovementList = { movements: Movement[]; page: PageInfo };
type PendingProductWrite = {
  businessId: string;
  action: string;
  idempotencyKey: string;
  path: string;
  method: string;
  body: string | null;
};

const PENDING_PRODUCT_WRITE_KEY = 'randevu:products:pending-write:v1';

function samePending(left: PendingProductWrite | null, right: PendingProductWrite) {
  return Boolean(left
    && left.businessId === right.businessId
    && left.action === right.action
    && left.idempotencyKey === right.idempotencyKey
    && left.path === right.path
    && left.method === right.method
    && left.body === right.body);
}

function readPendingProductWrite(): PendingProductWrite | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(PENDING_PRODUCT_WRITE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PendingProductWrite>;
    if (typeof value.businessId !== 'string'
      || typeof value.action !== 'string'
      || typeof value.idempotencyKey !== 'string'
      || typeof value.path !== 'string'
      || typeof value.method !== 'string'
      || (value.body !== null && typeof value.body !== 'string')
      || !value.businessId
      || !value.action
      || value.idempotencyKey.length < 8
      || value.idempotencyKey.length > 128
      || !value.path.startsWith('/api/products')
      || !['POST', 'PUT'].includes(value.method)) {
      window.sessionStorage.removeItem(PENDING_PRODUCT_WRITE_KEY);
      return null;
    }
    return value as PendingProductWrite;
  } catch {
    return null;
  }
}

function writePendingProductWrite(value: PendingProductWrite) {
  try { window.sessionStorage.setItem(PENDING_PRODUCT_WRITE_KEY, JSON.stringify(value)); } catch { /* in-memory state still guards this mount */ }
}

function clearPendingProductWrite(expected: PendingProductWrite) {
  try {
    const current = readPendingProductWrite();
    if (!current || samePending(current, expected)) window.sessionStorage.removeItem(PENDING_PRODUCT_WRITE_KEY);
  } catch { /* definitive server result remains authoritative */ }
}

function money(minor: number, currency: string) {
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency }).format(minor / 100);
}

function parseMoneyMinor(value: FormDataEntryValue | null) {
  const raw = String(value ?? '').trim().replace(',', '.');
  const match = raw.match(/^(\d{1,9})(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? '').padEnd(2, '0'));
  const result = whole * 100 + fraction;
  return Number.isSafeInteger(result) && result <= 2_147_483_647 ? result : null;
}

function parseQuantity(value: FormDataEntryValue | null, allowNegative = false) {
  const raw = String(value ?? '').trim();
  if (!(allowNegative ? /^-?\d{1,10}$/.test(raw) : /^\d{1,10}$/.test(raw))) return null;
  const result = Number(raw);
  return Number.isSafeInteger(result) && Math.abs(result) <= 1_000_000_000 ? result : null;
}

function ambiguous(error: unknown) {
  return error instanceof ApiRequestError && (error.status === 0 || error.status === 408 || error.status === 503);
}

export default function ProductsPage() {
  const { activeBusinessId, scopeEpoch } = useWorkspace();
  const [products, setProducts] = useState<Product[]>([]);
  const [page, setPage] = useState<PageInfo | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [pendingWrite, setPendingWrite] = useState<PendingProductWrite | null>(() => readPendingProductWrite());
  const keys = useRef(new Map<string, string>());
  const generation = useRef(0);

  const selected = useMemo(
    () => products.find((product) => product.productId === selectedId) ?? null,
    [products, selectedId],
  );

  const loadProducts = useCallback(async (cursor: string | null = null, append = false) => {
    const current = ++generation.current;
    if (!append) setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '25', includeArchived: String(includeArchived) });
      if (cursor) params.set('cursor', cursor);
      const result = await api<ProductList>(`/api/products?${params}`);
      if (current !== generation.current) return;
      if (result.products.some((product) => product.businessId !== activeBusinessId)) {
        throw new Error('Ürün listesi güncel işletme bağlamıyla eşleşmiyor.');
      }
      setProducts((existing) => append ? [...existing, ...result.products] : result.products);
      setPage(result.page);
    } catch (error) {
      if (current !== generation.current) return;
      setNotice(error instanceof Error ? error.message : 'Ürünler yüklenemedi.');
      if (!append) {
        setProducts([]);
        setPage(null);
      }
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [activeBusinessId, includeArchived]);

  const loadProduct = useCallback(async (productId: string) => {
    const result = await api<{ product: Product }>(`/api/products/${productId}`);
    if (result.product.businessId !== activeBusinessId) throw new Error('Ürün güncel işletme bağlamıyla eşleşmiyor.');
    setProducts((items) => items.map((item) => item.productId === productId ? result.product : item));
    return result.product;
  }, [activeBusinessId]);

  const loadMovements = useCallback(async (productId: string) => {
    const result = await api<MovementList>(`/api/products/${productId}/stock-movements?limit=25`);
    setMovements(result.movements);
  }, []);

  useEffect(() => {
    generation.current += 1;
    keys.current.clear();
    setPendingWrite(readPendingProductWrite());
    setProducts([]);
    setPage(null);
    setSelectedId(null);
    setMovements([]);
    setNotice('');
    void loadProducts();
  }, [activeBusinessId, scopeEpoch, includeArchived, loadProducts]);

  useEffect(() => {
    if (!selectedId) {
      setMovements([]);
      return;
    }
    void loadMovements(selectedId).catch((error) => setNotice(error instanceof Error ? error.message : 'Stok hareketleri yüklenemedi.'));
  }, [loadMovements, selectedId]);

  async function mutate(action: string, path: string, init: RequestInit) {
    const method = String(init.method ?? 'POST').toUpperCase();
    const body = typeof init.body === 'string' ? init.body : null;
    const matchesPending = Boolean(pendingWrite
      && pendingWrite.businessId === activeBusinessId
      && pendingWrite.action === action
      && pendingWrite.path === path
      && pendingWrite.method === method
      && pendingWrite.body === body);
    if (pendingWrite && !matchesPending) {
      setNotice(pendingWrite.businessId === activeBusinessId
        ? 'Önce sonucu belirsiz ürün/stok işlemini doğrulayın. Yeni işlem başlatılmadı.'
        : 'Başka işletmede sonucu belirsiz ürün/stok işlemi var. Önce o işletmede doğrulayın.');
      return null;
    }

    setBusy(true);
    setNotice('');
    const key = matchesPending ? pendingWrite!.idempotencyKey : (keys.current.get(action) ?? crypto.randomUUID());
    keys.current.set(action, key);
    const identity: PendingProductWrite = { businessId: activeBusinessId, action, idempotencyKey: key, path, method, body };
    try {
      const result = await api<{ product: Product }>(path, {
        ...init,
        headers: { ...(init.headers ?? {}), 'Idempotency-Key': key },
      });
      keys.current.delete(action);
      clearPendingProductWrite(identity);
      setPendingWrite((current) => samePending(current, identity) ? null : current);
      if (result.product.businessId !== activeBusinessId) throw new Error('Sunucu farklı işletme ürünü döndürdü.');
      setProducts((items) => {
        const exists = items.some((item) => item.productId === result.product.productId);
        return exists
          ? items.map((item) => item.productId === result.product.productId ? result.product : item)
          : [result.product, ...items];
      });
      setSelectedId(result.product.productId);
      await loadMovements(result.product.productId);
      return result.product;
    } catch (error) {
      if (ambiguous(error)) {
        writePendingProductWrite(identity);
        setPendingWrite(identity);
        setNotice('İşlemin sonucu belirsiz. Kayıtlı istek aynı anahtarla doğrulanana kadar başka ürün/stok işlemi başlatılmayacak.');
      } else {
        keys.current.delete(action);
        clearPendingProductWrite(identity);
        setPendingWrite((current) => samePending(current, identity) ? null : current);
        setNotice(error instanceof Error ? error.message : 'İşlem tamamlanamadı.');
        if (selectedId) {
          try { await loadProduct(selectedId); } catch { /* preserve mutation error */ }
        }
      }
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function retryPendingWrite() {
    if (!pendingWrite) return;
    if (pendingWrite.businessId !== activeBusinessId) {
      setNotice('Belirsiz işlemi doğrulamak için önce işlemin başladığı işletmeye dönün.');
      return;
    }
    const result = await mutate(
      pendingWrite.action,
      pendingWrite.path,
      { method: pendingWrite.method, body: pendingWrite.body ?? undefined },
    );
    if (result) setNotice('Belirsiz ürün/stok işlemi sunucuda doğrulandı.');
  }

  async function createProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const salePriceMinor = parseMoneyMinor(data.get('price'));
    const initialQuantity = parseQuantity(data.get('initialQuantity'));
    if (salePriceMinor === null || initialQuantity === null) {
      setNotice('Satış fiyatı ve başlangıç stoğu geçerli olmalı.');
      return;
    }
    const payload = {
      name: String(data.get('name') ?? '').trim(),
      code: String(data.get('code') ?? '').trim() || null,
      unit: 'piece',
      salePriceMinor,
      currency: 'TRY',
      initialQuantity,
    };
    const product = await mutate(
      `create:${payload.name}:${payload.code ?? ''}:${salePriceMinor}:${initialQuantity}`,
      '/api/products',
      { method: 'POST', body: JSON.stringify(payload) },
    );
    if (product) {
      form.reset();
      setNotice('Ürün oluşturuldu.');
    }
  }

  async function updateProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const data = new FormData(event.currentTarget);
    const salePriceMinor = parseMoneyMinor(data.get('price'));
    if (salePriceMinor === null) return setNotice('Satış fiyatı geçerli olmalı.');
    const payload = {
      name: String(data.get('name') ?? '').trim(),
      code: String(data.get('code') ?? '').trim() || null,
      unit: 'piece',
      salePriceMinor,
      currency: selected.currency,
      expectedVersion: selected.version,
    };
    const product = await mutate(
      `update:${selected.productId}:${selected.version}:${JSON.stringify(payload)}`,
      `/api/products/${selected.productId}`,
      { method: 'PUT', body: JSON.stringify(payload) },
    );
    if (product) setNotice('Ürün bilgileri güncellendi.');
  }

  async function stockMovement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const kind = data.get('kind') === 'receipt' ? 'receipt' : 'adjustment';
    const quantityDelta = parseQuantity(data.get('quantity'), kind === 'adjustment');
    const reason = String(data.get('reason') ?? '').trim() || null;
    if (quantityDelta === null || quantityDelta === 0 || (kind === 'adjustment' && !reason)) {
      return setNotice('Stok miktarı ve gerekçe geçerli olmalı.');
    }
    const payload = { kind, quantityDelta, reason, expectedVersion: selected.version };
    const product = await mutate(
      `stock:${selected.productId}:${selected.version}:${kind}:${quantityDelta}:${reason ?? ''}`,
      `/api/products/${selected.productId}/stock-movements`,
      { method: 'POST', body: JSON.stringify(payload) },
    );
    if (product) {
      form.reset();
      setNotice('Stok hareketi kaydedildi.');
    }
  }

  async function archive() {
    if (!selected) return;
    const product = await mutate(
      `archive:${selected.productId}:${selected.version}`,
      `/api/products/${selected.productId}/archive`,
      { method: 'POST', body: JSON.stringify({ expectedVersion: selected.version }) },
    );
    if (product) setNotice('Ürün arşivlendi; geçmiş stok hareketleri korundu.');
  }

  return (
    <main className="products-shell">
      <header className="products-hero">
        <div><p className="products-eyebrow">ÜRÜN VE STOK</p><h1>Ürün kataloğu</h1><p>Satış fiyatı ve stok hareketleri sunucu kayıtlarından yönetilir.</p></div>
        <label className="products-archive-toggle"><input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} /> Arşivlenenleri göster</label>
      </header>

      {notice && <div className="products-notice" role="status">{notice}</div>}
      {pendingWrite && <div className="products-notice" role="alert">
        <strong>Sonucu belirsiz işlem korunuyor.</strong>{' '}
        {pendingWrite.businessId === activeBusinessId
          ? <button disabled={busy} onClick={() => void retryPendingWrite()}>Kayıtlı isteği doğrula</button>
          : <span>İşlemin başladığı işletmeye dönün.</span>}
      </div>}

      <section className="products-grid">
        <article className="products-card products-create">
          <h2>Yeni ürün</h2>
          <form className="products-form" onSubmit={createProduct}>
            <label>Ürün adı<input name="name" required minLength={1} maxLength={120} /></label>
            <label>Ürün kodu<input name="code" maxLength={64} placeholder="Örn. SAMP-001" /></label>
            <label>Satış fiyatı<input name="price" inputMode="decimal" required placeholder="250,00" /></label>
            <label>Başlangıç stoğu<input name="initialQuantity" inputMode="numeric" required defaultValue="0" /></label>
            <button disabled={busy}>Ürünü oluştur</button>
          </form>
        </article>

        <article className="products-card">
          <h2>Ürünler</h2>
          {loading ? <p>Ürünler yükleniyor…</p> : products.length === 0 ? <p>Henüz ürün yok.</p> : (
            <ul className="products-list">{products.map((product) => (
              <li key={product.productId}>
                <button type="button" className={selectedId === product.productId ? 'selected' : ''} onClick={() => setSelectedId(product.productId)}>
                  <strong>{product.name}</strong>
                  <span>{product.code ?? 'Kodsuz'} · {money(product.salePriceMinor, product.currency)}</span>
                  <span>Stok: {product.stockOnHand} adet {product.active ? '' : '· Arşivde'}</span>
                </button>
              </li>
            ))}</ul>
          )}
          {page?.hasMore && <button className="products-more" disabled={busy} onClick={() => void loadProducts(page.nextCursor, true)}>Daha fazla</button>}
        </article>

        <article className="products-card products-detail">
          {!selected ? <div className="products-empty"><h2>Ürün seçin</h2><p>Ürün bilgileri ve stok hareketleri burada görünür.</p></div> : <>
            <div className="products-detail-head"><div><p className="products-eyebrow">{selected.code ?? 'KODSUZ'}</p><h2>{selected.name}</h2></div><strong>{selected.stockOnHand} adet</strong></div>

            {selected.active && <>
              <form className="products-form products-edit" onSubmit={updateProduct}>
                <label>Ürün adı<input name="name" defaultValue={selected.name} required maxLength={120} /></label>
                <label>Ürün kodu<input name="code" defaultValue={selected.code ?? ''} maxLength={64} /></label>
                <label>Satış fiyatı<input name="price" inputMode="decimal" defaultValue={(selected.salePriceMinor / 100).toFixed(2)} required /></label>
                <button disabled={busy}>Bilgileri kaydet</button>
              </form>

              <form className="products-form products-stock-form" onSubmit={stockMovement}>
                <label>Hareket<select name="kind" defaultValue="receipt"><option value="receipt">Stok girişi</option><option value="adjustment">Sayım düzeltmesi</option></select></label>
                <label>Miktar<input name="quantity" inputMode="numeric" required placeholder="5 veya -2" /></label>
                <label>Gerekçe<input name="reason" maxLength={240} placeholder="Düzeltmede zorunlu" /></label>
                <button disabled={busy}>Stok hareketini kaydet</button>
              </form>

              <button className="products-danger" disabled={busy} onClick={() => void archive()}>Ürünü arşivle</button>
            </>}

            <section className="products-movements">
              <h3>Stok hareketleri</h3>
              {movements.length === 0 ? <p>Henüz stok hareketi yok.</p> : <ol>{movements.map((movement) => (
                <li key={movement.movementId}>
                  <span><strong>{movement.kind === 'initial' ? 'Başlangıç' : movement.kind === 'receipt' ? 'Giriş' : movement.kind === 'adjustment' ? 'Düzeltme' : 'Reversal'}</strong><small>{new Date(movement.createdAt).toLocaleString('tr-TR')}</small></span>
                  <span className={movement.quantityDelta > 0 ? 'positive' : 'negative'}>{movement.quantityDelta > 0 ? '+' : ''}{movement.quantityDelta} → {movement.balanceAfter}</span>
                  {movement.reason && <small>{movement.reason}</small>}
                </li>
              ))}</ol>}
            </section>
          </>}
        </article>
      </section>
    </main>
  );
}
