import { createRoot } from 'react-dom/client';
import AvailabilityPage from '../../src/AvailabilityPage';
import '../../src/styles.css';
import '../../src/phase4.css';

type Control = {
  text(): string;
  clickButton(text: string): boolean;
  setInArticle(label: string, name: string, value: string): Promise<boolean>;
  submitInArticle(label: string): boolean;
  valueInArticle(label: string, name: string): string | null;
  toggleAssignment(person: string, service: string): boolean;
  assignmentChecked(person: string, service: string): boolean | null;
  setInSection(title: string, name: string, value: string): boolean;
  submitInSection(title: string, buttonText: string): boolean;
  clickInSection(title: string, buttonText: string): boolean;
  metrics(): { width: number; scrollWidth: number; minTargetHeight: number; targetCount: number };
};

declare global {
  interface Window { __f10settingsReview: Control }
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

async function articleWhenReady(label: string, timeoutMs = 3_000) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const candidate = article(label);
    if (candidate) return candidate;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
  return null;
}

function section(title: string) {
  return [...document.querySelectorAll<HTMLElement>('.availability-card')]
    .find((item) => item.querySelector('h2')?.textContent?.includes(title)) ?? null;
}

function buttonWithText(text: string, scope: ParentNode = document) {
  return [...scope.querySelectorAll<HTMLButtonElement>('button')]
    .find((candidate) => candidate.innerText.includes(text) && !candidate.disabled) ?? null;
}

function assignment(person: string, service: string) {
  const row = [...document.querySelectorAll<HTMLElement>('.settings-matrix-row')]
    .find((candidate) => candidate.innerText.includes(person));
  const chip = [...(row?.querySelectorAll<HTMLElement>('.chip') ?? [])]
    .find((candidate) => candidate.innerText.includes(service));
  return chip?.querySelector<HTMLInputElement>('input[type="checkbox"]') ?? null;
}

window.__f10settingsReview = {
  text: () => document.body.innerText,
  clickButton: (text) => {
    const button = buttonWithText(text);
    if (!button) return false;
    button.click();
    return true;
  },
  setInArticle: async (label, name, value) => {
    const editor = await articleWhenReady(label);
    return setValue(editor?.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${CSS.escape(name)}"]`) ?? null, value);
  },
  submitInArticle: (label) => {
    const form = article(label)?.querySelector<HTMLFormElement>('form');
    const button = form?.querySelector<HTMLButtonElement>('button[type="submit"],button:not([type])');
    if (!form || !button || button.disabled) return false;
    form.requestSubmit(button);
    return true;
  },
  valueInArticle: (label, name) => article(label)?.querySelector<HTMLInputElement>(`[name="${CSS.escape(name)}"]`)?.value ?? null,
  toggleAssignment: (person, service) => {
    const checkbox = assignment(person, service);
    if (!checkbox || checkbox.disabled) return false;
    checkbox.click();
    return true;
  },
  assignmentChecked: (person, service) => assignment(person, service)?.checked ?? null,
  setInSection: (title, name, value) => setValue(
    section(title)?.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${CSS.escape(name)}"]`) ?? null,
    value,
  ),
  submitInSection: (title, buttonText) => {
    const card = section(title);
    const button = card ? buttonWithText(buttonText, card) : null;
    const form = button?.closest('form');
    if (!button || !form) return false;
    form.requestSubmit(button);
    return true;
  },
  clickInSection: (title, buttonText) => {
    const card = section(title);
    const button = card ? buttonWithText(buttonText, card) : null;
    if (!button) return false;
    button.click();
    return true;
  },
  metrics: () => {
    const targets = [...document.querySelectorAll<HTMLElement>(
      '.availability-page button:not([disabled]), .availability-page input:not([type="checkbox"]):not([disabled]), .availability-page select:not([disabled]), .availability-page a.primary-link, .settings-matrix .chip',
    )].filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    const heights = targets.map((element) => element.getBoundingClientRect().height);
    return {
      width: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      minTargetHeight: heights.length ? Math.min(...heights) : 0,
      targetCount: targets.length,
    };
  },
};

const root = document.getElementById('root');
if (!root) throw new Error('F10-04 review browser harness root missing');
createRoot(root).render(<AvailabilityPage />);
document.documentElement.dataset.f10SettingsReviewReady = 'true';
