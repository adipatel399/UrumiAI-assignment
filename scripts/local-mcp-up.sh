#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
[[ "$(kubectl config current-context)" == k3d-urumi ]] || { echo 'Select k3d-urumi first.' >&2; exit 1; }
python3 scripts/setup-woocommerce-mcp.py
npm ci
npm run build
npm test
docker build -f services/woocommerce-mcp/Dockerfile -t urumi-woocommerce-mcp:0.1.0 .
k3d image import urumi-woocommerce-mcp:0.1.0 -c urumi
platform_enabled=false
if kubectl get secret urumi-platform-secrets -n urumi >/dev/null 2>&1; then platform_enabled=true; fi
helm upgrade --install urumi deploy/helm/urumi -n urumi \
  -f deploy/helm/urumi/values-local.yaml --set woocommerceMcp.enabled=true --set "platform.enabled=$platform_enabled" --wait --timeout=5m
kubectl rollout restart deployment/urumi-woocommerce-mcp -n urumi
kubectl rollout status deployment/urumi-woocommerce-mcp -n urumi --timeout=180s
echo 'Internal MCP endpoint: http://urumi-woocommerce-mcp:3000/mcp'
