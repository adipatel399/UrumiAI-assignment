#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .local
container="urumi-platform-test-$$"
env_file=".local/${container}.env"
export TEST_PG_PASSWORD="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
export TEST_PG_PORT=55432
umask 077
printf 'POSTGRES_PASSWORD=%s\nPOSTGRES_USER=urumi\nPOSTGRES_DB=urumi\n' "$TEST_PG_PASSWORD" > "$env_file"
cleanup() { docker rm -f -v "$container" >/dev/null; rm -f "$env_file"; }
trap cleanup EXIT
docker run -d --name "$container" --env-file "$env_file" -p "127.0.0.1:${TEST_PG_PORT}:5432" postgres:17-bookworm >/dev/null
for attempt in $(seq 1 30); do
  if docker exec "$container" pg_isready -U urumi >/dev/null; then break; fi
  sleep 1
done
npm run build
npm test
