import { createRoot } from 'react-dom/client';
import type { ReactNode } from 'react';
import BrowserWorkspaceProvider from './workspace-provider';
import AccountMenu from '../../src/AccountMenu';
import LanguageSwitch from '../../src/LanguageSwitch';
import PublicReviews from '../../src/PublicReviews';
import KolayAppSurface from '../../src/kolayapp/KolayAppSurface';
import TicketCashierPage from '../../src/kolayapp/TicketCashierPage';
import { initLocale, useLocale } from '../../src/i18n';
import { WorkspaceProvider, useWorkspace } from '../../src/workspace-context';
// Production imports these stylesheets globally from src/main.tsx.
import '../../src/styles.css';
import '../../src/public-profile.css';
import '../../src/account.css';

type Control = {
  text(scope: string): string;
  html(scope: string): string;
  setField(scope: string, selector: string, value: string): boolean;
  click(scope: string, text: string): boolean;
  openAccountMenu(): boolean;
  hrefs(scope: string): string[];
  disabled(scope: string): string[];
  calls(): { logout: number; password: number };
  layout(): { overflow: number; shortTargets: string[] };
};
declare global { interface Window { __f1608: Control; __f1608Calls: { logout: number; password: number } } }

window.__f1608Calls = { logout: 0, password: 0 };
const el = (scope: string) => document.querySelector<HTMLElement>(`[data-scope="${scope}"]`);
function setValue(element: HTMLInputElement | HTMLSelectElement, value: string) {
  const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

window.__f1608 = {
  text: (scope) => el(scope)?.innerText ?? '',
  html: (scope) => el(scope)?.innerHTML ?? '',
  setField: (scope, selector, value) => {
    const field = el(scope)?.querySelector<HTMLInputElement | HTMLSelectElement>(selector);
    if (!field) return false;
    setValue(field, value);
    return true;
  },
  click: (scope, text) => {
    const button = [...(el(scope)?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
      .find((item) => item.innerText.trim() === text && !item.disabled);
    if (!button) return false;
    button.click();
    return true;
  },
  openAccountMenu: () => {
    const details = el('header')?.querySelector<HTMLDetailsElement>('details.account-menu');
    if (!details) return false;
    details.open = true;
    return true;
  },
  hrefs: (scope) => [...(el(scope)?.querySelectorAll<HTMLAnchorElement>('a.kolay-action-link') ?? [])].map((link) => link.getAttribute('href') ?? ''),
  disabled: (scope) => [...(el(scope)?.querySelectorAll<HTMLElement>('[aria-disabled="true"]') ?? [])].map((node) => node.innerText.split('\n')[0] ?? ''),
  calls: () => ({ ...window.__f1608Calls }),
  layout: () => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    shortTargets: [...document.querySelectorAll<HTMLElement>(
      '.account-menu > summary, .account-menu button, .account-panel button, .language-switch select, .kolay-action-link, .kolay-action-disabled, .ticket-package-sale button, .ticket-package-sale select',
    )]
      .filter((node) => node.getBoundingClientRect().height > 0 && node.getBoundingClientRect().height < 44)
      .map((node) => `${node.tagName}:${(node.textContent || '').trim().slice(0, 40)}:${node.getBoundingClientRect().height}`),
  }),
};

// Adds the shell's account actions, as WorkspaceShell does in production.
function WithAccount({ children }: { children: ReactNode }) {
  const workspace = useWorkspace();
  const account = {
    openPasswordChange: () => { window.__f1608Calls.password += 1; },
    logout: async () => { window.__f1608Calls.logout += 1; },
  };
  return <WorkspaceProvider value={{ ...workspace, account }}>{children}</WorkspaceProvider>;
}

function Header() {
  const { session, activeBusinessId, account } = useWorkspace();
  return (
    <AccountMenu
      businessId={activeBusinessId}
      email={session.user?.email ?? null}
      onChangePassword={() => account?.openPasswordChange()}
      onLogout={() => void account?.logout()}
    />
  );
}

// Mirrors src/main.tsx: the tree remounts when the language changes.
function LocaleRoot() {
  const locale = useLocale();
  const view = new URLSearchParams(window.location.search).get('view');
  if (view === 'cashier') {
    return <div key={locale} data-scope="cashier"><BrowserWorkspaceProvider><TicketCashierPage /></BrowserWorkspaceProvider></div>;
  }
  return (
    <div key={locale}>
      <BrowserWorkspaceProvider>
        <WithAccount>
          <header data-scope="header" className="app-header"><Header /></header>
          <div data-scope="kolay"><KolayAppSurface activeTab="more" /></div>
        </WithAccount>
      </BrowserWorkspaceProvider>
      <div data-scope="public">
        <LanguageSwitch className="public-language-switch" />
        <PublicReviews slug="dil-salon" />
      </div>
    </div>
  );
}

void initLocale().finally(() => {
  createRoot(document.getElementById('root')!).render(<LocaleRoot />);
  document.documentElement.dataset.f1608Ready = 'true';
});
