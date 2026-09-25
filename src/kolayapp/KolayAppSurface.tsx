import { lazy, Suspense, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { kolayAppHref, navigateApp } from '../workspace-route';
import { useWorkspace } from '../workspace-context';
import AccountMenu from '../AccountMenu';
import { t } from '../i18n';
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

function ActionLink({ href, title, description }: { href: string; title: string; description: string }) {
  return <AppLink href={href}><strong>{t(title)}</strong><span>{t(description)}</span></AppLink>;
}

function DisabledAction({ title, description }: { title: string; description: string }) {
  return (
    <div className="kolay-action-disabled" aria-disabled="true">
      <strong>{t(title)}</strong>
      <span>{t(description)}</span>
    </div>
  );
}

function NewActions() {
  return (
    <>
      <section className="kolay-action-group" aria-labelledby="kolay-new-heading">
        <h2 id="kolay-new-heading">{t('Yeni işlem')}</h2>
        <div className="kolay-action-list">
          <ActionLink href="/app/bookings" title="Yeni randevu" description="Mevcut güvenli randevu oluşturma akışını aç" />
          <ActionLink href="/app/mobile/tickets" title="Yeni adisyon" description="Randevusuz adisyon aç veya mevcut adisyona dön" />
          <ActionLink href="/app/mobile/tickets?newProductSale=1" title="Yeni ürün satışı" description="Ürün seç, miktarı belirle ve stoktan güvenle düş" />
          <ActionLink href="/app/mobile/tickets?newPackageSale=1" title="Yeni paket satışı" description="Seans paketini kendi adisyonuyla sat" />
          <ActionLink href="/app/expenses" title="Yeni masraf" description="Masraf kaydı oluştur" />
        </div>
      </section>
    </>
  );
}

function AccountSection() {
  const { session, activeBusinessId, account } = useWorkspace();
  if (!account) return null;
  return (
    <AccountMenu
      variant="panel"
      businessId={activeBusinessId}
      email={session.user?.email ?? null}
      onChangePassword={account.openPasswordChange}
      onLogout={() => void account.logout()}
    />
  );
}

function MoreActions() {
  return (
    <>
      <AccountSection />

      <section className="kolay-action-group" aria-labelledby="kolay-more-general">
        <h2 id="kolay-more-general">{t('Genel')}</h2>
        <div className="kolay-action-list">
          <DisabledAction title="Destek" description="YZT destek kanalı henüz uygulamaya bağlı değil." />
          <ActionLink href="/app/public-booking" title="Online Randevu" description="Müşteri rezervasyon ayarları" />
          <ActionLink href="/app/feedback" title="Müşteri geri bildirimleri" description="Yorumları gör, izinli olanları yayınla" />
          <ActionLink href="/app/services" title="Hizmet fotoğrafları" description="Randevu fotoğraflarının hizmet arşivi" />
        </div>
      </section>

      <section className="kolay-action-group" aria-labelledby="kolay-more-reports">
        <h2 id="kolay-more-reports">{t('Raporlar')}</h2>
        <div className="kolay-action-list">
          <ActionLink href="/app/reports" title="Kasa" description="Tahsilat, masraf ve net hareketi görüntüle" />
          <ActionLink href="/app/reports" title="Çalışan primleri" description="Kapanan adisyonlardan yazılan prim ve oranlar" />
          <ActionLink href="/app/expenses" title="Masraflar" description="Gider hareketlerini görüntüle ve düzelt" />
          <ActionLink href="/app/reports" title="Ürün satışları" description="Ürün ve hizmet satış değerlerini karşılaştır" />
          <ActionLink href="/app/reports" title="Gelir-gider" description="Tahsilat, iade ve masraf mutabakatını aç" />
          <ActionLink href="/app/reports" title="Detaylı çalışan raporu" description="Çalışan bazında matrah, düzeltme ve prim hareketleri" />
        </div>
      </section>

      <section className="kolay-action-group" aria-labelledby="kolay-more-setup">
        <h2 id="kolay-more-setup">{t('Kurulum')}</h2>
        <div className="kolay-action-list">
          <ActionLink href="/app/setup" title="Salon bilgileri" description="İşletme kurulumu ve temel bilgiler" />
          <ActionLink href="/app/availability" title="Çalışma saatleri" description="Müsaitlik ve kapanış ayarları" />
          <ActionLink href="/app/team" title="Çalışanlar" description="Ekip ve erişim yönetimi" />
          <ActionLink href="/app/services" title="Hizmetler" description="Hizmet ve personel eşleşmeleri" />
          <ActionLink href="/app/services" title="Süreler ve fiyatlar" description="Hizmet süre ve fiyat ayarları" />
          <ActionLink href="/app/public-booking" title="Randevu ayarları" description="Online randevu davranışı ve salon görünümü" />
          <ActionLink href="/app/products" title="Ürün ve stok" description="Katalog, fiyat ve stok hareketlerini yönet" />
          <ActionLink href="/app/public-booking" title="Salon fotoğrafları" description="Yayınlanan salon görselleri" />
          <ActionLink href="/app/services" title="Promosyonlar" description="Kampanya kodları ve kullanım sınırları" />
          <ActionLink href="/app/services" title="Seans paketleri" description="Paket tanımları, fiyat ve geçerlilik" />
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
      <span>{t('İşletme')}</span>
      <select
        aria-label={t('KolayApp aktif işletme')}
        value={activeBusinessId}
        disabled={switchingBusiness || scopeChanging}
        onChange={(event) => void switchBusiness(event.target.value)}
      >
        {session.memberships.map((membership) => (
          <option value={membership.business_id} key={membership.id}>
            {membership.businesses?.name ?? t('İşletme')}
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
      <Suspense fallback={<div className="kolay-empty-state" aria-busy="true">{t('Ekran hazırlanıyor…')}</div>}>
        {content}
      </Suspense>
    </KolayAppShell>
  );
}
