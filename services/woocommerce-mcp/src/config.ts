import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  WOO_BASE_URL: z.url(),
  WOO_PUBLIC_URL: z.url(),
  WOO_CONSUMER_KEY: z.string().regex(/^ck_[a-f0-9]{40}$/),
  WOO_CONSUMER_SECRET: z.string().regex(/^cs_[a-f0-9]{40}$/),
  MCP_BEARER_TOKEN: z.string().min(32),
  STORE_TIMEZONE: z.string().default('Asia/Kolkata'),
  WOO_TIMEOUT_MS: z.coerce.number().int().min(100).max(60000).default(8000),
  ALLOWED_HOSTS: z.string().default('localhost,127.0.0.1,urumi-woocommerce-mcp,urumi-woocommerce-mcp.urumi.svc.cluster.local'),
});

export type Config = z.infer<typeof schema>;
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    // Print field names only: schema diagnostics must never disclose input credentials.
    throw new Error(`Invalid configuration fields: ${result.error.issues.map(i => i.path.join('.')).join(', ')}`);
  }
  const config = result.data;
  for (const value of [config.WOO_BASE_URL, config.WOO_PUBLIC_URL]) {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error('Store URLs must be HTTP(S), without embedded credentials, queries, or fragments.');
    }
  }
  new Intl.DateTimeFormat('en', { timeZone: config.STORE_TIMEZONE });
  return config;
}
