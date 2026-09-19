import { createRoot } from 'react-dom/client';
import ManageAppointmentPage from '../../src/ManageAppointmentPage';

// F11-03 customer management harness. The page is mounted exactly as the
// /m#token route mounts it, so the group projection, the optimistic version it
// sends and its conflict recovery are the real ones; only the API is a fixture.

type Control = {
  text(): string;
  buttons(): Array<{ text: string; disabled: boolean; selected: boolean }>;
  click(text: string): boolean;
  setDate(value: string): boolean;
  slots(): string[];
  pickSlot(index: number): boolean;
  setReason(value: string): boolean;
  lines(): string[];
};

declare global {
  interface Window { __f1103: Control }
}

function visibleButtons() {
  return [...document.querySelectorAll<HTMLButtonElement>('button')];
}

window.__f1103 = {
  text: () => document.body.innerText,
  buttons: () => visibleButtons().map((button) => ({
    text: button.innerText.trim(),
    disabled: button.disabled,
    selected: button.classList.contains('is-selected'),
  })),
  click: (text) => {
    const button = visibleButtons().find((candidate) => candidate.innerText.includes(text) && !candidate.disabled);
    if (!button) return false;
    button.click();
    return true;
  },
  setDate: (value) => {
    const input = document.querySelector<HTMLInputElement>('input[type="date"]');
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  },
  slots: () => [...document.querySelectorAll<HTMLElement>('.manage-slots .public-slot')].map((slot) => slot.innerText.replace(/\n/g, ' ').trim()),
  pickSlot: (index) => {
    const slot = document.querySelectorAll<HTMLButtonElement>('.manage-slots .public-slot')[index];
    if (!slot) return false;
    slot.click();
    return true;
  },
  setReason: (value) => {
    const area = document.querySelector<HTMLTextAreaElement>('.manage-danger textarea');
    if (!area) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(area, value);
    area.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  },
  lines: () => [...document.querySelectorAll<HTMLElement>('.manage-group-line')].map((line) => line.innerText.replace(/\n/g, ' ').trim()),
};

const token = new URL(window.location.href).searchParams.get('token') ?? '';
const root = document.getElementById('root');
if (!root) throw new Error('F11-03 management browser harness root missing');
createRoot(root).render(<ManageAppointmentPage token={token} />);
document.documentElement.dataset.f1103Ready = 'true';
