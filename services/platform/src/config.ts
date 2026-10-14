import { z } from 'zod';
const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  PGHOST: z.string(),
  PGPORT: z.coerce.number().default(5432),
  PGUSER: z.string(),
  PGPASSWORD: z.string().min(16),
  PGDATABASE: z.string(),
  ENCRYPTION_KEY: z.string().regex(/^[a-f0-9]{64}$/),
  BOOTSTRAP_EMAIL: z.email(),
  BOOTSTRAP_PASSWORD: z.string().min(12),
  PUBLIC_URL: z.url().default('http://gateway.localhost:8080'),
  COOKIE_SECURE: z.enum(['true', 'false']).default('false'),
  UPSTREAM_TIMEOUT_MS: z.coerce.number().int().min(100).max(30000).default(10000),
  UPSTREAM_ALLOWED_HOSTS: z
    .string()
    .default('urumi-woocommerce-mcp,urumi-inventory-mcp,urumi-knowledge-mcp'),
  WOO_MCP_TOKEN: z.string().min(32),
  SUPPORT_MCP_TOKEN: z.string().min(32),
});
export type Config = z.infer<typeof schema>;
export function config(env = process.env): Config {
  const result = schema.safeParse(env);
  if (!result.success)
    throw new Error(
      'Invalid configuration fields: ' +
        result.error.issues.map((i) => i.path.join('.')).join(', '),
    );
  return result.data;
}
