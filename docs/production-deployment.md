# Production-like VPS deployment

The same Helm chart runs locally and on a real single-node Azure VM. There is no VPS-specific chart fork. The current deployment uses k3s v1.35.0+k3s1, Ubuntu 24.04, AMD64 images, local-path storage, Traefik Ingress, and cert-manager v1.21.2.

## Live installation

- Store: https://store.85.211.243.237.sslip.io/shop/
- Dashboard: https://gateway.85.211.243.237.sslip.io/
- MCP: https://gateway.85.211.243.237.sslip.io/mcp

These are assessment demo services, not an availability guarantee. Use fictional customer details and COD. Administrator credentials are delivered privately, never in this repository. The free sslip.io hostnames resolve the embedded public IP; they depend on a third-party DNS service. Real production should use an owned domain and a recovery plan.

## What changed through values

| Setting | Local | VPS |
|---|---|---|
| Public URLs | `*.localhost:8080`, HTTP | Separate public sslip.io names, HTTPS |
| Images | Development tags imported into k3d | Immutable Linux AMD64 tags imported into k3s |
| Ingress | Traefik | Traefik, HTTP-to-HTTPS redirect |
| TLS | Disabled | Namespace Issuer, certificates, TLS Secrets |
| Sessions | Local non-Secure cookie | Secure cookie |
| Storage | local-path, 2 GiB claims | local-path, 10 GiB claims on VM disk |
| Secrets | Local installation's private files | Independently generated VPS credentials and encryption key |
| Administration | Loopback Kubernetes API | SSH tunnel; public API port blocked |

The same `values-prod.yaml` example is the starting point; an ignored installation file supplies the actual hosts, image tags, TLS email, and sizes. No secret value belongs in Helm values. Install cert-manager separately once per cluster before enabling `tls.enabled`.

## Prepare the VM

Use an eligible student-credit subscription with its spending limit enabled. Check allowed regions and VM-family quotas before creation; available credit does not imply every VM SKU is permitted. Our subscription permitted Malaysia West and B2as v2 (2 vCPUs, 8 GB); the initial Dasv5 choice had zero quota and was not deployed.

Create a dedicated resource group and SSH key, then a VM. Example parameters:

```sh
ssh-keygen -t ed25519 -f PRIVATE_DIRECTORY/id_ed25519
az group create --name YOUR_RESOURCE_GROUP --location malaysiawest
az vm create --resource-group YOUR_RESOURCE_GROUP --name urumi-k3s \
  --location malaysiawest --image Ubuntu2404 --size Standard_B2as_v2 \
  --admin-username urumi --ssh-key-values PRIVATE_DIRECTORY/id_ed25519.pub \
  --public-ip-sku Standard --storage-sku StandardSSD_LRS --os-disk-size-gb 64 \
  --nsg-rule NONE --security-type Standard
```

Add NSG rules for TCP 80/443 from the internet and TCP 22 only from the operator's IP. Do not expose Kubernetes API 6443, database ports, NodePorts, or the internal MCP ports. Use key-only SSH. Run `scripts/install-k3s.sh` on that dedicated Ubuntu host over SSH; it pins k3s and enables encryption of Kubernetes Secrets at rest.

Retrieve `/etc/rancher/k3s/k3s.yaml` over SSH into a mode-600 local file, change its server address to `https://127.0.0.1:16443`, rename the context to `urumi-vps`, and forward the API securely:

```sh
ssh -N -L 16443:127.0.0.1:6443 -i PRIVATE_DIRECTORY/id_ed25519 urumi@PUBLIC_IP
export KUBECONFIG=PRIVATE_DIRECTORY/kubeconfig.yaml
export URUMI_CONTEXT=urumi-vps
```

Keep that tunnel open while running cluster commands. The actual installation's SSH configuration and kubeconfig live under ignored `.local/azure-vps`; access is privileged, so do not share those files in the submission or recording.

## Distribute images

```sh
bash scripts/build-vps-images.sh UNIQUE_RELEASE_TAG
scp .local/images/UNIQUE_RELEASE_TAG.tar.gz urumi@PUBLIC_IP:/home/urumi/images.tar.gz
ssh urumi@PUBLIC_IP 'sudo k3s ctr images import /home/urumi/images.tar.gz && rm /home/urumi/images.tar.gz'
```

