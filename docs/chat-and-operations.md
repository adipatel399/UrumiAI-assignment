# Chat, diagnostics, and security verification

## Request flow

```text
Browser session + CSRF → chat API → short-lived user key → gateway /mcp
                                 ↕ model tool proposals       ↓ authorization + audit
                                                    registered MCP → WooCommerce
```

Chat is a server-side tool loop. It discovers tools using an official MCP client against the gateway's loopback `/mcp` endpoint. It does not call the connection manager, WooCommerce API, or upstream MCP endpoints directly. A new random credential is created for the logged-in user for each turn; PostgreSQL stores its hash, purpose, two-minute expiry, and originating session hash. It is never returned to the browser or provider. It is revoked in `finally`; expiry protects against process crashes. Revoked/expired credentials, expired/logged-out sessions, inactive users, and current roles are checked on each MCP request. Internal chat keys cannot authenticate administration APIs and are excluded from personal key lists. Rows remain for audit foreign keys.

The browser sends at most twelve user/assistant messages, each bounded to 4,000 characters. It cannot submit system or tool-role messages. Conversation state lives only in the page's memory; clearing/reloading discards it. Switching away from chat also clears that component. Tool audit records remain durable.

A turn has at most six model requests (up to 700 completion tokens each), eight tool calls, and a 90-second deadline. Each provider request has a 30-second deadline and a 512 KB response limit. Tool results sent to the model are capped at 16,000 characters each. Inputs/results appear in expandable activity cards after the turn completes or fails. No streaming or background jobs are claimed. Only one chat per account and four chats per gateway process run concurrently. These are single-replica controls, not distributed quotas.

Reads are the default. The user must enable “Allow requested changes” for each message that requests a write. That choice resets afterward. Classification uses the administrator's trusted `read_tools` configuration, not an upstream's advisory annotations. Enabling writes does not grant a member additional permissions. Calls absent from the discovered/approved set are refused, and the gateway independently authorizes every dispatched call. A tool error stops the turn; writes are not automatically retried. If the connection fails after dispatch, the operation may have completed: inspect activity/audit/store state before retrying.

The system instruction distinguishes untrusted tool descriptions/results from instructions, but prompting does not eliminate prompt injection. A malicious result can still influence a model's proposals. Role enforcement, per-turn write approval, bounded execution, independent gateway checks, and visible activity limit consequences. An admin who enables writes retains broad store authority; this is not a sandbox for arbitrary hostile integrations.

## Configure a provider locally

