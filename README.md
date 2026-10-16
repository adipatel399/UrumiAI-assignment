# Urumi team MCP gateway

The Kubernetes WooCommerce store, its internal MCP service, team gateway, supporting inventory/knowledge MCP services, and account/access backend are implemented. The React dashboard includes a user-scoped chat tool loop, administration, audit, and per-server diagnostics. Chat requires a server-side provider key; the rest of the system works without one.

See [the store architecture](docs/store-architecture.md), [WooCommerce MCP design](docs/woocommerce-mcp.md), and [requirements checklist](docs/requirements.md).

Gateway details: [architecture and tradeoffs](docs/gateway-design.md), [access and threat model](docs/access-and-threat-model.md), [chat setup and operations](docs/chat-and-operations.md), [implemented differentiators](docs/standouts.md).

Live VPS: [store](https://store.85.211.243.237.sslip.io/shop/) · [dashboard](https://gateway.85.211.243.237.sslip.io/) · MCP endpoint `https://gateway.85.211.243.237.sslip.io/mcp`. Use privately supplied credentials and fictional customer data. This single-node assessment deployment consumes student credits and is not a permanent hosted service.

## Local setup

Requirements: Docker engine running (approximately 8 GB available to Docker), kubectl, Helm, k3d 5.9, Python 3, and Node.js 22 with npm. On macOS, Helm and k3d can be installed with `brew install helm k3d`.

Run from the repository root:

```sh
bash scripts/local-up.sh
```

This creates a dedicated `urumi` cluster, selects its context, creates namespace `urumi`, generates Secrets, builds/imports the store image, installs Helm resources, and bootstraps WooCommerce. Rerunning preserves existing credentials and avoids duplicating the demo product.

It then provisions a dedicated WooCommerce service credential and deploys our handwritten MCP server. No LLM provider or paid cloud resource is needed for this setup.

Finally it provisions the platform secrets, PostgreSQL, gateway, and two supporting MCP services. Setup preserves existing platform registrations, accounts, and keys. The platform database PVC is retained if its Helm resources are disabled/uninstalled; do not confuse this retention with a backup.

Local setup also starts an existing stopped cluster and replaces pods to load rebuilt development images. It deploys the store before enabling MCP, so credentials can be provisioned on a fresh installation. This causes short local interruptions. Production will use immutable release image tags instead.

URLs:

- Store: http://store.localhost:8080/shop/
- WordPress administration: http://store.localhost:8080/wp-admin/

Modern browsers resolve `*.localhost` to loopback. If yours does not, add `127.0.0.1 store.localhost` to your hosts file. Ingress selects the store using that hostname. HTTP is for local testing; production must use HTTPS. The cluster's HTTP/HTTPS mappings bind to loopback rather than exposing the shop to your local network.

Open the ignored `.local/store-credentials.json` privately for the admin username/password. Never commit, paste, or record this file in a demo. Kubernetes Secrets are not encryption by themselves; additional production encryption and access controls are planned.

## Place a demo order

1. Open the shop and add Urumi Demo Notebook to your cart.
2. Proceed to checkout and use fictional billing information and a test email.
3. Select Cash on delivery and place the order. No payment is collected and nothing is shipped.
4. Log into WordPress administration and open WooCommerce → Orders.
5. Confirm the order and its product, amount, and status.

The store deployment has been verified: browser checkout created order #12 for ₹199 using COD; the authenticated admin order list contained it. Both pods were replaced and the order and a test content file remained. A fresh temporary installation and database isolation check also passed. See [verification details](docs/store-architecture.md#observed-results).

## Check persistence

```sh
kubectl get pods,pvc,services,ingress -n urumi
kubectl rollout restart deployment/urumi-store deployment/urumi-database -n urumi
kubectl rollout status deployment/urumi-database -n urumi --timeout=180s
kubectl rollout status deployment/urumi-store -n urumi --timeout=180s
```

The product, order, and store settings should remain. This tests pod replacement, not disaster recovery. Deleting the cluster deletes its local storage. The local-path storage used here is not replicated or highly available. Do not delete the namespace or uninstall the release if you need to retain its PVCs; these actions require a deliberate backup/retention plan.

Run `python3 scripts/check-database-isolation.py` to verify an unrelated pod is blocked from connecting to MariaDB. This creates and removes only its own temporary test pod.

## WooCommerce MCP

The internal endpoint is `http://urumi-woocommerce-mcp:3000/mcp`. It has no public Ingress and only accepts the gateway's network identity plus its upstream bearer credential. External clients connect to the public gateway instead.

Tools: `list_products`, `create_product`, `list_orders`, `get_order`, and `update_order_status`. Credentials live in `urumi-woocommerce-mcp-secrets`, with a private ignored local backup. MCP uses stateless Streamable HTTP and calls WooCommerce REST API v3 with signed requests.

For an existing store, build/deploy only MCP with `bash scripts/local-mcp-up.sh`. Run `npm run build` and `npm test` for local checks. After placing a demo order, run `python3 scripts/check-woocommerce-mcp.py` for the real-cluster integration check. It creates/deletes its own test product and temporarily changes/restores a test order's status; use only the local demo store. See [MCP design and security details](docs/woocommerce-mcp.md).

## Team gateway and accounts

- MCP endpoint: `http://gateway.localhost:8080/mcp`
- Account/administration API: `http://gateway.localhost:8080/api`
- Bootstrap admin credentials: private ignored `.local/platform-credentials.json`.
- Dashboard: open `http://gateway.localhost:8080/` and sign in with the private bootstrap admin credentials.

Login with `POST /api/login` and JSON `{ "email": "...", "password": "..." }`. It sets an HttpOnly session cookie and returns a CSRF token. Send the cookie and `X-CSRF-Token` for mutations. Create a personal client key with `POST /api/keys` and `{ "name": "My MCP client" }`; copy the returned key once. Configure an external MCP client with the gateway URL and `Authorization: Bearer YOUR_USER_KEY`. Refresh the client's tool list after server or permission changes; direct calls always enforce current authorization.

Admin routes manage `/api/servers`, `/api/members`, `/api/invitations`, `/api/keys`, and `/api/audit`. Members can manage their own keys and inspect `/api/tools`. Invitation acceptance uses `POST /api/invitations/accept` with token/password; the returned invitation link opens the dashboard acceptance form.

There are eight default admin tools and six member tools. Store writes are admin-only. `inventory__search` and `knowledge__search` prove same-name routing. Inventory is synthetic demo data, not a stock synchronization service.

For an existing store/MCP setup run `bash scripts/local-platform-up.sh`. Full local verification: `bash scripts/check-platform-local.sh` (disposable PostgreSQL integration tests), followed by `python3 scripts/check-platform-cluster.py` (real cluster, two users, outage/recovery and persistence). The latter retains a gateway-created virtual demo product and saves private demo login/key details in `.local/gateway-demo.json`; it revokes the tested member key. It requires the local test order and interrupts inventory/gateway briefly. Use only the local demo cluster.

When a gateway is installed, the earlier WooCommerce MCP verification script automatically tests through it. The old direct fixture-cleanup path is restricted by gateway egress policy; normal application and verification calls use the gateway boundary.

## Chat and diagnostics

Open **Chat** after signing in. Run `python3 scripts/configure-chat.py`, edit the generated ignored `.local/llm-credentials.json` privately, and rerun the helper to provision a provider key. Default configuration uses Groq's free-plan-capable tool model; account quotas apply. The key stays server-side. Reads are enabled by default; use the per-message checkbox for requested changes. Members still cannot use admin write tools. Chat activity shows actual gateway calls, outcomes, and selected results. History is kept only in page memory.

Administrators can open **Metrics** for each server's calls, failures, average/p95 latency and diagnostics. Authenticated `GET /metrics` exports Prometheus counters/gauge/histogram; no separate collector installation is required or claimed. Run `python3 scripts/check-security.py` for real network-boundary checks. The namespace is default deny with explicit application/DNS flows, and external upstream connections validate the actual socket DNS resolution and reject redirects/private destinations.

Live local chat verification created Chat Demo Notebook (product #17), a guest COD checkout created order #19 for INR 249.00, and chat retrieved it using the store’s today filter. Inventory/knowledge calls and member write refusal were also verified. Free-plan rate limits can interrupt final summaries after a tool has already completed; inspect activity before retrying writes.

See [chat, operations, limits, and verification](docs/chat-and-operations.md) for setup, demonstration steps, provider data handling, scrape access, and known limitations.

## Troubleshooting

- Docker unavailable: finish Docker Desktop first-run setup and wait for its engine to run.
- Failed pods: inspect `kubectl describe pod -n urumi POD_NAME` and relevant container logs; do not publish secrets from debug output.
- Port 8080 occupied: change the local cluster port mapping and `store.url` together before creating the cluster.
- Wrong context: verify `kubectl config current-context` is `k3d-urumi`.
- Existing store: bootstrap intentionally leaves existing WordPress users/passwords intact. Do not rotate database passwords by editing the local file; changing the Secret alone does not change existing database accounts.
- Email: outbound mail is not configured in this test store; notification attempts may report missing `sendmail`. Checkout and order storage work without email. No real customer information should be used here.

## VPS deployment, upgrades, and submission

The same Helm chart is deployed on a real Azure Ubuntu/k3s VM with valid HTTPS certificates, independent Secrets, immutable AMD64 application images, and local-path persistence. Public web traffic uses Traefik; the Kubernetes API is accessed through an operator SSH tunnel. Local versus VPS differences are values only. See [complete VPS setup and cost/cleanup instructions](docs/production-deployment.md).

The platform was also installed from empty volumes in a disposable local cluster. Login, all three upstreams and eight tools worked. A quiesced backup was restored there after deliberate store/platform-data changes, and the earlier values returned. Helm upgrade/rollback rehearsals passed locally and on the VPS. See [upgrade, rollback and backup/restore procedures](docs/upgrades-and-recovery.md). No claim of high availability or automatic database rollback is made.

For a configured installation, run `GATEWAY_URL=YOUR_URL URUMI_CREDENTIAL_DIR=PRIVATE_DIRECTORY node scripts/check-installation.mjs` for the read-only login/discovery/routing probe. The temporary probe key is revoked afterward. `scripts/prepare-demo.mjs` prepares independent demo users and a private Inspector configuration without printing keys.

MCP Inspector 2.11.0 was verified as member B with only the gateway URL/key: six tools, today's orders, an external question spanning inventory and knowledge, and rejection after revocation. The optional external-question helper delegates every MCP request to the real Inspector CLI. See [the live demo and submission runbook](docs/demo-runbook.md) for client setup, the required two-user flow, narration topics, and recording hygiene.
