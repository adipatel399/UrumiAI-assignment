import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { token } from '../src/security.js';
const base = process.env.GATEWAY_TEST_URL ?? 'http://gateway.localhost:8080';
const path = '.local/gateway-demo.json';
const credentials = JSON.parse(await readFile('.local/platform-credentials.json', 'utf8'));
const stage = process.env.CHECK_STAGE ?? 'baseline';
let saved: any;
try {
  saved = JSON.parse(await readFile(path, 'utf8'));
} catch {
  saved = { memberEmail: 'member@example.test', memberPassword: token() };
}
async function api(
  route: string,
  method = 'GET',
  body?: unknown,
  auth?: { cookie: string; csrf: string } | string,
) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (typeof auth === 'string') headers.Authorization = 'Bearer ' + auth;
  else if (auth) {
    headers.Cookie = auth.cookie;
    headers['x-csrf-token'] = auth.csrf;
  }
  const r = await fetch(base + route, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  });
  return {
    status: r.status,
    body: r.status === 204 ? {} : await r.json(),
    cookie: r.headers.get('set-cookie')?.split(';')[0] ?? '',
  };
}
const login = await api('/api/login', 'POST', {
  email: credentials.BOOTSTRAP_EMAIL,
  password: credentials.BOOTSTRAP_PASSWORD,
});
assert.equal(login.status, 200);
const admin = { cookie: login.cookie, csrf: login.body.csrf_token };
await api('/api/servers/refresh', 'POST', {}, admin);
const servers = await api('/api/servers', 'GET', undefined, admin);
assert.equal(servers.status, 200);
assert(!JSON.stringify(servers.body).includes(credentials.SUPPORT_MCP_TOKEN));
async function client(key: string) {
  const c = new Client({ name: 'cluster-verification', version: '1.0.0' });
  await c.connect(
    new StreamableHTTPClientTransport(new URL(base + '/mcp'), {
      requestInit: { headers: { Authorization: 'Bearer ' + key } },
    }),
  );
  return c;
}
if (stage === 'baseline') {
  assert.equal(servers.body.servers.length, 3);
  assert(servers.body.servers.every((s: any) => s.status === 'Connected'));
  const createdA = await api('/api/keys', 'POST', { name: 'Local verification admin' }, admin);
  assert.equal(createdA.status, 201);
  saved.adminKey = createdA.body.key.token;
  saved.adminKeyId = createdA.body.key.id;
  const members = await api('/api/members', 'GET', undefined, admin);
  if (!members.body.members.some((m: any) => m.email === saved.memberEmail)) {
    const invitation = await api('/api/invitations', 'POST', { email: saved.memberEmail }, admin);
    assert.equal(invitation.status, 201);
    const accepted = await api('/api/invitations/accept', 'POST', {
      token: invitation.body.invitation.token,
      password: saved.memberPassword,
    });
    assert.equal(accepted.status, 201);
    assert.equal(
      (
        await api('/api/invitations/accept', 'POST', {
          token: invitation.body.invitation.token,
          password: saved.memberPassword,
        })
      ).status,
      400,
    );
  }
  const loginB = await api('/api/login', 'POST', {
    email: saved.memberEmail,
    password: saved.memberPassword,
  });
  assert.equal(loginB.status, 200);
  const member = { cookie: loginB.cookie, csrf: loginB.body.csrf_token };
  const keyB = await api('/api/keys', 'POST', { name: 'Local verification member' }, member);
  assert.equal(keyB.status, 201);
  saved.revokedMemberKey = keyB.body.key.token;
  const a = await client(saved.adminKey);
  const b = await client(saved.revokedMemberKey);
  try {
    const toolsA = (await a.listTools()).tools.map((x) => x.name);
    const toolsB = (await b.listTools()).tools.map((x) => x.name);
    assert.equal(toolsA.length, 8);
    assert.equal(toolsB.length, 6);
    assert(toolsA.includes('inventory__search') && toolsA.includes('knowledge__search'));
    assert(
      !toolsB.includes('store__create_product') && !toolsB.includes('store__update_order_status'),
    );
    assert(
      (
        await b.callTool({
          name: 'store__create_product',
          arguments: { name: 'Forbidden product', price: '1' },
        })
      ).isError,
    );
    const existing = await a.callTool({
      name: 'store__list_products',
      arguments: { sku: 'GATEWAY-DEMO-001' },
    });
    if (!(existing.structuredContent as any).products.length) {
      const made = await a.callTool({
        name: 'store__create_product',
        arguments: {
          name: 'Gateway Demo Notebook',
          price: '349.00',
          sku: 'GATEWAY-DEMO-001',
          virtual: true,
        },
      });
      assert(!made.isError);
    }
    const order = await b.callTool({ name: 'store__list_orders', arguments: {} });
    assert(!order.isError);
    assert(
      (order.structuredContent as any).orders.length > 0,
      'Place a demo order before running the gateway check.',
    );
    for (const name of ['inventory__search', 'knowledge__search'])
      assert(!(await b.callTool({ name, arguments: { query: '' } })).isError);
    const stock = await b.callTool({
      name: 'inventory__get_stock',
      arguments: { sku: 'URUMI-DEMO-001' },
    });
    assert.equal((stock.structuredContent as any).stock.available, 25);
    const inventory = servers.body.servers.find((s: any) => s.slug === 'inventory');
    try {
      assert.equal(
        (await api('/api/servers/' + inventory.id, 'PATCH', { enabled: false }, admin)).status,
        200,
      );
      assert(!(await a.listTools()).tools.some((x) => x.name.startsWith('inventory__')));
      assert(!(await b.listTools()).tools.some((x) => x.name.startsWith('inventory__')));
      assert((await b.callTool({ name: 'inventory__search', arguments: { query: '' } })).isError);
    } finally {
      await api('/api/servers/' + inventory.id, 'PATCH', { enabled: true }, admin);
    }
    assert.equal((await api('/api/servers', 'GET', undefined, member)).status, 403);
    assert.equal(
      (await api('/api/keys/' + saved.adminKeyId, 'DELETE', undefined, member)).status,
      404,
    );
    assert.equal(
      (await api('/api/keys/' + keyB.body.key.id, 'DELETE', undefined, admin)).status,
      204,
    );
    await assert.rejects(b.callTool({ name: 'store__list_orders', arguments: {} }));
    const audit = await api('/api/audit', 'GET', undefined, admin);
    assert(
      audit.body.events.some(
        (e: any) => e.user_email === saved.memberEmail && e.error_code === 'FORBIDDEN',
      ),
    );
    assert(
      audit.body.events.some(
        (e: any) => e.user_email === saved.memberEmail && e.outcome === 'rejected',
      ),
    );
    assert(
      audit.body.events.some(
        (e: any) =>
          e.user_email === saved.memberEmail &&
          e.tool === 'store__list_orders' &&
          e.outcome === 'success',
      ),
    );
    console.log(
      'PASS: real store and three upstreams; name collisions; cross-server workflow; admin/member permissions; invitations; immediate revocation; attributed audit.',
    );
  } finally {
    await Promise.allSettled([a.close(), b.close()]);
  }
  await writeFile(path, JSON.stringify(saved, null, 2), { mode: 0o600 });
} else {
  const inventory = servers.body.servers.find((s: any) => s.slug === 'inventory');
  assert.equal(inventory.status, stage === 'outage' ? 'Unreachable' : 'Connected');
  const a = await client(saved.adminKey);
  try {
    assert(
      !(await a.callTool({ name: 'knowledge__search', arguments: { query: 'shipping' } })).isError,
    );
    assert(!(await a.callTool({ name: 'store__list_orders', arguments: {} })).isError);
    if (stage !== 'outage')
      assert(!(await a.callTool({ name: 'inventory__search', arguments: { query: '' } })).isError);
    assert.equal((await api('/api/me', 'GET', undefined, saved.revokedMemberKey)).status, 401);
    const audit = await api('/api/audit', 'GET', undefined, admin);
    assert(
      audit.body.events.some(
        (e: any) => e.user_email === saved.memberEmail && e.outcome === 'rejected',
      ),
    );
    console.log(
      stage === 'outage'
        ? 'PASS: inventory unreachable; store and knowledge calls still work.'
        : 'PASS: upstream recovered; account/key revocation and audit survive restarts.',
    );
  } finally {
    await a.close();
  }
}
