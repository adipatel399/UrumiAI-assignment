# Implemented differentiators

| Differentiator | Implementation and evidence |
|---|---|
| Tool permissions | Administrator-configured member read allowlists. Restricted tools are absent from discovery and rejected on direct invocation. Live chat member refusal and two-client tests pass. See `services/platform/src/gateway.ts`, `upstreams.ts`, and [access model](access-and-threat-model.md). |
| Security hardening | Default-deny NetworkPolicies with real positive/negative TCP checks; socket-level public destination validation; redirects refused; AES-256-GCM persisted upstream credentials; non-root custom services without Kubernetes API tokens; server-side secrets and session/CSRF protections. See [chat/operations](chat-and-operations.md) and `scripts/check-security.py`. |
| Observability | Durable per-server counts, failure rate inputs, mean/p95 latency, authenticated Prometheus histogram/counters/gauge, dashboard diagnostics, and controlled outage/recovery evidence. See `services/platform/src/metrics.ts` and [operations](chat-and-operations.md). |
| Real VPS | Same chart deployed on Azure Ubuntu/k3s with public HTTPS, independently provisioned Secrets, CPU-compatible immutable images, and larger local-path claims. See [deployment](production-deployment.md). |
| Lifecycle and recovery | Explicit-context setup, immutable image workflow, tested Helm upgrade/rollback, private quiesced backup and restore rehearsal in a disposable cluster. See [recovery](upgrades-and-recovery.md). |

Multi-store provisioning is implemented: concurrent namespace provisioning, automatic MCP registration, isolated networks, quotas, retry/restart recovery, and full namespace/storage teardown. See [multi-store design and verification](multi-store.md). OAuth, arbitrary hosted-server provisioning, many-tool search, and multi-replica scaling are not claimed. The inventory integration is intentionally synthetic and is not synchronized to WooCommerce stock.
