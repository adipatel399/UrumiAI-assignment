import test from 'node:test';
import assert from 'node:assert/strict';
import { modelToolData } from '../src/chat.js';

test('model store projection retains business facts without customer and plugin payloads', () => {
  const input = {
    orders: [
      {
        id: 18,
        total: '249.00',
        billing: { email: 'private@example.test' },
        order_key: 'private-order-key',
        meta_data: [{ value: 'private-plugin-data' }],
        line_items: [
          {
            product_id: 17,
            name: 'Notebook',
            quantity: 1,
            total: '249.00',
            meta_data: [{ value: 'private-line-data' }],
          },
        ],
        _links: { internal: 'unused' },
      },
    ],
    pagination: { page: 1 },
  };
  const output = modelToolData('store__list_orders', input) as any;
  assert.equal(output.orders[0].id, 18);
  assert.equal(output.orders[0].line_items[0].product_id, 17);
  assert.equal(output.pagination.page, 1);
  assert(!JSON.stringify(output).includes('private'));
  assert(!JSON.stringify(output).includes('_links'));
  assert.deepEqual(modelToolData('inventory__get_stock', { stock: { available: 25 } }), {
    stock: { available: 25 },
  });
});
