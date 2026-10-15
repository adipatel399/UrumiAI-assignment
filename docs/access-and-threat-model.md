# Team access and threat model

## Identity and permissions

The backend supports admin and member accounts. Admins manage servers, invitations, users, and API keys and inspect audit records. Members create/revoke their own keys and use explicitly permitted tools. Admins can issue/revoke keys for other users. A member cannot administer a server, create an admin invitation, revoke another user's key, or inspect team audit data. The last active administrator cannot be disabled/demoted.

Tool discovery and execution both apply permission checks. Members see only the original tool names in each server's configured `read_tools` allowlist. Upstream `readOnlyHint` annotations do not grant access. WooCommerce's default member list permits listing products/orders and retrieving one order; product creation and status updates are admin-only.

Passwords use asynchronous scrypt with independent random salts. Per-user API keys are high-entropy random values; only a SHA-256 hash and a display prefix are stored. The raw key is returned once on creation. Revocation is a database timestamp, checked on every request. Inactive accounts also fail authentication. Key metadata lists never return raw keys or hashes.

Dashboard login issues an HttpOnly, SameSite=Strict session cookie; production uses Secure cookies. The database stores only the session hash with a 24-hour expiry. Session-authenticated mutations require an `X-CSRF-Token` derived from the session and server secret. The login/me response supplies that CSRF token. Logout removes the server-side session. Session state does not replace per-request role/active checks. Bearer-authenticated requests do not rely on cookies and do not require the cookie CSRF token.

Invitations contain a one-time hashed token, a role and email assigned by the admin, and a 48-hour expiry. Acceptance uses a transaction and row lock so concurrent/repeated acceptance cannot create multiple accounts. Copyable invitation links are returned; the dashboard supplies the acceptance page; email sending is not implemented. Public login has an in-memory attempt limit; it is not a distributed rate limiter and currently groups traffic by the observed source IP.

## Audit

Every valid `tools/call` envelope that reaches the handler creates a durable audit row before routing, including caller, key ID, server identity, public tool name and timestamp. Completion records duration, outcome and a safe error code. Denied known-user calls and revoked-key calls are recorded too; unknown keys are anonymous rather than assigned a fabricated user. Raw tool arguments, customer payloads, keys and upstream headers are not audit fields.

A crash after the initial insert may leave `started` as an incomplete outcome. This preserves evidence of an attempted operation but is not an exactly-once delivery guarantee. An audit/database failure prevents dispatch. Tool writes are never automatically retried after uncertain failures. Audit history keeps server identity snapshots even if a registration is removed.

## Credentials across boundaries

```text
External client → user's gateway key → gateway authenticates the user
Gateway → registered upstream credential → upstream authenticates the gateway
WooCommerce MCP → its store key/secret → WooCommerce authenticates that service
```

Client tokens are never passed through to upstreams. An upstream should not learn reusable team-user credentials; it receives only the credential configured for that integration. The gateway does not receive the WooCommerce consumer key/secret, only the WooCommerce MCP bearer credential.

Recoverable upstream credentials are encrypted with AES-256-GCM before being persisted. The encryption key is supplied through a Kubernetes Secret, separate from PostgreSQL. Credential fields are write-only in administration APIs; server list responses report only whether a credential exists. Encryption-key rotation requires deliberate re-encryption, not simply changing the Secret. Back up the key securely or existing credentials cannot be recovered.

A member can still exercise every operation the gateway permits under a shared upstream credential. Hiding that credential is not a substitute for tool authorization. Upstream credentials should have the smallest service permissions practical.

## Untrusted upstreams and team members

An upstream may return dishonest descriptions, prompt-injection text, or malicious results. Treat descriptions/results as untrusted data, not as instructions that alter identity or permissions. The gateway authorizes tool names using trusted configuration and never grants write permission based on a server's self-reported annotations. Chat preserves this boundary with per-user MCP authentication, trusted tool allowlists, per-turn write approval, and bounded execution. Prompt instructions alone do not eliminate injection risk.

A compromised upstream can misuse the credential already entrusted to it and falsify its own results. Gateway policy does not control what a compromised service does internally. Separate credentials and network restrictions reduce its access to other services; a compromised WooCommerce MCP has a write-capable store credential and therefore remains a serious store risk.

Members share authorized store data as a team. This is not per-customer or per-store tenant isolation. They cannot acquire another member's password/key from management APIs, change another member's role, or revoke another member's key. Kubernetes administrators and Secret readers are privileged operators outside this application trust boundary.

## Remaining production work

Dashboard chat and per-server metrics are implemented. Chat uses short-lived, session-bound user keys through the MCP endpoint; see [chat and operations](chat-and-operations.md). External destinations are validated during the actual socket DNS lookup and redirects are refused. Namespace-wide default-deny policies have explicit permitted paths and real enforcement checks. Local transport uses HTTP on loopback/internal networks; remote traffic needs TLS. Internal transport encryption, credential rotation procedures, backup/restore, audit retention, a metrics-only role, and shared rate limiting still need production attention. One database replica and local-path disks are not highly available.
