# Gateway architecture and tradeoffs

The gateway is an MCP server to external clients and an MCP client to registered upstreams. One public endpoint aggregates WooCommerce, demo inventory, and store knowledge. The dashboard API shares the backend. The React dashboard includes a bounded chat loop that uses a short-lived user-scoped MCP credential through the same public protocol handler.

## Discovery and routing

Upstream URLs, credentials, enabled flags, and member-readable tool names are persisted in PostgreSQL. Initial registrations are seeded once; a durable marker prevents deleted defaults from reappearing on restart. Display-name edits do not change stable server slugs.

The public name is `server-slug__original-tool-name`, for example `inventory__search` and `knowledge__search`. Unusually long or invalid names use a stable hash suffix within the 64-character limit. Routing uses discovered original names, not arbitrary paths supplied by the caller.

Each upstream has an independent SDK client, cached catalog, bounded connection/discovery deadline, and bounded call timeout. Background refresh runs every 15 seconds. Discovery reads cached catalogs and current database authorization/enabled state; it does not wait for upstream network calls. Failed refresh retains a previously discovered catalog, allowing useful unreachable errors. If the gateway has never discovered an unavailable server, it cannot expose that server's unknown tools.

Disabled or removed servers disappear on the next tool-list request and are rejected if called using an old name. Clients that cache tool menus must refresh/reconnect; this stateless endpoint does not publish a persistent `tools/list_changed` event stream. Authorization does not depend on that UI refresh.

Streamable HTTP uses a fresh server/transport per POST with JSON responses. User credentials are verified on every request, including requests from an already connected SDK client. GET/DELETE MCP requests return 405. The current deployment uses one replica; distributed rate limiting and multi-replica behavior are not claimed.

## Supporting services

Inventory exposes `search` and `get_stock`; knowledge exposes `search`. Inventory is explicitly synthetic, with a seeded stock count and reorder threshold for the demo SKU; it is not synchronized with WooCommerce. Knowledge supplies test payment/shipping guidance. These services intentionally share a tool name to exercise collision handling.

An example workflow retrieves store products and consults inventory by SKU, then reads store guidance. The SDK integration check exercises cross-service calls. Chat routing and permissions pass controlled-provider integration tests and live-model checks: product creation, guest checkout, today’s orders, a two-upstream workflow, and member write refusal. See [chat and operations](chat-and-operations.md).

## Storage and deployment

PostgreSQL is separate from the WooCommerce MariaDB database. Schema initialization is transactional and protected by a PostgreSQL advisory lock. The initial schema version is recorded; future schema changes must be explicit migrations. Bootstrap does not overwrite existing passwords, server edits, disables, or removals.

Helm deploys the gateway, PostgreSQL, inventory, and knowledge as distinct workloads. The application image contains their common runtime, selected through a mode variable; their pods and network policies are independent. The gateway and MCP service containers run non-root with read-only root filesystems, dropped capabilities, no privilege escalation, and no Kubernetes API token. The optional store provisioner uses a separate service account with scoped Kubernetes API access; see [managed-store provisioning](multi-store.md). Every workload has probes and resource requests/limits.

The platform database PVC has a Helm retention annotation. Disabling/uninstalling the platform does not automatically destroy this claim; explicit deletion and backups require operator care. Retention is not replication, backup, or high availability.

Local URLs use `*.localhost`, with Ingress on loopback port 8080. Production values change domains, image registry, TLS Secrets, secure cookies, and disk sizes. The same chart has been deployed on Azure k3s with HTTPS. The checked-in production values are a template: each installation supplies its own domains, images, storage settings, and Secrets. See [deployment configuration](production-deployment.md).

## Network boundaries

The storefront and gateway/dashboard are public through Ingress; MCP upstream services and databases remain internal. Managed stores also have public storefront hosts. Internal MCP ingress accepts gateway-labeled pods and also requires upstream bearer credentials. Gateway ingress admits Traefik. Gateway egress allows DNS, its PostgreSQL database, the three core internal MCP Services, managed-store MCP services when provisioning is enabled, and external HTTPS with private/reserved IPv4 ranges excluded. It cannot call WordPress or either store database directly. Supporting services have DNS-only egress; WooCommerce MCP reaches only DNS and WordPress. Namespace-wide default deny also isolates new, unclassified pods.

An administrator can add public HTTPS upstreams with optional static header or bearer credentials. Additional trusted internal hosts need explicit server configuration and NetworkPolicy changes. Credentials, fragments and query parameters embedded in registration URLs are rejected. External IPv6 destinations are conservatively rejected for now. Redirects are refused.

URL validation and the actual socket DNS lookup reject non-public external destinations, including cloud metadata and mixed DNS answers. Validated addresses are passed directly to the connection, and redirects are refused. Explicitly configured internal MCP names bypass the public-address rule on HTTP port 3000. Managed-store MCP destinations additionally require an exact URL/upstream-ID match to an active managed-store record; see [managed-store trust and isolation](multi-store.md). Public IPv6 integrations are intentionally unsupported. Internal transport encryption and broader external integration compatibility remain production considerations.

## Verification

`bash scripts/check-platform-local.sh` starts a disposable real PostgreSQL instance and runs the full protocol/access integration tests. Ordinary `npm test` skips this database-dependent test unless its test database environment is supplied.

`python3 scripts/check-platform-cluster.py` verifies two users and the real store, eight admin tools versus six member tools, collision routing, cross-server calls, disabling, revocation on an existing connection, audit attribution, a controlled inventory outage/recovery, and database/gateway restart persistence. It deliberately changes local demo state and retains one gateway-created demo product. It restores inventory's replica count in a finally block. Use only the dedicated local cluster.

External clients use `http://gateway.localhost:8080/mcp` and their own `Authorization: Bearer <user-key>` header. They receive no upstream credentials. HTTPS is required for a remote deployment.

## Primary references

- [MCP TypeScript client guide](https://ts.sdk.modelcontextprotocol.io/client)
- [MCP TypeScript server guide](https://ts.sdk.modelcontextprotocol.io/server)
- [node-postgres transactions](https://node-postgres.com/features/transactions)

## Production configuration and lifecycle

The same chart is deployed on Azure k3s with public HTTPS, independent installation Secrets, immutable CPU-compatible images imported over SSH, and larger local-path claims. No application routing logic or separate chart fork was needed. The Kubernetes API remains private behind an SSH tunnel. See [deployment details](production-deployment.md) and [upgrade/recovery](upgrades-and-recovery.md). A clean installation and isolated primary-store backup/restore rehearsal passed; one VM and local disks are intentionally not highly available.
