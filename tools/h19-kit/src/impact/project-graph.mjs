function normalizePath(value) {
  return String(value ?? '').replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '');
}

export function projectGraph({ projects = [], dependencies = [] } = {}) {
  const normalizedProjects = projects.map((p) => ({
    id: String(p.id),
    root: normalizePath(p.root),
    metadata: structuredClone(p.metadata ?? {}),
  })).sort((a, b) => a.id.localeCompare(b.id));

  const ids = new Set(normalizedProjects.map((p) => p.id));
  const normalizedDeps = dependencies
    .filter((d) => ids.has(String(d.source)) && ids.has(String(d.target)))
    .map((d) => ({ source: String(d.source), target: String(d.target), type: d.type ?? 'static' }))
    .sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target));

  return Object.freeze({
    projects: Object.freeze(normalizedProjects),
    dependencies: Object.freeze(normalizedDeps),
  });
}

export function projectForFile(graph, file) {
  const target = normalizePath(file);
  const candidates = graph.projects
    .filter((p) => p.root === '' || target === p.root || target.startsWith(`${p.root}/`))
    .sort((a, b) => b.root.length - a.root.length || a.id.localeCompare(b.id));
  return candidates[0] ?? null;
}

export function reverseDependents(graph, projectIds, { includeSeeds = true } = {}) {
  const selected = new Set(includeSeeds ? projectIds : []);
  const queue = [...projectIds];
  const reverse = new Map();

  for (const dep of graph.dependencies) {
    if (!reverse.has(dep.target)) reverse.set(dep.target, new Set());
    reverse.get(dep.target).add(dep.source);
  }

  while (queue.length) {
    const current = queue.shift();
    for (const dependent of reverse.get(current) ?? []) {
      if (selected.has(dependent)) continue;
      selected.add(dependent);
      queue.push(dependent);
    }
  }

  return [...selected].sort();
}

export function affectedProjects(graph, changedFiles = []) {
  const touched = new Set();
  const unownedFiles = [];

  for (const file of changedFiles) {
    const project = projectForFile(graph, file);
    if (project) touched.add(project.id);
    else unownedFiles.push(normalizePath(file));
  }

  const affected = reverseDependents(graph, [...touched]);
  return Object.freeze({
    touched: [...touched].sort(),
    affected,
    unownedFiles: unownedFiles.sort(),
  });
}
