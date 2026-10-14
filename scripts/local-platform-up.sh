#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
[[ "$(kubectl config current-context)" == k3d-urumi ]] || { echo 'Select k3d-urumi first.' >&2; exit 1; }
python3 scripts/setup-platform.py
npm ci
npm run build
npm test
docker build -f services/platform/Dockerfile -t urumi-platform:0.1.0 .
k3d image import urumi-platform:0.1.0 -c urumi
helm upgrade --install urumi deploy/helm/urumi -n urumi \
  -f deploy/helm/urumi/values-local.yaml --set platform.enabled=true --wait --timeout=5m
kubectl rollout restart deployment/urumi-gateway deployment/urumi-inventory-mcp deployment/urumi-knowledge-mcp -n urumi
kubectl rollout status deployment/urumi-gateway -n urumi --timeout=180s
echo 'Gateway: http://gateway.localhost:8080/mcp'