The implementation supports a chat-completions API with function tools. Default settings use Groq and `qwen/qwen3.8-27b`; model availability and free-plan quotas can change. See [Groq tool calling](https://console.groq.com/docs/tool-use/local-tool-calling), [model capabilities](https://console.groq.com/docs/model/qwen/qwen3.8-27b), and [account limits](https://console.groq.com/docs/rate-limits). Free-plan rate limits return an error; do not upgrade billing as part of this setup.

1. Create a provider account/key privately.
2. Run `python3 scripts/configure-chat.py` to create ignored `.local/llm-credentials.json` if absent.
3. Edit its `LLM_API_KEY` locally. `LLM_MODEL` and `LLM_URL` select the provider/model. Keep the endpoint HTTPS on port 443, without URL credentials/query/fragment.
4. Run the script again. It applies `urumi-llm-secrets` through standard input and restarts only the local gateway. It prints no key. The private file is mode 600 and excluded from Git and image builds.
5. Open the dashboard's chat tab. Missing credentials produce an explicit configuration message; the application never substitutes fake model replies.

The Helm value `platform.llmSecretName` selects this optional Secret. A fresh store/gateway installation works without it. For a VPS, provision the Secret securely in its namespace; the local helper deliberately refuses other contexts. Provider credentials are server-only, supplied only to the provider endpoint. The model receives messages, permitted tool schemas, and selected results—not team passwords, gateway keys, or upstream headers.

Use fictional customer data. Structured billing/shipping/email/phone/IP/order-key/metadata fields are removed from tool results before sending them to the provider. Store products/orders are projected to concise business fields (IDs, names, prices, status, dates, and line items) to avoid sending plugin/link payloads and reduce free-plan token usage. This is best-effort minimization, not comprehensive anonymization: arbitrary upstream text and user messages may contain personal information. Neither chat content nor raw tool arguments/results are application log/audit fields.

## Demonstration

- Admin, writes enabled: “Create a virtual product called Chat Demo Notebook priced 249.00 with SKU CHAT-DEMO-001. First check whether that SKU exists and do not create a duplicate.” Confirm successful product tool activity and the visible shop product.
- Purchase it manually through the shop with fictional details and COD.
- “Show today's orders.” Confirm the `period: today` tool input, configured store timezone, and purchased order.
- “Search inventory for notebook and find the returns policy. Explain which information is synthetic.” Confirm calls to both inventory and knowledge.
- Member: ask to create a product, even with writes enabled. The write tool is unavailable; direct remembered-name calls are independently forbidden by the gateway.

These are live-model acceptance steps, separate from controlled integration tests. Do not claim they passed until performed with configured provider access.

## Metrics and diagnostics

Administrators can open **metrics** in the dashboard or fetch `GET /api/metrics`. Each registered server shows total attempts, failures/rejections, unfinished audit entries, mean and 95th percentile completed latency, connection observation, and last checked time. History comes from durable audit rows and survives restarts. Calls include permission/disabled/unreachable failures attributed to known servers. `started` entries are not included in latency; after a crash they may remain unfinished. No periodic browser refresh is implied: use Refresh.

`GET /metrics` exports Prometheus text format with administrator authentication (session or ordinary admin bearer key). It provides:

- `urumi_tool_calls_total` and `urumi_tool_failures_total` counters;
- `urumi_upstream_connected` gauge;
- `urumi_tool_duration_seconds` histogram with 0.1, 0.5, 1, 5, 10, 30 second and +Inf buckets, count, and sum.

Labels contain server slug/ID only. No user emails, tokens, customer payloads, arbitrary tool names, or raw URLs appear. Removed registrations stop exporting their series; their audit snapshots remain. No Prometheus/Grafana installation or alert delivery is claimed. An external scraper can reach the public gateway through Ingress with an admin key supplied via a mounted credentials file, never a URL parameter. Direct in-cluster scrapers require a deliberately added ingress rule; the default permits only Traefik. There is no dedicated read-only metrics role yet, so protect the admin scraper key accordingly.

Connection diagnostics map status/timeout/connection failures to safe explanations without exposing arbitrary upstream error bodies. HTTP 401/403 suggests credentials; timeouts suggest service health/latency; refused connections suggest address/deployment. Status is the latest observation (background refresh about every 15 seconds), not a guarantee. A stale schema can remain visible while its server is down, allowing a remembered call to return a clear unavailable result.

## Network boundaries and destination validation

The namespace has default-deny ingress/egress, plus explicit DNS and application flow rules. Traefik reaches public store/gateway; WooCommerce MCP reaches WordPress; WordPress reaches MariaDB; gateway reaches PostgreSQL and the three MCP services. Supporting MCP services have only DNS egress. Gateway and WordPress can reach public IPv4 HTTPS, with private/metadata ranges excluded. Responses to permitted connections are allowed by the network implementation.

Only the three operator-configured internal MCP hostnames bypass the public destination policy; they must use HTTP port 3000. External registrations require HTTPS port 443, a hostname, no embedded credentials/query/fragment, and public IPv4 DNS resolution. Resolution is restricted to IPv4; dual-stack public hosts work over IPv4. Literal IPs, private/metadata destinations, and mixed public/private IPv4 answers are refused. IPv6-only hosts are unsupported. The socket's custom DNS lookup validates the actual addresses supplied to the connection, preventing an unchecked second resolution after validation. Redirects are refused. TLS still validates the original hostname. Public IPv6 integrations are intentionally unsupported.

Custom applications use non-root users, read-only roots, dropped capabilities, default seccomp, and no mounted Kubernetes API token. Database/store vendor images have their own startup requirements; do not claim every vendor entrypoint is non-root. Kubernetes Secrets require appropriate cluster-admin access controls and encryption-at-rest configuration; base64 encoding alone is not encryption. Persisted upstream credentials use AES-256-GCM with a separate Secret key.

Limitations: application/network rules do not defend against a compromised cluster administrator, kernel, or host. Internal HTTP is not encrypted. Public HTTPS egress is broad rather than domain-specific; a compromised allowed workload can contact public services. Local-path volumes and one replica do not provide high availability. Retained audit/chat-key rows currently have no retention job; plan retention and backups before sustained production usage.

## Verification commands

```sh
bash scripts/check-platform-local.sh
python3 scripts/check-security.py
python3 scripts/check-platform-cluster.py
```

The first uses disposable PostgreSQL and controlled model replies to test routing, write gating, user attribution, credential cleanup, malformed input, provider failures, permissions, and metrics without provider charges. It is not evidence of model quality. The second checks actual positive/negative TCP paths in local Kubernetes and custom-service privileges, removing its temporary pod afterward. The third checks real-store calls, two users, inventory outage/recovery, metrics/diagnostics, key revocation, and database/gateway restart persistence; it briefly interrupts the demo services. All helpers guard the local context and print no credentials.

## Observed local results

On October 15, 2026, the disposable-database suite passed all eight reported tests (including the extended gateway integration scenario), Helm lint passed, and local/production chart configurations rendered. Real-cluster checks passed for allowed/blocked network paths, all four custom-service privilege checks, a controlled inventory outage with metrics/diagnostics, recovery, and database/gateway restart persistence. The browser showed live chat activity and populated administrator metrics. An unauthenticated provider request from the gateway reached Groq over the protected HTTPS connection and returned the expected 401, proving connectivity without a model call or charge. With the provider configured, live chat created product #17 (Chat Demo Notebook, SKU CHAT-DEMO-001, 249.00). The first turn completed the write but hit a free-plan limit during its final summary; activity retained the successful result. We reduced completion allowance and projected store results to concise fields. A later live chat read confirmed the product. A fresh guest browser purchased it with fictional details/COD as order #19 for INR 249.00, and dashboard chat retrieved that order using period=today and Asia/Kolkata. Fresh-guest testing also caught WooCommerce Coming soon mode; bootstrap now disables it so demo customers can access the shop.

The live cross-server dashboard prompt successfully called `inventory__search` and `knowledge__search`, then identified inventory as synthetic and unsynchronized. A member prompt with `allow_writes: true` looked up SKU MEMBER-FORBIDDEN-001 but refused creation because its discovered catalog lacked write tools. No product with that SKU was created. Audit rows identified the actual admin/member for all seven live tool calls, and each associated temporary key was revoked after its turn. No billing upgrade or paid cloud resource was needed. Space live demo turns to respect the provider's free-plan token limits; a rate-limit error after a successful write does not undo the write.

Read-only turns may request independent tools together. When the provider returns HTTP 429 with a retry-after of at most 45 seconds, the agent may retry that model request twice within the existing 90-second deadline. Completed tool results remain in the conversation; the backoff itself never replays a tool invocation. Write-enabled turns do not use this backoff. Free-plan daily exhaustion or a long cooldown still produces a visible error with completed activity retained. Managed-store results use the same compact, customer-data-filtered model representation as the original store.

Successful writes return a receipt derived from the successful gateway result (including product/order identifiers when available). They do not request a second LLM completion merely to acknowledge the write. This prevents the duplicated tool-schema token cost that could exceed a fresh free-plan minute budget after a successful creation. It does not bypass provider quotas; the initial model request can still be limited. The activity remains the authoritative record of completed actions, and failed writes are never replayed automatically.
