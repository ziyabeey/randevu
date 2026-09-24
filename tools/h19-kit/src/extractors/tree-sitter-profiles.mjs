export const GO_TREE_SITTER_PROFILE = Object.freeze({
  id: 'tree-sitter-go-v1',
  language: 'go',
  containers: {},
  units: {
    function_declaration: {
      kind: 'function',
      nameFields: ['name'],
      bodyFields: ['body'],
    },
    method_declaration: {
      kind: 'method',
      nameFields: ['name'],
      bodyFields: ['body'],
    },
  },
});

export const RUST_TREE_SITTER_PROFILE = Object.freeze({
  id: 'tree-sitter-rust-v1',
  language: 'rust',
  containers: {
    impl_item: {
      nameFields: ['type'],
    },
    trait_item: {
      nameFields: ['name'],
    },
  },
  units: {
    function_item: {
      kind: 'function',
      nameFields: ['name'],
      bodyFields: ['body'],
    },
    closure_expression: {
      kind: 'closure',
      allowAnonymous: true,
      anonymousName: '<closure>',
      bodyFields: ['body'],
    },
  },
});

export const CPP_TREE_SITTER_PROFILE = Object.freeze({
  id: 'tree-sitter-cpp-v1',
  language: 'cpp',
  containers: {
    class_specifier: { nameFields: ['name'] },
    struct_specifier: { nameFields: ['name'] },
    namespace_definition: { nameFields: ['name'] },
  },
  units: {
    function_definition: {
      kind: 'function',
      nameFields: [],
      bodyFields: ['body'],
      name(node, text) {
        const declarator = node.childForFieldName?.('declarator');
        if (!declarator) return '';
        const raw = text.slice(declarator.startIndex, declarator.endIndex);
        const match = raw.match(/(?:^|::)([~\w]+)\s*\(/);
        return match?.[1] ?? raw.replace(/\s*\(.*$/s, '').trim();
      },
    },
  },
});

export const DEFAULT_TREE_SITTER_PROFILES = Object.freeze({
  '.go': GO_TREE_SITTER_PROFILE,
  '.rs': RUST_TREE_SITTER_PROFILE,
  '.cc': CPP_TREE_SITTER_PROFILE,
  '.cpp': CPP_TREE_SITTER_PROFILE,
  '.cxx': CPP_TREE_SITTER_PROFILE,
  '.hpp': CPP_TREE_SITTER_PROFILE,
  '.hh': CPP_TREE_SITTER_PROFILE,
});
