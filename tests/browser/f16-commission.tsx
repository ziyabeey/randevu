import { createRoot } from 'react-dom/client';
import BrowserWorkspaceProvider from './workspace-provider';
import FinancialReportsPage from '../../src/FinancialReportsPage';
// Production imports this stylesheet globally from src/main.tsx.
import '../../src/financial-reports.css';

type Control = {
  text(scope: string): string;
  setField(scope: string, selector: string, value: string): boolean;
  click(scope: string, text: string, within?: string): boolean;
  openDetails(scope: string, summary: string): boolean;
  layout(): { overflow: number; shortTargets: string[] };
};
declare global { interface Window { __f1607: Control } }

const el = (scope: string) => document.querySelector<HTMLElement>(`[data-scope="${scope}"]`);
function setValue(element: HTMLInputElement | HTMLSelectElement, value: string) {
  const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

window.__f1607 = {
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
  openDetails: (scope, summary) => {
    const details = [...(el(scope)?.querySelectorAll<HTMLDetailsElement>('details') ?? [])]
      .find((item) => item.querySelector('summary')?.innerText.includes(summary));
    if (!details) return false;
    details.open = true;
    return true;
  },
  layout: () => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    shortTargets: [...document.querySelectorAll<HTMLElement>(
      '.commission-panel button, .commission-panel input, .commission-panel select, .commission-panel summary, '
      + '.financial-report-filter button, .financial-report-filter input',
    )]
      .filter((node) => node.getBoundingClientRect().height > 0 && node.getBoundingClientRect().height < 44)
      .map((node) => `${node.tagName}:${(node.textContent || (node as HTMLInputElement).name || '').trim()}:${node.getBoundingClientRect().height}`),
  }),
};

createRoot(document.getElementById('root')!).render(
  <div data-scope="reports"><BrowserWorkspaceProvider><FinancialReportsPage /></BrowserWorkspaceProvider></div>,
);
document.documentElement.dataset.f1607Ready = 'true';
