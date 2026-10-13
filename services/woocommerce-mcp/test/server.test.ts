import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest, type Server } from 'node:http';
import express from 'express';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { DateTime } from 'luxon';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { todayRange } from '../src/tools.js';

async function url(server: Server) {
  if (!server.listening) await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}
const stop = (server: Server) => { server.closeAllConnections(); server.close(); };

test('store-day boundaries include the right UTC range and daylight-saving changes', () => {
  assert.deepEqual(todayRange('Asia/Kolkata', DateTime.fromISO('2026-10-12T01:00:00Z')), {
    after: '2026-10-11T18:30:00', before: '2026-10-12T18:29:59',
  });
  const dst = todayRange('America/New_York', DateTime.fromISO('2026-03-08T12:00:00Z'));
  assert.equal(dst.after, '2026-03-08T05:00:00');
  assert.equal(dst.before, '2026-03-09T03:59:59');
});

test('real MCP protocol: discovery, validation, authorization, failures, and recovery', async t => {
  const store = express(); store.use(express.json());
  let mode: 'ok' | 'failure' | 'slow' = 'ok';
  let calls = 0;
  store.get('/wp-json/wc/v3/products', async (req, res) => {
    calls++;
    assert(req.headers.authorization?.startsWith('OAuth '));
    assert(!req.headers.authorization?.includes('cs_'));
    if (mode === 'failure') { res.status(500).json({ message: 'PRIVATE-UPSTREAM-CONTENT' }); return; }
    if (mode === 'slow') await new Promise(resolve => setTimeout(resolve, 400));
    res.set('X-WP-Total', '1').set('X-WP-TotalPages', '1').json([{ id: 1, name: 'Notebook' }]);
  });
  store.get('/wp-json/wc/v3/orders/:id', (_req, res) => { res.status(404).json({ message: 'not found' }); });
  const storeListener = store.listen(0, '127.0.0.1');
  t.after(() => stop(storeListener));
  const config = loadConfig({ WOO_BASE_URL: await url(storeListener), WOO_PUBLIC_URL: 'http://store.example.test',
    WOO_CONSUMER_KEY: 'ck_' + 'a'.repeat(40), WOO_CONSUMER_SECRET: 'cs_' + 'b'.repeat(40),
    MCP_BEARER_TOKEN: 'test-only-token-'.repeat(4), WOO_TIMEOUT_MS: '100' });
  const listener = createApp(config).listen(0, '127.0.0.1');
  t.after(() => stop(listener));
  const endpoint = new URL('/mcp', await url(listener));
  assert.equal((await fetch(endpoint, { method: 'POST', body: '{}' })).status, 401);
  assert.equal((await fetch(endpoint, { method: 'POST', headers: { Authorization: 'Bearer wrong' } })).status, 401);
  assert.equal((await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${config.MCP_BEARER_TOKEN}`, Origin: 'https://untrusted.example' } })).status, 403);
  // Node fetch replaces Host; a raw HTTP request actually exercises this boundary.
  const badHostStatus = await new Promise<number | undefined>((resolve, reject) => {
    const request = httpRequest(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${config.MCP_BEARER_TOKEN}`, Host: 'untrusted.example' } }, response => {
      response.resume(); resolve(response.statusCode);
    });
    request.on('error', reject); request.end();
  });
  assert.equal(badHostStatus, 403);
  const client = new Client({ name: 'integration-test', version: '1.0.0' });
  t.after(() => client.close());
  await client.connect(new StreamableHTTPClientTransport(endpoint, {
    requestInit: { headers: { Authorization: `Bearer ${config.MCP_BEARER_TOKEN}` } },
  }));
  const listed = await client.listTools();
  assert.deepEqual(listed.tools.map(x => x.name).sort(), ['create_product', 'get_order', 'list_orders', 'list_products', 'update_order_status']);
  let result = await client.callTool({ name: 'list_products', arguments: { search: 'Notebook & pen' } });
  assert(!result.isError); assert.equal((result.structuredContent as { pagination: { total: number } }).pagination.total, 1);
  const before = calls;
  result = await client.callTool({ name: 'create_product', arguments: { name: 'Bad', price: '-1' } });
  assert(result.isError); assert.equal(calls, before);
  result = await client.callTool({ name: 'list_orders', arguments: { period: 'today', after: '2026-10-12T00:00:00Z' } });
  assert(result.isError); assert(JSON.stringify(result).includes('INVALID_DATE_RANGE'));
  result = await client.callTool({ name: 'get_order', arguments: { order_id: 999 } });
  assert(result.isError); assert(JSON.stringify(result).includes('404'));
  mode = 'failure';
  result = await client.callTool({ name: 'list_products', arguments: {} });
  assert(result.isError); assert(!JSON.stringify(result).includes('PRIVATE-UPSTREAM-CONTENT'));
  mode = 'slow';
  result = await client.callTool({ name: 'list_products', arguments: {} });
  assert(result.isError); assert(JSON.stringify(result).includes('STORE_TIMEOUT'));
  mode = 'ok';
  result = await client.callTool({ name: 'list_products', arguments: {} });
  assert(!result.isError);
});
