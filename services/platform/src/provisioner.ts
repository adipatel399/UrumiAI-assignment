import express from "express";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { encrypt } from "./security.js";
import { Kube, KubeError, resourcePath } from "./kube.js";
import { storeSettings, type ManagedStore } from "./stores.js";
import {
  labels,
  managedBy,
  storeResources,
  freshStoreSecret,
} from "./store-resources.js";

export class StoreReconciler {
  constructor(
    public pool: pg.Pool,
    public kube: Kube,
    public encryptionKey: string,
  ) {}
  async active(id: string, status: string) {
    return !!(
      await this.pool.query(
        "SELECT id FROM managed_stores WHERE id=$1 AND status=$2",
        [id, status],
      )
    ).rowCount;
  }
  async stage(s: ManagedStore, stage: string) {
    await this.pool.query(
      `UPDATE managed_stores SET stage=$2,error=NULL,updated_at=now() WHERE id=$1 AND status=$3`,
      [s.id, stage, s.status],
    );
  }
  owned(s: ManagedStore, o: any) {
    if (
      o.metadata?.labels?.["urumi.io/store-id"] !== s.id ||
      o.metadata?.labels?.["app.kubernetes.io/managed-by"] !== managedBy
    )
      throw new Error(
        "Ownership check failed; refusing to adopt or delete existing resources.",
      );
  }
  async reconcile(s: ManagedStore) {
    const nsPath = "/api/v1/namespaces/" + s.namespace;
    if (!/^urumi-shop-[a-f0-9]{12}$/.test(s.namespace))
      throw new Error("Invalid managed namespace.");
    if (
      s.status === "Provisioning" &&
      Date.now() - new Date(s.started_at).getTime() >
        s.spec.STORE_PROVISION_TIMEOUT_SECONDS * 1000
    ) {
      await this.fail(
        s,
        "Provisioning timed out at " +
          s.stage +
          ". Retry to resume, or delete this store.",
      );
      return;
    }
    let ns = await this.kube.get(nsPath);
    if (ns) this.owned(s, ns);
    if (s.status === "Deleting") {
      await this.pool.query("DELETE FROM upstreams WHERE id=$1", [
        s.upstream_id,
      ]);
      if (ns) {
        if (!ns.metadata.deletionTimestamp) {
          const pvcs = await this.kube.get(
            "/api/v1/namespaces/" + s.namespace + "/persistentvolumeclaims",
          );
          const names = (pvcs?.items ?? [])
            .map((p: any) => p.spec.volumeName)
            .filter(Boolean);
          await this.pool.query(
            "UPDATE managed_stores SET volume_names=$2 WHERE id=$1",
            [s.id, names],
          );
          await this.stage(s, "Deleting namespace and volumes");
          await this.kube.delete(nsPath);
        }
        return;
      }
      for (const name of s.volume_names)
        if (await this.kube.get("/api/v1/persistentvolumes/" + name)) {
          await this.stage(s, "Waiting for storage reclamation");
          return;
        }
      await this.pool.query(
        `UPDATE managed_stores SET status='Deleted',stage='Deleted',deleted_at=now(),updated_at=now(),error=NULL WHERE id=$1 AND status='Deleting'`,
        [s.id],
      );
      return;
    }
    if (s.status !== "Provisioning") return;
    if (
      Date.now() - new Date(s.started_at).getTime() >
      s.spec.STORE_PROVISION_TIMEOUT_SECONDS * 1000
    ) {
      await this.fail(
        s,
        "Provisioning timed out at " +
          s.stage +
          ". Retry to resume, or delete this store.",
      );
      return;
    }
    if (!ns) {
      await this.stage(s, "Creating isolated namespace");
      ns = await this.kube.create({
        apiVersion: "v1",
        kind: "Namespace",
        metadata: { name: s.namespace, labels: labels(s) },
      });
    }
    if (ns.metadata.deletionTimestamp) {
      await this.fail(
        s,
        "Namespace is terminating. Delete this record and create a new store.",
      );
      return;
    }
    const binding = {
      apiVersion: "rbac.authorization.k8s.io/v1",
      kind: "RoleBinding",
      metadata: {
        name: "urumi-store-provisioner",
        namespace: s.namespace,
        labels: labels(s),
      },
      roleRef: {
        apiGroup: "rbac.authorization.k8s.io",
        kind: "ClusterRole",
        name: s.spec.STORE_PLATFORM_RELEASE + "-store-resources",
      },
      subjects: [
        {
          kind: "ServiceAccount",
          name: s.spec.STORE_PLATFORM_RELEASE + "-provisioner",
          namespace: s.spec.STORE_GATEWAY_NAMESPACE,
        },
      ],
    };
    const oldBinding = await this.kube.get(resourcePath(binding));
    if (oldBinding) this.owned(s, oldBinding);
    else await this.kube.create(binding);
    const secretPath =
      "/api/v1/namespaces/" + s.namespace + "/secrets/store-credentials";
    let secret = await this.kube.get(secretPath);
    if (secret) this.owned(s, secret);
    else
      secret = await this.kube.create({
        apiVersion: "v1",
        kind: "Secret",
        metadata: {
          name: "store-credentials",
          namespace: s.namespace,
          labels: labels(s),
        },
        type: "Opaque",
        stringData: freshStoreSecret(),
      });
    if (!secret.data?.MCP_BEARER_TOKEN)
      throw new Error(
        "Stored credentials are incomplete. Refusing to regenerate them.",
      );
    const objects = storeResources(s);
    for (const o of objects) {
      if (!(await this.active(s.id, "Provisioning"))) return;
      const old = await this.kube.get(resourcePath(o));
      if (old) this.owned(s, old);
      if (o.kind === "Job") {
        if (!old) await this.kube.create(o);
      } else await this.kube.apply(o);
    }
    const job = await this.kube.get(
      "/apis/batch/v1/namespaces/" +
        s.namespace +
        "/jobs/bootstrap-" +
        s.attempt,
    );
    if (
      job?.status?.conditions?.some(
        (c: any) => c.type === "Failed" && c.status === "True",
      )
    ) {
      await this.fail(
        s,
        "Store initialization failed. Check the bootstrap job logs, then retry or delete.",
      );
      return;
    }
    if (!job?.status?.succeeded) {
      await this.stage(s, "Initializing WooCommerce and storefront");
      return;
    }
    for (const name of ["database", "store", "mcp"]) {
      const d = await this.kube.get(
        "/apis/apps/v1/namespaces/" + s.namespace + "/deployments/" + name,
      );
      if (
        !d ||
        d.status?.observedGeneration < d.metadata.generation ||
        d.status?.readyReplicas !== 1
      ) {
        await this.stage(s, "Waiting for " + name + " health checks");
        return;
      }
    }
    if (s.spec.STORE_TLS_ISSUER) {
      const cert = await this.kube.get(
        "/apis/cert-manager.io/v1/namespaces/" +
          s.namespace +
          "/certificates/store-tls",
      );
      if (
        !cert?.status?.conditions?.some(
          (c: any) => c.type === "Ready" && c.status === "True",
        )
      ) {
        await this.stage(s, "Securing storefront with HTTPS");
        return;
      }
    }
    if (!s.upstream_id) {
      const c = await this.pool.connect();
      try {
        await c.query("BEGIN");
        const locked = (
          await c.query<ManagedStore>(
            "SELECT * FROM managed_stores WHERE id=$1 FOR UPDATE",
            [s.id],
          )
        ).rows[0];
        if (locked.status !== "Provisioning") {
          await c.query("ROLLBACK");
          return;
        }
        if (!locked.upstream_id) {
          const token = Buffer.from(
            secret.data.MCP_BEARER_TOKEN,
            "base64",
          ).toString();
          const inserted = await c.query(
            `INSERT INTO upstreams(slug,name,url,credential,read_tools) VALUES($1,$2,$3,$4,$5) ON CONFLICT(slug) DO UPDATE SET name=EXCLUDED.name RETURNING id`,
            [
              s.slug,
              s.name + " store",
              "http://mcp." + s.namespace + ".svc.cluster.local:3000/mcp",
              encrypt(
                { header: "Authorization", value: "Bearer " + token },
                this.encryptionKey,
              ),
              ["list_products", "list_orders", "get_order"],
            ],
          );
          await c.query(
            `UPDATE managed_stores SET upstream_id=$2,stage='Connecting gateway',updated_at=now() WHERE id=$1`,
            [s.id, inserted.rows[0].id],
          );
        }
        await c.query("COMMIT");
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
      return;
    }
    const upstream = (
      await this.pool.query("SELECT status FROM upstreams WHERE id=$1", [
        s.upstream_id,
      ])
    ).rows[0];
    if (upstream?.status === "Connected")
      await this.pool.query(
        `UPDATE managed_stores SET status='Ready',stage='Ready',error=NULL,updated_at=now() WHERE id=$1 AND status='Provisioning'`,
        [s.id],
      );
    else await this.stage(s, "Connecting gateway");
  }
  async fail(s: ManagedStore, message: string) {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const row = (
        await c.query<ManagedStore>(
          "SELECT * FROM managed_stores WHERE id=$1 FOR UPDATE",
          [s.id],
        )
      ).rows[0];
      if (row.status === "Provisioning") {
        if (row.upstream_id)
          await c.query("DELETE FROM upstreams WHERE id=$1", [row.upstream_id]);
        await c.query(
          `UPDATE managed_stores SET status='Failed',stage='Needs attention',error=$2,updated_at=now() WHERE id=$1`,
          [s.id, message],
        );
      }
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  async tick() {
    const rows = (
      await this.pool.query<ManagedStore>(
        `SELECT * FROM managed_stores WHERE status IN ('Provisioning','Deleting') ORDER BY updated_at LIMIT 20`,
      )
    ).rows;
    // Each process reconciles two stores concurrently. Advisory locks fence out another worker.
    for (let i = 0; i < rows.length; i += 2)
      await Promise.all(
        rows.slice(i, i + 2).map(async (s) => {
          const c = await this.pool.connect();
          let locked = false;
          try {
            locked = (
              await c.query(
                "SELECT pg_try_advisory_lock(hashtext($1)) AS locked",
                ["urumi-store:" + s.id],
              )
            ).rows[0].locked;
            if (!locked) return;
            const fresh = (
              await c.query<ManagedStore>(
                "SELECT * FROM managed_stores WHERE id=$1",
                [s.id],
              )
            ).rows[0];
            await this.reconcile(fresh);
          } catch (e) {
            const message =
              e instanceof KubeError
                ? "Kubernetes access failed (HTTP " + e.status + ")."
                : e instanceof Error &&
                    /Ownership|Invalid managed|credentials are incomplete/.test(
                      e.message,
                    )
                  ? e.message
                  : "Provisioning step could not complete. The worker will retry.";
            await this.pool.query(
              "UPDATE managed_stores SET error=$2,updated_at=now() WHERE id=$1 AND status IN ('Provisioning','Deleting')",
              [s.id, message],
            );
          } finally {
            if (locked)
              await c.query("SELECT pg_advisory_unlock(hashtext($1))", [
                "urumi-store:" + s.id,
              ]);
            c.release();
          }
        }),
      );
  }
}
export async function runProvisioner() {
  storeSettings();
  const key = process.env.ENCRYPTION_KEY;
  if (!key || !/^[a-f0-9]{64}$/.test(key))
    throw new Error("Worker encryption key is required.");
  const pool = new pg.Pool({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT ?? 5432),
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    max: 8,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
  });
  const kube = new Kube();
  const worker = new StoreReconciler(pool, kube, key);
  let running = false,
    healthy = false,
    stopping = false;
  const tick = async () => {
    if (running || stopping) return;
    running = true;
    try {
      await worker.tick();
      healthy = true;
    } catch {
      healthy = false;
      console.error("Store queue check failed; retrying.");
    } finally {
      running = false;
    }
  };
  const app = express();
  app.get("/healthz", (_q, r) => r.json({ status: "ok" }));
  app.get("/readyz", (_q, r) =>
    r.status(healthy ? 200 : 503).json({ ready: healthy }),
  );
  const listener = app.listen(3000, "0.0.0.0");
  const timer = setInterval(() => void tick(), 5000);
  void tick();
  const shutdown = () => {
    stopping = true;
    clearInterval(timer);
    listener.close();
    const wait = setInterval(() => {
      if (!running) {
        clearInterval(wait);
        void pool
          .end()
          .then(() => kube.close())
          .then(() => process.exit(0));
      }
    }, 100);
    setTimeout(() => process.exit(1), 20000).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  console.log(
    JSON.stringify({ event: "provisioner_started", instance: randomUUID() }),
  );
}
