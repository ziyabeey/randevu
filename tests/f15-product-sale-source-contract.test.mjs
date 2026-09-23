import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

test('F15-02 activates product sale while preserving accepted expense scope and keeping package sale closed', () => {
  const kolay=readFileSync(path.join(root,'src/kolayapp/KolayAppSurface.tsx'),'utf8');
  assert.match(kolay,/AppLink href="\/app\/mobile\/tickets\?newProductSale=1"><strong>Yeni ürün satışı<\/strong>/);
  assert.match(kolay,/DisabledAction title="Yeni paket satışı"/);
  assert.match(kolay,/AppLink href="\/app\/expenses"><strong>Yeni masraf<\/strong>/);
});

test('F15-02 keeps financial refund and physical stock return explicit', () => {
  const page=readFileSync(path.join(root,'src/kolayapp/TicketCashierPage.tsx'),'utf8');
  const worker=readFileSync(path.join(root,'worker/tickets.ts'),'utf8');

  assert.match(page,/name="returnToStock" type="checkbox"/);
  assert.match(page,/Finansal iade kaydedildi; ürün stoğa geri alınmadı/);
  assert.match(page,/Ürün iadesi ve stoğa geri dönüş birlikte doğrulandı/);
  assert.match(worker,/p_return_to_stock: body\.returnToStock/);
  assert.match(worker,/record_product_return_refund_guarded/);
  assert.match(worker,/open_product_sale_guarded/);
  assert.match(worker,/add_ticket_product_line_guarded/);
});
