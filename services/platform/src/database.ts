import pg from 'pg';
import { readFile } from 'node:fs/promises';
import type { Config } from './config.js';
import { encrypt, passwordHash } from './security.js';
export type Principal = {
  id: string;
  email: string;
  role: 'admin' | 'member';
  keyId?: string;
  session?: string;
};
export type Upstream = {
  id: string;
  slug: string;
  name: string;
  url: string;
  credential: string | null;
  enabled: boolean;
  read_tools: string[];
  status: string;
  last_error: string | null;
};
export class Database {
  pool: pg.Pool;
  constructor(public config: Config) {
    this.pool = new pg.Pool({
      host: config.PGHOST,
      port: config.PGPORT,
      user: config.PGUSER,
      password: config.PGPASSWORD,
      database: config.PGDATABASE,
      max: 8,
      connectionTimeoutMillis: 5000,
      statement_timeout: 5000,
    });
  }
  async query<T extends pg.QueryResultRow = any>(sql: string, args: unknown[] = []) {
    return this.pool.query<T>(sql, args);
  }
  async initialize() {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(70124)');
      await client.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
      await client.query(
        'INSERT INTO users(email,password_hash,role) VALUES($1,$2,$3) ON CONFLICT(email) DO NOTHING',
        [
          this.config.BOOTSTRAP_EMAIL.toLowerCase(),
          await passwordHash(this.config.BOOTSTRAP_PASSWORD),
          'admin',
        ],
      );
      const entries = [
        [
          'store',
          'WooCommerce',
          'http://urumi-woocommerce-mcp:3000/mcp',
          this.config.WOO_MCP_TOKEN,
          ['list_products', 'list_orders', 'get_order'],
        ],
        [
          'inventory',
          'Demo inventory',
          'http://urumi-inventory-mcp:3000/mcp',
          this.config.SUPPORT_MCP_TOKEN,
          ['search', 'get_stock'],
        ],
        [
          'knowledge',
          'Store knowledge',
          'http://urumi-knowledge-mcp:3000/mcp',
          this.config.SUPPORT_MCP_TOKEN,
          ['search'],
        ],
      ];
      const seeded = (
        await client.query("SELECT key FROM platform_settings WHERE key='upstreams_seeded'")
      ).rowCount;
      if (!seeded)
        for (const [slug, name, url, value, reads] of entries)
          await client.query(
            'INSERT INTO upstreams(slug,name,url,credential,read_tools) VALUES($1,$2,$3,$4,$5) ON CONFLICT(slug) DO NOTHING',
            [
              slug,
              name,
              url,
              encrypt(
                { header: 'Authorization', value: 'Bearer ' + value },
                this.config.ENCRYPTION_KEY,
              ),
              reads,
            ],
          );
      if (!seeded)
        await client.query(
          "INSERT INTO platform_settings(key,value) VALUES('upstreams_seeded','true')",
        );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
