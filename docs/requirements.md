# Assessment evidence checklist

Statuses describe demonstrated behavior, not just files present. See the store architecture note for verification details.

| Requirement | Status |
| --- | --- |
| Local Kubernetes and Helm | Verified locally |
| Same charts with local/production values | Same chart verified on local k3d and real Azure k3s with HTTPS |
| Store and database persistent storage | Verified after replacing both pods |
| Checkout and order visible in admin | Browser COD order #12; authenticated admin page verified |
| Stable store and dashboard Ingress | Store and dashboard Ingress available |
| Probes, requests and limits | Store, both databases, gateway and three MCP services configured and healthy |
| Secrets absent from source | Generated credentials ignored; Secret applied |
| Five custom WooCommerce MCP server tools | Implemented; all five verified against the real store |
| Streamable HTTP and internal-only WooCommerce MCP | Official SDK client verified; no public exposure; unrelated pod blocked |
| Three registered upstreams | WooCommerce, inventory and knowledge verified through gateway |
| Aggregate discovery and correct routing | SDK client sees eight admin tools; cross-server calls verified |
| Tool collisions, timeouts and failure isolation | Namespaced search tools, controlled timeout and actual outage/recovery verified |
| Admin/member identity and invitations | API login/session, invitations and role-based dashboard implemented |
| Per-user hashed API keys and immediate revocation | Verified on existing SDK connection; revocation persists across restarts |
| User-attributed audit log and dashboard | Durable audit API and dashboard view implemented |
| Chat tool loop through gateway | Live model created product #17; guest COD checkout created order #19; dashboard chat retrieved today’s order and called two upstreams; live member write refusal and attributed audit verified |
| Two-user external MCP acceptance flow | MCP Inspector GUI and CLI verified as member B: six tools, today’s order, two-upstream prompt, revoked-key rejection |
| Stand-out: tool permissions | Member write tools hidden and direct calls rejected; admin writes verified |
| Stand-out: security hardening | Actual default-deny/allowed flows, prohibited paths and non-root/no-token custom services verified; destination socket validation and redirect refusal tested |
| Stand-out: observability | Per-server metrics, authenticated Prometheus export, dashboard diagnostics and controlled outage verified |
| Stand-out: real VPS deployment | Azure Malaysia West VM deployed with public store/dashboard HTTPS, independent Secrets and same chart |
| Upgrade and rollback story | Helm upgrade/rollback passed locally and on VPS; isolated fresh-install and backup/restore rehearsal passed |
| README, design note, threat model and demo | Setup, design/tradeoffs, threat model, stand-out map, VPS/recovery instructions and demo runbook complete; captioned live VPS rehearsal recorded locally; final upload/form submission awaits candidate review |
| Bonus: multi-store provisioning | Dedicated durable worker, dashboard lifecycle, namespace-local databases/Secrets/PVCs/Ingress/MCP, concurrent provisioning, automatic registration, quotas/timeouts and isolated networks. Local live worker restart and full namespace/PV deletion verified; see [design and acceptance flow](multi-store.md). |
