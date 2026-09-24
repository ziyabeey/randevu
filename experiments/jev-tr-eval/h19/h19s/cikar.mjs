#!/usr/bin/env node
// H19s eligible-unit çıkarıcı (H19S-PROTOKOL-v0.2 §2–§3 + CLARIFICATIONS-v0.2.1). Deterministik; Jev çağrısı yapmaz, H19 skoruna,
// etikete veya review sonucuna bakmaz.
//
// Bir birim: main'e merge edilen bir PR'ın final base→merge farkında `supabase/migrations/**/*.sql` altındaki
// bir dosyada tanımı bulunan ve merge ağacındaki geçerli (son) tanımının gövdesi, base ağacındaki geçerli
// tanımından farklı olan function/procedure. Migration'lar ekleme usulü olduğundan "gövde değişikliği" rutinin
// geçerli tanımları arasında ölçülür; Jev girdisi bu iki tanımın birleşik farkıdır (bkz. UYGULAMA-EKI.md).
//
//   node h19/h19s/cikar.mjs --ref origin/main --after <protokol-commit> [--stop] [--out birimler.json]
//   node h19/h19s/cikar.mjs --merge <merge-sha>

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const MIGRATIONS = 'supabase/migrations';
export const STOP = { units: 150, prs: 25 };
const sha = (text) => createHash('sha256').update(text).digest('hex');
// Yol belirteçleri repo köküne göredir; betik hangi dizinden çalıştırılırsa çalıştırılsın.
const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28, cwd: ROOT });

// ---- SQL rutin ayrıştırıcı ----

function lineCommented(sql, index) {
  const lineStart = sql.lastIndexOf('\n', index - 1) + 1;
  return sql.slice(lineStart, index).includes('--');
}

function closingParen(sql, open) {
  let depth = 0;
  let quoted = false;
  for (let i = open; i < sql.length; i += 1) {
    const ch = sql[i];
    if (ch === "'") quoted = !quoted;
    else if (!quoted && ch === '(') depth += 1;
    else if (!quoted && ch === ')') { depth -= 1; if (depth === 0) return i; }
  }
  return -1;
}

