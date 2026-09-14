import { createRoot } from 'react-dom/client';
import OnboardingPage from '../../src/OnboardingPage';

type Control = {
  text(): string;
  buttons(): Array<{ text: string; disabled: boolean }>;
  set(name: string, value: string): boolean;
  check(name: string, checked: boolean): boolean;
  click(text: string): boolean;
  submit(buttonText: string): boolean;
  links(): string[];
};

declare global {
  interface Window { __f10: Control }
}

function field(name: string) {
  return document.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${CSS.escape(name)}"]`);
}

window.__f10 = {
  text: () => document.body.innerText,
  buttons: () => [...document.querySelectorAll<HTMLButtonElement>('button')].map((button) => ({
    text: button.innerText.trim(),
    disabled: button.disabled,
  })),
  set: (name, value) => {
    const element = field(name);
    if (!element) return false;
    element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  },
  check: (name, checked) => {
    const element = document.querySelector<HTMLInputElement>(`input[type="checkbox"][name="${CSS.escape(name)}"]`);
    if (!element) return false;
    element.checked = checked;
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  },
  click: (text) => {
    const button = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((candidate) => candidate.innerText.includes(text) && !candidate.disabled);
    if (!button) return false;
    button.click();
    return true;
  },
  submit: (buttonText) => {
    const button = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((candidate) => candidate.innerText.includes(buttonText) && !candidate.disabled);
    const form = button?.closest('form');
    if (!button || !form) return false;
    form.requestSubmit(button);
    return true;
  },
  links: () => [...document.querySelectorAll<HTMLAnchorElement>('a')].map((link) => link.getAttribute('href') ?? ''),
};

const root = document.getElementById('root');
if (!root) throw new Error('F10 browser harness root missing');
createRoot(root).render(<OnboardingPage />);
document.documentElement.dataset.f10Ready = 'true';
