# WooCommerce MCP service

## Purpose and request flow

This service exposes five handwritten tools using the official MCP TypeScript SDK and Streamable HTTP. It is an internal application, not a public endpoint.

```text
Gateway → authenticated MCP request → validated tool input
        → signed WooCommerce REST request → store database
        ← tool result ← WooCommerce response
```

MCP defines how a client initializes a connection, discovers tools, and invokes a named operation. WooCommerce's REST API defines how our application reads and modifies store data. The SDK implements the protocol; our code defines the tools, validates inputs, signs store requests, and handles failures. No existing WooCommerce MCP plugin or server is used.

## Tools

| Tool | Inputs | Result |
|---|---|---|
| `list_products` | Page, page size, optional search/SKU | Products and pagination totals |
| `create_product` | Name, decimal-string price, optional description/SKU/virtual flag | Published simple product |
| `list_orders` | Page, page size, optional status and date filters | Orders, time range, timezone and pagination |
| `get_order` | Positive numeric order ID | Single order |
| `update_order_status` | Order ID and supported status | Updated order |

Prices use strings such as `"249.00"`, avoiding binary floating-point price conversions. Page size is limited to 100; results include `total_pages` so a client can retrieve all pages rather than silently assume the first page is complete. New products are physical by default; use `virtual=true` for the test checkout that requires no shipping configuration.

`list_orders(period="today")` calculates midnight boundaries in `STORE_TIMEZONE` (Asia/Kolkata by default), converts them to UTC, and asks WooCommerce to interpret the filters as GMT. Explicit `after` and `before` inputs require a UTC indicator or offset and cannot be combined with `period="today"`. A day follows the configured timezone, including daylight-saving changes where applicable.

Tool annotations describe read/write behavior to clients. They are advisory metadata, not permissions. Actual member/admin authorization will be enforced by the gateway. Changing status to `refunded` does not independently process a payment refund.

## Why REST, TypeScript, and stateless HTTP

REST preserves a clear application boundary. Direct database writes would depend on WooCommerce's internal schema and could bypass order/product logic. WP-CLI is used only for installation and service-credential provisioning, not to implement tools.

TypeScript checks interfaces during compilation. Zod validates data at runtime because network inputs cannot be trusted just because our own source code has types. The official SDK handles MCP initialization, discovery, and message structure.

The endpoint is stateless Streamable HTTP with JSON responses. Each POST gets a fresh MCP server and transport, which are closed when the response closes. No in-memory session IDs are needed for these request/response tools. GET and DELETE return 405. This does not implement resumable event streams, background tasks, or session-based notifications. Store data persists independently in WooCommerce.

## Two credentials, two jobs

1. **MCP bearer token:** authenticates a trusted gateway to this service. Checked on every `/mcp` request using fixed-length hash comparisons. It is not an end-user API key.
2. **WooCommerce consumer key/secret:** authenticates this service to WooCommerce as a dedicated `shop_manager` service user. It is not the store administrator's password.

Local provisioning generates random credentials, stores a private ignored backup in `.local/woocommerce-mcp-credentials.json`, and applies a Kubernetes Secret. It sends credential values to provisioning over stdin, without printing them or placing them in shell arguments. Rerunning reuses the key rather than creating duplicates. WooCommerce stores the consumer-key hash and its consumer secret according to its own implementation. Kubernetes Secrets alone do not encrypt values at rest.

The internal store currently uses HTTP. WooCommerce supports one-legged OAuth signatures for this path. Our client signs method, canonical store URL, query parameters, timestamp, and nonce using HMAC-SHA256; the consumer secret is not sent in the request. WooCommerce signs against its configured home URL, so `WOO_PUBLIC_URL` must match the installed store while `WOO_BASE_URL` is the reachable internal Service address. The signing scheme follows the actual transport scheme.

This signing is WooCommerce authentication, not the optional OAuth login feature for the team gateway. It does not encrypt HTTP traffic or protect JSON body confidentiality/integrity. Internal transport encryption is a production-hardening consideration; do not claim this is equivalent to HTTPS.

## Network and container boundaries

- Only a ClusterIP Service exists; there is no Ingress, NodePort, or LoadBalancer for MCP.
- Ingress NetworkPolicy admits pods labeled `app=urumi-gateway` in the same namespace, on port 3000.
- Egress allows DNS and the store on port 80. It does not allow direct database connections or arbitrary internet access.
- HTTP requests must use an allowed Host and a valid bearer token. Requests carrying a browser Origin are rejected; browsers should use the dashboard backend instead.
- The container runs as a non-root user, with a read-only filesystem, dropped Linux capabilities, no privilege escalation, and no mounted Kubernetes service-account token.
- Startup, readiness, and liveness probes plus resource requests/limits are included in Helm.

