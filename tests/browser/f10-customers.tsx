import { createRoot } from 'react-dom/client';
import BrowserWorkspaceProvider from './workspace-provider';
import CustomersPage from '../../src/CustomersPage';

type Metrics = {
  viewport: number;
  documentWidth: number;
  navClientWidth: number;
  navScrollWidth: number;
  navLinks: Array<{ text: string; left: number; right: number; top: number; bottom: number }>;
  shortControls: Array<{ tag: string; text: string; height: number }>;
};

type Control = {
  text(): string;
  click(text: string): boolean;
  submit(buttonText: string): boolean;
  setIn(buttonText: string, name: string, value: string): boolean;
  setSearch(value: string): boolean;
  submitSearch(): boolean;
  metrics(): Metrics;
  focus(): { tag: string; text: string; left: number; right: number; top: number; bottom: number; outline: string };
};

declare global {
  interface Window { __f10customers: Control }
}

function setValue(element: HTMLInputElement | HTMLTextAreaElement | null, value: string) {
  if (!element) return false;
  element.value = value;
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

function buttonContaining(text: string) {
  return [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find((candidate) => candidate.innerText.includes(text) && !candidate.disabled) ?? null;
}

function formFor(buttonText: string) {
  const button = buttonContaining(buttonText);
  return { button, form: button?.closest('form') ?? null };
}

window.__f10customers = {
  text: () => document.body.innerText,
  click: (text) => {
    const button = buttonContaining(text);
    if (!button) return false;
    button.click();
    return true;
  },
  submit: (buttonText) => {
    const { button, form } = formFor(buttonText);
    if (!button || !form) return false;
    form.requestSubmit(button);
    return true;
  },
  setIn: (buttonText, name, value) => {
    const { form } = formFor(buttonText);
    return setValue(form?.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${CSS.escape(name)}"]`) ?? null, value);
  },
  setSearch: (value) => setValue(document.querySelector<HTMLInputElement>('input[aria-label="Müşteri ara"]'), value),
  submitSearch: () => {
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Müşteri ara"]');
    const form = input?.closest('form');
    if (!form) return false;
    form.requestSubmit();
    return true;
  },
  metrics: () => {
    const nav = document.querySelector<HTMLElement>('.phase-nav');
    const navLinks = [...document.querySelectorAll<HTMLAnchorElement>('.phase-nav a')].map((link) => {
      const rect = link.getBoundingClientRect();
      return { text: link.innerText.trim(), left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    });
    const shortControls = [...document.querySelectorAll<HTMLElement>('.customers-shell button, .customers-shell input, .customers-shell a')]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { tag: element.tagName, text: element.innerText.trim() || element.getAttribute('aria-label') || element.getAttribute('name') || '', height: rect.height };
      })
      .filter((item) => item.height < 43.5);
    return {
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      navClientWidth: nav?.clientWidth ?? 0,
      navScrollWidth: nav?.scrollWidth ?? 0,
      navLinks,
      shortControls,
    };
  },
  focus: () => {
    const element = document.activeElement as HTMLElement | null;
    const rect = element?.getBoundingClientRect() ?? new DOMRect();
    const style = element ? getComputedStyle(element) : null;
    return {
      tag: element?.tagName ?? '',
      text: element?.innerText?.trim() || element?.getAttribute('aria-label') || element?.getAttribute('name') || '',
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      outline: style ? `${style.outlineStyle}:${style.outlineWidth}` : '',
    };
  },
};

const root = document.getElementById('root');
if (!root) throw new Error('F10 customer browser harness root missing');
createRoot(root).render(
  <BrowserWorkspaceProvider>
    <>
      <CustomersPage />
      <nav className="phase-nav" aria-label="Çalışma alanları">
      <a href="/calendar">Takvim</a>
      <a href="/bookings">Randevular</a>
      <a href="/customers" aria-current="page">Müşteriler</a>
      <a href="/availability">Müsaitlik</a>
      <a href="/setup">Kurulum</a>
      <a href="/">Hizmetler</a>
      <a href="/team">Ekip</a>
      <a href="/public-booking">Public Sayfa</a>
      </nav>
    </>
  </BrowserWorkspaceProvider>,
);
document.documentElement.dataset.f10CustomersReady = 'true';
