import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import type { Server as HttpServer } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { z } from 'zod';
import { config } from '../src/config.js';
import { Database } from '../src/database.js';
import { Upstreams } from '../src/upstreams.js';
import { createGateway } from '../src/gateway.js';
import { supportApp } from '../src/support.js';
import { encrypt, digest } from '../src/security.js';

async function address(server: HttpServer) {
  if (!server.listening) await once(server, 'listening');
  const addr = server.address();
  assert(addr && typeof addr !== 'string');
  return `http://127.0.0.1:${addr.port}`;
}
test(
  'gateway and team access with real PostgreSQL and three MCP upstreams',
  { skip: !process.env.TEST_PG_PORT },
  async (t) => {
    let writes = 0;
    let inventoryDown = false;
    let inventorySlow = false;
    const mock = express();
    mock.use(express.json());
    mock.use(
      '/inventory',
      (req, res, next) => {
        if (inventoryDown) {
          res.status(503).end();
          return;
        }
        if (inventorySlow) {
          setTimeout(next, 500);
          return;
        }
        next();
      },
      supportApp('inventory', 'test-support-token-'.repeat(3)),
    );
    mock.use('/knowledge', supportApp('knowledge', 'test-support-token-'.repeat(3)));
    mock.post('/store/mcp', async (req, res) => {
      assert.equal(req.headers.authorization, 'Bearer ' + 'test-woo-token-'.repeat(3));
      const server = new McpServer({ name: 'mock-store', version: '1.0.0' });
      server.registerTool(
        'list_orders',
        { inputSchema: {}, annotations: { readOnlyHint: true } },
        async () => ({
          content: [{ type: 'text', text: 'orders' }],
          structuredContent: { orders: [{ id: 1, total: '199.00' }] },
        }),
      );
      server.registerTool(
        'create_product',
        { inputSchema: { name: z.string(), price: z.string() } },
        async () => {
          writes++;
          return { content: [{ type: 'text', text: 'created' }] };
        },
      );
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.on('close', () => {
        void Promise.allSettled([server.close(), transport.close()]);
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    });
    const mockListener = mock.listen(0, '127.0.0.1');
    t.after(() => {
      mockListener.closeAllConnections();
      mockListener.close();
    });
    const mockUrl = await address(mockListener);
    const settings = config({
      PGHOST: '127.0.0.1',
      PGPORT: process.env.TEST_PG_PORT,
      PGUSER: 'urumi',
      PGDATABASE: 'urumi',
      PGPASSWORD: process.env.TEST_PG_PASSWORD,
      ENCRYPTION_KEY: 'ab'.repeat(32),
      BOOTSTRAP_EMAIL: 'admin@example.test',
      BOOTSTRAP_PASSWORD: 'test-admin-password',
      WOO_MCP_TOKEN: 'test-woo-token-'.repeat(3),
      SUPPORT_MCP_TOKEN: 'test-support-token-'.repeat(3),
      UPSTREAM_ALLOWED_HOSTS: '127.0.0.1',
      UPSTREAM_TIMEOUT_MS: '200',
    });
    const db = new Database(settings);
    t.after(() => db.pool.end());
    await db.initialize();
    for (const [slug, path] of [
      ['store', 'store'],
      ['inventory', 'inventory'],
      ['knowledge', 'knowledge'],
    ])
      await db.query('UPDATE upstreams SET url=$2 WHERE slug=$1', [
        slug,
        `${mockUrl}/${path}/mcp`,
      ]);
    const upstreams = new Upstreams(db);
    t.after(() => upstreams.close());
    await upstreams.refreshAll();
    let modelStep = 0;
    let modelMode = 'cross';
    const provider: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert(!JSON.stringify(body).includes('test-support-token'));
      assert(!JSON.stringify(body).includes('test-woo-token'));
      if (modelMode === 'rate') return new Response('{}', { status: 429 });
      const tools = body.tools?.map((t: any) => t.function.name) ?? [];
      if (modelMode === 'write') assert(tools.includes('store__create_product'));
      else if (modelMode === 'member') assert(!tools.includes('store__create_product'));
      let message: any = { content: 'Completed using the gateway.' };
      if (modelStep++ === 0)
        message = {
          content: null,
          tool_calls:
            modelMode === 'write' || modelMode === 'member'
              ? [
                  {
                    id: 'w1',
                    type: 'function',
                    function: {
                      name: 'store__create_product',
                      arguments: '{"name":"Chat product","price":"9"}',
                    },
                  },
                ]
              : [
                  {
                    id: 'r1',
                    type: 'function',
                    function: {
                      name: 'inventory__search',
                      arguments: '{"query":""}',
                    },
                  },
                  {
                    id: 'r2',
                    type: 'function',
                    function: {
                      name: 'knowledge__search',
                      arguments: '{"query":""}',
                    },
                  },
                ],
        };
      return Response.json({ choices: [{ message }] });
    };
    const app = createGateway(db, upstreams, provider);
    const listener = app.listen(0, '127.0.0.1');
    t.after(() => {
      listener.closeAllConnections();
      listener.close();
    });
    const base = await address(listener);
    settings.PUBLIC_URL = base;
    async function request(
      path: string,
      method = 'GET',
      body?: unknown,
      auth?: { cookie: string; csrf: string } | string,
    ) {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (typeof auth === 'string') headers.Authorization = 'Bearer ' + auth;
      else if (auth) {
        headers.Cookie = auth.cookie;
        headers['x-csrf-token'] = auth.csrf;
      }
      const response = await fetch(base + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return {
        status: response.status,
        body: response.status === 204 ? {} : await response.json(),
        cookie: response.headers.get('set-cookie')?.split(';')[0] ?? '',
      };
    }
    const logged = await request('/api/login', 'POST', {
      email: settings.BOOTSTRAP_EMAIL,
      password: settings.BOOTSTRAP_PASSWORD,
    });
    assert.equal(logged.status, 200);
    const admin = { cookie: logged.cookie, csrf: logged.body.csrf_token };
    assert.equal(
      (
        await request(
          '/api/members/' + logged.body.user.id,
          'PATCH',
          { active: false },
          admin,
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await fetch(base + '/api/keys', {
          method: 'POST',
          headers: { Cookie: admin.cookie, 'Content-Type': 'application/json' },
          body: '{"name":"no csrf"}',
        })
      ).status,
      403,
    );
    const adminKey = await request('/api/keys', 'POST', { name: 'admin-test' }, admin);
    assert.equal(adminKey.status, 201);
    const rawAdmin = adminKey.body.key.token;
    const invite = await request(
      '/api/invitations',
      'POST',
      { email: 'member@example.test' },
      admin,
    );
    assert.equal(invite.status, 201);
    const accepted = await request('/api/invitations/accept', 'POST', {
      token: invite.body.invitation.token,
      password: 'test-member-password',
    });
    assert.equal(accepted.status, 201);
    assert.equal(
      (
        await request('/api/invitations/accept', 'POST', {
          token: invite.body.invitation.token,
          password: 'test-member-password',
        })
      ).status,
      400,
    );
    const loginB = await request('/api/login', 'POST', {
      email: 'member@example.test',
      password: 'test-member-password',
    });
    const member = { cookie: loginB.cookie, csrf: loginB.body.csrf_token };
    const keyB = await request('/api/keys', 'POST', { name: 'member-test' }, member);
    assert.equal(keyB.status, 201);
    const rawB = keyB.body.key.token;
    assert.equal((await request('/api/servers', 'GET', undefined, member)).status, 403);
    assert.equal(
      (
        await request(
          '/api/invitations',
          'POST',
          { email: 'intruder@example.test', role: 'admin' },
          member,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await request(
          '/api/keys',
          'POST',
          { name: 'another-user', user_id: logged.body.user.id },
          member,
        )
      ).status,
      403,
    );
    assert.equal(
      (await request('/api/keys/' + adminKey.body.key.id, 'DELETE', undefined, member))
        .status,
      404,
    );
    const notConfigured = await request(
      '/api/chat',
      'POST',
      { messages: [{ role: 'user', content: 'Show inventory' }] },
      admin,
    );
    assert.equal(notConfigured.status, 503);
    settings.LLM_API_KEY = 'fake-provider-key-for-controlled-test';
    const chat = await request(
      '/api/chat',
      'POST',
      { messages: [{ role: 'user', content: 'Find inventory and returns' }] },
      admin,
    );
    assert.equal(chat.status, 200);
    assert.equal(chat.body.activity.length, 2);
    assert(chat.body.activity.every((x: any) => x.outcome === 'success'));
    modelStep = 0;
    modelMode = 'member';
    const deniedChat = await request(
      '/api/chat',
      'POST',
      {
        messages: [{ role: 'user', content: 'Create product' }],
        allow_writes: true,
      },
      member,
    );
    assert.equal(deniedChat.body.activity[0].outcome, 'error');
    assert.equal(writes, 0);
    modelStep = 0;
    modelMode = 'write';
    const writeChat = await request(
      '/api/chat',
      'POST',
      {
        messages: [{ role: 'user', content: 'Create product' }],
        allow_writes: true,
      },
      admin,
    );
    assert.equal(writeChat.status, 200);
    assert.equal(writes, 1);
    modelStep = 0;
    modelMode = 'member';
    const readOnlyAdmin = await request(
      '/api/chat',
      'POST',
      { messages: [{ role: 'user', content: 'Create product' }] },
      admin,
    );
    assert.equal(readOnlyAdmin.body.activity[0].outcome, 'error');
    assert.equal(writes, 1);
    const chatKeys = await db.query(
      "SELECT k.*,u.email FROM api_keys k JOIN users u ON u.id=k.user_id WHERE purpose='chat'",
    );
    assert.equal(chatKeys.rows.length, 4);
    assert(chatKeys.rows.every((k) => k.revoked_at && k.expires_at && k.session_hash));
    const externalKeys = await request('/api/keys', 'GET', undefined, admin);
    assert(!externalKeys.body.keys.some((k: any) => k.name === 'Dashboard chat'));
    const chatAudit = await db.query(
      "SELECT a.*,u.email FROM audit_log a JOIN users u ON u.id=a.user_id JOIN api_keys k ON k.id=a.key_id WHERE k.purpose='chat'",
    );
    assert(
      chatAudit.rows.some(
        (a) => a.email === 'admin@example.test' && a.tool === 'inventory__search',
      ),
    );
    modelMode = 'rate';
    const limited = await request(
      '/api/chat',
      'POST',
      { messages: [{ role: 'user', content: 'Inventory' }] },
      admin,
    );
    assert.equal(limited.status, 502);
    assert.match(limited.body.error, /rate limit/);
    assert.equal(
      (
        await request(
          '/api/chat',
          'POST',
          { messages: [{ role: 'system', content: 'Bad' }] },
          admin,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await request(
          '/api/chat',
          'POST',
          { messages: [{ role: 'user', content: 'x' }] },
          rawAdmin,
        )
      ).status,
      403,
    );
    writes = 0;
    const clients: Client[] = [];
    async function mcp(key: string) {
      const client = new Client({ name: 'integration', version: '1.0.0' });
      clients.push(client);
      await client.connect(
        new StreamableHTTPClientTransport(new URL(base + '/mcp'), {
          requestInit: { headers: { Authorization: 'Bearer ' + key } },
        }),
      );
      return client;
    }
    t.after(() => Promise.allSettled(clients.map((c) => c.close())));
    const rawChatFixture = 'test-session-bound-chat-key';
    const sessionHash = digest(admin.cookie.split('=')[1]);
    const fixture = await db.query(
      "INSERT INTO api_keys(user_id,name,prefix,token_hash,purpose,expires_at,session_hash) VALUES($1,'Test internal','test',$2,'chat',now()+interval '2 minutes',$3) RETURNING id",
      [logged.body.user.id, digest(rawChatFixture), sessionHash],
    );
    const internal = await mcp(rawChatFixture);
    assert((await internal.listTools()).tools.length > 0);
    assert.equal(
      (await request('/api/me', 'GET', undefined, rawChatFixture)).status,
      401,
    );
    await db.query(
      "UPDATE api_keys SET expires_at=now()-interval '1 second' WHERE id=$1",
      [fixture.rows[0].id],
    );
    await assert.rejects(internal.listTools());
    await db.query(
      "UPDATE api_keys SET expires_at=now()+interval '2 minutes' WHERE id=$1",
      [fixture.rows[0].id],
    );
    await db.query(
      "UPDATE sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1",
      [sessionHash],
    );
    await assert.rejects(internal.listTools());
    await db.query(
      "UPDATE sessions SET expires_at=now()+interval '24 hours' WHERE token_hash=$1",
      [sessionHash],
    );
    await db.query('UPDATE api_keys SET revoked_at=now() WHERE id=$1', [
      fixture.rows[0].id,
    ]);
    const a = await mcp(rawAdmin);
    const b = await mcp(rawB);
    let names = (await a.listTools()).tools.map((x) => x.name);
    assert(
      names.includes('inventory__search') &&
        names.includes('knowledge__search') &&
        names.includes('store__create_product'),
    );
    assert(!(await b.listTools()).tools.some((x) => x.name === 'store__create_product'));
    assert(
      (
        await b.callTool({
          name: 'store__create_product',
          arguments: { name: 'Blocked', price: '1' },
        })
      ).isError,
    );
    assert.equal(writes, 0);
    assert(
      !(
        await a.callTool({
          name: 'store__create_product',
          arguments: { name: 'Allowed', price: '1' },
        })
      ).isError,
    );
    assert.equal(writes, 1);
    for (const name of ['store__list_orders', 'inventory__search', 'knowledge__search'])
      assert(
        !(
          await b.callTool({
            name,
            arguments: name.endsWith('search') ? { query: '' } : {},
          })
        ).isError,
      );
    const servers = await request('/api/servers', 'GET', undefined, admin);
    assert(!JSON.stringify(servers.body).includes(settings.SUPPORT_MCP_TOKEN));
    const inventory = servers.body.servers.find((s: any) => s.slug === 'inventory');
    await request('/api/servers/' + inventory.id, 'PATCH', { enabled: false }, admin);
    assert(!(await b.listTools()).tools.some((x) => x.name.startsWith('inventory__')));
    assert(
      (
        await b.callTool({
          name: 'inventory__search',
          arguments: { query: '' },
        })
      ).isError,
    );
    await request('/api/servers/' + inventory.id, 'PATCH', { name: 'Renamed' }, admin);
    assert.equal(
      (await db.query('SELECT enabled FROM upstreams WHERE id=$1', [inventory.id]))
        .rows[0].enabled,
      false,
    );
    await request('/api/servers/' + inventory.id, 'PATCH', { enabled: true }, admin);
    inventorySlow = true;
    assert(
      (
        await b.callTool({
          name: 'inventory__search',
          arguments: { query: '' },
        })
      ).isError,
    );
    assert(
      !(
        await b.callTool({
          name: 'knowledge__search',
          arguments: { query: '' },
        })
      ).isError,
    );
    inventorySlow = false;
    await upstreams.refreshAll();
    inventoryDown = true;
    await upstreams.refreshAll();
    assert.equal(
      (await db.query('SELECT status FROM upstreams WHERE id=$1', [inventory.id])).rows[0]
        .status,
      'Unreachable',
    );
    assert(
      !(
        await b.callTool({
          name: 'knowledge__search',
          arguments: { query: '' },
        })
      ).isError,
    );
    inventoryDown = false;
    await upstreams.refreshAll();
    const added = await request(
      '/api/servers',
      'POST',
      {
        slug: 'extra',
        name: 'Extra',
        url: mockUrl + '/knowledge/mcp',
        credential: {
          header: 'Authorization',
          value: 'Bearer ' + settings.SUPPORT_MCP_TOKEN,
        },
        read_tools: ['search'],
      },
      admin,
    );
    assert.equal(added.status, 201);
    assert((await b.listTools()).tools.some((x) => x.name === 'extra__search'));
    await request('/api/servers/' + added.body.id, 'DELETE', undefined, admin);
    assert(!(await b.listTools()).tools.some((x) => x.name === 'extra__search'));
    assert.equal(
      (
        await request(
          '/api/servers',
          'POST',
          {
            slug: 'malicious',
            name: 'Bad',
            url: 'http://169.254.169.254/latest/meta-data',
          },
          admin,
        )
      ).status,
      400,
    );
    const stored = (
      await db.query('SELECT token_hash FROM api_keys WHERE id=$1', [keyB.body.key.id])
    ).rows[0];
    assert.notEqual(stored.token_hash, rawB);
    const encrypted = (
      await db.query("SELECT credential FROM upstreams WHERE slug='inventory'")
    ).rows[0].credential;
    assert(!encrypted.includes(settings.SUPPORT_MCP_TOKEN));
    await request('/api/keys/' + keyB.body.key.id, 'DELETE', undefined, admin);
    await assert.rejects(
      b.callTool({ name: 'knowledge__search', arguments: { query: '' } }),
    );
    assert.equal((await request('/api/me', 'GET', undefined, rawB)).status, 401);
    const audit = await request('/api/audit', 'GET', undefined, admin);
    assert(
      audit.body.events.some(
        (e: any) => e.user_email === 'member@example.test' && e.outcome === 'rejected',
      ),
    );
    assert(
      audit.body.events.some(
        (e: any) =>
          e.user_email === 'admin@example.test' &&
          e.tool === 'store__create_product' &&
          e.outcome === 'success',
      ),
    );
    assert(
      audit.body.events.some(
        (e: any) =>
          e.user_email === 'member@example.test' && e.error_code === 'FORBIDDEN',
      ),
    );
    const stats = await request('/api/metrics', 'GET', undefined, admin);
    assert.equal(stats.status, 200);
    assert(
      stats.body.metrics.some(
        (r: any) => r.slug === 'inventory' && r.calls > 0 && r.failures > 0,
      ),
    );
    assert.equal((await request('/api/metrics', 'GET', undefined, member)).status, 403);
    const scrape = await fetch(base + '/metrics', {
      headers: { Authorization: 'Bearer ' + rawAdmin },
    });
    assert.equal(scrape.status, 200);
    const metricsText = await scrape.text();
    assert(metricsText.includes('urumi_tool_duration_seconds_bucket'));
    assert(!metricsText.includes('admin@example'));
    assert.equal((await fetch(base + '/metrics')).status, 401);
    assert.equal(
      (
        await fetch(base + '/metrics', {
          headers: { Authorization: 'Bearer ' + rawB },
        })
      ).status,
      401,
    );
    const snapshots = await db.query('SELECT count(*) FROM users');
    await db.initialize();
    assert.equal(
      (await db.query('SELECT count(*) FROM users')).rows[0].count,
      snapshots.rows[0].count,
    );
    await db.query("DELETE FROM upstreams WHERE slug='knowledge'");
    await db.initialize();
    assert.equal(
      (await db.query("SELECT id FROM upstreams WHERE slug='knowledge'")).rowCount,
      0,
    );
    assert.equal((await request('/api/audit', 'GET', undefined, member)).status, 403);
    assert.equal((await request('/api/logout', 'POST', {}, member)).status, 204);
    assert.equal((await request('/api/me', 'GET', undefined, member)).status, 401);
  },
);
