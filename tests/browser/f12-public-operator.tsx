import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import PublicBookingSettingsPage from '../../src/PublicBookingSettingsPage';
import PublicSalonPage from '../../src/PublicSalonPage';
import '../../src/styles.css';
import '../../src/public-booking.css';
import '../../src/public-profile.css';

type OperatorMetrics = {
  layoutWidth: number;
  scrollWidth: number;
  overflow: boolean;
  touchTargets: Array<{ label: string; height: number; width: number }>;
};

declare global {
  interface Window {
    __f12operator: {
      text: () => string;
      html: () => string;
      remount: () => void;
      setProfileName: (value: string) => void;
      submitProfile: () => void;
      setPhoto: () => void;
      submitUpload: () => void;
      click: (label: string) => void;
      metrics: () => OperatorMetrics;
      activeFocus: () => { label: string; focusVisible: boolean; outlineWidth: string; outlineStyle: string };
    };
  }
}

const rootNode = document.getElementById('root');
if (!rootNode) throw new Error('F12 operator browser harness root missing');
const root = createRoot(rootNode);
let generation = 0;
const publicVisibilityMode = window.location.pathname === '/public-visibility';

function render() {
  document.documentElement.dataset.f12OperatorReady = 'false';
  if (publicVisibilityMode) {
    root.render(<StrictMode><PublicSalonPage slug="visibility-salon" /></StrictMode>);
  } else {
    root.render(<StrictMode><PublicBookingSettingsPage key={generation} /></StrictMode>);
  }
}

function inputValue(selector: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(selector);
  if (!input) throw new Error(`F12 operator input missing: ${selector}`);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setter) throw new Error('F12 operator input value setter missing');
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function clickByLabel(label: string) {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>('button,a'));
  const target = candidates.find((node) => (node.textContent ?? '').trim() === label || (node.textContent ?? '').includes(label));
  if (!target) throw new Error(`F12 operator control missing: ${label}`);
  target.click();
}

function setPhoto() {
  const input = document.querySelector<HTMLInputElement>('input[name="photo"]');
  if (!input) throw new Error('F12 operator photo input missing');
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlK0l8AAAAASUVORK5CYII=';
  const bytes = Uint8Array.from(atob(png), (value) => value.charCodeAt(0));
  const file = new File([bytes], 'salon.png', { type: 'image/png' });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function metrics(): OperatorMetrics {
  const rootElement = document.documentElement;
  const selectors = [
    '.public-primary',
    '.public-media-admin-actions button',
    '.public-link-box button',
    '.public-preview-link',
  ];
  const touchTargets = Array.from(document.querySelectorAll<HTMLElement>(selectors.join(',')))
    .filter((node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    })
    .map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        label: (node.textContent ?? node.getAttribute('name') ?? node.tagName).trim(),
        height: Math.round(rect.height * 10) / 10,
        width: Math.round(rect.width * 10) / 10,
      };
    });
  return {
    layoutWidth: rootElement.clientWidth,
    scrollWidth: rootElement.scrollWidth,
    overflow: rootElement.scrollWidth > rootElement.clientWidth + 1,
    touchTargets,
  };
}

function activeFocus() {
  const node = document.activeElement as HTMLElement | null;
  if (!node) return { label: '', focusVisible: false, outlineWidth: '0px', outlineStyle: 'none' };
  const style = getComputedStyle(node);
  return {
    label: node.getAttribute('name') || (node.textContent ?? '').trim() || node.tagName.toLowerCase(),
    focusVisible: node.matches(':focus-visible'),
    outlineWidth: style.outlineWidth,
    outlineStyle: style.outlineStyle,
  };
}

window.__f12operator = {
  text: () => document.body.innerText,
  html: () => document.documentElement.outerHTML,
  remount: () => { generation += 1; render(); },
  setProfileName: (value) => inputValue('input[name="publicName"]', value),
  submitProfile: () => {
    const form = document.querySelector<HTMLFormElement>('.public-profile-form');
    if (!form) throw new Error('F12 operator profile form missing');
    form.requestSubmit();
  },
  setPhoto,
  submitUpload: () => {
    const form = document.querySelector<HTMLFormElement>('.public-media-upload');
    if (!form) throw new Error('F12 operator upload form missing');
    form.requestSubmit();
  },
  click: clickByLabel,
  metrics,
  activeFocus,
};

function recordReady() {
  const text = document.body.innerText;
  if (
    text.includes('Salon profiliniz ve randevu bağlantınız') ||
    text.includes('Çalışma alanı açılamadı.') ||
    text.includes('Şu anda online randevuya açık hizmet bulunmuyor.')
  ) {
    document.documentElement.dataset.f12OperatorReady = 'true';
  }
}

const observer = new MutationObserver(() => window.setTimeout(recordReady, 0));
observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true });
window.setInterval(recordReady, 100);
render();
