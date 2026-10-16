#!/usr/bin/env bash
# Same chart for local and remote; pass explicit context, values, and a private credential directory.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${URUMI_CONTEXT:?Set an explicit Kubernetes context}"
: "${URUMI_CREDENTIAL_DIR:?Set a private credential directory}"
values="${1:?Pass an installation values file}"
kubectl --context "$URUMI_CONTEXT" create namespace urumi --dry-run=client -o yaml | kubectl --context "$URUMI_CONTEXT" apply -f -
python3 scripts/create-secrets.py
platform_enabled=false
if kubectl --context "$URUMI_CONTEXT" get secret urumi-platform-secrets -n urumi >/dev/null 2>&1; then platform_enabled=true; fi
helm --kube-context "$URUMI_CONTEXT" upgrade --install urumi deploy/helm/urumi -n urumi \
  -f "$values" --set woocommerceMcp.enabled=false --set "platform.enabled=$platform_enabled" --wait --timeout 10m
kubectl --context "$URUMI_CONTEXT" exec -n urumi deployment/urumi-store -- bash /opt/urumi/bootstrap.sh
python3 scripts/setup-woocommerce-mcp.py
python3 scripts/setup-platform.py
helm --kube-context "$URUMI_CONTEXT" upgrade --install urumi deploy/helm/urumi -n urumi \
  -f "$values" --set woocommerceMcp.enabled=true --set platform.enabled=true --wait --timeout 10m
if [[ -f "$URUMI_CREDENTIAL_DIR/llm-credentials.json" ]]; then
  python3 - <<'PY'
import json
from scripts.provisioning import PRIVATE, secret
secret('urumi-llm-secrets', json.loads((PRIVATE/'llm-credentials.json').read_text()))
PY
  kubectl --context "$URUMI_CONTEXT" rollout restart deployment/urumi-gateway -n urumi
  kubectl --context "$URUMI_CONTEXT" rollout status deployment/urumi-gateway -n urumi --timeout=180s
fi
