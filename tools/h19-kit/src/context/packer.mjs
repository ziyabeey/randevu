function estimateTokens(text) {
  return Math.ceil(String(text ?? '').length / 4);
}

export function packUnits(units = [], {
  maxTokens = 12000,
  reserveTokens = 1000,
} = {}) {
  const budget = Math.max(0, maxTokens - reserveTokens);
  const ranked = [...units].sort((a, b) => {
    const pa = Number(a.priority ?? 0);
    const pb = Number(b.priority ?? 0);
    return pb - pa || String(a.id).localeCompare(String(b.id));
  });

  const selected = [];
  const omitted = [];
  let used = 0;

  for (const unit of ranked) {
    const text = unit.text ?? '';
    const tokens = unit.estimatedTokens ?? estimateTokens(text);
    if (used + tokens <= budget) {
      selected.push({ ...unit, estimatedTokens: tokens });
      used += tokens;
    } else {
      omitted.push({ id: unit.id, estimatedTokens: tokens, priority: unit.priority ?? 0 });
    }
  }

  return Object.freeze({
    selected,
    omitted,
    estimatedTokens: used,
    budget,
    complete: omitted.length === 0,
  });
}

export function semanticUnit({
  id,
  path,
  symbol = null,
  patch,
  enclosingContext = '',
  priority = 0,
} = {}) {
  if (!id || !path || patch == null) throw new TypeError('semanticUnit requires id, path and patch');
  const text = [
    `PATH: ${path}`,
    symbol ? `SYMBOL: ${symbol}` : '',
    'DIFF:',
    String(patch),
    enclosingContext ? `CONTEXT:\n${enclosingContext}` : '',
  ].filter(Boolean).join('\n');
  return Object.freeze({ id, path, symbol, patch, enclosingContext, priority, text });
}
