import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { loadConfig } from '../src/config.js';
import { WooCommerceApi } from '../src/woocommerce.js';

const config = loadConfig();
const api = new WooCommerceApi(config);
const client = new Client({ name: 'store-integration-check', version: '1.0.0' });
const endpoint = process.env.MCP_TEST_URL ?? 'http://urumi-woocommerce-mcp:3000/mcp';
const headers = { Authorization: `Bearer ${config.MCP_BEARER_TOKEN}` };
async function call(name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  assert(!result.isError, `Tool ${name} failed: ${JSON.stringify(result.content)}`);
  return result.structuredContent as Record<string, any>;
}
let productId: number | undefined;
let originalOrder: { id: number; status: string } | undefined;
try {
  // A new pod's policy and Service routing can take a moment to converge.
  // Retry only this read-only health check, never a product/order write.
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(new URL('/healthz', endpoint), { signal: AbortSignal.timeout(2000) });
      assert.equal(response.status, 200); break;
    } catch (error) {
      if (attempt === 19) throw error;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  assert.equal((await fetch(endpoint, { method: 'POST', body: '{}' })).status, 401);
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint), { requestInit: { headers } }));
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 5);
  console.log('PASS: MCP initialization and five-tool discovery; missing token rejected.');
  const created = await call('create_product', { name: 'MCP Integration Notebook', price: '249.00',
    sku: 'MCP-CHECK-' + Date.now(), virtual: true });
  productId = created.product.id;
  assert.equal(created.product.status, 'publish');
  const listed = await call('list_products', { sku: created.product.sku });
  assert.equal(listed.products[0].id, productId);
  // The public Store API proves the product is actually available to storefront users.
  const publicResult = await fetch(`${config.WOO_BASE_URL}/wp-json/wc/store/v1/products/${productId}`);
  assert.equal(publicResult.status, 200);
  console.log(`PASS: product #${productId} created, discovered, and visible through the storefront API.`);
  const orders = await call('list_orders', { per_page: 1 });
  assert(orders.orders.length, 'Place a test order in the storefront before running this check.');
  originalOrder = { id: orders.orders[0].id, status: orders.orders[0].status };
  const order = await call('get_order', { order_id: originalOrder.id });
  assert.equal(order.order.id, originalOrder.id);
  const createdAt = Date.parse(order.order.date_created_gmt + 'Z');
  assert(Number.isFinite(createdAt));
  const matchingDates = await call('list_orders', {
    after: new Date(createdAt - 1000).toISOString(), before: new Date(createdAt + 1000).toISOString(),
  });
  assert(matchingDates.orders.some((entry: { id: number }) => entry.id === originalOrder!.id));
  const laterDates = await call('list_orders', {
    after: new Date(createdAt + 86400000).toISOString(), before: new Date(createdAt + 172800000).toISOString(),
  });
  assert(!laterDates.orders.some((entry: { id: number }) => entry.id === originalOrder!.id));
  const target = originalOrder.status === 'on-hold' ? 'processing' : 'on-hold';
  const changed = await call('update_order_status', { order_id: originalOrder.id, status: target });
  assert.equal(changed.order.status, target);
  const restored = await call('update_order_status', { order_id: originalOrder.id, status: originalOrder.status });
  assert.equal(restored.order.status, originalOrder.status);
  const today = await call('list_orders', { period: 'today' });
  assert.equal(today.timezone, config.STORE_TIMEZONE);
  console.log(`PASS: order #${originalOrder.id} retrieved, updated, and restored; today's order query works.`);
  const invalid = await client.callTool({ name: 'create_product', arguments: { name: 'Invalid', price: '-1' } });
  assert(invalid.isError);
  const missing = await client.callTool({ name: 'get_order', arguments: { order_id: 2147483647 } });
  assert(missing.isError);
  console.log('PASS: invalid inputs and missing orders return tool errors.');
} finally {
  if (originalOrder) await api.request('PUT', `orders/${originalOrder.id}`, {}, { status: originalOrder.status });
  if (productId) await api.request('DELETE', `products/${productId}`, { force: 'true' });
  await client.close();
  console.log('Test product removed; original order status restored.');
}
