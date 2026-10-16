#!/usr/bin/env bash
# Run on a dedicated Ubuntu VPS through SSH. Requires sudo; no public Kubernetes API.
set -euo pipefail
version="${K3S_VERSION:-v1.35.0+k3s1}"
if ! command -v k3s >/dev/null; then
  curl -fsSL https://get.k3s.io -o /tmp/install-k3s.sh
  sudo env INSTALL_K3S_VERSION="$version" sh /tmp/install-k3s.sh server \
    --secrets-encryption --write-kubeconfig-mode 600
  rm /tmp/install-k3s.sh
fi
for attempt in $(seq 1 60); do
  if [[ -n "$(sudo k3s kubectl get nodes -o name 2>/dev/null)" ]]; then break; fi
  sleep 2
done
sudo k3s kubectl wait node --all --for=condition=Ready --timeout=180s
sudo k3s secrets-encrypt status
