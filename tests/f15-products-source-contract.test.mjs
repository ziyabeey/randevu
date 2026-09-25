import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('F15-01 exposes stock setup; product sale activation is owned by F15-02', () => {
  const kolay = readFileSync(path.join(root, 'src/kolayapp/KolayAppSurface.tsx'), 'utf8');
  const routes = readFileSync(path.join(root, 'src/workspace-route.ts'), 'utf8');
  const shell = readFileSync(path.join(root, 'src/WorkspaceShell.tsx'), 'utf8');

  // F15-02 activates "Yeni ürün satışı"; its pin lives in f15-product-sale-source-contract.
  assert.match(kolay, /ActionLink href="\/app\/products" title="Ürün ve stok"/);
  assert.match(routes, /'\/app\/products': 'products'/);
  assert.match(shell, /lazy\(\(\) => import\('\.\/ProductsPage'\)\)/);
});

test('F15-01 persists only bounded exact product write contracts on ambiguity', () => {
  const source = readFileSync(path.join(root, 'src/ProductsPage.tsx'), 'utf8');

  assert.match(source, /randevu:products:pending-write:v1/);
  assert.match(source, /value\.path\.startsWith\('\/api\/products'\)/);
  assert.match(source, /!\['POST', 'PUT'\]\.includes\(value\.method\)/);
  assert.match(source, /idempotencyKey/);
  assert.match(source, /writePendingProductWrite\(identity\)/);
  assert.match(source, /Kayıtlı isteği doğrula/);
  assert.match(source, /pendingWrite\.businessId === activeBusinessId/);
  assert.match(source, /key=\{\`edit-\$\{selected\.productId\}-\$\{selected\.version\}\`\}/);
});
