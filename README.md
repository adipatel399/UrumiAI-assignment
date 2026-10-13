# Urumi team MCP gateway

The Kubernetes WooCommerce store is implemented. The team MCP gateway, dashboard, and chat are planned and are not implemented yet.

See [the store architecture](docs/store-architecture.md) and [requirements checklist](docs/requirements.md).

## Local setup

Requirements: Docker engine running (approximately 8 GB available to Docker), kubectl, Helm, k3d, Python 3. On macOS, Helm and k3d can be installed with `brew install helm k3d`.

Run from the repository root:

```sh
bash scripts/local-up.sh
```

This creates a dedicated `urumi` cluster, selects its context, creates namespace `urumi`, generates Secrets, builds/imports the store image, installs Helm resources, and bootstraps WooCommerce. Rerunning preserves existing credentials and avoids duplicating the demo product.

Local setup also starts an existing stopped cluster and replaces the store pod to load a rebuilt development image. This causes a short local interruption. Production will use versioned image tags instead.

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

## Troubleshooting

- Docker unavailable: finish Docker Desktop first-run setup and wait for its engine to run.
- Failed pods: inspect `kubectl describe pod -n urumi POD_NAME` and relevant container logs; do not publish secrets from debug output.
- Port 8080 occupied: change the local cluster port mapping and `store.url` together before creating the cluster.
- Wrong context: verify `kubectl config current-context` is `k3d-urumi`.
- Existing store: bootstrap intentionally leaves existing WordPress users/passwords intact. Do not rotate database passwords by editing the local file; changing the Secret alone does not change existing database accounts.
- Email: outbound mail is not configured in this test store; notification attempts may report missing `sendmail`. Checkout and order storage work without email. No real customer information should be used here.

## Production preparation

`values-prod.yaml` uses the same Helm templates. It is a configuration example, not a deployed production system. Publish the image to a registry available to the VPS, create Secrets in namespace `urumi`, configure DNS and TLS, and select appropriate storage and sizes. Full VPS instructions and verified deployment will be added with the production deployment. Persistent site URL must be updated deliberately when moving an existing database between environments.

