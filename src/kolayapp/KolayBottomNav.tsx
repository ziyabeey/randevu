import { useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { adjacentKolayAppTab, KOLAY_APP_TABS, type KolayAppTab } from './model';

type Props = {
  activeTab: KolayAppTab;
  onTabChange: (tab: KolayAppTab) => void;
};

function TabIcon({ tab }: { tab: KolayAppTab }) {
  const common = {
    width: 22,
    height: 22,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    focusable: false,
    'aria-hidden': true,
  };

  if (tab === 'appointments') {
    return <svg {...common}><rect x="4" y="5" width="16" height="15" rx="3" /><path d="M8 3v4M16 3v4M4 10h16" /></svg>;
  }
  if (tab === 'tickets') {
    return <svg {...common}><path d="M7 3h10v18l-2-1.5L13 21l-2-1.5L9 21l-2-1.5L5 21V5a2 2 0 0 1 2-2Z" /><path d="M9 8h6M9 12h6M9 16h4" /></svg>;
  }
  if (tab === 'new') {
    return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></svg>;
  }
  if (tab === 'customers') {
    return <svg {...common}><circle cx="12" cy="8" r="3" /><path d="M5.5 19a6.5 6.5 0 0 1 13 0" /></svg>;
  }
  return <svg {...common}><circle cx="6" cy="12" r="1.3" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" /><circle cx="18" cy="12" r="1.3" fill="currentColor" stroke="none" /></svg>;
}

export default function KolayBottomNav({ activeTab, onTabChange }: Props) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  function moveFocus(nextTab: KolayAppTab) {
    const nextIndex = KOLAY_APP_TABS.findIndex((tab) => tab.id === nextTab);
    onTabChange(nextTab);
    requestAnimationFrame(() => buttons.current[nextIndex]?.focus());
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, currentTab: KolayAppTab) {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      moveFocus(adjacentKolayAppTab(currentTab, 1));
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      moveFocus(adjacentKolayAppTab(currentTab, -1));
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      moveFocus(KOLAY_APP_TABS[0].id);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      const lastTab = KOLAY_APP_TABS.at(-1);
      if (lastTab) moveFocus(lastTab.id);
    }
  }

  return (
    <nav className="kolay-bottom-nav" aria-label="KolayApp ana menü">
      {KOLAY_APP_TABS.map((tab, index) => (
        <button
          key={tab.id}
          ref={(node) => { buttons.current[index] = node; }}
          className="kolay-bottom-nav__item"
          type="button"
          aria-current={activeTab === tab.id ? 'page' : undefined}
          data-active={activeTab === tab.id ? 'true' : 'false'}
          onClick={() => onTabChange(tab.id)}
          onKeyDown={(event) => handleKeyDown(event, tab.id)}
        >
          <span className="kolay-bottom-nav__icon"><TabIcon tab={tab.id} /></span>
          <span className="kolay-bottom-nav__label">{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}
