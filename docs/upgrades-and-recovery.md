# Upgrades, rollback, and recovery

Use an explicit Kubernetes context for every remote command. Keep separate credentials and values for each installation. The same `deploy/helm/urumi` chart owns the store, databases, gateway/dashboard, and all MCP services.

## Release an update

1. Build immutable image tags for all changed applications. A VPS CPU may differ from your laptop: `bash scripts/build-vps-images.sh RELEASE_TAG` targets Linux AMD64 by default. Set `TARGET_PLATFORM` deliberately for a different server.
2. Transfer the private image archive over SSH and import it with `sudo k3s ctr images import ARCHIVE`. A production registry is an alternative; this single-node demo avoids a registry account and fees.
3. Make a quiesced backup before a schema/data change. Review compatibility: an older application must be able to read the newer schema if rollback is expected to work.
4. Change only image tags/configuration in your installation values. Render and inspect the manifests: `helm template urumi deploy/helm/urumi -f VALUES`.
5. Upgrade with `helm --kube-context CONTEXT upgrade urumi deploy/helm/urumi -n urumi -f VALUES --wait --timeout 10m`.
6. Verify readiness, login, tool discovery, a read through each integration, and retained records. Do not use a write as an automatic readiness/retry probe.

Store, MCP, and gateway can be upgraded independently by changing `store.image`, `woocommerceMcp.image`, and `platform.image`. Support services currently share the platform image. Local development deliberately reuses an image tag and restarts pods; release tags on the VPS are immutable.

## Roll back application configuration

Inspect `helm --kube-context CONTEXT history urumi -n urumi`, select the known earlier revision, then run `helm --kube-context CONTEXT rollback urumi REVISION -n urumi --wait --timeout 10m`.

Rollback restores Kubernetes configuration and image references. It does **not** undo database migrations, orders, content edits, or external side effects. Current platform migrations are additive; password/encryption-key rotation and destructive migrations require a separate recovery procedure. WordPress/WooCommerce upgrades may migrate their database; follow vendor compatibility guidance and retain a tested backup.

`scripts/rehearse-upgrade.py --context CONTEXT` demonstrates a reversible CPU-request change and Helm rollback without changing business data. It upgrades and restores the earlier values for the whole chart. This checks the release lifecycle, not every future application-version downgrade.

## Private backup

`python3 scripts/backup.py --context CONTEXT --output PRIVATE_NEW_DIRECTORY --allow-plaintext`

The helper stops the gateway, activates WordPress maintenance mode, captures a transaction-consistent MariaDB dump, PostgreSQL custom-format dump, WordPress filesystem archive, Kubernetes Secrets and Helm values, then restores service. It creates a mode-700 directory with mode-600 files. Expect a short outage and run it when no demo is in progress. Operators must prevent independent writers during this window.

The backup contains raw credentials and customer data. The plaintext flag is intentional for a private local rehearsal; encrypt the entire backup with a trusted tool such as age before off-host storage. Restrict access and keep the encryption recovery key separately. `scripts/encrypt-backup.sh PRIVATE_DIRECTORY PUBLIC_RECIPIENT_FILE OUTPUT.tar.age` packages and encrypts a completed backup without putting a secret in command arguments. Test with `age -d -i PRIVATE_IDENTITY OUTPUT.tar.age | tar -tzf -` before removing a plaintext copy. Do not commit archives, database dumps, or Secret manifests. A folder on the same VM is not disaster recovery.

## Restore

Prepare an isolated recovery cluster with the same chart, compatible images and original Secrets. For an existing target, take a separate safety backup first. Restoring overwrites application data and interrupts access.

`python3 scripts/restore.py --context RECOVERY_CONTEXT --backup PRIVATE_DIRECTORY --confirm-replace-data`

The helper refuses to proceed without explicit replacement acknowledgement and checks that the upstream encryption key matches the backup. Database passwords must also match the saved Secrets. Restore the saved Secret data on fresh volumes before bootstrapping recovery databases; updating a Secret does not rotate an existing database password. The helper restores both databases and overlays archived WordPress content. Use empty recovery volumes for a clean filesystem recovery; overlay restoration does not remove extra files introduced after the backup. A failure leaves the gateway stopped for diagnosis rather than reopening a partially recovered system.

When moving hostnames, deliberately update WordPress `home` and `siteurl`, perform a serialization-aware URL migration if needed, update `store.url` and `platform.url`, obtain matching TLS certificates, and recheck OAuth signatures. Restoring into the original stable hostnames normally needs no URL rewrite.

Verify order/product counts, an existing account, a revoked key, audit rows, decryption of registered upstream credentials, and MCP calls. Only then direct external traffic to recovery. Test restores periodically; having a backup file is not proof it can be restored.

## Storage limits

Local-path volumes survive pod replacement, not host/disk loss. They are single-node and unreplicated. PostgreSQL's retained PVC is intentional; store/MariaDB PVCs require deliberate retention/backup before namespace deletion or Helm uninstall. Never use uninstall or deleting the cluster as an upgrade procedure. Deleting a cloud resource group destroys its VM/disk and therefore its local-path data unless copied elsewhere first.

## Observed rehearsals

The values-only Helm upgrade/rollback passed locally and on the VPS on October 15, 2026. A clean disposable installation passed login/discovery/routing checks. Its backup was restored after deliberate WordPress/platform configuration changes; the original store name and knowledge registration returned and login/MCP reads passed afterward. The temporary cluster was removed after verification. The VPS backup was stored off-VM, encrypted with age, and successfully decrypted for archive verification. This does not claim a full VM-loss recovery drill.
