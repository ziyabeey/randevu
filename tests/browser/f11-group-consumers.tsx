import { createRoot } from 'react-dom/client';
import BrowserWorkspaceProvider from './workspace-provider';
import BookingPage from '../../src/BookingPage';
import CalendarPage from '../../src/CalendarPage';
import CustomersPage from '../../src/CustomersPage';

type Control = {
  text(): string;
  click(text: string): boolean;
  topBookings(): string[];
  bookingLineCount(customer: string): number;
  bookingButtons(customer: string): string[];
  bookingDraftCount(): number;
  bookingCreateSlotCount(): number;
  setComposerField(label: string, value: string): boolean;
  setBookingDraftSelect(index: number, label: string, optionText: string): boolean;
  setCloseField(label: string, value: string): boolean;
  clickBookingButton(customer: string, label: string): boolean;
  clickDetailButton(label: string): boolean;
  detailText(): string;
  calendarReservationCount(): string;
  calendarEventCount(): number;
  calendarListRows(): string[];
  calendarWeekRows(): string[];
  calendarStaffColors(): string[];
  setCalendarDate(value: string): boolean;
  selectCalendarStaff(name: string): boolean;
  clickCalendarEvent(text: string): boolean;
  calendarDrawerLines(): string[];
  setCalendarReason(value: string): boolean;
  historyRows(): string[];
  chooseCustomer(name: string): boolean;
};

declare global {
  interface Window { __f1103c: Control }
}

function visibleButtons() {
  return [...document.querySelectorAll<HTMLButtonElement>('button')];
}

function clickButton(text: string) {
  const button = visibleButtons().find((candidate) => candidate.innerText.includes(text) && !candidate.disabled);
  if (!button) return false;
  button.click();
  return true;
}

function bookingArticle(customer: string) {
  return [...document.querySelectorAll<HTMLElement>('.booking-list-card > .appointment-list > article.appointment-row')]
    .find((item) => item.innerText.includes(customer)) ?? null;
}

