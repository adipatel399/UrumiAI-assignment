import { chatInput, runChat } from './chat.js';
import { metrics, prometheus } from './metrics.js';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { Database, type Principal } from './database.js';
import { Upstreams, exposedName, failure } from './upstreams.js';
import {
  csrf,
  digest,
  encrypt,
  equal,
  passwordHash,
  passwordMatches,
  token,
  validateUpstream,
} from './security.js';

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const email = z
  .email()
  .max(254)
  .transform((x) => x.toLowerCase());
const password = z.string().min(12).max(256);
const id = z.uuid();
const keyInput = z.object({
  name: z.string().trim().min(1).max(100),
  user_id: id.optional(),
});
const credential = z.object({
  header: z
    .string()
    .regex(/^[a-zA-Z0-9-]+$/)
    .refine(
      (x) =>
        ![
          'host',
          'cookie',
          'origin',
          'connection',
          'content-length',
          'mcp-session-id',
        ].includes(x.toLowerCase()) && !x.toLowerCase().startsWith('x-forwarded-'),
    ),
  value: z
    .string()
    .min(1)
    .max(4096)
    .regex(/^[^\r\n]+$/),
});
const serverInput = z.object({
  slug: z.string().regex(/^[a-z][a-z0-9-]{0,23}$/),
  name: z.string().trim().min(1).max(100),
  url: z.url().max(2000),
  credential: credential.nullable().optional(),
  enabled: z.boolean().default(true),
  read_tools: z.array(z.string().max(128)).max(1000).default([]),
});
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new ApiError(
      400,
      'Invalid input fields: ' +
        result.error.issues.map((x) => x.path.join('.')).join(', '),
    );
  return result.data;
}
const safeUser = (user: Principal) => ({
  id: user.id,
  email: user.email,
  role: user.role,
});
export function createGateway(
  db: Database,
  upstreams: Upstreams,
  providerFetch?: typeof fetch,
) {
  const app = express();
  app.use((_req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    });
    next();
  });
  app.use(express.static(fileURLToPath(new URL('../ui/', import.meta.url))));
  app.get('/invite', (_req, res) =>
    res.sendFile(fileURLToPath(new URL('../ui/index.html', import.meta.url))),
  );
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));
  const config = db.config;
  const cookie = (req: express.Request) => {
    try {
      return decodeURIComponent(
        req.headers.cookie
          ?.split(';')
          .map((x) => x.trim())
          .find((x) => x.startsWith('urumi_session='))
          ?.slice(14) ?? '',
      );
    } catch {
      return '';
    }
  };
  const requireAdmin = (principal: Principal) => {
    if (principal.role !== 'admin')
      throw new ApiError(403, 'Administrator access required.');
  };
  async function audit(
    user: Principal | null,
    tool: string,
    outcome: string,
    server?: { id: string; name: string },
    error?: string,
  ) {
    const result = await db.query(
      'INSERT INTO audit_log(user_id,key_id,server_id,server_name,tool,outcome,error_code) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [
        user?.id ?? null,
        user?.keyId ?? null,
        server?.id ?? null,
        server?.name ?? null,
        tool.slice(0, 200),
        outcome,
        error ?? null,
      ],
    );
    return result.rows[0].id as string;
  }
  async function authenticate(req: express.Request, mcp = false): Promise<Principal> {
    const bearer = req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : undefined;
    let user: any;
    if (bearer) {
      user = (
        await db.query(
          'SELECT u.id,u.email,u.role,u.active,k.id AS key_id,k.revoked_at,k.expires_at,k.purpose,k.session_hash,EXISTS(SELECT 1 FROM sessions s WHERE s.token_hash=k.session_hash AND s.expires_at>now()) AS session_valid FROM api_keys k JOIN users u ON u.id=k.user_id WHERE k.token_hash=$1',
          [digest(bearer)],
        )
      ).rows[0];
      if (user) {
        user = { ...user, keyId: user.key_id };
      }
      if (
        !user ||
        !user.active ||
        user.revoked_at ||
        (user.expires_at && new Date(user.expires_at).getTime() <= Date.now()) ||
        (user.purpose === 'chat' && (!mcp || !user.session_valid))
      ) {
        if (mcp && req.body?.method === 'tools/call') {
          const name = String(req.body?.params?.name ?? 'unknown');
          const row = (await upstreams.rows()).find((r) =>
            name.startsWith(r.slug + '__'),
          );
          await audit(user ?? null, name, 'rejected', row, 'INVALID_OR_REVOKED_KEY');
        }
        throw new ApiError(401, 'Invalid or revoked API key.');
      }
    } else if (!mcp) {
      const raw = cookie(req);
      if (raw)
        user = (
          await db.query(
            'SELECT u.id,u.email,u.role,u.active FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()',
            [digest(raw)],
          )
        ).rows[0];
      if (!user?.active) throw new ApiError(401, 'Login required.');
      user = { ...user, session: raw };
    } else {
      if (req.body?.method === 'tools/call')
        await audit(
          null,
          String(req.body?.params?.name ?? 'unknown'),
          'rejected',
          undefined,
          'MISSING_KEY',
        );
      throw new ApiError(401, 'User API key required.');
    }
    return user;
  }
  app.use((req, res, next) => {
    if (req.headers.origin && req.headers.origin !== new URL(config.PUBLIC_URL).origin) {
      res.status(403).json({ error: 'Origin not allowed.' });
      return;
    }
    next();
  });
  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.get('/readyz', async (_req, res) => {
    try {
      await db.query('SELECT 1');
      res.json({ status: 'ready' });
    } catch {
      res.status(503).json({ status: 'database unavailable' });
    }
  });
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  const attempts = new Map<string, { count: number; until: number }>();
  app.post('/api/login', async (req, res) => {
    const address = req.ip ?? 'unknown';
    const now = Date.now();
    for (const [ip, state] of attempts) if (state.until < now) attempts.delete(ip);
    const state = attempts.get(address) ?? { count: 0, until: now + 900000 };
    if (state.count >= 10 || attempts.size > 10000)
      throw new ApiError(429, 'Too many login attempts; try later.');
    state.count++;
    attempts.set(address, state);
    const input = parse(
      z.object({ email, password: z.string().min(1).max(256) }),
      req.body,
    );
    const user = (
      await db.query('SELECT * FROM users WHERE email=$1 AND active=true', [input.email])
    ).rows[0];
    const valid = await passwordMatches(
      input.password,
      user?.password_hash ?? (await passwordHash('nonexistent-account-check')),
    );
    if (!user || !valid) throw new ApiError(401, 'Invalid email or password.');
    const raw = token();
    await db.query(
      "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '24 hours')",
      [digest(raw), user.id],
    );
    res.cookie('urumi_session', raw, {
      httpOnly: true,
      sameSite: 'strict',
      secure: config.COOKIE_SECURE === 'true',
      maxAge: 86400000,
      path: '/',
    });
    res.json({
      user: safeUser(user),
      csrf_token: csrf(raw, config.ENCRYPTION_KEY),
    });
  });
  app.post('/api/invitations/accept', async (req, res) => {
    const input = parse(
      z.object({ token: z.string().min(32).max(200), password }),
      req.body,
    );
    const hash = await passwordHash(input.password);
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const invite = (
        await client.query(
          'SELECT * FROM invitations WHERE token_hash=$1 AND accepted_at IS NULL AND expires_at>now() FOR UPDATE',
          [digest(input.token)],
        )
      ).rows[0];
      if (!invite)
        throw new ApiError(400, 'Invitation is invalid, expired, or already accepted.');
      const inserted = await client.query(
        'INSERT INTO users(email,password_hash,role) VALUES($1,$2,$3) ON CONFLICT(email) DO NOTHING RETURNING id,email,role',
        [invite.email, hash, invite.role],
      );
      if (!inserted.rowCount) throw new ApiError(409, 'User already exists.');
      await client.query('UPDATE invitations SET accepted_at=now() WHERE id=$1', [
        invite.id,
      ]);
      await client.query('COMMIT');
      res.status(201).json({ user: inserted.rows[0] });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
  app.use('/api', async (req, res, next) => {
    const user = await authenticate(req);
    res.set('Cache-Control', 'no-store');
    res.locals.user = user;
    if (
      user.session &&
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      !equal(
        req.headers['x-csrf-token']?.toString() ?? '',
        csrf(user.session, config.ENCRYPTION_KEY),
      )
    )
      throw new ApiError(403, 'Valid CSRF token required.');
    next();
  });
  app.get('/api/me', (_req, res) => {
    const u = res.locals.user as Principal;
    res.json({
      user: safeUser(u),
      ...(u.session ? { csrf_token: csrf(u.session, config.ENCRYPTION_KEY) } : {}),
    });
  });
  app.post('/api/logout', async (req, res) => {
    const u = res.locals.user as Principal;
    if (u.session)
      await db.query('DELETE FROM sessions WHERE token_hash=$1', [digest(u.session)]);
    res.clearCookie('urumi_session', { path: '/' });
    res.status(204).end();
  });
  app.get('/api/keys', async (_req, res) => {
    const u = res.locals.user as Principal;
    res.json({
      keys: (
        await db.query(
          "SELECT id,user_id,name,prefix,created_at,revoked_at FROM api_keys WHERE purpose='external' AND ($1::boolean OR user_id=$2) ORDER BY created_at DESC",
          [u.role === 'admin', u.id],
        )
      ).rows,
    });
  });
  app.post('/api/keys', async (req, res) => {
    const u = res.locals.user as Principal;
    const input = parse(keyInput, req.body);
    const owner = input.user_id ?? u.id;
    if (owner !== u.id) requireAdmin(u);
    if (
      !(await db.query('SELECT id FROM users WHERE id=$1 AND active=true', [owner]))
        .rowCount
    )
      throw new ApiError(404, 'User not found.');
    const raw = 'urumi_' + token();
    const inserted = await db.query(
      'INSERT INTO api_keys(user_id,name,prefix,token_hash) VALUES($1,$2,$3,$4) RETURNING id,user_id,name,prefix,created_at',
      [owner, input.name, raw.slice(0, 12), digest(raw)],
    );
    res.status(201).json({ key: { ...inserted.rows[0], token: raw } });
  });
  app.delete('/api/keys/:id', async (req, res) => {
    const u = res.locals.user as Principal;
    const keyId = parse(id, req.params.id);
    const changed = await db.query(
      'UPDATE api_keys SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1 AND ($2::boolean OR user_id=$3) RETURNING id',
      [keyId, u.role === 'admin', u.id],
    );
    if (!changed.rowCount) throw new ApiError(404, 'Key not found.');
    res.status(204).end();
  });
  app.get('/api/members', async (_req, res) => {
    requireAdmin(res.locals.user);
    res.json({
      members: (
        await db.query(
          'SELECT id,email,role,active,created_at FROM users ORDER BY created_at',
        )
      ).rows,
    });
  });
  app.patch('/api/members/:id', async (req, res) => {
    requireAdmin(res.locals.user);
    const memberId = parse(id, req.params.id);
    const input = parse(
      z.object({
        role: z.enum(['admin', 'member']).optional(),
        active: z.boolean().optional(),
      }),
      req.body,
    );
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(70125)');
      const member = (
        await client.query('SELECT id,role,active FROM users WHERE id=$1 FOR UPDATE', [
          memberId,
        ])
      ).rows[0];
      if (!member) throw new ApiError(404, 'User not found.');
      if (
        member.role === 'admin' &&
        member.active &&
        (input.role === 'member' || input.active === false)
      ) {
        const remaining = await client.query(
          "SELECT id FROM users WHERE role='admin' AND active=true AND id<>$1",
          [memberId],
        );
        if (!remaining.rowCount)
          throw new ApiError(409, 'Cannot remove the last active administrator.');
      }
      await client.query('UPDATE users SET role=$2,active=$3 WHERE id=$1', [
        memberId,
        input.role ?? member.role,
        input.active ?? member.active,
      ]);
      await client.query('COMMIT');
      res.json({ id: memberId });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
  app.get('/api/invitations', async (_req, res) => {
    requireAdmin(res.locals.user);
    res.json({
      invitations: (
        await db.query(
          'SELECT id,email,role,expires_at,accepted_at FROM invitations ORDER BY expires_at DESC LIMIT 100',
        )
      ).rows,
    });
  });
  app.post('/api/invitations', async (req, res) => {
    const u = res.locals.user as Principal;
    requireAdmin(u);
    const input = parse(
      z.object({ email, role: z.enum(['admin', 'member']).default('member') }),
      req.body,
    );
    const raw = token();
    await db.query(
      "INSERT INTO invitations(email,role,token_hash,invited_by,expires_at) VALUES($1,$2,$3,$4,now()+interval '48 hours')",
      [input.email, input.role, digest(raw), u.id],
    );
    res.status(201).json({
      invitation: {
        email: input.email,
        token: raw,
        expires_in_hours: 48,
        accept_url: config.PUBLIC_URL + '/invite?token=' + raw,
      },
    });
  });
  app.get('/api/servers', async (_req, res) => {
    requireAdmin(res.locals.user);
    res.json({
      servers: (await upstreams.rows()).map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        url: r.url,
        enabled: r.enabled,
        status: r.enabled ? r.status : 'Disabled',
        last_error: r.last_error,
        read_tools: r.read_tools,
        credential_configured: !!r.credential,
        tools: upstreams.entries.get(r.id)?.tools ?? [],
      })),
    });
  });
  app.post('/api/servers', async (req, res) => {
    requireAdmin(res.locals.user);
    const input = parse(serverInput, req.body);
    try {
      await validateUpstream(input.url, config.UPSTREAM_ALLOWED_HOSTS.split(','));
    } catch {
      throw new ApiError(400, 'URL violates upstream network policy.');
    }
    const inserted = await db.query<import('./database.js').Upstream>(
      'INSERT INTO upstreams(slug,name,url,credential,enabled,read_tools) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
      [
        input.slug,
        input.name,
        input.url,
        input.credential ? encrypt(input.credential, config.ENCRYPTION_KEY) : null,
        input.enabled,
        input.read_tools,
      ],
    );
    await upstreams.refresh(inserted.rows[0]);
    res.status(201).json({ id: inserted.rows[0].id });
  });
  app.patch('/api/servers/:id', async (req, res) => {
    requireAdmin(res.locals.user);
    const serverId = parse(id, req.params.id);
    // Slug is immutable: changing display names must not break configured tool names.
    const input = parse(
      z.object({
        name: z.string().trim().min(1).max(100).optional(),
        url: z.url().max(2000).optional(),
        credential: credential.nullable().optional(),
        enabled: z.boolean().optional(),
        read_tools: z.array(z.string().max(128)).max(1000).optional(),
      }),
      req.body,
    );
    const existing = (
      await db.query<import('./database.js').Upstream>(
        'SELECT * FROM upstreams WHERE id=$1',
        [serverId],
      )
    ).rows[0];
    if (!existing) throw new ApiError(404, 'Server not found.');
    if (input.url)
      try {
        await validateUpstream(input.url, config.UPSTREAM_ALLOWED_HOSTS.split(','));
      } catch {
        throw new ApiError(400, 'URL violates upstream network policy.');
      }
    const updated = await db.query<import('./database.js').Upstream>(
      'UPDATE upstreams SET name=$2,url=$3,credential=$4,enabled=$5,read_tools=$6 WHERE id=$1 RETURNING *',
      [
        serverId,
        input.name ?? existing.name,
        input.url ?? existing.url,
        input.credential === undefined
          ? existing.credential
          : input.credential === null
            ? null
            : encrypt(input.credential, config.ENCRYPTION_KEY),
        input.enabled ?? existing.enabled,
        input.read_tools ?? existing.read_tools,
      ],
    );
    await upstreams.refresh(updated.rows[0]);
    res.json({ id: serverId });
  });
  app.delete('/api/servers/:id', async (req, res) => {
    requireAdmin(res.locals.user);
    const serverId = parse(id, req.params.id);
    const result = await db.query('DELETE FROM upstreams WHERE id=$1', [serverId]);
    if (!result.rowCount) throw new ApiError(404, 'Server not found.');
    await upstreams.forget(serverId);
    res.status(204).end();
  });
  app.post('/api/servers/refresh', async (_req, res) => {
    requireAdmin(res.locals.user);
    await upstreams.refreshAll();
    res.json({ status: 'refreshed' });
  });
  const activeChats = new Set<string>();
  app.get('/api/chat', (_req, res) =>
    res.json({ configured: !!config.LLM_API_KEY, model: config.LLM_MODEL }),
  );
  app.post('/api/chat', async (req, res) => {
    const user = res.locals.user as Principal;
    if (!user.session) throw new ApiError(403, 'Dashboard login required for chat.');
    const input = parse(chatInput, req.body);
    if (activeChats.has(user.id) || activeChats.size >= 4)
      throw new ApiError(429, 'Another chat is running. Wait for it to finish.');
    const aborted = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) aborted.abort();
    });
    activeChats.add(user.id);
    try {
      const readTools = new Set(
        (await upstreams.catalog(user.role))
          .filter((x) => x.row.read_tools.includes(x.original))
          .map((x) => x.tool.name),
      );
      const address = req.socket.localPort;
      const result = await runChat(
        db,
        user,
        input,
        new URL(`http://127.0.0.1:${address}/mcp`),
        readTools,
        aborted.signal,
        providerFetch,
      );
      res.status(result.status).json(result);
    } finally {
      activeChats.delete(user.id);
    }
  });
  app.get('/api/metrics', async (_req, res) => {
    requireAdmin(res.locals.user);
    res.json({ metrics: await metrics(db) });
  });
  app.get('/metrics', async (req, res) => {
    const user = await authenticate(req);
    requireAdmin(user);
    res
      .set('Cache-Control', 'no-store')
      .type('text/plain; version=0.0.4')
      .send(prometheus(await metrics(db)));
  });
  app.get('/api/tools', async (_req, res) => {
    res.json({
      tools: (await upstreams.catalog(res.locals.user.role)).map((x) => x.tool),
    });
  });
  app.get('/api/audit', async (req, res) => {
    requireAdmin(res.locals.user);
    const page = parse(
      z.coerce.number().int().min(1).max(100000).default(1),
      req.query.page,
    );
    res.json({
      events: (
        await db.query(
          'SELECT a.*,u.email AS user_email FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 100 OFFSET $1',
          [(page - 1) * 100],
        )
      ).rows,
      page,
    });
  });
  app.post('/mcp', async (req, res) => {
    const user = await authenticate(req, true);
    const server = new Server(
      { name: 'urumi-team-gateway', version: '0.1.0' },
      { capabilities: { tools: {} } },
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: (await upstreams.catalog(user.role)).map((x) => x.tool),
    }));
    server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const start = Date.now();
      const name = request.params.name;
      const rows = await upstreams.rows();
      const row = rows.find((r) => name.startsWith(r.slug + '__'));
      const entry = row
        ? (upstreams.entries.get(row.id)?.tools ?? []).find(
            (t) => exposedName(row.slug, t.name) === name,
          )
        : undefined;
      const auditId = await audit(user, name, 'started', row);
      let result;
      try {
        if (row && !row.enabled)
          result = failure('SERVER_DISABLED', 'This server is disabled.');
        else if (!row || !entry)
          result = failure(
            'UNKNOWN_TOOL',
            'Tool is unknown or its upstream has no discovered catalog.',
          );
        else if (user.role !== 'admin' && !row.read_tools.includes(entry.name))
          result = failure('FORBIDDEN', 'You are not permitted to call this tool.');
        else
          result = await upstreams.call(
            row,
            entry.name,
            request.params.arguments ?? {},
            extra.signal,
          );
        const error = (result.structuredContent?.error as { code?: string } | undefined)
          ?.code;
        await db.query(
          'UPDATE audit_log SET duration_ms=$2,outcome=$3,error_code=$4 WHERE id=$1',
          [
            auditId,
            Date.now() - start,
            result.isError ? 'error' : 'success',
            error ?? (result.isError ? 'UPSTREAM_TOOL_ERROR' : null),
          ],
        );
        return result;
      } catch {
        await db.query(
          "UPDATE audit_log SET duration_ms=$2,outcome='error',error_code='GATEWAY_ERROR' WHERE id=$1",
          [auditId, Date.now() - start],
        );
        return failure('GATEWAY_ERROR', 'Tool execution failed.');
      }
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      void Promise.allSettled([transport.close(), server.close()]);
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  app.all('/mcp', async (req, res) => {
    await authenticate(req, true);
    res
      .set('Allow', 'POST')
      .status(405)
      .json({ error: 'Stateless MCP accepts POST only.' });
  });
  app.use(
    (
      error: any,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (res.headersSent) return;
      const status =
        error instanceof ApiError
          ? error.status
          : error.code === '23505'
            ? 409
            : [400, 413].includes(error.status)
              ? error.status
              : 500;
      res.status(status).json({
        error:
          error instanceof ApiError
            ? error.message
            : status === 409
              ? 'Record already exists.'
              : status === 400
                ? 'Invalid request body.'
                : status === 413
                  ? 'Request too large.'
                  : 'Request failed.',
      });
    },
  );
  return app;
}
