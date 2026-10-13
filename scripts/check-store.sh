#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "$(kubectl config current-context)" != k3d-urumi ]]; then
  echo 'Select the dedicated k3d-urumi context before running local checks.' >&2
  exit 1
fi
helm lint deploy/helm/urumi
kubectl rollout status deployment/urumi-database -n urumi --timeout=180s
kubectl rollout status deployment/urumi-store -n urumi --timeout=180s
curl --fail --silent --show-error --resolve store.localhost:8080:127.0.0.1 \
  http://store.localhost:8080/readyz.php
kubectl exec -n urumi deployment/urumi-store -- wp wc product list \
  --allow-root --user=storeadmin --fields=id,name,sku,price --format=table
kubectl get pods,pvc,services,ingress,networkpolicies -n urumi
echo 'Infrastructure checks complete. Checkout and persistence must also be verified.'

