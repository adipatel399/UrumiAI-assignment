import express from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Config } from './config.js';
import { createStoreServer } from './tools.js';

export function createApp(config: Config) {
  const app = express();
  app.disable('x-powered-by');
  const digest = (value: string) => createHash('sha256').update(value).digest();
  const expected = digest(config.MCP_BEARER_TOKEN);
  const hosts = new Set(config.ALLOWED_HOSTS.split(',').map(h => h.trim()));
  app.get('/healthz', (_req, res) => { res.json({ status: 'ok' }); });
  // Readiness describes this MCP service; a store outage is reported by tools.
  app.get('/readyz', (_req, res) => { res.json({ status: 'ready' }); });
  app.use('/mcp', (req, res, next) => {
    if (!hosts.has(req.hostname)) { res.status(403).json({ error: 'Host not allowed.' }); return; }
    if (req.headers.origin) { res.status(403).json({ error: 'Browser origins are not allowed on this internal service.' }); return; }
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ') || !timingSafeEqual(digest(auth.slice(7)), expected)) {
      res.status(401).json({ error: 'Valid upstream bearer token required.' }); return;
    }
    next();
  });
  app.use(express.json({ limit: '64kb' }));
  app.post('/mcp', async (req, res) => {
    const server = createStoreServer(config);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { void Promise.allSettled([transport.close(), server.close()]); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'MCP request failed.' } });
    }
  });
  app.all('/mcp', (_req, res) => { res.set('Allow', 'POST').status(405).json({ error: 'This stateless MCP endpoint accepts POST only.' }); });
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = (error as { status?: number }).status;
    res.status(status === 413 ? 413 : 400).json({ error: status === 413 ? 'Request too large.' : 'Invalid request body.' });
  });
  return app;
}
