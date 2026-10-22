# Live demonstration and submission runbook

Use fictional store data. Show real requests and results, and explain decisions in your own words. Do not record raw API keys, provider keys, upstream headers, cookies, invitation tokens, kubeconfigs, database dumps, or private files. Client keys are entered before recording; show their prefix/status afterward.

## Before recording

1. Confirm local and VPS workloads are ready, both public TLS certificates are valid, and all three upstream registrations are Connected.
2. Open the administrator dashboard (user A; Integrations in the sidebar), a guest storefront window, and MCP Inspector configured as member B with one gateway URL and B's own bearer key. Prepare the configuration privately; do not show the header editor.
3. Use a fresh product SKU for creation; check existing state before repeating a write whose response was lost. Allow free-plan token quotas to reset between model-heavy turns.
4. Keep a local and remote Kubernetes terminal ready, each with an explicit context. Verify the context before any outage test.
5. Prepare the recording chapters below. Leave time to show each actual result; do not substitute a successful-looking mock UI.

## Suggested 8–12 minute walkthrough

### System design

Explain the four layers: WooCommerce/MariaDB; custom WooCommerce MCP server; gateway/dashboard/PostgreSQL; dashboard chat. Inventory and knowledge are two additional upstreams. The gateway is a server to clients and a client to upstreams. The model proposes a tool; application code executes through the same authenticated MCP endpoint as external clients.

Explain why Node/TypeScript reduces implementation complexity, the official SDK owns protocol transport, WooCommerce REST API avoids direct database writes, and PostgreSQL stores team/access/audit data separately from the store database.

### Store and chat as user A

- Open the storefront as a guest.
- In AI workspace, enable Approve changes for this message for one message and ask to create a virtual product with a name, decimal price and fresh SKU. Show `store__create_product` activity and the real product page.
- Add it to the cart and complete COD checkout by hand with fictional details. Show the order-received number and total.
- Open WooCommerce administration and confirm the order.
- Return to chat and ask today's orders. Show `period: today`, the configured Asia/Kolkata timezone, and the same order.

### External client as user B

- Show MCP Inspector connected to one gateway URL; no upstream addresses/credentials were configured.
- Show the member's six tools across three enabled servers. Product creation/status writes are absent.
- Execute `store__list_orders` with `period: today` and show the same order.
- Run one external question requiring two integrations, such as inventory notebook stock and shipping guidance. The optional `scripts/external-question.mjs` uses the real MCP Inspector CLI to execute each LLM-proposed call; its terminal prints tool names and a final answer without client/provider keys. Alternatively use a configured natural-language MCP client.
- Clearly identify inventory as synthetic demo data, not synchronized store stock.

### Team controls and failure behavior

- Revoke B's key in the admin dashboard. Replay the next Inspector call; it must fail immediately without waiting for a new session.
- Disable inventory. Refresh tool discovery in chat and Inspector; inventory tools must disappear. A remembered-name call is rejected too. Re-enable it afterward.
- Temporarily scale inventory to zero or delete its pod during a controlled check. Refresh dashboard status until Unreachable is observed. Call store/knowledge successfully, show failure counters/latency, then restore inventory and show recovery.
- Open Audit trail and show the correct admin/member, server/tool, timestamps, duration and outcome for success and rejection.

### Kubernetes and security

Show `kubectl --context CONTEXT get deploy,pods,pvc,svc,ingress,networkpolicy -n urumi`. Explain which endpoints are public and which services are internal. Show probes/resources from a selected deployment without dumping Secret values.

Explain: passwords are scrypt-hashed, API keys are random and hashed, upstream credentials are encrypted because the gateway must recover them, and client tokens are not forwarded. Chat uses an expiring per-user credential bound to its login session; it does not borrow an admin key. NetworkPolicy plus authenticated MCP boundaries restrict access. SSRF checks validate actual connection resolution and reject redirects, with explicit exceptions for required internal services.

Discuss a malicious upstream: it can lie in descriptions/results and attempt prompt injection. Trusted gateway permissions and write approval limit authority; prompting does not make an arbitrary integration safe. A compromised WooCommerce MCP still holds a write-capable store credential. Team members share authorized store data; this is not multi-tenant customer isolation.

### VPS and lifecycle

Open the real public HTTPS URLs and show the remote context. Show how only values changed: hosts, URLs, image tags/CPU architecture, Secure cookie, TLS and storage sizes. Explain the SSH-only Kubernetes API, student-credit costs, and single-node limitations.

Show Helm history and the recorded/repeated safe upgrade/rollback rehearsal. Explain that Helm rollback does not reverse orders or database migrations. Show backup/restore evidence without opening backups; the recovery rehearsal must be reported as a rehearsal, not high availability.

## Repeatable helpers

- `scripts/prepare-demo.mjs`: prepares two users and a private Inspector config for a selected installation. It never prints keys.
- `scripts/check-installation.mjs`: login/catalog/three-upstream read probe, cleaning up its temporary test key/session.
- `scripts/check-platform-cluster.py`: local two-user/outage/recovery/persistence checks.
- `scripts/check-security.py`: actual local positive/negative network paths and custom-service privilege checks.
- `scripts/rehearse-upgrade.py`: explicit-context values-only upgrade/rollback.
- `scripts/backup.py` and `scripts/restore.py`: private quiesced backup and explicit data-replacement recovery.

## External question helper

After `npm ci && npm run build`, set `MCP_CLIENT_CONFIG` to a private Inspector-format config containing only your gateway URL and user key. Set `LLM_CREDENTIAL_FILE` to private provider settings. Then:

```sh
MCP_CLIENT_CONFIG=PRIVATE_CONFIG LLM_CREDENTIAL_FILE=PRIVATE_LLM_FILE \
  node scripts/external-question.mjs 'Search notebook inventory and shipping guidance, using both integrations.'
```

The helper is an external read-only demonstration client, not part of the cluster's dashboard agent. It uses MCP Inspector 2.11.0 for discovery/calls and the same free provider settings. Upstream credentials remain entirely inside the gateway. Inspector supports legacy 2025-11-25 negotiation for this implementation. See the [official Inspector guide](https://modelcontextprotocol.io/docs/tools/inspector).

## Submission package

Required: the GitHub repository and an accessible demo video link through the [assessment form](https://forms.gle/nftwgyNeenSDmiRb6). Ensure reviewers can access the private repo if it remains private; the assessment does not require a private repository. Check video permissions from a logged-out/private browser. Upload the final recording deliberately and review it for secrets before sharing.

This runbook does not submit the form or send invitations/messages to reviewers. Final submission follows the candidate's instruction. A scripted/captioned rehearsal can help preparation, but the candidate must understand and be ready to explain every part in the interview.