function topLevelArgs(text) {
  const parts = [];
  let depth = 0;
  let quoted = false;
  let current = '';
  for (const ch of text) {
    if (ch === "'") quoted = !quoted;
    if (!quoted && ch === '(') depth += 1;
    if (!quoted && ch === ')') depth -= 1;
    if (!quoted && depth === 0 && ch === ',') { parts.push(current); current = ''; } else current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

const qualify = (name) => {
  const clean = name.replace(/"/g, '').toLowerCase();
  return clean.includes('.') ? clean : `public.${clean}`;
};

// Dosyadaki rutin tanımları, dosya sırasıyla. Bir tanımın gövdesinin içinde eşleşme aranmaz.
export function parseRoutines(sql) {
  const out = [];
  const issues = [];
  const re = /create\s+(?:or\s+replace\s+)?(function|procedure)\s+((?:"?\w+"?\.)?"?\w+"?)\s*\(/gi;
  let m;
  while ((m = re.exec(sql))) {
    if (lineCommented(sql, m.index)) continue;
    const open = m.index + m[0].length - 1;
    const close = closingParen(sql, open);
    if (close < 0) { issues.push({ at: m.index, name: m[2], reason: 'args_unclosed' }); continue; }
    const tag = /\$([A-Za-z0-9_]*)\$/.exec(sql.slice(close));
    const header = tag ? sql.slice(close, close + tag.index) : '';
    if (!tag || header.includes(';')) { issues.push({ at: m.index, name: m[2], reason: 'no_dollar_body' }); continue; }
    const bodyStart = close + tag.index + tag[0].length;
    const bodyEnd = sql.indexOf(tag[0], bodyStart);
    if (bodyEnd < 0) { issues.push({ at: m.index, name: m[2], reason: 'body_unclosed' }); continue; }
    const semi = sql.indexOf(';', bodyEnd + tag[0].length);
    const end = semi < 0 ? sql.length : semi + 1;
    const argc = topLevelArgs(sql.slice(open + 1, close)).length;
    const name = qualify(m[2]);
    out.push({
      kind: m[1].toLowerCase(),
      name,
      identity: `${name}/${argc}`,
      line: sql.slice(0, m.index).split('\n').length,
      body: sql.slice(bodyStart, bodyEnd),
      statement: sql.slice(m.index, end),
      start: m.index,
      end,
    });
    re.lastIndex = end;
  }
  const drops = [];
  const dre = /drop\s+(function|procedure)\s+(?:if\s+exists\s+)?((?:"?\w+"?\.)?"?\w+"?)\s*(\([^;]*?\))?\s*(?:cascade|restrict)?\s*;/gi;
  while ((m = dre.exec(sql))) {
    if (lineCommented(sql, m.index)) continue;
    const argc = m[3] ? topLevelArgs(m[3].slice(1, -1)).length : null;
    drops.push({ name: qualify(m[2]), argc, start: m.index });
  }
  return { routines: out, drops, issues };
}

// Yorum ve boşluk farkı gövde değişikliği sayılmaz (protokol §2: yorum-only dışarıda).
export function normalizeBody(body) {
  return body
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').map((line) => line.replace(/--.*$/, '')).join('\n')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---- ağaç düzeyi geçerli tanımlar ----

const fileCache = new Map();
function readAt(rev, file) {
  const key = `${rev}:${file}`;
  if (!fileCache.has(key)) fileCache.set(key, git(['show', key]));
  return fileCache.get(key);
}

function migrationFiles(rev) {
  return git(['ls-tree', '-r', '--name-only', rev, '--', MIGRATIONS])
    .split('\n').filter((f) => f.endsWith('.sql')).sort();
}

// Migration'lar dosya adı sırasıyla uygulanır; aynı kimliğin son tanımı geçerlidir, sonraki drop onu siler.
export function effectiveDefinitions(rev) {
  const defs = new Map();
  const issues = [];
  for (const file of migrationFiles(rev)) {
    const parsed = parseRoutines(readAt(rev, file));
    issues.push(...parsed.issues.map((i) => ({ file, ...i })));
    const events = [
      ...parsed.routines.map((r) => ({ at: r.start, def: { ...r, path: file } })),
      ...parsed.drops.map((d) => ({ at: d.start, drop: d })),
    ].sort((a, b) => a.at - b.at);
    for (const e of events) {
      if (e.def) defs.set(e.def.identity, e.def);
      else for (const id of [...defs.keys()]) {
        const [name, argc] = id.split('/');
        if (name === e.drop.name && (e.drop.argc === null || Number(argc) === e.drop.argc)) defs.delete(id);
      }
    }
  }
  return { defs, issues };
}

let tmp;
function unifiedDiff(before, after) {
  tmp ??= mkdtempSync(path.join(tmpdir(), 'h19s-'));
  const a = path.join(tmp, 'a.sql');
  const b = path.join(tmp, 'b.sql');
  writeFileSync(a, before);
  writeFileSync(b, after);
  let out = '';
  try {
    execFileSync('git', ['diff', '--no-index', '--no-color', '-U3', a, b], { encoding: 'utf8' });
  } catch (error) {
    out = error.stdout;
  }
  const lines = out.split('\n');
  return lines.slice(lines.findIndex((line) => line.startsWith('@@'))).join('\n').replace(/\n+$/, '');
}

// ---- bir merge commit'inin birimleri ----

export function prFromMessage(message) {
  const merge = /^Merge pull request #(\d+) from (\S+)/.exec(message);
  if (merge) return { number: Number(merge[1]), branch: merge[2] };
  const squash = /\(#(\d+)\)\s*$/m.exec(message.split('\n')[0]);
  return squash ? { number: Number(squash[1]), branch: null } : null;
}

export function unitsForMerge(mergeSha) {
  const [full, parents, mergedAt, subject, ...bodyLines] = git(['show', '-s', '--format=%H%n%P%n%cI%n%s%n%b', mergeSha]).trim().split('\n');
  const [base, head = null] = parents.split(' ');
  const pr = prFromMessage(subject);
  // GitHub merge commit'inde PR başlığı gövdenin ilk boş olmayan satırıdır; squash'ta başlığın kendisi.
  const title = /^Merge pull request #/.test(subject)
    ? (bodyLines.find((line) => line.trim()) ?? '').trim()
    : subject.replace(/\s*\(#\d+\)\s*$/, '');
  const changed = git(['diff', '--name-only', '--diff-filter=AMR', base, full, '--', MIGRATIONS])
    .split('\n').filter((f) => f.endsWith('.sql')).sort();
  const record = {
    pr: pr?.number ?? null,
    branch: pr?.branch ?? null,
    title,
    merge_sha: full,
    base_sha: base,
    head_sha: head,
    merged_at: mergedAt,
    changed_migration_files: changed,
    units: [],
    excluded: { body_unchanged: [], dropped_or_superseded: [] },
    parse_issues: [],
  };
  if (!changed.length) return record;
  const after = effectiveDefinitions(full);
  const before = effectiveDefinitions(base);
  record.parse_issues = after.issues.filter((i) => changed.includes(i.file));
  const touched = new Map();
  for (const file of changed) for (const r of parseRoutines(readAt(full, file)).routines) touched.set(r.identity, r.name);
  for (const identity of [...touched.keys()].sort()) {
    const now = after.defs.get(identity);
    if (!now || !changed.includes(now.path)) { record.excluded.dropped_or_superseded.push(identity); continue; }
    const prev = before.defs.get(identity);
    if (prev && normalizeBody(prev.body) === normalizeBody(now.body)) { record.excluded.body_unchanged.push(identity); continue; }
    const patch = unifiedDiff(prev ? `${prev.statement}\n` : '', `${now.statement}\n`);
    const files = [{ path: now.path, patch }];
    record.units.push({
      unit_id: `PR${record.pr ?? 'x'}:${identity}`,
      path: now.path,
      symbol: identity,
      routine_kind: now.kind,
      change: prev ? 'modified' : 'new',
      previous_path: prev?.path ?? null,
      line: now.line,
      files,
      input_digest: sha(JSON.stringify({ files })),
      added_lines: patch.split('\n').filter((l) => l.startsWith('+')).length,
      removed_lines: patch.split('\n').filter((l) => l.startsWith('-')).length,
      // Referans okuyucu paketi için (Jev girdisi değildir; input_digest yalnız `files` üzerindendir).
      before_definition: prev ? prev.statement : null,
      after_definition: now.statement,
    });
  }
  return record;
}

// Protokol commit'inden sonra main'e ilk ebeveyn hattında giren PR merge'leri, merge sırasıyla.
export function mergesAfter(ref, afterRev) {
  const since = git(['show', '-s', '--format=%cI', afterRev]).trim();
  return git(['log', ref, '--first-parent', '--reverse', `--since=${since}`, '--format=%H%x09%cI%x09%s'])
    .split('\n').filter(Boolean)
    .map((line) => { const [commit, at, subject] = line.split('\t'); return { commit, at, subject }; })
    .filter((c) => Date.parse(c.at) > Date.parse(since) && prFromMessage(c.subject));
}

// §3 stop rule: birim ≥ 150 ve birimli PR ≥ 25 sağlandığı PR'da durulur; o PR'ın bütün birimleri dahildir.
export function collect(ref, afterRev, { stop = false } = {}) {
  const prs = [];
  let units = 0;
  let complete = false;
  for (const merge of mergesAfter(ref, afterRev)) {
    const record = unitsForMerge(merge.commit);
    prs.push(record);
    units += record.units.length;
    const withUnits = prs.filter((p) => p.units.length).length;
    if (units >= STOP.units && withUnits >= STOP.prs) { complete = true; if (stop) break; }
  }
  const order = prs.flatMap((p) => p.units.map((u) => u.unit_id));
  return {
    protocol: 'H19S-PROTOKOL-v0.2 + CLARIFICATIONS-v0.2.1',
    ref,
    after: git(['rev-parse', afterRev]).trim(),
    merged_prs: prs.length,
    prs_with_units: prs.filter((p) => p.units.length).length,
    units,
    stop_rule_met: complete,
    unit_order: order,
    prs,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (name) => {
    const i = process.argv.indexOf(name);
    if (i < 0) return null;
    const value = process.argv[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`${name} değer ister`);
    return value;
  };
  let result;
  if (arg('--merge')) result = unitsForMerge(arg('--merge'));
  else if (arg('--after')) result = collect(arg('--ref') ?? 'origin/main', arg('--after'), { stop: process.argv.includes('--stop') });
  else throw new Error('--merge <sha> ya da --after <protokol-commit> gerekli');
  const text = `${JSON.stringify(result, null, 2)}\n`;
  if (arg('--out')) writeFileSync(arg('--out'), text); else process.stdout.write(text);
  if (tmp) rmSync(tmp, { recursive: true, force: true });
}
