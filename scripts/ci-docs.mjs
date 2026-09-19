import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TASK_ID = /^(?:S\d{2}|F\d{2}-\d{2})$/;
const DEP_ID = /^(?:TEMEL|GS|G(?:09|1[0-7])|S\d{2}|F\d{2}-\d{2})$/;
const STATES = new Set([
  'Planlandı',
  'Üstlenildi',
  'Çalışılıyor',
  'Engelli',
  'İncelemede',
  "Main'de / kabul açık",
  'Tamamlandı',
]);

// Ownership/planning may wait on prerequisites; implementation and acceptance may not.
const PREREQUISITES_REQUIRED = new Set(['Çalışılıyor', 'İncelemede', "Main'de / kabul açık", 'Tamamlandı']);

function trackedFiles(root) {
  const output = execFileSync('git', ['ls-files', '-z'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Set(output.split('\0').filter(Boolean).map((file) => file.replaceAll('\\', '/')));
}

function withoutFences(markdown) {
  let fence;
  return markdown
    .split('\n')
    .map((line) => {
      const marker = line.match(/^\s*(`{3,}|~{3,})/);
      if (marker && !fence) {
        fence = marker[1][0];
        return '';
      }
      if (marker && fence === marker[1][0]) {
        fence = undefined;
        return '';
      }
      return fence ? '' : line;
    })
    .join('\n');
}

function linkDestinations(markdown) {
  const text = withoutFences(markdown);
  const links = [];
  const opener = /!?\[[^\]\n]*\]\(/g;
  for (const match of text.matchAll(opener)) {
    let depth = 1;
    let escaped = false;
    let end = match.index + match[0].length;
    for (; end < text.length && depth; end += 1) {
      const char = text[end];
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '(') depth += 1;
      else if (char === ')') depth -= 1;
      else if (char === '\n') break;
    }
    if (!depth) links.push(text.slice(match.index + match[0].length, end - 1));
  }
  for (const line of text.split('\n')) {
    const definition = line.match(/^ {0,3}\[[^\]]+\]:\s*(<[^>]*>|\S+)/);
    if (definition) links.push(definition[1]);
  }
  return [...new Set(links)];
}

function destinationPath(destination) {
  let value = destination.trim();
  if (value.startsWith('<')) {
    const close = value.indexOf('>');
    if (close < 0) return undefined;
    value = value.slice(1, close);
  } else {
    value = value.split(/\s+["'(]/, 1)[0];
  }
  if (!value || value.startsWith('#') || value.startsWith('//') || /^[a-z][a-z\d+.-]*:/i.test(value)) return undefined;
  value = value.split('#', 1)[0].split('?', 1)[0];
  if (!value) return undefined;
  try {
    return decodeURIComponent(value).replaceAll('\\', '/');
  } catch {
    return null;
  }
}

function firstSymlink(root, relative) {
  let cursor = root;
  for (const component of relative.split('/').filter(Boolean)) {
    cursor = path.join(cursor, component);
    const entry = lstatSync(cursor, { throwIfNoEntry: false });
    if (!entry) return undefined;
    if (entry.isSymbolicLink()) return path.relative(root, cursor).replaceAll('\\', '/');
  }
  return undefined;
}

function checkLinks(root, tracked, errors) {
  const markdownFiles = [...tracked].filter((file) => file.toLowerCase().endsWith('.md'));
  for (const source of markdownFiles) {
    const absoluteSource = path.join(root, source);
    if (!existsSync(absoluteSource)) {
      errors.push(`${source}: tracked Markdown file is missing`);
      continue;
    }
    const sourceSymlink = firstSymlink(root, source);
    if (sourceSymlink) {
      errors.push(`${source}: tracked Markdown source traverses symlink ${sourceSymlink}`);
      continue;
    }
    for (const destination of linkDestinations(readFileSync(absoluteSource, 'utf8'))) {
      const decoded = destinationPath(destination);
      if (decoded === undefined) continue;
      if (decoded === null) {
        errors.push(`${source}: malformed percent-escape in link ${destination}`);
        continue;
      }
      const candidate = path.resolve(decoded.startsWith('/') ? root : path.dirname(absoluteSource), decoded.replace(/^\/+/, ''));
      const relative = path.relative(root, candidate).replaceAll('\\', '/');
      if (relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)) {
        errors.push(`${source}: link escapes repository: ${destination}`);
        continue;
      }
      const symlink = firstSymlink(root, relative);
      if (symlink) {
        errors.push(`${source}: local link traverses symlink ${symlink}: ${destination}`);
        continue;
      }
      const prefix = relative ? `${relative}/` : '';
      const isTracked = tracked.has(relative)
        || (existsSync(candidate) && lstatSync(candidate).isDirectory() && [...tracked].some((file) => file.startsWith(prefix)));
      if (!existsSync(candidate)) errors.push(`${source}: missing local link target ${destination}`);
      else if (!isTracked) errors.push(`${source}: local link target is not tracked: ${destination}`);
    }
  }
}

function tableRows(markdown, heading) {
  const start = markdown.indexOf(heading);
  if (start < 0) return [];
  const section = markdown.slice(start + heading.length).split(/\n##\s/, 1)[0];
  return section.split('\n').filter((line) => /^\s*\|/.test(line)).map((line) => line.trim().slice(1, -1).split('|').map((cell) => cell.trim()));
}

function cellId(cell) {
  return cell.match(/^\[?((?:S\d{2}|F\d{2}-\d{2}|GS|G\d{2}))\]?(?:\([^)]*\))?$/)?.[1];
}

function expectedGates() {
  const gates = new Map([['GS', Array.from({ length: 8 }, (_, index) => `S${String(index + 1).padStart(2, '0')}`)]]);
  const counts = new Map([[9, 5], [10, 6], [11, 4], [12, 5], [13, 4], [14, 5], [15, 4], [16, 8], [17, 5]]);
  for (const [phase, count] of counts) {
    const prefix = `F${String(phase).padStart(2, '0')}`;
    gates.set(`G${String(phase).padStart(2, '0')}`, Array.from({ length: count }, (_, index) => `${prefix}-${String(index + 1).padStart(2, '0')}`));
  }
  return gates;
}

function checkTasks(root, tracked, errors) {
  if (!tracked.has('TASKS.md') || !existsSync(path.join(root, 'TASKS.md'))) {
    errors.push('TASKS.md must exist and be tracked');
    return;
  }
  const tasksSymlink = firstSymlink(root, 'TASKS.md');
  if (tasksSymlink) {
    errors.push(`TASKS.md: tracked Markdown source traverses symlink ${tasksSymlink}`);
    return;
  }
  const markdown = readFileSync(path.join(root, 'TASKS.md'), 'utf8');
  const rows = [...tableRows(markdown, '## Teknik düzeltmeler'), ...tableRows(markdown, '## Korunan MVP işleri')];
  const tasks = new Map();
  for (const cells of rows) {
    const id = cellId(cells[0] ?? '');
    if (!id || !TASK_ID.test(id)) continue;
    if (tasks.has(id)) errors.push(`TASKS.md: duplicate task ${id}`);
    tasks.set(id, { deps: (cells[2] ?? '').split(',').map((dep) => dep.trim()).filter(Boolean), state: cells[3] ?? '' });
  }

  const gates = expectedGates();
  const expectedTasks = new Set([...gates.values()].flat());
  for (const id of tasks.keys()) if (!expectedTasks.has(id)) errors.push(`TASKS.md: unknown task ${id}`);
  for (const id of expectedTasks) if (!tasks.has(id)) errors.push(`TASKS.md: missing task ${id}`);
  for (const [id, task] of tasks) {
    if (!STATES.has(task.state)) errors.push(`TASKS.md: invalid state for ${id}: ${task.state || '(empty)'}`);
    if (!task.deps.length) errors.push(`TASKS.md: ${id} has no dependency`);
    for (const dep of task.deps) {
      if (!DEP_ID.test(dep)) errors.push(`TASKS.md: invalid dependency for ${id}: ${dep}`);
      else if (TASK_ID.test(dep) && !tasks.has(dep)) errors.push(`TASKS.md: ${id} depends on missing task ${dep}`);
      else if (/^G/.test(dep) && !gates.has(dep)) errors.push(`TASKS.md: ${id} depends on missing gate ${dep}`);
    }
  }

  const gateRows = tableRows(markdown, '## Kabul kapıları');
  const gateStates = new Map();
  for (const cells of gateRows) {
    const id = cellId(cells[0] ?? '');
    if (!id) continue;
    if (!gates.has(id)) {
      errors.push(`TASKS.md: unknown gate ${id}`);
      continue;
    }
    if (gateStates.has(id)) errors.push(`TASKS.md: duplicate gate ${id}`);
    const expected = gates.get(id);
    const scope = (cells[1] ?? '').replace(/\.\.\./g, '…');
    const expectedScope = `${expected[0]}…${expected.at(-1)}`;
    if (scope !== expectedScope) errors.push(`TASKS.md: invalid scope for ${id}: expected ${expectedScope}`);
    const state = cells[2] ?? '';
    const closed = /kapalı/i.test(state);
    if (!closed && !/^Açık\b/.test(state)) errors.push(`TASKS.md: invalid gate state for ${id}`);
    gateStates.set(id, closed);
    if (closed) for (const member of expected) if (tasks.get(member)?.state !== 'Tamamlandı') errors.push(`TASKS.md: closed gate ${id} has incomplete member ${member}`);
  }
  for (const id of gates.keys()) if (!gateStates.has(id)) errors.push(`TASKS.md: missing gate ${id}`);

  const graph = new Map([...tasks].map(([id, task]) => [id, task.deps.filter((dep) => TASK_ID.test(dep) || gates.has(dep))]));
  for (const [id, members] of gates) graph.set(id, members);
  const visiting = new Set();
  const visited = new Set();
  function visit(id, trail) {
    if (visiting.has(id)) {
      errors.push(`TASKS.md: dependency cycle ${[...trail.slice(trail.indexOf(id)), id].join(' -> ')}`);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dep of graph.get(id) ?? []) visit(dep, [...trail, id]);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of graph.keys()) visit(id, []);

  for (const [id, task] of tasks) {
    if (!PREREQUISITES_REQUIRED.has(task.state)) continue;
    for (const dep of task.deps) {
      if (TASK_ID.test(dep) && tasks.get(dep)?.state !== 'Tamamlandı') errors.push(`TASKS.md: task ${id} (${task.state}) has incomplete dependency ${dep}`);
      if (gates.has(dep) && gateStates.get(dep) !== true) errors.push(`TASKS.md: task ${id} (${task.state}) depends on open gate ${dep}`);
    }
  }

  // PROJECT_STATE.md is a required legacy tombstone so old historical links do
  // not break, but it must never become a second live status source.
  if (!tracked.has('PROJECT_STATE.md') || !existsSync(path.join(root, 'PROJECT_STATE.md'))) {
    errors.push('PROJECT_STATE.md legacy tombstone must exist and be tracked');
    return;
  }
  const legacy = readFileSync(path.join(root, 'PROJECT_STATE.md'), 'utf8');
  if (!legacy.includes('Bu dosya canlı durum kaynağı değildir')) {
    errors.push('PROJECT_STATE.md is retired; live status belongs only in TASKS.md');
  }
  if (/^##\s+(?:Main|Aktif|Faz|Kabul|Durum)/m.test(legacy) || /^\s*\|.*Durum.*\|/m.test(legacy)) {
    errors.push('PROJECT_STATE.md must remain a tombstone, not a second status tracker');
  }
}

export function validate(root = process.cwd()) {
  const resolvedRoot = path.resolve(root);
  const errors = [];
  let tracked;
  try {
    tracked = trackedFiles(resolvedRoot);
  } catch (error) {
    return [`cannot read tracked files: ${error.message}`];
  }
  checkLinks(resolvedRoot, tracked, errors);
  checkTasks(resolvedRoot, tracked, errors);
  return [...new Set(errors)].sort();
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const errors = validate();
  if (errors.length) {
    console.error(errors.map((error) => `- ${error}`).join('\n'));
    process.exitCode = 1;
  } else {
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'complete=true\n');
    console.log('Documentation checks passed.');
  }
}
