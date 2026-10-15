# Store architecture and deployment decisions

## The request journey

Browser → laptop port 8080 → k3d server node → Traefik Ingress → store Service → WordPress pod → database Service → MariaDB pod.

The local cluster uses one server node with direct loopback port mappings (`--no-lb`). An additional k3d proxy is unnecessary for this single-node layout. Kubernetes Ingress still performs hostname routing. The Kubernetes API also binds to loopback on port 6445.

WordPress renders the site. WooCommerce is a WordPress plugin that adds products, carts, checkout, and orders. MariaDB stores structured information, including products, orders, users, and settings. WordPress's disk holds uploaded media, plugin files, themes, and configuration.

## Vocabulary

- **Image:** a packaged application and its dependencies, like a prepared recipe kit.
- **Container:** a running instance of that package.
- **Pod:** Kubernetes's smallest running unit, containing one or more containers.
- **Deployment:** tells Kubernetes how to run and replace application pods.
- **Service:** a stable internal address in front of replaceable pods.
- **Ingress:** routing rules for incoming HTTP traffic. An ingress controller, Traefik here, executes those rules.
- **Namespace:** a grouping boundary within the cluster; it does not alone enforce network isolation.
- **PVC:** a request for persistent disk space. Its volume survives pod replacement.
- **Secret:** a Kubernetes object for sensitive configuration; base64 encoding does not encrypt it.
- **Helm chart:** templates describing resources. Values fill in environment-specific choices.

## Why these decisions

**Separate database and store pods:** their responsibilities, health, and disk requirements differ. A WordPress restart should not imply a database restart.

**Deployments with one replica and Recreate strategy:** straightforward for a single-node assessment. Recreate avoids overlapping writers during updates with single-writer storage. A StatefulSet would offer stable per-instance identities and volume management for more advanced stateful layouts; we do not need multiple database instances here. This design has upgrade downtime and no database high availability.

**Custom image:** official WordPress plus pinned WooCommerce and WP-CLI. It avoids manually installing an untracked plugin on every fresh deployment. WP-CLI is a store setup tool; the upcoming MCP server will use REST, not shell commands.

**Persistent WordPress directory:** retains content through pod replacement. Tradeoff: replacing the image alone does not replace core/plugin files already on the volume. Production upgrades require a documented explicit procedure and backup; Helm rollback alone does not roll back those files.

**Separate liveness and readiness:** liveness asks whether PHP/HTTP is alive. Readiness also checks database connectivity. A temporary database outage should stop routing ready traffic without repeatedly restarting WordPress.

**Resource requests/limits:** requests reserve scheduling capacity; limits cap usage. These starting values need measurement with the complete system. Docker currently has roughly 8 GB of memory; do not interpret limits as performance guarantees.

**Database NetworkPolicy:** only store pods in the namespace may initiate database connections. Having no public database URL is useful but insufficient isolation by itself. The policy must be tested against the actual cluster networking implementation.

**Virtual demo product and cash on delivery:** proves a real checkout/order without processing money or setting up shipping. This is deliberately a test store.

## Important files

- `store/Dockerfile`: packages WordPress, WooCommerce, health pages, and setup tools.
- `store/bootstrap.sh` and `bootstrap.php`: initial install and repeatable demo configuration.
- `deploy/helm/urumi/templates/store.yaml`: store deployment, persistent disk, Service, and Ingress.
- `deploy/helm/urumi/templates/database.yaml`: database deployment, disk, and internal Service.
- `deploy/helm/urumi/templates/database-networkpolicy.yaml`: allowed database callers.
- `scripts/create-secrets.py`: creates private random credentials and sends the Secret to Kubernetes without printing values.
- `scripts/local-up.sh`: repeatable local setup.

## Completion evidence

Record observed results, not assumptions:

- Helm renders and lints.
- Both pods become ready and volumes bind.
- Store and admin are accessible through stable hostname.
- Browser checkout creates a visible order.
- Pod replacements preserve products, orders, and content.
- A pod without the store label cannot connect to MariaDB.

## Interview practice

1. Why does an order survive a pod restart?
2. What happens if you delete the whole local cluster?
3. How does a browser request reach WordPress?
4. Why does a Service help when pod addresses change?
5. How is readiness different from liveness?
6. What does a Kubernetes Secret protect, and what does it not protect?
7. What changes for Azure, and what stays in the same chart?
8. Why isn't one replica with local storage highly available?

## Observed results

Verified on October 12, 2026:

- Kubernetes v1.35.0+k3s1 runs through k3d 5.9.0 on the local ARM64 machine; Helm 4.3.0 installed.
- WordPress 7.1.3, PHP 8.3, WooCommerce 11.2.1, and MariaDB 11.4 deployed. Base WordPress and MariaDB images pinned by digest.
- Local and production values render; Helm lint passes.
- Both application pods ready; both 2 GiB PVCs bound.
- Browser shop, cart, and checkout work through Ingress. Browser checkout created order #12 for ₹199 with COD and processing status.
- A password-authenticated request to the actual WooCommerce admin orders page confirmed Demo Customer and order #12.
- Replacing WordPress and database pods preserved the order, seed product, and an uploaded-directory test file.
- WordPress connected to MariaDB; a temporary non-root pod without the store label could not connect. The test pod was removed.
- Fresh install in a separate temporary namespace succeeded and exposed one seed product. That test installation was removed; the real store remains.
- Setup rerun did not duplicate the seed product.

Limits: one replica, node-local storage, no outbound email or TLS locally. VPS configuration is only an example at this stage. Full gateway security, dashboard, MCP, and chat are planned additions.

## Primary references

- [Official WordPress container image](https://hub.docker.com/_/wordpress): database configuration and persistent files.
- [k3d service exposure](https://k3d.io/stable/usage/exposing_services/): local port mappings and ingress.
- [WooCommerce cash on delivery](https://woocommerce.com/document/cash-on-delivery/): test-friendly payment setup.
- [WooCommerce command-line interface](https://developer.woocommerce.com/docs/wc-cli/using-wc-cli): setup and inspection.

### Guest visibility verification

A fresh logged-out browser on October 15, 2026 exposed WooCommerce's default Coming soon mode, which an administrator can bypass. Bootstrap now explicitly sets `woocommerce_coming_soon` to `no` for the runnable demo store. After applying that setting, a guest purchased the chat-created product #17 with fictional details/COD, creating order #19 for INR 249.00. Dashboard chat retrieved the same order with the configured store-day filter.
