# Local installation and verification

Requirements: a running Docker engine with approximately 8 GB available, kubectl, Helm, k3d 5.9, Python 3, and Node.js 22 with npm. Run from the repository root:

```sh
bash scripts/local-up.sh
```

The script creates or starts the dedicated local cluster, builds/imports images, generates Kubernetes Secrets, installs the Helm chart, and initializes the store, custom MCP server, gateway and supporting integrations. Re-running preserves existing credentials and registrations but briefly restarts local workloads.

| Open | Local URL | Credentials |
| --- | --- | --- |
| Dashboard | http://gateway.localhost:8080/ | `.local/platform-credentials.json` |
| Storefront | http://store.localhost:8080/shop/ | Guest checkout |
| WooCommerce admin | http://store.localhost:8080/wp-admin/ | `.local/store-credentials.json` |
| Gateway MCP | `http://gateway.localhost:8080/mcp` | Personal API key from the dashboard |

Browsers resolve `*.localhost` to loopback; the cluster exposes Ingress on loopback port 8080. After setup, open the ignored `.local/platform-credentials.json` for your local dashboard login and `.local/store-credentials.json` for your local WooCommerce login. These files are generated on your computer and contain different credentials from the hosted reviewer accounts. Keep them private and out of recordings. Chat additionally needs a provider key; setup and the non-chat features do not.

### Use chat

Run `python3 scripts/configure-chat.py`, enter the provider settings in the generated `.local/llm-credentials.json`, then rerun the helper. Sign into the dashboard and open **AI workspace**. Ask for today's orders, or enable **Approve changes for this message** to request a product creation as an admin. Activity shows the actual gateway tool calls. See [provider setup and chat behavior](chat-and-operations.md).

### Place an order

Open the storefront, add a product, and check out with fictional billing details and **Cash on delivery**. Confirm the matching order in **WooCommerce → Orders**, then ask chat for today's orders. For the create-to-order flow, buy the exact product that chat created.

### Connect an external MCP client

In **API keys**, create a personal key. Configure your Streamable HTTP client with endpoint `http://gateway.localhost:8080/mcp` and header `Authorization: Bearer YOUR_USER_KEY`. For the live deployment, use `https://gateway.85.211.243.237.sslip.io/mcp`. Members see permitted read tools; admin-only writes are hidden and rejected on direct invocation. Refresh discovery after integration changes. See [Inspector setup and two-user walkthrough](demo-runbook.md).

### Create another store

Enable Helm `provisioning` settings, then use **Stores** to create, inspect, retry or delete a store. Provisioning is disabled in the default values. Each new store gets its own namespace, database, Secrets, persistent volumes, Ingress host and MCP server. See [multi-store setup and guardrails](multi-store.md).

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

This probe verifies login, aggregate discovery and reads through the three core integrations; it revokes its temporary key afterward. The [evidence checklist](requirements.md) records demonstrated behavior. The [cluster verification procedure](gateway-design.md#verification) covers state-changing two-user, outage and persistence checks; use those only on a dedicated demo cluster.
