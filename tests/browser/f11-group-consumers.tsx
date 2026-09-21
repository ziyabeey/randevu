import { createRoot } from 'react-dom/client';
import BookingPage from '../../src/BookingPage';
import CalendarPage from '../../src/CalendarPage';
import CustomersPage from '../../src/CustomersPage';

type Control = {
  text(): string;
  click(text: string): boolean;
  topBookings(): string[];
  bookingLineCount(customer: string): number;
  bookingButtons(customer: string): string[];
  calendarReservationCount(): string;
  calendarEventCount(): number;
  calendarListRows(): string[];
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
  calendarReservationCount: () => document.querySelector<HTMLElement>('.calendar-stats > div:first-child strong')?.innerText ?? '',
  calendarEventCount: () => document.querySelectorAll('.calendar-event, .calendar-week-event, .calendar-list-event').length,
  calendarListRows: () => [...document.querySelectorAll<HTMLElement>('.calendar-list-event')]
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
createRoot(root).render(page);
document.documentElement.dataset.f1103ConsumerReady = 'true';
