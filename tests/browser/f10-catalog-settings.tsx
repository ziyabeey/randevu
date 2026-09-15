import { createRoot } from 'react-dom/client';
import AvailabilityPage from '../../src/AvailabilityPage';

type Control = {
  text(): string;
  setInArticle(label: string, name: string, value: string): Promise<boolean>;
  submitInArticle(label: string): Promise<boolean>;
  clickInArticle(label: string, text: string): boolean;
  setInForm(buttonText: string, name: string, value: string): Promise<boolean>;
  submit(buttonText: string): Promise<boolean>;
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

async function waitForForm(buttonText: string, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = formForButton(buttonText);
    if (result.button && result.form) return result;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return { button: undefined, form: null };
}

function articleFormState(label: string) {
  const form = article(label)?.querySelector<HTMLFormElement>('form') ?? null;
  const button = form?.querySelector<HTMLButtonElement>('button[type="submit"],button:not([type])') ?? null;
  return { form, button };
}

async function waitForArticleField(label: string, name: string, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { form, button } = articleFormState(label);
    const field = form?.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${CSS.escape(name)}"]`) ?? null;
    if (field && button && !button.disabled) return field;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return null;
}

async function waitForArticleSubmit(label: string, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { form, button } = articleFormState(label);
    if (form && button && !button.disabled) return { form, button };
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return { form: null, button: null };
}

window.__f10settings = {
  text: () => document.body.innerText,
  setInArticle: async (label, name, value) => setValue(await waitForArticleField(label, name), value),
  submitInArticle: async (label) => {
    const { form, button } = await waitForArticleSubmit(label);
    if (!form || !button) return false;
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
  setInForm: async (buttonText, name, value) => {
    const { form } = await waitForForm(buttonText);
    return setValue(
      form?.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${CSS.escape(name)}"]`) ?? null,
      value,
    );
  },
  submit: async (buttonText) => {
    const { button, form } = await waitForForm(buttonText);
    if (!button || !form) return false;
    form.requestSubmit(button);
    return true;
  },
};

const root = document.getElementById('root');
if (!root) throw new Error('F10-04 browser harness root missing');
createRoot(root).render(<AvailabilityPage />);
document.documentElement.dataset.f10SettingsReady = 'true';