function setInputLike(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

function setSelectOption(select: HTMLSelectElement, optionText: string) {
  const option = [...select.options].find((candidate) => candidate.text.includes(optionText));
  if (!option) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  setter?.call(select, option.value);
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

function labelControl(container: ParentNode, labelText: string) {
  const label = [...container.querySelectorAll<HTMLLabelElement>('label')]
    .find((candidate) => candidate.innerText.trim().startsWith(labelText));
  return label?.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input,textarea,select') ?? null;
}

window.prompt = () => 'fixture reason';
window.confirm = () => true;
window.__f1103c = {
  text: () => document.body.innerText,
  click: clickButton,
  topBookings: () => [...document.querySelectorAll<HTMLElement>('.booking-list-card > .appointment-list > article.appointment-row')]
    .map((item) => item.innerText.replace(/\n/g, ' ').trim()),
  bookingLineCount: (customer) => bookingArticle(customer)?.querySelectorAll(':scope > .appointment-list > .appointment-row').length ?? 0,
  bookingButtons: (customer) => [...(bookingArticle(customer)?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
    .map((button) => button.innerText.trim()),
  bookingDraftCount: () => document.querySelectorAll('.booking-line-draft').length,
  bookingCreateSlotCount: () => document.querySelectorAll('.booking-composer .slot-cloud .slot-button').length,
  setComposerField: (label, value) => {
    const composer = document.querySelector<HTMLElement>('.booking-composer');
    if (!composer) return false;
    const control = labelControl(composer, label);
    if (!control || control instanceof HTMLSelectElement) return false;
    setInputLike(control, value);
    return true;
  },
  setBookingDraftSelect: (index, label, optionText) => {
    const draft = document.querySelectorAll<HTMLElement>('.booking-line-draft')[index];
    if (!draft) return false;
    const control = labelControl(draft, label);
    return control instanceof HTMLSelectElement && setSelectOption(control, optionText);
  },
  setCloseField: (label, value) => {
    const panel = document.querySelector<HTMLElement>('.booking-close-panel');
    if (!panel) return false;
    const control = labelControl(panel, label);
    if (!control) return false;
    if (control instanceof HTMLSelectElement) return setSelectOption(control, value);
    setInputLike(control, value);
    return true;
  },
  clickBookingButton: (customer, label) => {
    const article = bookingArticle(customer);
    const button = [...(article?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
      .find((candidate) => candidate.innerText.includes(label) && !candidate.disabled);
    if (!button) return false;
    button.click();
    return true;
  },
  clickDetailButton: (label) => {
    const detail = document.querySelector<HTMLElement>('.booking-detail-card');
    const button = [...(detail?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
      .find((candidate) => candidate.innerText.includes(label) && !candidate.disabled);
    if (!button) return false;
    button.click();
    return true;
  },
  detailText: () => document.querySelector<HTMLElement>('.booking-detail-card')?.innerText.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim() ?? '',
  calendarReservationCount: () => document.querySelector<HTMLElement>('.calendar-stats > div:first-child strong')?.innerText ?? '',
  calendarEventCount: () => document.querySelectorAll('.calendar-event, .calendar-week-event, .calendar-list-event').length,
  calendarListRows: () => [...document.querySelectorAll<HTMLElement>('.calendar-list-event')]
    .map((item) => item.innerText.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()),
  calendarWeekRows: () => [...document.querySelectorAll<HTMLElement>('.calendar-week-event')]
    .map((item) => item.innerText.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()),
  calendarStaffColors: () => [...document.querySelectorAll<HTMLElement>('.calendar-staff-head')]
    .map((item) => getComputedStyle(item).borderTopColor),
  setCalendarDate: (value) => {
    const input = document.querySelector<HTMLInputElement>('.calendar-date-filter input');
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  },
  selectCalendarStaff: (name) => {
    const select = document.querySelector<HTMLSelectElement>('.calendar-filter select');
    if (!select) return false;
    const option = [...select.options].find((candidate) => candidate.text.includes(name));
    if (!option) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    setter?.call(select, option.value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  },
  clickCalendarEvent: (text) => {
    const event = [...document.querySelectorAll<HTMLButtonElement>('.calendar-event, .calendar-week-event, .calendar-list-event')]
      .find((candidate) => candidate.innerText.includes(text));
    if (!event) return false;
    event.click();
    return true;
  },
  calendarDrawerLines: () => [...document.querySelectorAll<HTMLElement>('.calendar-drawer dl > div:nth-child(2) dd > div')]
    .map((item) => item.innerText.replace(/\n/g, ' ').trim()),
  setCalendarReason: (value) => {
    const area = document.querySelector<HTMLTextAreaElement>('.calendar-drawer textarea');
    if (!area) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(area, value);
    area.dispatchEvent(new Event('input', { bubbles: true }));
    area.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  },
  historyRows: () => [...document.querySelectorAll<HTMLElement>('.customers-history > li')]
    .map((item) => item.innerText.replace(/\n/g, ' ').trim()),
  chooseCustomer: (name) => {
    const button = [...document.querySelectorAll<HTMLButtonElement>('.customers-list button')]
      .find((candidate) => candidate.innerText.includes(name));
    if (!button) return false;
    button.click();
    return true;
  },
};

const root = document.getElementById('root');
if (!root) throw new Error('F11-03 consumer browser harness root missing');
const pathname = window.location.pathname;
const page = pathname === '/calendar'
  ? <CalendarPage />
  : pathname === '/bookings'
    ? <BookingPage />
    : pathname === '/customers'
      ? <CustomersPage />
      : <div>Unknown F11-03 consumer harness route: {pathname}</div>;
createRoot(root).render(<BrowserWorkspaceProvider>{page}</BrowserWorkspaceProvider>);
document.documentElement.dataset.f1103ConsumerReady = 'true';
