import { createApp } from './app.js';
import { loadConfig } from './config.js';

try {
  const config = loadConfig();
  const listener = createApp(config).listen(config.PORT, '0.0.0.0', () => {
    console.log(JSON.stringify({ event: 'server_started', service: 'woocommerce-mcp', port: config.PORT }));
  });
  listener.requestTimeout = 15000;
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
    listener.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Invalid service configuration.');
  process.exit(1);
}