An operator allowed to create or relabel pods or read Secrets can bypass application-level trust boundaries. NetworkPolicies are not protection against a Kubernetes administrator. Team members will not receive Kubernetes access.

Readiness checks whether the MCP application is ready, not whether WooCommerce is healthy. A store outage should produce clear tool errors while discovery remains available; the gateway's later status logic must distinguish MCP availability from tool dependency failures.

## Failure behavior

Store requests time out after eight seconds by default. Redirects are refused so credentials are not forwarded to a new destination. No write is automatically retried: a timeout may happen after the store committed a change, and retrying could create duplicates. Callers should inspect store state before retrying an uncertain write.

Expected failures return MCP tool results with `isError=true` and a structured code/message. Upstream error bodies are not echoed, because they may contain sensitive or untrusted text. Inputs are validated before contacting WooCommerce. Logs do not include request bodies, Authorization headers, or store credentials.

## Setup and checks

From a fresh checkout, run `bash scripts/local-up.sh`. For an existing configured store, run `bash scripts/local-mcp-up.sh` to provision credentials, install locked dependencies, compile/test, build/import the image, and deploy the service.

```sh
npm run build
npm test
python3 scripts/check-woocommerce-mcp.py
```

The cluster integration check uses a temporary pod with the trusted gateway label; the actual gateway is not implemented yet. The script does not weaken the service's NetworkPolicy or open a public port. It creates a temporary product, verifies storefront availability, reads an existing test order, changes and restores its status, checks date filtering and invalid calls, then deletes its test product. Use only the local demo store; status changes can trigger WooCommerce workflows.

Only the temporary verification pod receives store credentials for fixture cleanup. In the application architecture, the gateway receives the MCP bearer token, and only the WooCommerce MCP service receives the store key/secret.

The script also verifies that an unrelated pod cannot reach MCP. Temporary test pods are removed. Setup requires a real storefront test order before running the order checks.

## Important files

- `src/config.ts`: validates configuration without disclosing credential values.
- `src/app.ts`: HTTP boundaries, bearer checks, and MCP transport lifecycle.
- `src/tools.ts`: five tool contracts and order-date semantics.
- `src/woocommerce.ts`: signed REST requests, timeouts, and safe errors.
- `test/server.test.ts`: protocol, authorization, validation, timeout/recovery, and timezone checks with a controlled store.
- `test/smoke.ts`: real-store integration exercised inside Kubernetes.
- `scripts/setup-woocommerce-mcp.py`: dedicated service-user/key provisioning.
- `deploy/helm/urumi/templates/woocommerce-mcp.yaml`: deployment, internal Service, probes, resources, and network rules.

## Interview practice

1. What is the difference between MCP discovery and a tool call?
2. Why isn't a tool just an ordinary REST endpoint?
3. Where are inputs validated, and where will user permissions be enforced?
4. Why are gateway-to-MCP and MCP-to-store credentials different?
5. Why does the client sign the canonical store URL while connecting to Service DNS?
6. What happens if product creation times out after saving the product?
7. Why can this MCP server be stateless while the store remains stateful?
8. What does NetworkPolicy enforce, and who can bypass it?

## Verification evidence

Verified locally on October 13, 2026:

- TypeScript compilation, locked dependency installation, and protocol integration tests pass.
- A real SDK client initialized Streamable HTTP and discovered exactly five tools.
- MCP created published product #15; discovery and the public storefront API both found it. The test product was then removed.
- Order #12 was listed, retrieved, changed to on-hold, and restored to processing.
- Date filters included that order around its creation timestamp and excluded it in a later range. Today's query used Asia/Kolkata; timezone tests also covered a daylight-saving boundary.
- Missing/incorrect MCP tokens, untrusted Origin and Host values, invalid prices, conflicting date filters, and missing orders were rejected.
- A controlled slow-store test returned a timeout; the next healthy request succeeded. Upstream failure text was not reflected.
- An unrelated pod could not connect to MCP; MCP could not connect directly to MariaDB. The store retained its allowed database connection.
- The complete local setup command was rerun successfully and reused existing store data and service credentials.
- Local and production Helm configurations render. The MCP pod is healthy with probes and resource limits; it runs without root or Kubernetes API credentials.

No public gateway, team login, dashboard, or LLM chat exists yet. This verification uses a temporary trusted test client, not a completed gateway.

## Primary references

- [Official MCP SDK server guide](https://ts.sdk.modelcontextprotocol.io/server)
- [Official stateless Streamable HTTP example](https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.x/src/examples/server/simpleStatelessStreamableHttp.ts)
- [WooCommerce REST API documentation](https://woocommerce.github.io/woocommerce-rest-api-docs/)
- [WooCommerce REST authentication implementation](https://github.com/woocommerce/woocommerce/blob/trunk/plugins/woocommerce/includes/class-wc-rest-authentication.php)
