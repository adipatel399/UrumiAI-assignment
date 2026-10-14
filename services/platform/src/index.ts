import { config } from './config.js';
import { Database } from './database.js';
import { Upstreams } from './upstreams.js';
import { createGateway } from './gateway.js';
import { supportApp } from './support.js';
const mode = process.env.SERVICE_MODE;
async function main() {
  if (mode === 'inventory' || mode === 'knowledge') {
    if (!process.env.SUPPORT_MCP_TOKEN || process.env.SUPPORT_MCP_TOKEN.length < 32)
      throw new Error('SUPPORT_MCP_TOKEN required');
    const listener = supportApp(mode, process.env.SUPPORT_MCP_TOKEN).listen(3000, '0.0.0.0');
    process.on('SIGTERM', () => {
      listener.close(() => process.exit(0));
      setTimeout(() => process.exit(1), 10000).unref();
    });
    return;
  }
  const settings = config();
  const db = new Database(settings);
  await db.initialize();
  const upstreams = new Upstreams(db);
  const listener = createGateway(db, upstreams).listen(settings.PORT, '0.0.0.0');
  listener.requestTimeout = 30000;
  let refreshing = false;
  const refresh = async () => {
    if (refreshing) return;
    refreshing = true;
    try {
      await upstreams.refreshAll();
    } catch {
      console.error('Catalog refresh failed.');
    } finally {
      refreshing = false;
    }
  };
  void refresh();
  const timer = setInterval(() => {
    void refresh();
  }, 15000);
  timer.unref();
  const shutdown = () => {
    clearInterval(timer);
    listener.close(() => {
      void upstreams
        .close()
        .then(() => db.pool.end())
        .then(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  console.log(JSON.stringify({ event: 'gateway_started' }));
}
void main().catch(() => {
  console.error('Service startup failed; verify configuration and database.');
  process.exit(1);
});
