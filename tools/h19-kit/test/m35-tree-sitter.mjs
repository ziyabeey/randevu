import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  createNodeTreeSitterParser,
  createTreeSitterRuntime,
  loadTreeSitterGrammar,
} from '../src/adapters/tree-sitter.mjs';
import {
  extractTreeSitterUnits,
  extractTreeSitterUnitsFromTree,
} from '../src/extractors/tree-sitter-units.mjs';
import { GO_TREE_SITTER_PROFILE } from '../src/extractors/tree-sitter-profiles.mjs';
import { repositoryInventory } from '../src/repository/inventory.mjs';

function node(type, startIndex, endIndex, {
  fields = {},
  children = [],
  row = 0,
  endRow = row,
  hasError = false,
} = {}) {
  return {
    type,
    startIndex,
    endIndex,
    startPosition: { row, column: 0 },
    endPosition: { row: endRow, column: Math.max(0, endIndex - startIndex) },
    namedChildren: children,
    childForFieldName(name) {
      return fields[name] ?? null;
    },
    hasError() {
      return hasError;
    },
  };
}

const source = 'func Add() { return 1 }\n';
const nameStart = source.indexOf('Add');
const bodyStart = source.indexOf('{');
const nameNode = node('identifier', nameStart, nameStart + 3);
const bodyNode = node('block', bodyStart, source.length - 1);
const fnNode = node('function_declaration', 0, source.length - 1, {
  fields: { name: nameNode, body: bodyNode },
  children: [nameNode, bodyNode],
});
const tree = {
  rootNode: node('source_file', 0, source.length, {
    children: [fnNode],
  }),
};

const units = extractTreeSitterUnitsFromTree(tree, source, {
  path: 'main.go',
  profile: GO_TREE_SITTER_PROFILE,
});
assert.equal(units.length, 1);
assert.equal(units[0].symbol, 'Add');
assert.equal(units[0].language, 'go');
assert.equal(units[0].parser, 'tree-sitter');
assert.equal(units[0].body, '{ return 1 }');

const runtime = { parse: () => tree };
assert.equal(extractTreeSitterUnits(source, {
  path: 'main.go',
  profile: GO_TREE_SITTER_PROFILE,
  runtime,
}).length, 1);

assert.throws(
  () => extractTreeSitterUnitsFromTree({
    rootNode: node('source_file', 0, source.length, { hasError: true }),
  }, source, {
    path: 'broken.go',
    profile: GO_TREE_SITTER_PROFILE,
  }),
  /parse error/,
);

const language = { abi: 'fake' };
class FakeParser {
  setLanguage(value) {
    this.language = value;
  }
  parse() {
    return tree;
  }
}
const imports = async (name) => {
  if (name === 'tree-sitter') return { default: FakeParser };
  if (name === 'tree-sitter-go') return { default: language };
  throw new Error(`unexpected module: ${name}`);
};
assert.equal(await loadTreeSitterGrammar({
  moduleName: 'tree-sitter-go',
  importModule: imports,
}), language);
const nodeRuntime = await createNodeTreeSitterParser({
  language,
  importModule: imports,
});
assert.equal(nodeRuntime.parse(source).rootNode.type, 'source_file');
const composed = await createTreeSitterRuntime({
  grammarModule: 'tree-sitter-go',
  importModule: imports,
});
assert.equal(composed.parse(source).rootNode.type, 'source_file');

const temp = await mkdtemp(path.join(os.tmpdir(), 'h19-tree-sitter-'));
try {
  await mkdir(path.join(temp, 'cmd'), { recursive: true });
  await writeFile(path.join(temp, 'cmd', 'main.go'), source);

  const inventory = await repositoryInventory(temp, {
    treeSitterFallbacks: {
      '.go': {
        profile: GO_TREE_SITTER_PROFILE,
        runtime,
      },
    },
  });
  assert.equal(inventory.filesScanned, 1);
  assert.equal(inventory.errors.length, 0);
  assert.equal(inventory.units.length, 1);
  assert.equal(inventory.units[0].path, 'cmd/main.go');

  const brokenInventory = await repositoryInventory(temp, {
    treeSitterFallbacks: {
      '.go': {
        profile: GO_TREE_SITTER_PROFILE,
        runtime: {
          parse: () => ({
            rootNode: node('source_file', 0, source.length, { hasError: true }),
          }),
        },
      },
    },
  });
  assert.equal(brokenInventory.units.length, 0);
  assert.equal(brokenInventory.errors.length, 1);
  assert.match(brokenInventory.errors[0].error, /parse error/);
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log('h19-kit M3.5 Tree-sitter fallback smoke: ok');
