#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
docker info >/dev/null
if ! k3d cluster list -o json | python3 -c 'import json,sys; sys.exit(0 if any(c["name"]=="urumi" for c in json.load(sys.stdin)) else 1)'; then
  k3d cluster create urumi --image rancher/k3s:v1.35.0-k3s1 --api-port '127.0.0.1:6445' --no-lb \
    --port '127.0.0.1:8080:80@server:0:direct' --port '127.0.0.1:8443:443@server:0:direct'
fi
k3d cluster start urumi
kubectl config use-context k3d-urumi
kubectl create namespace urumi --dry-run=client -o yaml | kubectl apply -f -
python3 scripts/create-secrets.py
docker build -t urumi-store:0.1.0 store
k3d image import urumi-store:0.1.0 -c urumi
helm upgrade --install urumi deploy/helm/urumi -n urumi \
  -f deploy/helm/urumi/values-local.yaml --wait --timeout 10m
# The local development image tag is reused; replace the pod to load rebuilt code.
kubectl rollout restart deployment/urumi-store -n urumi
kubectl rollout status deployment/urumi-store -n urumi --timeout=180s
kubectl exec -n urumi deployment/urumi-store -- bash /opt/urumi/bootstrap.sh
echo 'Store: http://store.localhost:8080/shop/'
echo 'Admin: http://store.localhost:8080/wp-admin/'

