import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { config } from "../src/config.js";
import { Database, type Principal } from "../src/database.js";
import {
  StoreRepository,
  StoreError,
  storeSettings,
  type ManagedStore,
} from "../src/stores.js";
import { StoreReconciler } from "../src/provisioner.js";
import { Kube, resourcePath } from "../src/kube.js";
import { Upstreams } from "../src/upstreams.js";
import { storeResources, labels } from "../src/store-resources.js";
class FakeKube {
  objects = new Map<string, any>();
  secretCreates = 0;
  calls = 0;
  async get(path: string) {
    this.calls++;
    if (path.endsWith("/persistentvolumeclaims"))
      return {
        items: [...this.objects.values()].filter(
          (o) =>
            o.kind === "PersistentVolumeClaim" &&
            path.includes("/" + o.metadata.namespace + "/"),
        ),
      };
    return this.objects.get(path) ?? null;
  }
  async create(o: any) {
    this.calls++;
    assert(!this.objects.has(resourcePath(o)), "duplicate creation");
    const value = structuredClone(o);
    if (value.kind === "Secret") {
      this.secretCreates++;
      value.data = Object.fromEntries(
        Object.entries(value.stringData).map(([k, v]) => [
          k,
          Buffer.from(String(v)).toString("base64"),
        ]),
      );
    }
    if (value.kind === "Job") value.status = { succeeded: 1 };
    this.objects.set(resourcePath(o), value);
    return value;
  }
  async apply(o: any) {
    this.calls++;
    const value = structuredClone(o);
    if (value.kind === "Deployment") {
      value.metadata.generation = 1;
      value.status = { readyReplicas: 1, observedGeneration: 1 };
    }
    if (value.kind === "PersistentVolumeClaim") {
      value.spec.volumeName =
        "pv-" + value.metadata.namespace + "-" + value.metadata.name;
      this.objects.set("/api/v1/persistentvolumes/" + value.spec.volumeName, {
        metadata: { name: value.spec.volumeName },
      });
    }
    this.objects.set(resourcePath(o), value);
    return value;
  }
  async delete(path: string) {
    this.calls++;
    if (path.startsWith("/api/v1/namespaces/")) {
      const ns = path.split("/").at(-1);
      for (const [key, value] of this.objects)
        if (
          value.metadata?.namespace === ns ||
          key === path ||
          key.includes("pv-" + ns + "-")
        )
          this.objects.delete(key);
    } else this.objects.delete(path);
  }
}
test("managed store manifests isolate networks and bound resources", () => {
  const s = {
    id: randomUUID(),
    namespace: "urumi-shop-123456789abc",
    name: "Test store",
    url: "http://shop-test.localhost:8080",
    spec: storeSettings(),
    attempt: 1,
  } as ManagedStore;
  const objects = storeResources(s);
  assert(objects.some((o) => o.kind === "ResourceQuota"));
  assert(objects.some((o) => o.kind === "LimitRange"));
  assert.equal(
    objects.filter((o) => o.kind === "PersistentVolumeClaim").length,
    2,
  );
  assert.equal(objects.filter((o) => o.kind === "Deployment").length, 3);
  const mcp = objects.find(
    (o) => o.kind === "NetworkPolicy" && o.metadata.name === "mcp",
  );
  assert.deepEqual(mcp.spec.egress[0].to, [
    { podSelector: { matchLabels: { app: "store" } } },
  ]);
  assert.equal(
    mcp.spec.ingress[0].from[0].namespaceSelector.matchLabels[
      "kubernetes.io/metadata.name"
    ],
    "urumi",
  );
  for (const d of objects.filter((o) => o.kind === "Deployment")) {
    assert.equal(d.spec.template.spec.automountServiceAccountToken, false);
    const c = d.spec.template.spec.containers[0];
    assert(
      c.readinessProbe &&
        c.livenessProbe &&
        c.resources.requests &&
        c.resources.limits,
    );
  }
});
test(
  "store queue idempotency quotas ownership recovery and complete deletion",
  { skip: !process.env.TEST_PG_PORT },
  async () => {
    const adminPool = new pg.Pool({
      host: "127.0.0.1",
      port: Number(process.env.TEST_PG_PORT),
      user: "urumi",
      password: process.env.TEST_PG_PASSWORD,
      database: "urumi",
    });
    const dbName = "bonus_" + randomUUID().replaceAll("-", "");
    await adminPool.query("CREATE DATABASE " + dbName);
    const cfg = config({
      PGHOST: "127.0.0.1",
      PGPORT: process.env.TEST_PG_PORT,
      PGUSER: "urumi",
      PGDATABASE: dbName,
      PGPASSWORD: process.env.TEST_PG_PASSWORD,
      ENCRYPTION_KEY: "ab".repeat(32),
      BOOTSTRAP_EMAIL: "admin@example.test",
      BOOTSTRAP_PASSWORD: "test-admin-password",
      WOO_MCP_TOKEN: "woo-test-token-".repeat(4),
      SUPPORT_MCP_TOKEN: "support-test-token-".repeat(4),
    } as NodeJS.ProcessEnv);
    const db = new Database(cfg);
    try {
      await db.initialize();
      const u = (await db.query("SELECT id,email,role FROM users LIMIT 1"))
        .rows[0] as Principal;
      const other = (
        await db.query(
          "INSERT INTO users(email,password_hash,role) VALUES('other@example.test','unused','member') RETURNING id,email,role",
        )
      ).rows[0] as Principal;
      const settings = storeSettings({
        STORES_ENABLED: "true",
        STORE_MAX_PER_USER: "2",
        STORE_MAX_TOTAL: "3",
        STORE_PROVISION_TIMEOUT_SECONDS: "60",
      });
      const repo = new StoreRepository(db.pool, settings),
        id = randomUUID();
      const duplicate = await Promise.all([
        repo.create(u, { id, name: "Sunday Studio" }),
        repo.create(u, { id, name: "Sunday Studio" }),
      ]);
      assert.equal(duplicate[0].id, duplicate[1].id);
      assert.equal((await repo.list(u)).length, 1);
      await assert.rejects(
        () => repo.remove(other, id),
        (e) => e instanceof StoreError && e.status === 404,
      );
      await assert.rejects(
        () => repo.create(other, { id, name: "Sunday Studio" }),
        (e) => e instanceof StoreError && e.status === 409,
      );
      const second = await repo.create(u, {
        id: randomUUID(),
        name: "Field Notes",
      });
      await assert.rejects(
        () => repo.create(u, { id: randomUUID(), name: "Over quota" }),
        (e) => e instanceof StoreError && e.status === 409,
      );
      const fake = new FakeKube();
      const worker = new StoreReconciler(
        db.pool,
        fake as unknown as Kube,
        cfg.ENCRYPTION_KEY,
      );
      await worker.tick();
      assert.equal(fake.secretCreates, 2);
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int n FROM managed_stores WHERE upstream_id IS NOT NULL",
          )
        ).rows[0].n,
        2,
      );
      const resumed = new StoreReconciler(
        db.pool,
        fake as unknown as Kube,
        cfg.ENCRYPTION_KEY,
      );
      await resumed.tick();
      assert.equal(fake.secretCreates, 2, "restart reuses credentials");
      await db.query("UPDATE upstreams SET status='Connected'");
      await resumed.tick();
      assert.equal((await repo.get(id))?.status, "Ready");
      const row = await repo.get(id);
      const upstream = (
        await db.query("SELECT * FROM upstreams WHERE id=$1", [
          row!.upstream_id,
        ])
      ).rows[0];
      const upstreams = new Upstreams(db);
      assert(
        (await upstreams.allowedHosts(upstream)).includes(
          "mcp." + row!.namespace + ".svc.cluster.local",
        ),
      );
      assert(
        !(
          await upstreams.allowedHosts({
            ...upstream,
            url: "http://mcp.urumi-shop-ffffffffffff.svc.cluster.local:3000/mcp",
          })
        ).includes("mcp.urumi-shop-ffffffffffff.svc.cluster.local"),
      );
      const memberView = await repo.list(other);
      assert.equal(memberView.length, 0);
      await repo.remove(u, id);
      assert.equal(
        (
          await db.query("SELECT id FROM upstreams WHERE id=$1", [
            row!.upstream_id,
          ])
        ).rowCount,
        0,
        "registration removed synchronously",
      );
      await resumed.tick();
      await resumed.tick();
      assert.equal((await repo.get(id))?.status, "Deleted");
      assert.equal(
        await fake.get("/api/v1/namespaces/" + row!.namespace),
        null,
      );
      assert.equal(
        (await repo.get(second.id))?.status,
        "Ready",
        "other store survives",
      );
      const slow = await repo.create(u, {
        id: randomUUID(),
        name: "Timeout test",
      });
      await db.query(
        "UPDATE managed_stores SET started_at=now()-interval '2 minutes' WHERE id=$1",
        [slow.id],
      );
      const before = fake.calls;
      await resumed.tick();
      assert.equal((await repo.get(slow.id))?.status, "Failed");
      assert.equal(
        fake.calls,
        before,
        "deadline checked before Kubernetes access",
      );
      await repo.retry(u, slow.id);
      await resumed.tick();
      assert.equal((await repo.get(slow.id))?.attempt, 2);
      assert.equal(fake.secretCreates, 3);
    } finally {
      await db.pool.end();
      await adminPool.query("DROP DATABASE " + dbName);
      await adminPool.end();
    }
  },
);
