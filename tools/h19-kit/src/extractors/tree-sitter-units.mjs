import { createHash } from 'node:crypto';

const sha = (text) => createHash('sha256').update(String(text)).digest('hex');

function namedChildren(node) {
  if (Array.isArray(node?.namedChildren)) return node.namedChildren;
  if (Number.isInteger(node?.namedChildCount) && typeof node.namedChild === 'function') {
    const out = [];
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child) out.push(child);
    }
    return out;
  }
  return [];
}

function childForField(node, fields = []) {
  if (typeof node?.childForFieldName !== 'function') return null;
  for (const field of fields) {
    const child = node.childForFieldName(field);
    if (child) return child;
  }
  return null;
}

function sliceNode(text, node) {
  if (!Number.isInteger(node?.startIndex) || !Number.isInteger(node?.endIndex)) return '';
  return text.slice(node.startIndex, node.endIndex);
}

function nodeName(node, text, spec = {}) {
  const named = childForField(node, spec.nameFields ?? ['name']);
  if (named) return sliceNode(text, named).trim();
  if (typeof spec.name === 'function') return String(spec.name(node, text) ?? '').trim();
  return '';
}

function nodeBody(node, text, spec = {}) {
  const body = childForField(node, spec.bodyFields ?? ['body']);
  return body ? sliceNode(text, body) : sliceNode(text, node);
}

function profileSpec(profile, node) {
  return profile?.units?.[node?.type] ?? null;
}

function containerSpec(profile, node) {
  return profile?.containers?.[node?.type] ?? null;
}

export function validateTreeSitterProfile(profile) {
  if (!profile?.id || !profile?.language || !profile?.units || typeof profile.units !== 'object') {
    throw new TypeError('tree-sitter profile requires id, language and units');
  }
  return profile;
}

export function extractTreeSitterUnitsFromTree(tree, text, {
  path = 'unknown',
  profile,
  failOnParseError = true,
} = {}) {
  validateTreeSitterProfile(profile);
  const root = tree?.rootNode;
  if (!root) throw new TypeError('tree/rootNode required');

  const hasError = typeof root.hasError === 'function' ? root.hasError() : Boolean(root.hasError);
  if (failOnParseError && hasError) {
    throw new Error(`tree-sitter parse error in ${path}`);
  }

  const units = [];

  const visit = (node, containers) => {
    const cSpec = containerSpec(profile, node);
    let nextContainers = containers;
    if (cSpec) {
      const name = nodeName(node, text, cSpec);
      if (name) nextContainers = [...containers, name];
    }

    const spec = profileSpec(profile, node);
    if (spec) {
      const ownName = nodeName(node, text, spec);
      if (ownName || spec.allowAnonymous) {
        const fallback = spec.anonymousName ?? '<anonymous>';
        const name = ownName || fallback;
        const symbol = [...nextContainers, name].filter(Boolean).join('.') || fallback;
        const definition = sliceNode(text, node);
        const startLine = (node.startPosition?.row ?? 0) + 1;
        const endLine = (node.endPosition?.row ?? node.startPosition?.row ?? 0) + 1;

        units.push(Object.freeze({
          id: `${path}::${symbol}@${startLine}`,
          language: profile.language,
          kind: spec.kind ?? node.type,
          parser: 'tree-sitter',
          profile: profile.id,
          path,
          symbol,
          startLine,
          endLine,
          startOffset: node.startIndex ?? null,
          endOffset: node.endIndex ?? null,
          body: nodeBody(node, text, spec),
          definition,
          digest: sha(definition),
        }));
      }
    }

    for (const child of namedChildren(node)) visit(child, nextContainers);
  };

  visit(root, []);
  return units.sort((a, b) => (a.startOffset ?? 0) - (b.startOffset ?? 0));
}

export function extractTreeSitterUnits(text, {
  path = 'unknown',
  profile,
  runtime,
  failOnParseError = true,
} = {}) {
  if (!runtime?.parse) throw new TypeError('tree-sitter runtime with parse(text) required');
  const tree = runtime.parse(text);
  return extractTreeSitterUnitsFromTree(tree, String(text), {
    path,
    profile,
    failOnParseError,
  });
}
