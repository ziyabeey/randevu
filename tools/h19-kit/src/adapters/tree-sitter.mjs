function moduleValue(mod, exportName = null) {
  if (exportName) {
    const direct = mod?.[exportName] ?? mod?.default?.[exportName];
    if (!direct) throw new Error(`tree-sitter grammar export not found: ${exportName}`);
    return direct;
  }
  return mod?.language ?? mod?.default?.language ?? mod?.default ?? mod;
}

export async function loadTreeSitterGrammar({
  moduleName,
  exportName = null,
  importModule = (name) => import(name),
} = {}) {
  if (!moduleName) throw new TypeError('tree-sitter grammar moduleName required');
  const mod = await importModule(moduleName);
  const language = moduleValue(mod, exportName);
  if (!language) throw new Error(`tree-sitter grammar module has no language export: ${moduleName}`);
  return language;
}

export async function createNodeTreeSitterParser({
  language,
  parserModule = 'tree-sitter',
  importModule = (name) => import(name),
} = {}) {
  if (!language) throw new TypeError('tree-sitter language required');

  const mod = await importModule(parserModule);
  const Parser = mod?.default ?? mod?.Parser ?? mod;
  if (typeof Parser !== 'function') throw new Error(`invalid tree-sitter parser module: ${parserModule}`);

  const parser = new Parser();
  if (typeof parser.setLanguage !== 'function' || typeof parser.parse !== 'function') {
    throw new Error('tree-sitter parser module does not expose setLanguage()/parse()');
  }

  parser.setLanguage(language);

  return Object.freeze({
    id: 'node-tree-sitter',
    parse(text, oldTree = null) {
      const tree = parser.parse(String(text), oldTree);
      if (!tree?.rootNode) throw new Error('tree-sitter parser returned no rootNode');
      return tree;
    },
    parser,
  });
}

export async function createTreeSitterRuntime({
  grammarModule,
  grammarExport = null,
  parserModule = 'tree-sitter',
  importModule = (name) => import(name),
} = {}) {
  const language = await loadTreeSitterGrammar({
    moduleName: grammarModule,
    exportName: grammarExport,
    importModule,
  });
  return createNodeTreeSitterParser({ language, parserModule, importModule });
}
