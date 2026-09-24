// H19b deterministik extractor (S5). H19B-PROTOKOL v0.2 §1'in olgu tanımlarını uygular.
// Yalnız betimler: yapının varlığını ve konumunu söyler, risk ya da hüküm söylemez.

export const CUE = /for update|lock|version|advisory|serializ|skip locked|nowait/i;
const LOCK = /\bfor\s+update\b|\bfor\s+no\s+key\s+update\b|\bpg_advisory_xact_lock\b|\bpg_advisory_lock\b|\bskip\s+locked\b/gi;
const VERSION_CMP = /\b(?:\w+\.)?\w*(?:version|updated_at)\s*(?:=|<>|!=|is\s+(?:not\s+)?distinct\s+from)/i;
const RETRY = /exception\s+when\s+(?:unique_violation|serialization_failure|lock_not_available)\b/i;
const BOUNDARY = /\bcommit\b|\bdblink/i;

const lines = (body) => body.split('\n');
const lockCount = (body) => (body.match(LOCK) ?? []).length;
const firstLockLine = (body) => lines(body).findIndex((line) => new RegExp(LOCK.source, 'i').test(line));

// Güncellenen satırın WHERE koşulunda sürüm/updated_at karşılaştırması olan UPDATE ifadeleri
export function versionGuardCount(body) {
  let count = 0;
  for (const statement of body.split(';')) {
    const text = statement.replace(/--[^\n]*/g, ' ');
    const update = /\bupdate\s+[\w.]+(?:\s+\w+)?\s+set\b/i.exec(text);
    if (!update) continue;
    const rest = text.slice(update.index);
    const where = /\bwhere\b/i.exec(rest);
    if (!where) continue;
    const clause = rest.slice(where.index).split(/\breturning\b/i)[0];
    if (VERSION_CMP.test(clause)) count += 1;
  }
  return count;
}

// changed = { removed: [önceki gövdede satır indeksi], added: [sonraki gövdede satır indeksi] }
export function extractFacts(before, after, changed) {
  const lockBefore = lockCount(before);
  const lockAfter = lockCount(after);
  const guardBefore = versionGuardCount(before);
  const guardAfter = versionGuardCount(after);
  const firstBefore = firstLockLine(before);
  const firstAfter = firstLockLine(after);
  const inside = changed.removed.some((i) => firstBefore >= 0 && i >= firstBefore)
    || changed.added.some((i) => firstAfter >= 0 && i >= firstAfter);
  const down = lockAfter < lockBefore || guardAfter < guardBefore;
  const up = lockAfter > lockBefore || guardAfter > guardBefore;
  if (down && up) throw new Error('guard_delta: aynı değişiklikte hem kaldırma hem ekleme (protokolde tanımsız)');
  return {
    lock_context: lockBefore > 0,
    version_guard: guardBefore > 0,
    changed_inside_locked_region: inside,
    guard_delta: down ? 'removed' : up ? 'added' : 'unchanged',
    retry_path: RETRY.test(before),
    transaction_boundary: BOUNDARY.test(after) && !BOUNDARY.test(before) ? 'changed' : 'unchanged',
  };
}

// Birleşik diff hunk'larından değişen satırların dosya içi satır numaraları (1 tabanlı)
export function changedLineNumbers(patch) {
  const removed = [];
  const added = [];
  let oldLine = 0;
  let newLine = 0;
  for (const line of patch.split('\n')) {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (header) { oldLine = Number(header[1]); newLine = Number(header[2]); continue; }
    if (line.startsWith('-')) { removed.push(oldLine); oldLine += 1; continue; }
    if (line.startsWith('+')) { added.push(newLine); newLine += 1; continue; }
    if (line.startsWith('\\')) continue;
    oldLine += 1; newLine += 1;
  }
  return { removed, added };
}

// Migration dosyasındaki fonksiyon tanımları: gövdenin dosyadaki başlangıcı ve metni (aynı ad tekrar
// tanımlanırsa sonuncusu)
export function functionBodies(sql) {
  const out = new Map();
  const re = /create\s+or\s+replace\s+function\s+([\w.]+)\s*\(/gi;
  let m;
  while ((m = re.exec(sql))) {
    const tag = /as\s+(\$[a-z_]*\$)/i.exec(sql.slice(m.index));
    if (!tag) continue;
    const start = m.index + tag.index + tag[0].length;
    const end = sql.indexOf(tag[1], start);
    if (end < 0) continue;
    out.set(m[1].toLowerCase(), { start, end, body: sql.slice(start, end) });
  }
  return out;
}

export const lineOf = (text, offset) => text.slice(0, offset).split('\n').length;
