import { createRoot } from 'react-dom/client';
import BrowserWorkspaceProvider from './workspace-provider';
import ManageFeedback from '../../src/ManageFeedback';
import PublicReviews from '../../src/PublicReviews';
import FeedbackPage from '../../src/FeedbackPage';

type Control = {
  text(scope: string): string;
  rate(scope: string, value: number): boolean;
  setComment(scope: string, value: string): boolean;
  consent(scope: string): boolean;
  click(scope: string, text: string): boolean;
  clickInItem(scope: string, customer: string, text: string): boolean;
  buttons(scope: string): string[];
  setStatus(value: string): boolean;
  layout(): { overflow: number; shortTargets: string[] };
};
declare global { interface Window { __f1604: Control } }

const el = (scope: string) => document.querySelector<HTMLElement>(`[data-scope="${scope}"]`);
function setValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
    : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

window.__f1604 = {
  text: (scope) => el(scope)?.innerText ?? '',
  rate: (scope, value) => {
    const input = el(scope)?.querySelector<HTMLInputElement>(`input[name="feedback-rating"][value="${value}"]`);
    if (!input) return false;
    input.click();
    return input.checked;
  },
  setComment: (scope, value) => {
    const area = el(scope)?.querySelector<HTMLTextAreaElement>('textarea');
    if (!area) return false;
    setValue(area, value);
    return true;
  },
  consent: (scope) => {
    const box = el(scope)?.querySelector<HTMLInputElement>('.manage-feedback-consent input');
    if (!box) return false;
    box.click();
    return box.checked;
  },
  click: (scope, text) => {
    const button = [...(el(scope)?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((item) => item.innerText.includes(text) && !item.disabled);
    if (!button) return false;
    button.click();
    return true;
  },
  clickInItem: (scope, customer, text) => {
    const item = [...(el(scope)?.querySelectorAll<HTMLElement>('.feedback-item') ?? [])].find((node) => node.innerText.includes(customer));
    const button = [...(item?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((node) => node.innerText.includes(text) && !node.disabled);
    if (!button) return false;
    button.click();
    return true;
  },
  buttons: (scope) => [...(el(scope)?.querySelectorAll<HTMLButtonElement>('button') ?? [])].map((item) => item.innerText.trim()),
  setStatus: (value) => {
    const select = el('business')?.querySelector<HTMLSelectElement>('.feedback-filter select');
    if (!select) return false;
    setValue(select, value);
    return true;
  },
  layout: () => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    shortTargets: [...document.querySelectorAll<HTMLElement>('.manage-feedback button, .manage-feedback-stars label, .feedback-panel button, .feedback-panel select')]
      .filter((node) => node.getBoundingClientRect().height < 44)
      .map((node) => `${node.tagName}:${(node.textContent || '').trim()}:${node.getBoundingClientRect().height}`),
  }),
};

createRoot(document.getElementById('root')!).render(<main>
  <div data-scope="done"><ManageFeedback token={'D'.repeat(43)} /></div>
  <div data-scope="open"><ManageFeedback token={'O'.repeat(43)} /></div>
  <div data-scope="reviews"><PublicReviews slug="salon-a" /></div>
  <div data-scope="empty-reviews"><PublicReviews slug="salon-empty" /></div>
  <div data-scope="business"><BrowserWorkspaceProvider><FeedbackPage /></BrowserWorkspaceProvider></div>
</main>);
document.documentElement.dataset.f1604Ready = 'true';
