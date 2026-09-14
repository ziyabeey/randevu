import { createRoot } from 'react-dom/client';
import AvailabilityPage from '../../src/AvailabilityPage';
import { seedCsrfToken } from '../../src/api';

type Control = {
  text(): string;
  setInArticle(label: string, name: string, value: string): boolean;
  submitInArticle(label: string): boolean;
  clickInArticle(label: string, text: string): boolean;
  setInForm(buttonText: string, name: string, value: string): boolean;
  submit(buttonText: string): boolean;
};

declare global {
  interface Window { __f10settings: Control }
}

function setValue(element: HTMLInputElement | HTMLSelectElement | null, value: string) {
  if (!element) return false;
  element.value = value;
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

function article(label: string) {
  return [...document.querySelectorAll<HTMLElement>('.catalog-editor')]
    .find((item) => item.innerText.includes(label)) ?? null;
}

function formForButton(buttonText: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find((candidate) => candidate.innerText.includes(buttonText) && !candidate.disabled);
  return { button, form: button?.closest('form') ?? null };
}

window.__f10settings = {
  text: () => document.body.innerText,
  setInArticle: (label, name, value) => setValue(
    article(label)?.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${CSS.escape(name)}"]`) ?? null,
    value,
  ),
  submitInArticle: (label) => {
    const form = article(label)?.querySelector<HTMLFormElement>('form');
    const button = form?.querySelector<HTMLButtonElement>('button[type="submit"],button:not([type])');
    if (!form || !button || button.disabled) return false;
    form.requestSubmit(button);
    return true;
  },
  clickInArticle: (label, text) => {
    const button = [...(article(label)?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
      .find((candidate) => candidate.innerText.includes(text) && !candidate.disabled);
    if (!button) return false;
    button.click();
    return true;
  },
  setInForm: (buttonText, name, value) => {
    const { form } = formForButton(buttonText);
    return setValue(
      form?.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${CSS.escape(name)}"]`) ?? null,
      value,
    );
  },
  submit: (buttonText) => {
    const { button, form } = formForButton(buttonText);
    if (!button || !form) return false;
    form.requestSubmit(button);
    return true;
  },
};

seedCsrfToken('C'.repeat(43));
const root = document.getElementById('root');
if (!root) throw new Error('F10-04 browser harness root missing');
createRoot(root).render(<AvailabilityPage />);
document.documentElement.dataset.f10SettingsReady = 'true';
