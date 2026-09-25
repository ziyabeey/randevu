import { createRoot } from 'react-dom/client';
import AppointmentPhotos from '../../src/AppointmentPhotos';
import PrivatePhotoArchive from '../../src/PrivatePhotoArchive';

type Control = {
  text(scope: string): string;
  choosePng(scope: string, width: number, height: number): Promise<boolean>;
  setField(scope: string, label: string, value: string): boolean;
  click(scope: string, text: string): boolean;
  clickInTile(scope: string, caption: string, text: string): boolean;
  checkConsent(scope: string): boolean;
  buttonDisabled(scope: string, text: string): boolean | null;
  loadedImages(scope: string): number;
  fallbacks(scope: string): number;
  hasUploadForm(scope: string): boolean;
  layout(): { overflow: number; shortTargets: string[] };
};

declare global {
  interface Window { __f1603: Control }
}

function scopeElement(scope: string) {
  return document.querySelector<HTMLElement>(`[data-scope="${scope}"]`);
}

function setValue(element: HTMLInputElement | HTMLSelectElement, value: string) {
  const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

window.confirm = () => true;
window.__f1603 = {
  text: (scope) => scopeElement(scope)?.innerText ?? '',
  choosePng: async (scope, width, height) => {
    const input = scopeElement(scope)?.querySelector<HTMLInputElement>('input[name="photo"]');
    if (!input) return false;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return false;
    context.fillStyle = '#c0563d';
    context.fillRect(0, 0, width, height);
    context.fillStyle = '#f5e6c8';
    context.fillRect(width / 4, height / 4, width / 2, height / 2);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return false;
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], 'sonrasi.png', { type: 'image/png' }));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  },
  setField: (scope, label, value) => {
    const field = [...(scopeElement(scope)?.querySelectorAll<HTMLLabelElement>('label') ?? [])]
      .find((item) => item.innerText.trim().startsWith(label))?.querySelector<HTMLInputElement | HTMLSelectElement>('input,select');
    if (!field) return false;
    if (field instanceof HTMLSelectElement) {
      const option = [...field.options].find((item) => item.text.includes(value));
      if (!option) return false;
      setValue(field, option.value);
      return true;
    }
    setValue(field, value);
    return true;
  },
  click: (scope, text) => {
    const button = [...(scopeElement(scope)?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
      .find((item) => item.innerText.includes(text) && !item.disabled);
    if (!button) return false;
    button.click();
    return true;
  },
  clickInTile: (scope, caption, text) => {
    const tile = [...(scopeElement(scope)?.querySelectorAll<HTMLElement>('.private-photo-tile') ?? [])]
      .find((item) => item.querySelector('figcaption strong')?.textContent === caption);
    const button = [...(tile?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
      .find((item) => item.innerText.includes(text) && !item.disabled);
    if (!button) return false;
    button.click();
    return true;
  },
  checkConsent: (scope) => {
    const box = scopeElement(scope)?.querySelector<HTMLInputElement>('.private-photo-consent input[type="checkbox"]');
    if (!box) return false;
    box.click();
    return box.checked;
  },
  buttonDisabled: (scope, text) => {
    const button = [...(scopeElement(scope)?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((item) => item.innerText.includes(text));
    return button ? button.disabled : null;
  },
  loadedImages: (scope) => [...(scopeElement(scope)?.querySelectorAll<HTMLImageElement>('.private-photo-tile img') ?? [])]
    .filter((image) => image.complete && image.naturalWidth > 0).length,
  fallbacks: (scope) => scopeElement(scope)?.querySelectorAll('.private-photo-fallback').length ?? 0,
  hasUploadForm: (scope) => Boolean(scopeElement(scope)?.querySelector('.private-photo-upload')),
  layout: () => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    shortTargets: [...document.querySelectorAll<HTMLElement>('.appointment-photos button, .appointment-photos input:not([type=checkbox]), .appointment-photos select, .private-photo-archive button, .private-photo-archive select')]
      .filter((node) => node.getBoundingClientRect().height < 44)
      .map((node) => `${node.tagName}:${(node.textContent || node.getAttribute('name') || '').trim()}:${node.getBoundingClientRect().height}`),
  }),
};

const services = [
  { serviceId: 'f1603000-0000-4000-8000-00000000b001', serviceName: 'Boya' },
  { serviceId: 'f1603000-0000-4000-8000-00000000b002', serviceName: 'Kesim' },
];

createRoot(document.getElementById('root')!).render(<main className="workspace-page">
  <div data-scope="group"><AppointmentPhotos groupId="f1603000-0000-4000-8000-00000000a001" services={services} /></div>
  <div data-scope="full"><AppointmentPhotos groupId="f1603000-0000-4000-8000-00000000a002" services={services} /></div>
  <div data-scope="archive"><PrivatePhotoArchive businessId="f1603000-0000-4000-8000-00000000c001" services={services.map((item) => ({ id: item.serviceId, name: item.serviceName }))} /></div>
</main>);
document.documentElement.dataset.f1603Ready = 'true';
