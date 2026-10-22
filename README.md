# Urumi team MCP gateway

A WooCommerce hosting platform on Kubernetes with a shared MCP gateway and React dashboard. Admins connect integrations once; teammates use their permitted tools through dashboard chat or one external MCP endpoint with a personal API key.

## What the app does

- Runs a WooCommerce storefront with cart, guest checkout and cash-on-delivery test orders.
- Exposes products and orders through a custom WooCommerce MCP server using Streamable HTTP and the WooCommerce REST API.
- Aggregates WooCommerce, demo inventory and knowledge tools, with namespaced routing, per-role permissions and upstream timeouts.
- Provides a chat agent that calls the gateway as the signed-in user, with explicit approval for writes and visible tool activity.
- Manages team invitations, personal API keys, revocation, attributed audit logs and per-server metrics.
- Optionally provisions independent stores from the dashboard, with automatic MCP registration, namespace isolation, quotas, retry and clean deletion.

The same Helm chart runs on local k3d and has been deployed on Azure k3s with HTTPS. Live assessment deployment: [storefront](https://store.85.211.243.237.sslip.io/shop/) · [dashboard](https://gateway.85.211.243.237.sslip.io/). Dashboard access requires privately supplied credentials; the deployment is temporary.

## Reviewer access

Use the dedicated live demo accounts in [reviewer-access.json](docs/reviewer-access.json). Both dashboard roles and a WooCommerce shop-manager login are included. Follow the [reviewer walkthrough](docs/reviewer-guide.md) to check the two-user flow, tool permissions, audit, failure isolation and store provisioning. These are intentionally public demo accounts; provider and infrastructure credentials are excluded. The local setup credentials below are generated separately on your own machine.

## Screenshots

Captured from the running assessment deployment. Products, counts and available stores change as the demo is used.

### Team workspace

![Workspace overview with integration status, available tools and attributed recent activity](docs/images/workspace.png)

### WooCommerce storefront

![Urumi Studio storefront with product photography and collection navigation](docs/images/storefront.png)

## Quick start

Requirements: a running Docker engine with approximately 8 GB available, kubectl, Helm, k3d 5.9, Python 3, and Node.js 22 with npm. Run from the repository root:

```sh
bash scripts/local-up.sh
```

The script creates or starts the dedicated local cluster, builds/imports images, generates Kubernetes Secrets, installs the Helm chart, and initializes the store, custom MCP server, gateway and supporting integrations. Re-running preserves existing credentials and registrations but briefly restarts local workloads.

| Open | Local URL | Credentials |
| --- | --- | --- |
| Dashboard | http://gateway.localhost:8080/ | [Dashboard login fields — example only](docs/examples/platform-credentials.example.json) |
| Storefront | http://store.localhost:8080/shop/ | Guest checkout |
| WooCommerce admin | http://store.localhost:8080/wp-admin/ | [Store login fields — example only](docs/examples/store-credentials.example.json) |
| Gateway MCP | `http://gateway.localhost:8080/mcp` | Personal API key from the dashboard |

Browsers resolve `*.localhost` to loopback; the cluster exposes Ingress on loopback port 8080. The credential links above open example JSON files on GitHub; their password values are placeholders. After local setup, open `.local/platform-credentials.json` for the actual dashboard login and `.local/store-credentials.json` for the actual WooCommerce admin login. Those files are generated on your machine, ignored by Git, and unavailable through GitHub. Keep them private and out of recordings. Chat additionally needs a provider key; setup and the non-chat features do not.

### Use chat

Run `python3 scripts/configure-chat.py`, enter the provider settings in the generated `.local/llm-credentials.json`, then rerun the helper. Sign into the dashboard and open **AI workspace**. Ask for today's orders, or enable **Approve changes for this message** to request a product creation as an admin. Activity shows the actual gateway tool calls. See [provider setup and chat behavior](docs/chat-and-operations.md).

### Place an order

Open the storefront, add a product, and check out with fictional billing details and **Cash on delivery**. Confirm the matching order in **WooCommerce → Orders**, then ask chat for today's orders. For the create-to-order flow, buy the exact product that chat created.

### Connect an external MCP client

In **API keys**, create a personal key. Configure your Streamable HTTP client with endpoint `http://gateway.localhost:8080/mcp` and header `Authorization: Bearer YOUR_USER_KEY`. For the live deployment, use `https://gateway.85.211.243.237.sslip.io/mcp`. Members see permitted read tools; admin-only writes are hidden and rejected on direct invocation. Refresh discovery after integration changes. See [Inspector setup and two-user walkthrough](docs/demo-runbook.md).

### Create another store

Enable Helm `provisioning` settings, then use **Stores** to create, inspect, retry or delete a store. Provisioning is disabled in the default values. Each new store gets its own namespace, database, Secrets, persistent volumes, Ingress host and MCP server. See [multi-store setup and guardrails](docs/multi-store.md).

## Verification

```sh
npm ci
npm run build
npm test
bash scripts/check-platform-local.sh
```

The final command requires Docker and runs the database-dependent protocol/access and provisioning tests against disposable PostgreSQL. `npm test` alone skips those tests when their database environment is absent.

For an installed local platform:

```sh
GATEWAY_URL=http://gateway.localhost:8080 \
URUMI_CREDENTIAL_DIR=.local \
node scripts/check-installation.mjs
```

This probe verifies login, aggregate discovery and reads through the three core integrations; it revokes its temporary key afterward. The [evidence checklist](docs/requirements.md) records demonstrated behavior. The [cluster verification procedure](docs/gateway-design.md#verification) covers state-changing two-user, outage and persistence checks; use those only on a dedicated demo cluster.

## Known limitations

- Single-node local-path storage survives pod replacement, not node/disk loss. There is no high availability. The primary-store backup helper refuses managed-store installations; coordinated multi-store disaster recovery is not implemented.
- LLM provider quotas still apply. Inspect completed tool activity before retrying an interrupted turn. Successful writes return a receipt from the tool result without another model request; failed writes are not automatically replayed.
- Inventory is synthetic demo data, not synchronized WooCommerce stock. Test products are virtual, COD collects no real payment, and outbound email is not configured.
- Managed-store lifecycle ownership is separate from shared team tool access. Role-permitted team members can read enabled stores; this is not isolation between unrelated customer organizations.
- Gateway OAuth, arbitrary container-image MCP hosting, public IPv6 upstreams and multi-replica scaling are not implemented. Untrusted upstream tool content remains a prompt-injection risk.

## Design and operations

- [Gateway architecture and tradeoffs](docs/gateway-design.md)
- [Access controls and threat model](docs/access-and-threat-model.md)
- [Custom WooCommerce MCP server](docs/woocommerce-mcp.md) and [store architecture](docs/store-architecture.md)
- [Multi-store provisioning, isolation and recovery](docs/multi-store.md)
- [Azure deployment, configuration, cost and cleanup](docs/production-deployment.md)
- [Upgrades, rollback and primary-store backup/restore](docs/upgrades-and-recovery.md)
- [Chat, diagnostics and security checks](docs/chat-and-operations.md)
- [Implemented differentiators](docs/standouts.md) and [storefront design/photo credits](docs/storefront-design.md)
