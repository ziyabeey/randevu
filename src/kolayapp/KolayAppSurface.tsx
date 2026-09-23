import { lazy, Suspense, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { kolayAppHref, navigateApp } from '../workspace-route';
import { useWorkspace } from '../workspace-context';
import KolayAppShell from './KolayAppShell';
import type { KolayAppTab } from './model';

const CalendarPage = lazy(() => import('../CalendarPage'));
const CustomersPage = lazy(() => import('../CustomersPage'));
const TicketCashierPage = lazy(() => import('./TicketCashierPage'));

function AppLink({ href, children }: { href: string; children: ReactNode }) {
  function click(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigateApp(href);
  }
  return <a className="kolay-action-link" href={href} onClick={click}>{children}</a>;
}

function DisabledAction({ title, description }: { title: string; description: string }) {
  return (
    <div className="kolay-action-disabled" aria-disabled="true">
      <strong>{title}</strong>
      <span>{description}</span>
    </div>
  );
}

function NewActions() {
  return (
    <>
      <section className="kolay-action-group" aria-labelledby="kolay-new-heading">
        <h2 id="kolay-new-heading">Yeni işlem</h2>
        <div className="kolay-action-list">
          <AppLink href="/app/bookings"><strong>Yeni randevu</strong><span>Mevcut güvenli randevu oluşturma akışını aç</span></AppLink>
          <AppLink href="/app/mobile/tickets"><strong>Yeni adisyon</strong><span>Randevusuz adisyon aç veya mevcut adisyona dön</span></AppLink>
          <DisabledAction title="Yeni ürün satışı" description="Henüz kullanıma açık değil." />
          <DisabledAction title="Yeni paket satışı" description="Henüz kullanıma açık değil." />
          <DisabledAction title="Yeni masraf" description="Henüz kullanıma açık değil." />
        </div>
      </section>
    </>
  );
}

function MoreActions() {
  return (
    <>
      <section className="kolay-action-group" aria-labelledby="kolay-more-general">
        <h2 id="kolay-more-general">Genel</h2>
        <div className="kolay-action-list">
          <DisabledAction title="Destek" description="Henüz kullanıma açık değil." />
          <AppLink href="/app/public-booking"><strong>Online Randevu</strong><span>Müşteri rezervasyon ayarları</span></AppLink>
          <DisabledAction title="Müşteri geri bildirimleri" description="Henüz kullanıma açık değil." />
          <DisabledAction title="Hizmet fotoğrafları" description="Henüz kullanıma açık değil." />
        </div>
      </section>

      <section className="kolay-action-group" aria-labelledby="kolay-more-reports">
        <h2 id="kolay-more-reports">Raporlar</h2>
        <div className="kolay-action-list">
          <DisabledAction title="Kasa" description="Henüz kullanıma açık değil." />
          <DisabledAction title="Çalışan primleri" description="Henüz kullanıma açık değil." />
          <DisabledAction title="Masraflar" description="Henüz kullanıma açık değil." />
          <DisabledAction title="Ürün satışları" description="Henüz kullanıma açık değil." />
          <DisabledAction title="Gelir-gider" description="Henüz kullanıma açık değil." />
          <DisabledAction title="Detaylı çalışan raporu" description="Henüz kullanıma açık değil." />
        </div>
      </section>

      <section className="kolay-action-group" aria-labelledby="kolay-more-setup">
        <h2 id="kolay-more-setup">Kurulum</h2>
        <div className="kolay-action-list">
          <AppLink href="/app/setup"><strong>Salon bilgileri</strong><span>İşletme kurulumu ve temel bilgiler</span></AppLink>
          <AppLink href="/app/availability"><strong>Çalışma saatleri</strong><span>Müsaitlik ve kapanış ayarları</span></AppLink>
          <AppLink href="/app/team"><strong>Çalışanlar</strong><span>Ekip ve erişim yönetimi</span></AppLink>
          <AppLink href="/app/services"><strong>Hizmetler</strong><span>Hizmet ve personel eşleşmeleri</span></AppLink>
          <AppLink href="/app/services"><strong>Süreler ve fiyatlar</strong><span>Hizmet süre ve fiyat ayarları</span></AppLink>
          <AppLink href="/app/public-booking"><strong>Randevu ayarları</strong><span>Online randevu davranışı ve salon görünümü</span></AppLink>
          <AppLink href="/app/products"><strong>Ürün ve stok</strong><span>Katalog, fiyat ve stok hareketlerini yönet</span></AppLink>
          <AppLink href="/app/public-booking"><strong>Salon fotoğrafları</strong><span>Yayınlanan salon görselleri</span></AppLink>
          <DisabledAction title="Promosyonlar" description="Henüz kullanıma açık değil." />
        </div>
      </section>
    </>
  );
}

export default function KolayAppSurface({
  activeTab,
  notice = '',
  scopeChanging = false,
}: {
  activeTab: KolayAppTab;
  notice?: string;
  scopeChanging?: boolean;
}) {
  const { session, activeBusinessId, selectBusiness } = useWorkspace();
  const [switchingBusiness, setSwitchingBusiness] = useState(false);

  async function switchBusiness(businessId: string) {
    if (!businessId || businessId === activeBusinessId) return;
    setSwitchingBusiness(true);
    try {
      await selectBusiness(businessId, { to: kolayAppHref(activeTab) });
    } finally {
      setSwitchingBusiness(false);
    }
  }

  const businessControl = (
    <label className="kolay-business-select">
      <span>İşletme</span>
      <select
        aria-label="KolayApp aktif işletme"
        value={activeBusinessId}
        disabled={switchingBusiness || scopeChanging}
        onChange={(event) => void switchBusiness(event.target.value)}
      >
        {session.memberships.map((membership) => (
          <option value={membership.business_id} key={membership.id}>
            {membership.businesses?.name ?? 'İşletme'}
          </option>
        ))}
      </select>
    </label>
  );

  let content: ReactNode;
  if (activeTab === 'appointments') {
    content = <CalendarPage />;
  } else if (activeTab === 'customers') {
    content = <CustomersPage />;
  } else if (activeTab === 'tickets') {
    content = <TicketCashierPage />;
  } else if (activeTab === 'new') {
    content = <div role="main"><NewActions /></div>;
  } else {
    content = <div role="main"><MoreActions /></div>;
  }

  return (
    <KolayAppShell
      activeTab={activeTab}
      onTabChange={(tab) => navigateApp(kolayAppHref(tab))}
      headerAction={businessControl}
      hideBusinessSummary
    >
      {notice && <div className="kolay-surface-notice" role="status">{notice}</div>}
      <Suspense fallback={<div className="kolay-empty-state" aria-busy="true">Ekran hazırlanıyor…</div>}>
        {content}
      </Suspense>
    </KolayAppShell>
  );
}
