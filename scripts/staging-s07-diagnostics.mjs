// Only an ERROR message is assertion evidence; progress and CONTEXT are not.
const SQL_ASSERTION_PATTERN = /\bERROR:\s*(?:[0-9A-Z]{5}:\s*)?(?:S07 C1|S07 C2a|C2b|S07 C3)\b/i;
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

  // Match once, longest first: masking a prefix must not expose a longer secret's suffix.
  const exactSecrets = [...new Set(secrets.map(textOf).filter(Boolean))]
    .sort((a, b) => b.length - a.length);
  if (exactSecrets.length) {
    const pattern = exactSecrets.map((secret) => secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    text = text.replace(new RegExp(pattern, 'g'), '[REDACTED]');
  }

  text = text
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"'<>]+/gi, '[REDACTED_DATABASE_URI]')
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+\/-]+=*/gi, '$1 [REDACTED]')
    // Consume entire quoted values, including escapes/newlines. A truncated quote
    // masks the remainder rather than allowing part of a credential into the tail.
    // Do not retry at each hyphen inside a long non-credential identifier.
    .replace(/(?<![\w-])((?:[a-z][a-z0-9]*[_-])*(?:password|passwd|token|api[_-]?key|secret|admin[_-]?key|service[_-]?role(?:[_-]?key)?)["']?\s*[=:]\s*)(?:"(?:\\[\s\S]|[^"\\])*"?|'(?:\\[\s\S]|[^'\\])*'?|[^\s,;]+)/gi, '$1[REDACTED]')
    .replace(/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, 'sb_[REDACTED]');

  return text;
}

function diagnosticLimit(value, ceiling) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return ceiling;
  return Math.min(ceiling, Math.max(1, Math.floor(value)));
}

export function boundedS07DiagnosticTail(result = {}, {
  secrets = [],
  maxLines = DEFAULT_MAX_LINES,
  maxChars = DEFAULT_MAX_CHARS,
} = {}) {
  const lineLimit = diagnosticLimit(maxLines, DEFAULT_MAX_LINES);
  const charLimit = diagnosticLimit(maxChars, DEFAULT_MAX_CHARS);
  const raw = `${textOf(result.stdout)}\n${textOf(result.stderr)}`;
  const lines = redactS07Diagnostic(raw, secrets)
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .slice(-lineLimit);

  if (!lines.length) return '';

  const joined = lines.join('\n');
  if (joined.length <= charLimit) return joined;
  if (charLimit === 1) return '…';
  return `…${joined.slice(-(charLimit - 1))}`;
}

export function describeS07PsqlFailure(name, result = {}, options = {}) {
  const kind = classifyS07PsqlResult(result) ?? 'unknown';
  const tail = boundedS07DiagnosticTail(result, options);
  const suffix = tail ? `\nS07_DIAGNOSTIC_TAIL_BEGIN\n${tail}\nS07_DIAGNOSTIC_TAIL_END` : '';
  return `S07 staging database acceptance failed: ${name} class=${kind}${suffix}`;
}
