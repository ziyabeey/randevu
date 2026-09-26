const SQL_ASSERTION_PATTERN = /\b(?:S07 C1|S07 C2a|C2b|S07 C3)\b/i;
const DEFAULT_MAX_LINES = 12;
const DEFAULT_MAX_CHARS = 2400;

function textOf(value) {
  return value == null ? '' : String(value);
}

export function classifyS07PsqlResult(result = {}) {
  const errorCode = textOf(result.error?.code).toUpperCase();
  const errorMessage = textOf(result.error?.message);

  if (errorCode === 'ENOBUFS') return 'ENOBUFS';
  if (errorCode === 'ETIMEDOUT' || /timed?\s*out/i.test(errorMessage)) return 'timeout';
  if (result.error) return 'spawn_error';

  if (typeof result.status === 'number' && result.status !== 0) {
    const output = `${textOf(result.stdout)}\n${textOf(result.stderr)}`;
    return SQL_ASSERTION_PATTERN.test(output) ? 'sql_assertion' : 'psql_exit';
  }

  return null;
}

export function redactS07Diagnostic(value, secrets = []) {
  let text = textOf(value);

  for (const secret of secrets) {
    const exact = textOf(secret);
    if (exact) text = text.split(exact).join('[REDACTED]');
  }

  text = text
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"'<>]+/gi, '[REDACTED_DATABASE_URI]')
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+\/-]+=*/gi, '$1 [REDACTED]')
    .replace(/\b((?:password|passwd|token|api[_-]?key|secret)\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, 'sb_[REDACTED]');

  return text;
}

export function boundedS07DiagnosticTail(result = {}, {
  secrets = [],
  maxLines = DEFAULT_MAX_LINES,
  maxChars = DEFAULT_MAX_CHARS,
} = {}) {
  const raw = `${textOf(result.stdout)}\n${textOf(result.stderr)}`;
  const lines = redactS07Diagnostic(raw, secrets)
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .slice(-Math.max(1, maxLines));

  if (!lines.length) return '';

  const joined = lines.join('\n');
  if (joined.length <= maxChars) return joined;
  return `…${joined.slice(-(maxChars - 1))}`;
}

export function describeS07PsqlFailure(name, result = {}, options = {}) {
  const kind = classifyS07PsqlResult(result) ?? 'unknown';
  const tail = boundedS07DiagnosticTail(result, options);
  const suffix = tail ? `\nS07_DIAGNOSTIC_TAIL_BEGIN\n${tail}\nS07_DIAGNOSTIC_TAIL_END` : '';
  return `S07 staging database acceptance failed: ${name} class=${kind}${suffix}`;
}
