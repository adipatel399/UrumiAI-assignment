#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
tag="${1:?Pass an immutable image tag}"
[[ "$tag" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}$ ]] || { echo 'Invalid image tag'; exit 1; }
platform="${TARGET_PLATFORM:-linux/amd64}"
docker buildx build --platform "$platform" --load -t "urumi-store:$tag" store
docker buildx build --platform "$platform" --load -f services/woocommerce-mcp/Dockerfile -t "urumi-woocommerce-mcp:$tag" .
docker buildx build --platform "$platform" --load -f services/platform/Dockerfile -t "urumi-platform:$tag" .
mkdir -p .local/images
umask 077
docker save "urumi-store:$tag" "urumi-woocommerce-mcp:$tag" "urumi-platform:$tag" | gzip > ".local/images/$tag.tar.gz"
echo 'Images built and saved privately. Transfer over SSH and import with sudo k3s ctr images import.'
