# Managed stores

Enable `provisioning.enabled` in the same Helm chart. The Stores page lets any signed-in user create stores, see progress, open the storefront, retry failures, and delete their own stores. Admins can manage all stores. Store administration ownership is separate from team tool access: all enabled stores contribute tools to the shared team gateway, filtered by the existing role allowlists. This is a team platform, not a multi-tenant customer isolation claim.

## Configuration

```yaml
provisioning:
  enabled: true
  baseDomain: YOUR_PUBLIC_IP.sslip.io
  publicPort: ""
  apiServerCidr: YOUR_NODE_INTERNAL_IP/32
  storageClass: local-path
  maxPerUser: 3
  maxTotal: 4
  timeoutSeconds: 900
```

For local k3d use `baseDomain: localhost`, `publicPort: "8080"`, and the k3d server container's internal IP as `apiServerCidr`. Wildcard localhost resolves store hosts locally. On the VPS, public wildcard DNS points each stable random host to the same Ingress controller. `tls.enabled` also enables a shared ClusterIssuer; every managed host gets a separate certificate. The configured store/database/MCP images must be available on the node before creation. Kubernetes 1.30+ with ValidatingAdmissionPolicy is required; the verified environments use k3s 1.35.

## Responsibilities and lifecycle

The gateway records a durable request in PostgreSQL and responds promptly. A separate provisioner deployment watches pending work. The gateway has no Kubernetes API token. Each store gets a namespace, independent MariaDB and WordPress content claims (2 GiB each), generated Secrets, three deployments, bootstrap Job, Services, Ingress, ResourceQuota, LimitRange, and default-deny NetworkPolicies. Images come from operator Helm values, never a user-entered image or manifest.

The client keeps a UUID for each create request. Repeating it returns the same store; another owner or name cannot reuse it. Quota checks run under a transaction lock. The worker takes a database advisory lock per store, reconciles resources idempotently, preserves existing credentials, and processes two stores concurrently. A restart resumes persisted work. Failed jobs or the provisioning deadline produce a visible Failed state with a reason. Retry increments the attempt, reuses the namespace and credentials, and creates a new bootstrap Job. Failed stores consume capacity until deleted.

Ready requires successful initialization, healthy workloads, a valid certificate when enabled, and successful gateway tool discovery. MCP registration credentials are encrypted using the platform key. A store contributes five admin tools and three member read tools, prefixed `shop-NAME-RANDOM__`. Dynamic private destinations are trusted only when an exact upstream ID and URL match a managed-store database record. Arbitrary admin URLs retain the normal SSRF restrictions.

Delete immediately removes the upstream registration, then the worker deletes the namespace and waits for both namespace and bound volumes to disappear. StorageClass reclaimPolicy must be Delete. The status remains Deleting if the storage provider has not reclaimed a volume; it never falsely reports successful teardown.

## Isolation and privilege limits

A store MCP pod can reach its own WordPress service but cannot reach another namespace's WordPress or MariaDB. Only the gateway can call store MCP services. WordPress can reach only its own database; DNS and Ingress have narrowly scoped exceptions. Each namespace has a 1 CPU/1 GiB request budget, 4 CPU/3 GiB limit budget, two claims/4 GiB storage budget and six-pod cap; individual containers have requests, limits and probes.

The provisioner can create/delete managed namespaces and bind only its named store resource role. Admission policies restrict its namespace operations and RoleBindings to the managed prefix, ownership labels and fixed service account/role. Resource privileges are bound within each managed namespace, rather than across all namespaces. It cannot read primary-namespace Secrets. It can read its own PostgreSQL/encryption credentials because registration requires them. Compromise of the worker remains a risk to all managed stores; namespace isolation does not protect against a cluster administrator or node compromise.

## Verification and demo

`services/platform/test/stores.test.ts` tests manifest isolation plus real PostgreSQL ownership, concurrent idempotency, limits, retry, timeout, worker resume and registration removal. Live local checks additionally restart the worker during initialization, confirm Ready, delete the store, and verify its namespace and PVs disappear. Positive/negative TCP checks verify the NetworkPolicies on actual pods.

For the bonus demonstration, create two stores, place a guest COD order in each, then ask chat to compare today's orders across those two named stores. Show both namespaced list_orders calls. Delete one through Stores, confirm its tools disappear, and show its namespace/PVs gone while the other remains Ready. Do not present database rows or a mock status as proof of provisioning.

## Tradeoffs and recovery

This remains a single-node assessment deployment; local-path claims do not survive node loss. Ready describes completed provisioning, not a continuous storefront uptime monitor. Integration status continues monitoring MCP reachability. The total store cap protects this VM; raising it requires measuring memory, disk and CPU. The Groq free plan can rate-limit a tool loop; successful writes must not be replayed blindly.

The existing backup/restore scripts support the primary-store format and refuse to run when managed namespaces exist. Full managed-store disaster recovery is not claimed. Before production use, implement coordinated PostgreSQL, per-store MariaDB/content, Secret and resource backups (or CSI snapshots), encrypt them off-node, and rehearse restore with the matching platform encryption key. Helm rollback changes templates/images; it does not roll back these databases or store lifecycle operations. The provisioner does not automatically upgrade images of already-created stores: their recorded specification is retained. Plan and test store data/image migrations separately.

On the Azure deployment, concurrent stores reached Ready with valid HTTPS, guest orders #19 and #20 were placed in independent stores, and the real chat loop returned both namespaced order reads and compared their counts/totals. The compared Field Notes store was then deleted through the dashboard: its tools disappeared, its namespace and bound PVs were absent, and Sunday Studio continued serving HTTPS. A replacement Field Notes store was created from the dashboard. Audit entries attribute the managed-store reads to the signed-in administrator. Store IDs and order IDs are installation-specific and change during destructive demonstrations.
