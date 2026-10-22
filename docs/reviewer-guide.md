# Reviewing the live demo

[Open the demo login file](reviewer-access.json). These dedicated accounts are intentionally published for this temporary assessment installation. They contain no Groq key, Azure credentials, SSH key, Kubernetes configuration, database password, encryption key or upstream service token. Local setup generates separate credentials for your own installation.

## Accounts

- **Dashboard admin:** inspect/manage integrations, invitations, member roles, audit and metrics; use chat writes with explicit approval; manage stores.
- **Dashboard member:** use permitted read tools, chat, manage personal API keys and provision their own stores. Admin write tools remain unavailable.
- **WooCommerce shop manager:** inspect products and orders in WordPress admin, including storefront purchases. This role is sufficient for the demonstrated order checks and does not provide WordPress plugin/theme administration.

## Repeat the demonstrated flow

1. Sign into the dashboard as the reviewer admin. Integrations shows WooCommerce, synthetic inventory and knowledge, plus remaining managed stores. Open AI workspace, request a product with a unique name/SKU and price, and approve changes for that message. The successful write receipt and activity identify the created product.
2. In a separate private browser window, purchase that exact product using fictional details and cash on delivery. Note the order number. Use the WooCommerce login to find the matching order.
3. Ask admin chat for today's orders in the **original store**. Compare the returned order number/product to the purchase.
4. In a separate browser profile, sign into the dashboard as the reviewer member. Open API keys, create a key and copy it once. Configure MCP Inspector or another Streamable HTTP client with the URL from the login file and `Authorization: Bearer YOUR_KEY`. No upstream credentials are needed. Refresh discovery; verify read tools are available while product/order write tools are hidden. Call `store__list_orders` with `period: today` and find the same order.
5. For an external LLM-assisted question spanning inventory and knowledge, follow the [external-client instructions](demo-runbook.md). That helper requires your own private LLM credentials. Alternatively, the deployed dashboard chat can demonstrate the same two-upstream tool selection using its server-side provider configuration. No provider key is exposed by this repository.
6. Revoke only the personal key you created for this check, then make another call to confirm rejection. Inspect Audit trail as admin for successful and rejected calls under the relevant identity.
7. Disable the synthetic inventory integration as admin, refresh client discovery, and confirm its tools disappear. Re-enable it afterward. Metrics and audit provide call outcomes and latency. Infrastructure commands for a controlled outage require your own local deployment or operator access; the video shows the live VPS outage/recovery. Azure/SSH credentials are deliberately not published.

## Multi-store bonus

Use Stores to create two uniquely named disposable stores. The shared installation permits four managed stores in total and three per user; existing demo stores count toward that capacity. A store proceeds from Provisioning to Ready after initialization, health checks, HTTPS and gateway discovery complete. Do not repeat a create request just because initialization takes time.

Place a fresh guest COD order in each new store, then ask chat to compare today's orders across those exact names. Tool activity should show a namespaced `list_orders` call for each. The original WooCommerce store's orders and yesterday's orders are separate from this comparison.

Delete only a disposable store created for your check. Its gateway registration and tools are removed, then its namespace and volumes are reclaimed. The other store should continue serving its storefront and tools. The [multi-store design](multi-store.md) documents isolation, quota, retry and restart behavior; Kubernetes manifests and tests provide the implementation evidence. To run namespace/PV checks yourself, deploy locally with the same Helm chart and use your own cluster credentials.

## Limitations and shared state

The accounts share a real demo environment, so products, metrics and audit counts change. Use fictional data and unique SKUs. Avoid revoking shared accounts or deleting existing demonstration stores. Groq quotas can temporarily limit chat even though MCP calls and checkout work; inspect successful activity before repeating a write. This is a temporary single-node service, not a production SLA. Managed-store full disaster recovery is not implemented. See the README's [known limitations](../README.md#known-limitations).
