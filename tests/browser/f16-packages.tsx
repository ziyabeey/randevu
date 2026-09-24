import { createRoot } from 'react-dom/client';
import BrowserWorkspaceProvider from './workspace-provider';
import ServicePackagesPanel from '../../src/ServicePackagesPanel';
import TicketCashierPage from '../../src/kolayapp/TicketCashierPage';

type Control = {
  text(scope: string): string;
  setField(scope: string, selector: string, value: string): boolean;
  click(scope: string, text: string, within?: string): boolean;
  setStatus(status: string): boolean;
  clickTicket(text: string): boolean;
  optionTexts(scope: string, selector: string): string[];
  layout(): { overflow: number; shortTargets: string[] };
};
declare global { interface Window { __f1605: Control } }

const el = (scope: string) => document.querySelector<HTMLElement>(`[data-scope="${scope}"]`);
function setValue(element: HTMLInputElement | HTMLSelectElement, value: string) {
  const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

window.__f1605 = {
  text: (scope) => el(scope)?.innerText ?? '',
  setField: (scope, selector, value) => {
    const field = el(scope)?.querySelector<HTMLInputElement | HTMLSelectElement>(selector);
    if (!field) return false;
    setValue(field, value);
    return true;
  },
  click: (scope, text, within) => {
    const root = within ? el(scope)?.querySelector<HTMLElement>(within) : el(scope);
    const button = [...(root?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
      .find((item) => item.innerText.trim().includes(text) && !item.disabled);
    if (!button) return false;
    button.click();
    return true;
  },
  setStatus: (status) => {
    const select = [...(el('cashier')?.querySelectorAll<HTMLSelectElement>('select') ?? [])]
      .find((item) => [...item.options].some((option) => option.value === 'closed'));
    if (!select) return false;
    setValue(select, status);
    return true;
  },
  clickTicket: (text) => {
    const button = [...(el('cashier')?.querySelectorAll<HTMLButtonElement>('.ticket-list button') ?? [])]
      .find((item) => item.innerText.includes(text));
    if (!button) return false;
    button.click();
    return true;
  },
  optionTexts: (scope, selector) => [...(el(scope)?.querySelectorAll<HTMLOptionElement>(`${selector} option`) ?? [])].map((item) => item.textContent ?? ''),
  layout: () => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    shortTargets: [...document.querySelectorAll<HTMLElement>(
      '.service-packages button, .service-packages input, .service-packages select, '
      + '.ticket-add-package select, .ticket-add-package button, .ticket-package-use select, .ticket-package-use button, '
      + '.ticket-package-reverse input, .ticket-package-reverse button, .ticket-package-refund input, .ticket-package-refund button',
    )]
      .filter((node) => node.getBoundingClientRect().height > 0 && node.getBoundingClientRect().height < 44)
      .map((node) => `${node.tagName}:${(node.textContent || (node as HTMLInputElement).name || '').trim()}:${node.getBoundingClientRect().height}`),
  }),
};

const services = [
  { id: 'f1650000-0000-4000-8000-000000000611', name: 'Lazer Seansı', active: true },
  { id: 'f1650000-0000-4000-8000-000000000612', name: 'Cilt Bakımı', active: true },
];

createRoot(document.getElementById('root')!).render(<main>
  <div data-scope="packages"><ServicePackagesPanel businessId="f1650000-0000-4000-8000-000000000602" services={services} canManage /></div>
  <div data-scope="cashier"><BrowserWorkspaceProvider><TicketCashierPage /></BrowserWorkspaceProvider></div>
</main>);
document.documentElement.dataset.f1605Ready = 'true';
