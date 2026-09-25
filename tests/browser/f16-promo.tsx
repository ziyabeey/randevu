import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import BrowserWorkspaceProvider from './workspace-provider';
import PromoCodesPanel from '../../src/PromoCodesPanel';
import { ManagePromo, PromoAttachResult, PublicPromoField } from '../../src/PublicPromo';
import TicketCashierPage from '../../src/kolayapp/TicketCashierPage';

type Control = {
  text(scope: string): string;
  setField(scope: string, selector: string, value: string): boolean;
  check(scope: string, selector: string): boolean;
  click(scope: string, text: string): boolean;
  checkedCode(): string | null;
  layout(): { overflow: number; shortTargets: string[] };
};
declare global { interface Window { __f1606: Control; __f1606Code: string | null; __f1606Errors: string[] } }

const el = (scope: string) => document.querySelector<HTMLElement>(`[data-scope="${scope}"]`);
function setValue(element: HTMLInputElement | HTMLSelectElement, value: string) {
  const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

window.__f1606Code = null;
window.__f1606 = {
  text: (scope) => el(scope)?.innerText ?? '',
  setField: (scope, selector, value) => {
    const field = el(scope)?.querySelector<HTMLInputElement | HTMLSelectElement>(selector);
    if (!field) return false;
    setValue(field, value);
    return true;
  },
  check: (scope, selector) => {
    const box = el(scope)?.querySelector<HTMLInputElement>(selector);
    if (!box) return false;
    box.click();
    return box.checked;
  },
  click: (scope, text) => {
    const button = [...(el(scope)?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
      .find((item) => item.innerText.trim().includes(text) && !item.disabled);
    if (!button) return false;
    button.click();
    return true;
  },
  checkedCode: () => window.__f1606Code,
  layout: () => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    shortTargets: [...document.querySelectorAll<HTMLElement>(
      '.public-promo-field input, .public-promo-field button, .manage-promo input, .manage-promo button, '
      + '.promo-codes button, .promo-codes input, .promo-codes select, .ticket-promo input, .ticket-promo button',
    )]
      .filter((node) => node.getBoundingClientRect().height > 0 && node.getBoundingClientRect().height < 44
        && !(node instanceof HTMLInputElement && node.type === 'checkbox'))
      .map((node) => `${node.tagName}:${(node.textContent || (node as HTMLInputElement).name || '').trim()}:${node.getBoundingClientRect().height}`),
  }),
};

const services = [
  { id: 'f1680000-0000-4000-8000-000000000611', name: 'Kesim', active: true },
  { id: 'f1680000-0000-4000-8000-000000000612', name: 'Boya', active: true },
];

function PublicScope() {
  const [code, setCode] = useState<string | null>(null);
  window.__f1606Code = code;
  return <PublicPromoField slug="salon-a" serviceIds={[services[0].id]} onChange={setCode} />;
}

window.__f1606Errors = [];
window.addEventListener('error', (event) => window.__f1606Errors.push(String(event.message)));
window.addEventListener('unhandledrejection', (event) => window.__f1606Errors.push(String(event.reason)));

createRoot(document.getElementById('root')!).render(<main>
  <div data-scope="public"><PublicScope /></div>
  <div data-scope="attach"><PromoAttachResult manageUrl={`/m#${'M'.repeat(43)}`} code="YAZ20" /></div>
  <div data-scope="manage"><ManagePromo token={'N'.repeat(43)} /></div>
  <div data-scope="manage-ticket-open"><ManagePromo token={'O'.repeat(43)} /></div>
  <div data-scope="codes"><PromoCodesPanel businessId="f1680000-0000-4000-8000-000000000602" services={services} canManage /></div>
  <div data-scope="cashier"><BrowserWorkspaceProvider><TicketCashierPage /></BrowserWorkspaceProvider></div>
</main>);
document.documentElement.dataset.f1606Ready = 'true';
