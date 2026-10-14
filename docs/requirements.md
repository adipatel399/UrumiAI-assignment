# Assessment evidence checklist

Statuses describe demonstrated behavior, not just files present. See the store architecture note for verification details.

| Requirement | Status |
| --- | --- |
| Local Kubernetes and Helm | Verified locally |
| Same charts with local/production values | Both configurations render; VPS not deployed |
| Store and database persistent storage | Verified after replacing both pods |
| Checkout and order visible in admin | Browser COD order #12; authenticated admin page verified |
| Stable store and dashboard Ingress | Store Ingress created; dashboard pending |
| Probes, requests and limits | Store, both databases, gateway and three MCP services configured and healthy |
| Secrets absent from source | Generated credentials ignored; Secret applied |
| Five handwritten WooCommerce MCP tools | Implemented; all five verified against the real store |
| Streamable HTTP and internal-only WooCommerce MCP | Official SDK client verified; no public exposure; unrelated pod blocked |
| Three registered upstreams | WooCommerce, inventory and knowledge verified through gateway |
| Aggregate discovery and correct routing | SDK client sees eight admin tools; cross-server calls verified |
| Tool collisions, timeouts and failure isolation | Namespaced search tools, controlled timeout and actual outage/recovery verified |
| Admin/member identity and invitations | API login/session, invite/accept, one-time acceptance, roles verified; UI pending |
| Per-user hashed API keys and immediate revocation | Verified on existing SDK connection; revocation persists across restarts |
| User-attributed audit log and dashboard | Durable audit and admin API verified; dashboard view pending |
| Chat tool loop through gateway | Planned |
| Two-user external MCP acceptance flow | Two SDK clients verified with only gateway URL and own keys; final GUI client/video flow pending |
| Stand-out: tool permissions | Member write tools hidden and direct calls rejected; admin writes verified |
| Stand-out: security hardening | Database and MCP isolation verified; non-root MCP; remaining hardening planned |
| Stand-out: observability | Planned |
| Stand-out: real VPS deployment | Azure student credits available; deployment pending |
| Upgrade and rollback story | Planned |
| README, design note, threat model and demo | Setup, architecture and threat model updated; final demo pending |
