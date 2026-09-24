import * as tsModule from 'typescript';
import { createHash } from 'node:crypto';

// TypeScript 7's Node ESM interop exposes the API under `default` in this runtime.
// Older TypeScript releases expose the namespace directly. Normalize both shapes.
const ts = tsModule.default ?? tsModule;

const sha = (text) => createHash('sha256').update(String(text)).digest('hex');

function nameOf(node, sourceFile) {
  if (node.name?.getText) return node.name.getText(sourceFile);
  if (ts.isVariableDeclaration(node.parent) && node.parent.name?.getText) {
    return node.parent.name.getText(sourceFile);
  }
  if (ts.isPropertyAssignment(node.parent) && node.parent.name?.getText) {
    return node.parent.name.getText(sourceFile);
  }
  return '<anonymous>';
}

function containerOf(node, sourceFile) {
  const names = [];
  let cur = node.parent;
  while (cur) {
    if (ts.isClassDeclaration(cur) || ts.isClassExpression(cur)) {
      if (cur.name) names.unshift(cur.name.getText(sourceFile));
    } else if (ts.isFunctionDeclaration(cur) || ts.isMethodDeclaration(cur)) {
      if (cur.name) names.unshift(cur.name.getText(sourceFile));
    }
    cur = cur.parent;
  }
  return names;
}

function isUnit(node) {
  return ts.isFunctionDeclaration(node)
    || ts.isMethodDeclaration(node)
    || ts.isGetAccessorDeclaration(node)
    || ts.isSetAccessorDeclaration(node)
    || ts.isConstructorDeclaration(node)
    || ts.isArrowFunction(node)
    || ts.isFunctionExpression(node);
}

export function extractTypeScriptUnits(text, {
  path = 'unknown.ts',
  scriptKind = null,
} = {}) {
  const kind = scriptKind ?? (
    path.endsWith('.tsx') ? ts.ScriptKind.TSX
      : path.endsWith('.jsx') ? ts.ScriptKind.JSX
        : path.endsWith('.js') || path.endsWith('.mjs') || path.endsWith('.cjs') ? ts.ScriptKind.JS
          : ts.ScriptKind.TS
  );
  const sourceFile = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
  const units = [];

  const visit = (node) => {
    if (isUnit(node) && node.body) {
      const baseName = ts.isConstructorDeclaration(node) ? 'constructor' : nameOf(node, sourceFile);
      const container = containerOf(node, sourceFile);
      const symbol = [...container, baseName].filter(Boolean).join('.') || '<anonymous>';
      const start = node.getStart(sourceFile);
      const end = node.getEnd();
      const bodyStart = node.body.getStart(sourceFile);
      const bodyEnd = node.body.getEnd();
      const definition = text.slice(start, end);
      const body = text.slice(bodyStart, bodyEnd);
      const startPos = sourceFile.getLineAndCharacterOfPosition(start);
      const endPos = sourceFile.getLineAndCharacterOfPosition(end);

      units.push(Object.freeze({
        id: `${path}::${symbol}@${startPos.line + 1}`,
        language: path.match(/tsx?$/) ? 'typescript' : 'javascript',
        kind: ts.SyntaxKind[node.kind],
        path,
        symbol,
        startLine: startPos.line + 1,
        endLine: endPos.line + 1,
        startOffset: start,
        endOffset: end,
        body,
        definition,
        digest: sha(definition),
      }));
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return units.sort((a, b) => a.startOffset - b.startOffset);
}
