export const CALENDAR_REFRESH_INTERVAL_MS = 30_000;
export const CALENDAR_HTTP_TIMEOUT_MS = 10_000;

const RETURN_EVENT_COALESCE_MS = 1_000;

export type CalendarRequestTicket = Readonly<{
  generation: number;
  controller: AbortController;
}>;

/** Keeps exactly one calendar read authoritative at a time. */
export class LatestCalendarRequest {
  private generation = 0;
  private controller: AbortController | null = null;

  begin(): CalendarRequestTicket {
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    return { generation: ++this.generation, controller };
  }

  isCurrent(ticket: CalendarRequestTicket) {
    return ticket.generation === this.generation
      && ticket.controller === this.controller
      && !ticket.controller.signal.aborted;
  }

  complete(ticket: CalendarRequestTicket) {
    if (ticket.generation === this.generation && ticket.controller === this.controller) {
      this.controller = null;
    }
  }

  cancel() {
    ++this.generation;
    this.controller?.abort();
    this.controller = null;
  }
}

type CalendarRefreshSchedulerOptions = {
  isVisible(): boolean;
  onRefresh(): void;
  now?: () => number;
  schedule?: (callback: () => void, delayMs: number) => unknown;
  unschedule?: (handle: unknown) => void;
};

/**
 * Polls only while visible and folds the visibilitychange + focus pair emitted
 * by one tab return into a single immediate refresh.
 */
export class CalendarRefreshScheduler {
  private timer: unknown = null;
  private disposed = false;
  private lastReturnRefreshAt = Number.NEGATIVE_INFINITY;
  private readonly options: CalendarRefreshSchedulerOptions;
  private readonly now: () => number;
  private readonly schedule: (callback: () => void, delayMs: number) => unknown;
  private readonly unschedule: (handle: unknown) => void;

  constructor(options: CalendarRefreshSchedulerOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
    this.schedule = options.schedule ?? ((callback, delayMs) => globalThis.setInterval(callback, delayMs));
    this.unschedule = options.unschedule ?? ((handle) => globalThis.clearInterval(handle as ReturnType<typeof setInterval>));
  }

  start() {
    this.restart();
  }

  restart() {
    this.clearTimer();
    if (this.disposed || !this.options.isVisible()) return;
    this.timer = this.schedule(this.options.onRefresh, CALENDAR_REFRESH_INTERVAL_MS);
  }

  visibilityChanged() {
    if (!this.options.isVisible()) {
      this.clearTimer();
      return;
    }
    this.refreshOnReturn();
  }

  focused() {
    this.refreshOnReturn();
  }

  dispose() {
    this.disposed = true;
    this.clearTimer();
  }

  private refreshOnReturn() {
    if (this.disposed || !this.options.isVisible()) return;
    this.restart();
    const currentTime = this.now();
    if (currentTime - this.lastReturnRefreshAt < RETURN_EVENT_COALESCE_MS) return;
    this.lastReturnRefreshAt = currentTime;
    this.options.onRefresh();
  }

  private clearTimer() {
    if (this.timer === null) return;
    this.unschedule(this.timer);
    this.timer = null;
  }
}
