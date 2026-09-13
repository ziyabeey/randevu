export const OUTBOUND_REQUEST_TIMEOUT_MS = 10_000;

export class OutboundRequestTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Outbound request exceeded ${timeoutMs}ms`);
    this.name = 'OutboundRequestTimeoutError';
  }
}

function requestSignal(input: RequestInfo | URL, init: RequestInit) {
  if (init.signal) return init.signal;
  return typeof Request !== 'undefined' && input instanceof Request ? input.signal : null;
}

function abortReason(signal: AbortSignal) {
  return signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
}

export async function fetchTextWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch,
  timeoutMs = OUTBOUND_REQUEST_TIMEOUT_MS,
): Promise<{ response: Response; bodyText: string }> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError('timeoutMs must be a positive finite number');
  }

  const callerSignal = requestSignal(input, init);
  if (callerSignal?.aborted) throw abortReason(callerSignal);

  const controller = new AbortController();
  let rejectBoundary: (reason?: unknown) => void = () => undefined;
  const boundary = new Promise<never>((_resolve, reject) => {
    rejectBoundary = reject;
  });
  const abortFromCaller = () => {
    const reason = abortReason(callerSignal!);
    controller.abort(reason);
    rejectBoundary(reason);
  };
  callerSignal?.addEventListener('abort', abortFromCaller, { once: true });

  const timer = setTimeout(() => {
    const error = new OutboundRequestTimeoutError(timeoutMs);
    controller.abort(error);
    rejectBoundary(error);
  }, timeoutMs);

  const operation = (async () => {
    const response = await fetchImpl(input, { ...init, signal: controller.signal });
    const bodyText = await response.text();
    return { response, bodyText };
  })();

  try {
    return await Promise.race([operation, boundary]);
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', abortFromCaller);
  }
}