The helper builds for `linux/amd64`, independent of an ARM laptop, and uses the pinned multi-architecture base images. It packages the three application images without private files. Import them before installing the chart, and use the corresponding tags in values. A private registry can replace SSH transfer in a larger deployment.

## TLS and installation

Install cert-manager from its official OCI chart:

```sh
helm --kube-context urumi-vps upgrade --install cert-manager \
  oci://quay.io/jetstack/charts/cert-manager --version v1.21.2 \
  --namespace cert-manager --create-namespace --set crds.enabled=true --wait
```

Prepare a private values file based on `deploy/helm/urumi/values-prod.yaml`, overriding image tags and public names. Set `tls.enabled: true`, a reachable ACME contact email in `tls.email`, and the two TLS Secret names. Public DNS must resolve to the VM before ACME validation. The chart allows Traefik to reach only the HTTP-01 solver pods on their challenge port, preserving default-deny networking. Application Ingresses redirect HTTP to HTTPS; the challenge Ingress remains independently reachable for validation.

```sh
export URUMI_CREDENTIAL_DIR=PRIVATE_DIRECTORY/credentials
bash scripts/deploy-installation.sh PRIVATE_VALUES_FILE
```

This explicit-context helper generates independent Secrets, installs the store/database, bootstraps WooCommerce, provisions its service principal, and enables the MCP/platform services. Optional `llm-credentials.json` in the credential directory is applied only to the gateway. The helper refuses to overwrite existing Secrets when their private credential backup is missing; recover the original credentials rather than generating new database passwords accidentally. Rerunning preserves data and credentials but can briefly interrupt discovery/store setup.

Verify certificates, probes, login, all three integrations, and a read through each:

```sh
kubectl --context urumi-vps get pods,pvc,ingress,certificates,networkpolicies -n urumi
GATEWAY_URL=https://YOUR_GATEWAY URUMI_CREDENTIAL_DIR=PRIVATE_DIRECTORY/credentials node scripts/check-installation.mjs
```

Place a real demo checkout, verify it in WooCommerce admin and chat, then rehearse two-user MCP revocation and a controlled outage. See [the demo runbook](demo-runbook.md), [security model](access-and-threat-model.md), and [upgrades/recovery](upgrades-and-recovery.md).

## Costs and cleanup

Azure's retail API on October 15, 2026 listed B2as v2 Linux compute in Malaysia West at USD 0.0855/hour: about USD 28.73 over 14 days, before disk/public-IP/bandwidth costs. The disk and static IP are billable separately; exact billing arrives with delay. Credits pay for the demo resources. No billing upgrade, paid registry, managed Kubernetes service, domain purchase, or load-balancer service was required.

The resource group is `urumi-assessment-20261015`, tagged with an intended review date of October 29, 2026. **Tags do not stop billing.** The VM remains online for review until deliberately stopped/deleted or the subscription disables it. Deallocation stops VM compute billing but retained disks/public IP still cost credits:

```sh
az vm deallocate --resource-group urumi-assessment-20261015 --name urumi-k3s
```

After exporting a secure backup and when the demo is no longer needed, delete only this dedicated resource group to remove the VM, disk, IP, and network resources:

```sh
az group delete --name urumi-assessment-20261015
```

Deletion destroys local-path data. Keep the backup and encryption keys off-host first. One VM and local disks are not high availability; future work includes tested off-host backups, owned DNS, stronger ingress abuse controls, internal TLS, secret rotation, retention, and a multi-node storage/availability strategy.

## Observed VPS acceptance

On October 15, 2026, both certificates were Ready and real HTTPS requests succeeded. All seven application workloads were ready. Login, eight administrator tools and reads through all three upstreams passed. The captioned live VPS rehearsal created product #12 (Walkthrough Notebook, INR299.00), placed guest COD order #13, confirmed it in WooCommerce admin, and retrieved it through chat and MCP Inspector as another user. A real external model question called inventory and knowledge through Inspector CLI. Revocation, disabled tool discovery, an actual inventory outage with healthy store/knowledge calls, attributed audit, and recovery passed. The remote NetworkPolicy/privilege tests and Helm upgrade/rollback rehearsal passed. An off-VM backup was encrypted with age and successfully decrypted for archive verification; the full restore rehearsal was performed separately in the disposable local cluster.
