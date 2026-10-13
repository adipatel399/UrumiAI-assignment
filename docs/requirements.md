# Assessment evidence checklist

Statuses describe demonstrated behavior, not just files present. See the store architecture note for verification details.

| Requirement | Status |
| --- | --- |
| Local Kubernetes and Helm | Verified locally |
| Same charts with local/production values | Both configurations render; VPS not deployed |
| Store and database persistent storage | Verified after replacing both pods |
| Checkout and order visible in admin | Browser COD order #12; authenticated admin page verified |
| Stable store and dashboard Ingress | Store Ingress created; dashboard pending |
| Probes, requests and limits | Store/database configured and healthy; future workloads pending |
| Secrets absent from source | Generated credentials ignored; Secret applied |
| Five handwritten WooCommerce MCP tools | Planned |
| Streamable HTTP and internal-only WooCommerce MCP | Planned |
| Three registered upstreams | Planned |
| Aggregate discovery and correct routing | Planned |
| Tool collisions, timeouts and failure isolation | Planned |
| Admin/member identity and invitations | Planned |
| Per-user hashed API keys and immediate revocation | Planned |
| User-attributed audit log and dashboard | Planned |
| Chat tool loop through gateway | Planned |
| Two-user external MCP acceptance flow | Planned |
| Stand-out: tool permissions | Planned |
| Stand-out: security hardening | Database ingress enforcement verified; remaining hardening planned |
| Stand-out: observability | Planned |
| Stand-out: real VPS deployment | Azure student credits available; deployment pending |
| Upgrade and rollback story | Planned |
| README, design note, threat model and demo | Setup/learning documentation started |

