import type { ReactNode } from 'react';
import KolayBottomNav from './KolayBottomNav';
import { kolayAppTabLabel, type KolayAppTab } from './model';
import './kolayapp.css';

export type KolayBusinessSummary = Readonly<{
  name: string;
  meta?: string;
}>;

type Props = {
  activeTab: KolayAppTab;
  onTabChange: (tab: KolayAppTab) => void;
  business?: KolayBusinessSummary | null;
  onBusinessPress?: () => void;
  eyebrow?: string;
  title?: string;
  headerAction?: ReactNode;
  hideBusinessSummary?: boolean;
  children: ReactNode;
};

export default function KolayAppShell({
  activeTab,
  onTabChange,
  business = null,
  onBusinessPress,
  eyebrow = 'KOLAYAPP',
  title,
  headerAction,
  hideBusinessSummary = false,
  children,
}: Props) {
  const businessName = business?.name ?? 'İşletme seçilmedi';
  const screenTitle = title ?? kolayAppTabLabel(activeTab);

  const businessSummary = (
    <>
      <span className="kolay-business-switch__name">{businessName}</span>
      <span className="kolay-business-switch__meta">{business?.meta ?? 'İşletme seçimi hazır değil'}</span>
    </>
  );

  return (
    <section className="kolay-app-shell" data-active-tab={activeTab} aria-label="KolayApp mobil çalışma alanı">
      <a className="kolay-skip-link" href="#kolayapp-content">İçeriğe geç</a>

      <header className="kolay-app-header">
        <div className="kolay-app-header__copy">
          <p className="kolay-app-header__eyebrow">{eyebrow}</p>
          <h1 className="kolay-app-header__title">{screenTitle}</h1>
        </div>

        <div className="kolay-app-header__actions">
          {!hideBusinessSummary && (onBusinessPress ? (
            <button
              className="kolay-business-switch kolay-touch-target"
              type="button"
              onClick={onBusinessPress}
              aria-label={`İşletme: ${businessName}. İşletme seçimini aç`}
            >
              {businessSummary}
            </button>
          ) : (
            <div className="kolay-business-switch kolay-business-switch--static" aria-label={`İşletme: ${businessName}`}>
              {businessSummary}
            </div>
          ))}
          {headerAction}
        </div>
      </header>

      <div id="kolayapp-content" className="kolay-app-content" tabIndex={-1}>
        {children}
      </div>

      <KolayBottomNav activeTab={activeTab} onTabChange={onTabChange} />
    </section>
  );
}
