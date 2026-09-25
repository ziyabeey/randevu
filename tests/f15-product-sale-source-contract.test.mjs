import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

test('F15-02 activates product sale while preserving accepted expense scope', () => {
  const kolay=readFileSync(path.join(root,'src/kolayapp/KolayAppSurface.tsx'),'utf8');
  assert.match(kolay,/ActionLink href="\/app\/mobile\/tickets\?newProductSale=1" title="Yeni ürün satışı"/);
  // F16-08 opens "Yeni paket satışı"; its pin lives in f16-account-language-contract.
  assert.match(kolay,/ActionLink href="\/app\/expenses" title="Yeni masraf"/);
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
