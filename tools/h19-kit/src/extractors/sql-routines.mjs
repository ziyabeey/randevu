const CREATE_RE = /\bcreate\s+(?:or\s+replace\s+)?(?:function|procedure)\s+((?:[a-zA-Z_][\w$]*\.)?[a-zA-Z_][\w$]*)\s*\(/ig;

function normalizeName(raw) {
  const value = raw.toLowerCase();
  return value.includes('.') ? value : `public.${value}`;
}

function findMatchingParen(text, open) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote && text[i - 1] !== '\\') quote = null;
      continue;
    }
    if (c === "'" || c === '"') { quote = c; continue; }
    if (c === '(') depth++;
    if (c === ')' && --depth === 0) return i;
  }
  return -1;
}

function splitArgs(argText) {
  const trimmed = argText.trim();
  if (!trimmed) return [];
  const args = [];
  let start = 0, depth = 0, quote = null;
  for (let i = 0; i < argText.length; i++) {
    const c = argText[i];
    if (quote) {
      if (c === quote && argText[i - 1] !== '\\') quote = null;
      continue;
    }
    if (c === "'" || c === '"') quote = c;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) {
      args.push(argText.slice(start, i).trim());
      start = i + 1;
    }
  }
  args.push(argText.slice(start).trim());
  return args.filter(Boolean);
}

function dollarTagAt(text, from) {
  const m = text.slice(from).match(/\$[A-Za-z0-9_]*\$/);
  return m ? { tag: m[0], index: from + m.index } : null;
}

export function extractSqlRoutines(text, { path = null } = {}) {
  const routines = [];
  for (const match of text.matchAll(CREATE_RE)) {
    const name = normalizeName(match[1]);
    const open = text.indexOf('(', match.index);
    const close = findMatchingParen(text, open);
    if (close < 0) continue;
    const args = splitArgs(text.slice(open + 1, close));

    const afterArgs = close + 1;
    const asIndex = text.slice(afterArgs).search(/\bas\s+\$/i);
    if (asIndex < 0) continue;
    const firstTag = dollarTagAt(text, afterArgs + asIndex);
    if (!firstTag) continue;
    const bodyStart = firstTag.index + firstTag.tag.length;
    const bodyEnd = text.indexOf(firstTag.tag, bodyStart);
    if (bodyEnd < 0) continue;

    const statementEnd = text.indexOf(';', bodyEnd + firstTag.tag.length);
    const end = statementEnd >= 0 ? statementEnd + 1 : bodyEnd + firstTag.tag.length;
    const definition = text.slice(match.index, end);
    const body = text.slice(bodyStart, bodyEnd);

    routines.push(Object.freeze({
      id: `${name}/${args.length}`,
      name,
      arity: args.length,
      args,
      path,
      startOffset: match.index,
      endOffset: end,
      bodyStartOffset: bodyStart,
      bodyEndOffset: bodyEnd,
      body,
      definition,
    }));
  }
  return routines;
}

export function routineMap(text, opts = {}) {
  return new Map(extractSqlRoutines(text, opts).map((r) => [r.id, r]));
}
