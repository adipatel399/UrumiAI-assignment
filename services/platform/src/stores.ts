import pg from "pg";
import { z } from "zod";
import type { Principal } from "./database.js";

const settingsSchema = z.object({
  STORES_ENABLED: z.enum(["true", "false"]).default("false"),
  STORE_BASE_DOMAIN: z
    .string()
    .regex(/^[a-z0-9.-]+$/)
    .default("localhost"),
  STORE_PUBLIC_SCHEME: z.enum(["http", "https"]).default("http"),
  STORE_PUBLIC_PORT: z
    .string()
    .regex(/^([0-9]{1,5})?$/)
    .default("8080"),
  STORE_PLATFORM_RELEASE: z.string().regex(/^[a-z0-9-]+$/).default("urumi"),
  STORE_GATEWAY_NAMESPACE: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .default("urumi"),
  STORE_WORDPRESS_IMAGE: z.string().default("urumi-store:0.1.0"),
  STORE_DATABASE_IMAGE: z
    .string()
    .default(
      "docker.io/library/mariadb:11.4@sha256:1292844148b311e4ed4300022a996d39083f415a963e970cf47cad1b3b18e3a6",
    ),
  STORE_MCP_IMAGE: z.string().default("urumi-woocommerce-mcp:0.1.0"),
  STORE_STORAGE_CLASS: z.string().default("local-path"),
  STORE_TLS_ISSUER: z.string().default(""),
  STORE_MAX_PER_USER: z.coerce.number().int().min(1).max(10).default(3),
  STORE_MAX_TOTAL: z.coerce.number().int().min(1).max(20).default(4),
  STORE_PROVISION_TIMEOUT_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(3600)
    .default(900),
});
export type StoreSettings = z.infer<typeof settingsSchema>;
export const storeSettings = (env = process.env) => settingsSchema.parse(env);
export type ManagedStore = {
  id: string;
  owner_id: string;
  name: string;
  namespace: string;
  slug: string;
  url: string;
  spec: StoreSettings;
  status: "Provisioning" | "Ready" | "Failed" | "Deleting" | "Deleted";
  stage: string;
  error: string | null;
  attempt: number;
  upstream_id: string | null;
  volume_names: string[];
  created_at: Date;
  started_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
};
export class StoreError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export class StoreRepository {
  constructor(
    public pool: pg.Pool,
    public settings: StoreSettings,
  ) {}
  publicConfig() {
    return {
      enabled: this.settings.STORES_ENABLED === "true",
      max_per_user: this.settings.STORE_MAX_PER_USER,
      max_total: this.settings.STORE_MAX_TOTAL,
      timeout_seconds: this.settings.STORE_PROVISION_TIMEOUT_SECONDS,
    };
  }
  async list(user: Principal) {
    return (
      await this.pool.query(
        `SELECT s.id,s.owner_id,u.email AS owner_email,s.name,s.namespace,s.slug,s.url,s.status,s.stage,s.error,s.attempt,s.upstream_id,s.created_at,s.started_at,s.updated_at,
    COALESCE((SELECT json_agg(json_build_object('name',v,'public_name',s.slug||'__'||v)) FROM unnest($3::text[])v),'[]') AS tools
    FROM managed_stores s JOIN users u ON u.id=s.owner_id WHERE s.status<>'Deleted' AND ($1::boolean OR s.owner_id=$2) ORDER BY s.created_at DESC`,
        [
          user.role === "admin",
          user.id,
          user.role === "admin"
            ? [
                "list_products",
                "create_product",
                "list_orders",
                "get_order",
                "update_order_status",
              ]
            : ["list_products", "list_orders", "get_order"],
        ],
      )
    ).rows;
  }
  async get(id: string) {
    return (
      await this.pool.query<ManagedStore>(
        "SELECT * FROM managed_stores WHERE id=$1",
        [id],
      )
    ).rows[0];
  }
  async create(user: Principal, input: { id: string; name: string }) {
    if (this.settings.STORES_ENABLED !== "true")
      throw new StoreError(
        503,
        "Store provisioning is not enabled on this installation.",
      );
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(70126)");
      const old = (
        await client.query<ManagedStore>(
          "SELECT * FROM managed_stores WHERE id=$1",
          [input.id],
        )
      ).rows[0];
      if (old) {
        if (old.owner_id !== user.id || old.name !== input.name)
          throw new StoreError(409, "This request ID has already been used.");
        await client.query("COMMIT");
        return old;
      }
      const counts = (
        await client.query(
          `SELECT count(*)::int total,count(*) FILTER(WHERE owner_id=$1)::int owned FROM managed_stores WHERE status<>'Deleted'`,
          [user.id],
        )
      ).rows[0];
      if (counts.owned >= this.settings.STORE_MAX_PER_USER)
        throw new StoreError(
          409,
          "Your store limit has been reached. Delete an existing store before creating another.",
        );
      if (counts.total >= this.settings.STORE_MAX_TOTAL)
        throw new StoreError(
          409,
          "This installation has reached its store capacity.",
        );
      const key = input.id.replaceAll("-", "").slice(0, 12);
      const namespace = "urumi-shop-" + key;
      const slug =
        "shop-" +
        (input.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 18) || "store") +
        "-" +
        key.slice(0, 6);
      const host = "shop-" + key + "." + this.settings.STORE_BASE_DOMAIN;
      const url =
        this.settings.STORE_PUBLIC_SCHEME +
        "://" +
        host +
        (this.settings.STORE_PUBLIC_PORT
          ? ":" + this.settings.STORE_PUBLIC_PORT
          : "");
      const row = (
        await client.query<ManagedStore>(
          "INSERT INTO managed_stores(id,owner_id,name,namespace,slug,url,spec) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
          [input.id, user.id, input.name, namespace, slug, url, this.settings],
        )
      ).rows[0];
      await client.query("COMMIT");
      return row;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  async authorize(user: Principal, id: string) {
    const row = await this.get(id);
    if (!row || (row.owner_id !== user.id && user.role !== "admin"))
      throw new StoreError(404, "Store not found.");
    return row;
  }
  async retry(user: Principal, id: string) {
    await this.authorize(user, id);
    const r = await this.pool.query(
      `UPDATE managed_stores SET status='Provisioning',stage='Queued for retry',error=NULL,attempt=attempt+1,started_at=now(),updated_at=now() WHERE id=$1 AND status='Failed' RETURNING *`,
      [id],
    );
    if (!r.rowCount)
      throw new StoreError(409, "Only failed stores can be retried.");
    return r.rows[0];
  }
  async remove(user: Principal, id: string) {
    await this.authorize(user, id);
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const row = (
        await c.query<ManagedStore>(
          "SELECT * FROM managed_stores WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (row.status !== "Deleted") {
        await c.query(
          `UPDATE managed_stores SET status='Deleting',stage='Removing gateway tools',error=NULL,updated_at=now() WHERE id=$1`,
          [id],
        );
        if (row.upstream_id)
          await c.query("DELETE FROM upstreams WHERE id=$1", [row.upstream_id]);
      }
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
}
