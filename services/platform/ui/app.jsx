import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";

const paths = {
  grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  chat: "M21 11a8 8 0 0 1-8 8H7l-5 3 2-6a8 8 0 1 1 17-5Z M8 10h8 M8 14h5",
  server: "M4 3h16v7H4z M4 14h16v7H4z M7 6h.01 M7 17h.01 M11 6h6 M11 17h6",
  tool: "m14 6 4-4a6 6 0 0 1-7 8L4 17a2 2 0 0 0 3 3l7-7a6 6 0 0 0 8-7l-4 4Z",
  users:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M17 4a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87",
  key: "M15 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z M10 12H2 M5 12v4 M8 12v3",
  audit: "M8 3H4v18h16V3h-4 M8 2h8v4H8z M8 11h8 M8 15h8 M8 18h5",
  chart: "M3 3v18h18 M7 16v-5 M12 16V7 M17 16v-9",
  arrow: "M5 12h14 m-6-6 6 6-6 6",
  plus: "M12 5v14 M5 12h14",
  search: "M21 21l-5-5 M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14",
  refresh: "M20 7v5h-5 M4 17v-5h5 M6 6a8 8 0 0 1 13 3 M18 18a8 8 0 0 1-13-3",
  logout: "M9 3H3v18h6 M10 12h11 m-4-4 4 4-4 4",
  external: "M14 3h7v7 M21 3l-11 11 M10 3H3v18h18v-7",
  lock: "M5 10h14v11H5z M8 10V7a4 4 0 0 1 8 0v3",
  close: "m6 6 12 12 M6 18 18 6",
  check: "m5 12 4 4L19 6",
  copy: "M9 9h12v12H9z M15 5V3H3v12h2",
  shop: "M3 7h18l-2-5H5L3 7Z M4 7v14h16V7 M9 21v-8h6v8",
  code: "m8 7-5 5 5 5 M16 7l5 5-5 5 M14 4l-4 16",
  bolt: "m13 2-9 12h7l-1 8 10-13h-7l1-7Z",
};
function Icon({ name, size = 20, ...props }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d={paths[name] || paths.grid} />
    </svg>
  );
}
const pages = {
  overview: ["Overview", "Your integrations, at a glance.", "grid"],
  stores: [
    "Stores",
    "A space for every store. Connected from the start.",
    "shop",
  ],
  chat: ["AI workspace", "One conversation. All your tools.", "chat"],
  servers: [
    "Integrations",
    "Connect once. Put every tool within reach.",
    "server",
  ],
  tools: [
    "Tool library",
    "Explore the capabilities available to your account.",
    "tool",
  ],
  members: ["Team members", "The right access for the right people.", "users"],
  keys: ["API keys", "One endpoint for your external MCP clients.", "key"],
  audit: ["Audit trail", "Every tool call, accounted for.", "audit"],
  metrics: [
    "Observability",
    "Understand performance across your integrations.",
    "chart",
  ],
};
const date = (v) =>
  v
    ? new Date(v).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
function Badge({ value }) {
  const s = String(value || "Unknown");
  return (
    <span
      className={
        "badge " +
        (/connected|active|success|completed|ready/i.test(s)
          ? "good"
          : /error|reject|unreachable|failed/i.test(s)
            ? "bad"
            : "neutral")
      }
    >
      <i />
      {s}
    </span>
  );
}
function Empty({
  title = "Nothing here yet",
  text = "Your workspace activity will appear here.",
}) {
  return (
    <div className="empty">
      <Icon name="grid" size={30} />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        u<span>↗</span>
      </span>
      <strong>
        urumi<span>workspace</span>
      </strong>
    </div>
  );
}
function Copy({ value, label = "Copy" }) {
  const [c, S] = useState(false);
  return (
    <button
      type="button"
      className="btn secondary small"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          S(true);
          setTimeout(() => S(false), 2000);
        } catch {
          S(false);
        }
      }}
    >
      <Icon name={c ? "check" : "copy"} size={15} />
      {c ? "Copied" : label}
    </button>
  );
}
function App() {
  const [user, U] = useState(null),
    [csrf, C] = useState(""),
    [ready, Q] = useState(false),
    [tab, T] = useState("overview"),
    [data, D] = useState({}),
    [error, E] = useState(""),
    [notice, N] = useState(""),
    [busy, B] = useState(false),
    [search, F] = useState(""),
    [modal, M] = useState(null),
    [secret, S] = useState(null),
    [loading, L] = useState(false);
  const gen = useRef(0);
  async function api(path, method = "GET", body) {
    const r = await fetch("/api/" + path, {
      method,
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const d = r.status === 204 ? {} : await r.json();
    if (!r.ok) {
      const e = Error(d.error || "Request failed. Please try again.");
      e.data = d;
      throw e;
    }
    return d;
  }
  async function load() {
    if (!user) return;
    const n = ++gen.current;
    L(true);
    try {
      const resources =
        user.role === "admin"
          ? ["servers", "tools", "members", "keys", "audit", "metrics"]
          : ["tools", "keys"];
      const results = await Promise.all(
        resources.map(async (p) => [p, await api(p)]),
      );
      if (n === gen.current)
        D(
          Object.fromEntries(
            results.map(([p, d]) => [p, d[p] ?? d.events ?? []]),
          ),
        );
    } catch (e) {
      if (n === gen.current) E(e.message);
    } finally {
      if (n === gen.current) L(false);
    }
  }
  useEffect(() => {
    api("me")
      .then((d) => {
        U(d.user);
        C(d.csrf_token);
      })
      .catch(() => {})
      .finally(() => Q(true));
  }, []);
  useEffect(() => {
    if (user) {
      load();
      const id = setInterval(load, 15000);
      return () => clearInterval(id);
    }
  }, [user]);
  useEffect(() => {
    F("");
    E("");
  }, [tab]);
  async function action(fn, msg) {
    E("");
    B(true);
    try {
      await fn();
      if (msg) N(msg);
      await load();
      return true;
    } catch (e) {
      E(e.message);
      return false;
    } finally {
      B(false);
    }
  }
  async function login(e) {
    e.preventDefault();
    E("");
    B(true);
    try {
      const d = await api(
        "login",
        "POST",
        Object.fromEntries(new FormData(e.currentTarget)),
      );
      gen.current++;
      D({});
      U(d.user);
      C(d.csrf_token);
      T("overview");
    } catch (e) {
      E(e.message);
    } finally {
      B(false);
    }
  }
  const rows = data[tab] || [],
    servers = data.servers || [],
    tools = data.tools || [],
    members = data.members || [],
    metrics = data.metrics || [],
    audit = data.audit || [],
    connected = servers.filter((s) => s.status === "Connected").length,
    totalCalls = metrics.reduce((n, r) => n + Number(r.calls), 0),
    failures = metrics.reduce((n, r) => n + Number(r.failures), 0);
  const filtered = rows.filter((r) =>
    JSON.stringify(r).toLowerCase().includes(search.toLowerCase()),
  );
  const go = (t) => {
    T(t);
    S(null);
    M(null);
  };
  const stats = (
    <div className="stats">
      <Stat
        label="Connected integrations"
        value={`${connected} / ${servers.length}`}
        icon="server"
        detail="Live discovery status"
      />
      <Stat
        label="Available tools"
        value={tools.length}
        icon="tool"
        detail="Scoped to your permissions"
      />
      <Stat
        label="Tool calls"
        value={totalCalls}
        icon="bolt"
        detail="Retained audit history"
      />
      <Stat
        label="Successful calls"
        value={
          totalCalls
            ? `${Math.round(((totalCalls - failures - metrics.reduce((n, r) => n + Number(r.in_progress), 0)) / totalCalls) * 100)}%`
            : "—"
        }
        icon="chart"
        detail="Across registered servers"
      />
    </div>
  );
  if (!ready)
    return (
      <div className="loading-screen">
        <Brand />
        <p>Opening your workspace…</p>
      </div>
    );
  if (!user)
    return (
      <div className="auth-layout">
        <div className="auth-story">
          <Brand />
          <span className="eyebrow">YOUR TEAM. ONE CONNECTION.</span>
          <h1>
            Good tools.
            <br />
            Working <em>together.</em>
          </h1>
          <p>
            Bring your integrations, people, and AI into one thoughtfully
            connected workspace.
          </p>
          <div className="connection-art">
            <span>
              <Icon name="shop" />
              Commerce
            </span>
            <i />
            <b>
              <Icon name="bolt" size={28} />
            </b>
            <i />
            <span>
              <Icon name="chat" />
              Your team
            </span>
          </div>
          <div className="auth-foot">
            <Icon name="lock" size={16} /> Private credentials. Shared
            possibilities.
          </div>
        </div>
        <div className="auth-form">
          <div className="auth-card">
            <span className="eyebrow">URUMI WORKSPACE</span>
            <h2>Welcome back.</h2>
            <p>Sign in to your connected workspace.</p>
            {error && (
              <div role="alert" className="alert">
                {error}
              </div>
            )}
            <form onSubmit={login}>
              <Field
                label="Email address"
                name="email"
                type="email"
                placeholder="you@company.com"
                autoComplete="username"
              />
              <Field
                label="Password"
                name="password"
                type="password"
                placeholder="Enter your password"
                autoComplete="current-password"
              />
              <button className="btn primary full" disabled={busy}>
                {busy ? "Signing in…" : "Sign in to workspace"}
                <Icon name="arrow" size={18} />
              </button>
            </form>
            {new URLSearchParams(location.search).get("token") && (
              <form
                className="invite-accept"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const password = new FormData(e.currentTarget).get(
                    "password",
                  );
                  if (
                    await action(
                      () =>
                        api("invitations/accept", "POST", {
                          token: new URLSearchParams(location.search).get(
                            "token",
                          ),
                          password,
                        }),
                      "Invitation accepted. You can now sign in.",
                    )
                  )
                    history.replaceState(null, "", "/");
                }}
              >
                <h3>You’re invited</h3>
                <Field
                  label="Choose a password"
                  name="password"
                  type="password"
                  minLength={12}
                />
                <button className="btn secondary">Accept invitation</button>
              </form>
            )}
            {notice && <p role="status">{notice}</p>}
            <p className="auth-caption">
              <Icon name="lock" size={14} /> Secure access for your team and
              tools
            </p>
          </div>
        </div>
      </div>
    );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <div className="workspace-switch">
          <span className="workspace-avatar">U</span>
          <div>
            Urumi team<small>Team workspace</small>
          </div>
          <span className="workspace-dot" />
        </div>
        <span className="nav-label">WORKSPACE</span>
        <nav aria-label="Main navigation">
          {Object.entries(pages)
            .filter(
              ([k]) =>
                user.role === "admin" ||
                ["overview", "stores", "chat", "tools", "keys"].includes(k),
            )
            .map(([k, [name, , icon]]) => (
              <button
                key={k}
                className={tab === k ? "selected" : ""}
                aria-current={tab === k ? "page" : undefined}
                onClick={() => go(k)}
              >
                <Icon name={icon} />
                {name}
                {k === "servers" && (
                  <span className="nav-count">{servers.length}</span>
                )}
                {k === "chat" && <span className="ai-label">AI</span>}
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <a
            className="store-link"
            href={location.origin.replace("//gateway.", "//store.") + "/shop/"}
            target="_blank"
            rel="noreferrer"
          >
            <Icon name="shop" />
            Open storefront
            <Icon name="external" size={15} />
          </a>
          <div className="sidebar-note">
            <Icon name="lock" size={17} />
            <p>
              Access stays personal.
              <br />
              <span>Credentials stay private.</span>
            </p>
          </div>
          <div className="profile">
            <span className="avatar">
              {user.email.slice(0, 1).toUpperCase()}
            </span>
            <div>
              <strong>{user.email.split("@")[0]}</strong>
              <small>
                {user.role === "admin" ? "Administrator" : "Member"}
              </small>
            </div>
            <button
              title="Sign out"
              aria-label="Sign out"
              onClick={() =>
                action(async () => {
                  await api("logout", "POST", {});
                  gen.current++;
                  U(null);
                  C("");
                  D({});
                  S(null);
                  M(null);
                  N("");
                })
              }
            >
              <Icon name="logout" size={18} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span>
            Workspace <span className="slash">/</span>{" "}
            <strong>{pages[tab][0]}</strong>
          </span>
          <div>
            <span className="secure-label">
              <Icon name="lock" size={14} /> Secure workspace
            </span>
            <span className="avatar small-avatar">
              {user.email[0].toUpperCase()}
            </span>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <span className="eyebrow">TEAM MCP GATEWAY</span>
              <h1>
                {pages[tab][0]}
                <span className="heading-dot">.</span>
              </h1>
              <p>{pages[tab][1]}</p>
            </div>
            <div className="heading-actions">
              {!["chat", "stores"].includes(tab) && (
                <button
                  className="btn secondary"
                  onClick={load}
                  disabled={loading}
                >
                  <Icon
                    name="refresh"
                    size={16}
                    className={loading ? "spin" : ""}
                  />
                  Refresh
                </button>
              )}
              {["servers", "members", "keys"].includes(tab) && (
                <button
                  className="btn primary"
                  onClick={() => M({ type: tab })}
                >
                  <Icon name="plus" size={17} />
                  {tab === "servers"
                    ? "Add integration"
                    : tab === "members"
                      ? "Invite member"
                      : "Create API key"}
                </button>
              )}
            </div>
          </div>
          {error && (
            <div role="alert" className="alert">
              {error}
              <button aria-label="Dismiss error" onClick={() => E("")}>
                <Icon name="close" size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div role="status" className="notice">
              <Icon name="check" size={17} />
              {notice}
              <button aria-label="Dismiss notification" onClick={() => N("")}>
                <Icon name="close" size={16} />
              </button>
            </div>
          )}
          {secret && (
            <div className="secret-panel">
              <Icon name="key" />
              <div>
                <h3>{secret.title}</h3>
                <p>Copy this now. It will not be shown again.</p>
                <code>{secret.value}</code>
              </div>
              <Copy value={secret.value} />
              <button className="btn ghost small" onClick={() => S(null)}>
                Dismiss
              </button>
            </div>
          )}
          {tab === "overview" && (
            <>
              {user.role === "admin" ? (
                stats
              ) : (
                <div className="stats member-stats">
                  <Stat
                    label="Available tools"
                    value={tools.length}
                    icon="tool"
                    detail="Your permitted capabilities"
                  />
                  <Stat
                    label="Active API keys"
                    value={
                      (data.keys || []).filter((k) => !k.revoked_at).length
                    }
                    icon="key"
                    detail="Personal gateway access"
                  />
                </div>
              )}
              <div className="overview-grid">
                <div className="feature-card">
                  <span className="feature-kicker">
                    <Icon name="bolt" size={16} /> YOUR CONNECTED COPILOT
                  </span>
                  <h2>
                    Less switching.
                    <br />
                    More doing.
                  </h2>
                  <p>
                    Ask a question. Find an order. Put your connected tools to
                    work in one conversation.
                  </p>
                  <button className="btn light" onClick={() => go("chat")}>
                    Open AI workspace
                    <Icon name="arrow" size={17} />
                  </button>
                  <div className="feature-orbit" aria-hidden="true">
                    <Icon name="bolt" size={60} />
                  </div>
                </div>
                <div className="panel endpoint-panel">
                  <span className="icon-tile">
                    <Icon name="code" />
                  </span>
                  <h3>One endpoint. Every tool.</h3>
                  <p>
                    Connect your MCP client with your personal API key. Your
                    team’s integrations come with you.
                  </p>
                  <div className="endpoint">
                    <code>{location.origin}/mcp</code>
                    <Copy value={location.origin + "/mcp"} label="Copy URL" />
                  </div>
                  <button className="text-link" onClick={() => go("keys")}>
                    Manage your API keys <Icon name="arrow" size={16} />
                  </button>
                </div>
              </div>
              {user.role === "admin" && (
                <>
                  <div className="section-heading">
                    <h2>
                      Your integrations <span>{servers.length}</span>
                    </h2>
                    <button className="text-link" onClick={() => go("servers")}>
                      Manage integrations
                      <Icon name="arrow" size={16} />
                    </button>
                  </div>
                  <div className="server-grid">
                    {servers.map((s) => (
                      <ServerCard
                        key={s.id}
                        server={s}
                        compact
                        onEdit={() => {
                          go("servers");
                          M({ type: "servers", server: s });
                        }}
                      />
                    ))}
                  </div>
                  <div className="section-heading">
                    <h2>Recent activity</h2>
                    <button className="text-link" onClick={() => go("audit")}>
                      View audit trail
                      <Icon name="arrow" size={16} />
                    </button>
                  </div>
                  <AuditTable rows={audit.slice(0, 5)} />
                </>
              )}
            </>
          )}
          {tab === "stores" && <Stores api={api} user={user} onSync={load} />}
          {tab === "chat" && (
            <Chat api={api} user={user} toolCount={tools.length} />
          )}
          {tab === "servers" && (
            <>
              <div className="integration-summary">
                <span>
                  <i className="live-dot" />
                  {connected} connected
                </span>
                <span>
                  {servers.filter((s) => s.status === "Unreachable").length}{" "}
                  unreachable
                </span>
                <span>{servers.filter((s) => !s.enabled).length} disabled</span>
                <span className="muted">Discovery refreshes automatically</span>
              </div>
              <div className="server-grid">
                {servers.map((s) => (
                  <ServerCard
                    key={s.id}
                    server={s}
                    onEdit={() => M({ type: "servers", server: s })}
                    onToggle={() =>
                      action(
                        () =>
                          api("servers/" + s.id, "PATCH", {
                            enabled: !s.enabled,
                          }),
                        s.enabled
                          ? "Integration disabled."
                          : "Integration enabled.",
                      )
                    }
                    busy={busy}
                  />
                ))}
              </div>
              {!servers.length && (
                <Empty
                  title="Connect your first integration"
                  text="Add a Streamable HTTP MCP server to bring its tools into your workspace."
                />
              )}
              <div className="info-strip">
                <Icon name="lock" />
                <p>
                  <strong>Connected once. Accessed securely.</strong> Upstream
                  credentials stay on the server. Each user gets only the tools
                  their role permits.
                </p>
              </div>
            </>
          )}
          {["tools", "keys", "members", "audit"].includes(tab) && (
            <>
              <div className="list-toolbar">
                <div className="search">
                  <Icon name="search" size={17} />
                  <input
                    aria-label={`Search ${pages[tab][0]}`}
                    value={search}
                    onChange={(e) => F(e.target.value)}
                    placeholder={`Search ${pages[tab][0].toLowerCase()}…`}
                  />
                </div>
                <span className="muted">
                  {filtered.length} {tab === "audit" ? "events" : tab}
                </span>
              </div>
              {tab === "tools" && (
                <div className="tool-grid">
                  {filtered.map((t, i) => (
                    <article className="panel tool-card" key={t.name || i}>
                      <div className="tool-card-top">
                        <span className="icon-tile">
                          <Icon name="tool" />
                        </span>
                        <span className="mini-label">
                          {t.name.split("__")[0]}
                        </span>
                      </div>
                      <h3>
                        {t.name
                          .split("__")
                          .slice(1)
                          .join("__")
                          .replaceAll("_", " ") || t.name}
                      </h3>
                      <code>{t.name}</code>
                      <p>{t.description}</p>
                      <details>
                        <summary>
                          View input schema
                          <Icon name="code" size={15} />
                        </summary>
                        <pre>{JSON.stringify(t.inputSchema, null, 2)}</pre>
                      </details>
                    </article>
                  ))}
                </div>
              )}
              {tab === "audit" && <AuditTable rows={filtered} />}
              {tab === "keys" && (
                <>
                  <div className="endpoint endpoint-wide">
                    <Icon name="code" />
                    <div>
                      <span>YOUR GATEWAY ENDPOINT</span>
                      <code>{location.origin}/mcp</code>
                    </div>
                    <Copy value={location.origin + "/mcp"} label="Copy URL" />
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Key name</th>
                          <th>Owner</th>
                          <th>Status</th>
                          <th>Created</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((k) => (
                          <tr key={k.id}>
                            <td>
                              <strong>{k.name}</strong>
                              <code>{k.prefix}••••••</code>
                            </td>
                            <td>
                              {members.find((m) => m.id === k.user_id)?.email ||
                                user.email}
                            </td>
                            <td>
                              <Badge
                                value={k.revoked_at ? "Revoked" : "Active"}
                              />
                            </td>
                            <td>{date(k.created_at)}</td>
                            <td>
                              {!k.revoked_at && (
                                <button
                                  className="btn danger small"
                                  disabled={busy}
                                  onClick={() => {
                                    if (
                                      confirm(
                                        "Revoke this key? Its next request will be rejected.",
                                      )
                                    )
                                      action(
                                        () => api("keys/" + k.id, "DELETE"),
                                        "API key revoked.",
                                      );
                                  }}
                                >
                                  Revoke key
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
              {tab === "members" && (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Team member</th>
                        <th>Role</th>
                        <th>Status</th>
                        <th>Joined</th>
                        <th>Access</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((m) => (
                        <tr key={m.id}>
                          <td>
                            <div className="person">
                              <span className="avatar">
                                {m.email[0].toUpperCase()}
                              </span>
                              <div>
                                <strong>{m.email}</strong>
                                <small>
                                  {m.id === user.id ? "You" : "Team member"}
                                </small>
                              </div>
                            </div>
                          </td>
                          <td>
                            <select
                              aria-label={`Role for ${m.email}`}
                              value={m.role}
                              disabled={busy}
                              onChange={(e) =>
                                action(
                                  () =>
                                    api("members/" + m.id, "PATCH", {
                                      role: e.target.value,
                                    }),
                                  "Member role updated.",
                                )
                              }
                            >
                              <option value="admin">Admin</option>
                              <option value="member">Member</option>
                            </select>
                          </td>
                          <td>
                            <Badge value={m.active ? "Active" : "Disabled"} />
                          </td>
                          <td>{date(m.created_at)}</td>
                          <td>
                            <button
                              className="btn secondary small"
                              disabled={busy}
                              onClick={() =>
                                action(
                                  () =>
                                    api("members/" + m.id, "PATCH", {
                                      active: !m.active,
                                    }),
                                  "Member access updated.",
                                )
                              }
                            >
                              {m.active ? "Disable access" : "Enable access"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {!filtered.length && (
                <Empty
                  title={search ? "No matching results" : "Nothing here yet"}
                  text={
                    search
                      ? "Try a different search."
                      : "Create an item or use a tool to get started."
                  }
                />
              )}
            </>
          )}
          {tab === "metrics" && (
            <>
              {stats}
              <div className="section-heading">
                <h2>Integration performance</h2>
                <span className="muted">Based on retained audit events</span>
              </div>
              <div className="server-grid">
                {metrics.map((m) => (
                  <article className="panel metric-card" key={m.id}>
                    <div className="card-heading">
                      <h3>{m.name}</h3>
                      <Badge value={m.enabled ? m.status : "Disabled"} />
                    </div>
                    <div className="metric-number">
                      {m.calls}
                      <span>tool calls</span>
                    </div>
                    <div className="metric-bar">
                      <span
                        style={{
                          width:
                            (m.calls
                              ? ((m.calls - m.failures - m.in_progress) /
                                  m.calls) *
                                100
                              : 0) + "%",
                        }}
                      />
                    </div>
                    <div className="metric-pair">
                      <span>
                        Failures<strong>{m.failures}</strong>
                      </span>
                      <span>
                        In progress<strong>{m.in_progress}</strong>
                      </span>
                    </div>
                    <div className="metric-pair">
                      <span>
                        Mean latency<strong>{Math.round(m.mean_ms)} ms</strong>
                      </span>
                      <span>
                        P95 latency<strong>{Math.round(m.p95_ms)} ms</strong>
                      </span>
                    </div>
                    <small className="muted">
                      Checked {date(m.checked_at)}
                    </small>
                    {m.last_error && (
                      <p className="error-text">{m.last_error}</p>
                    )}
                  </article>
                ))}
              </div>
              <div className="info-strip">
                <Icon name="chart" />
                <p>
                  Latency includes gateway checks. Metrics refresh every 15
                  seconds and contain no raw customer payloads or credentials.
                </p>
              </div>
            </>
          )}
          <footer className="main-footer">
            <span>Urumi workspace</span>
            <span>One gateway. A connected team.</span>
          </footer>
        </main>
      </div>
      {modal && (
        <Modal
          title={
            modal.type === "servers"
              ? modal.server
                ? "Configure integration"
                : "Connect an integration"
              : modal.type === "members"
                ? "Invite a teammate"
                : "Create an API key"
          }
          onClose={() => {
            M(null);
            E("");
          }}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = Object.fromEntries(new FormData(e.currentTarget));
              const type = modal.type;
              const s = modal.server;
              const body =
                type === "servers"
                  ? {
                      name: f.name,
                      url: f.url,
                      ...(!s ? { slug: f.slug } : {}),
                      read_tools: (f.read_tools || "")
                        .split(",")
                        .map((v) => v.trim())
                        .filter(Boolean),
                      ...(f.credential
                        ? {
                            credential: {
                              header: f.header || "Authorization",
                              value: f.header
                                ? f.credential
                                : "Bearer " + f.credential,
                            },
                          }
                        : f.clear_credential
                          ? { credential: null }
                          : {}),
                    }
                  : f;
              await action(
                async () => {
                  const d = await api(
                    type === "members"
                      ? "invitations"
                      : type + (s ? "/" + s.id : ""),
                    s ? "PATCH" : "POST",
                    body,
                  );
                  if (d.key)
                    S({ title: "Your new API key", value: d.key.token });
                  if (d.invitation)
                    S({
                      title: "Your invitation link",
                      value: d.invitation.accept_url,
                    });
                  M(null);
                },
                type === "servers"
                  ? "Integration saved."
                  : type === "members"
                    ? "Invitation link created. Share it privately."
                    : "API key created. Copy it before leaving this page.",
              );
            }}
          >
            {modal.type === "servers" ? (
              <>
                <p className="muted">
                  Connect a Streamable HTTP MCP server. Credentials are
                  encrypted and never sent to clients.
                </p>
                {!modal.server && (
                  <Field
                    label="Server ID"
                    name="slug"
                    placeholder="e.g. analytics"
                    pattern="[a-z0-9-]+"
                  />
                )}
                <Field
                  label="Display name"
                  name="name"
                  defaultValue={modal.server?.name}
                  placeholder="e.g. Analytics"
                />
                <Field
                  label="MCP endpoint URL"
                  name="url"
                  type="url"
                  defaultValue={modal.server?.url}
                  placeholder="https://your-server.com/mcp"
                />
                <Field
                  label="Member tools"
                  name="read_tools"
                  required={false}
                  defaultValue={modal.server?.read_tools?.join(", ")}
                  placeholder="list_products, list_orders"
                />
                <p className="field-help">
                  Comma-separated original tool names. Only these tools are
                  available to members.
                </p>
                <div className="field-row">
                  <Field
                    label="Credential header"
                    name="header"
                    required={false}
                    placeholder="Authorization"
                  />
                  <Field
                    label={modal.server ? "Replace credential" : "Credential"}
                    name="credential"
                    type="password"
                    required={false}
                    autoComplete="new-password"
                    placeholder="Leave empty to keep current"
                  />
                </div>
                {modal.server?.credential_configured && (
                  <label className="check">
                    <input type="checkbox" name="clear_credential" />
                    Remove stored credential
                  </label>
                )}
              </>
            ) : modal.type === "members" ? (
              <>
                <p className="muted">
                  Create a private invitation link, valid for 48 hours.
                </p>
                <Field
                  name="email"
                  label="Email address"
                  type="email"
                  placeholder="teammate@company.com"
                />
                <label>
                  Role
                  <select name="role">
                    <option value="member">Member — use permitted tools</option>
                    <option value="admin">
                      Admin — manage team and integrations
                    </option>
                  </select>
                </label>
              </>
            ) : (
              <>
                <p className="muted">
                  Your key connects external clients to the gateway. The full
                  key is shown only once.
                </p>
                <Field
                  label="Key name"
                  name="name"
                  placeholder="e.g. Cursor on my laptop"
                />
                {user.role === "admin" && (
                  <label>
                    Key owner
                    <select name="user_id" defaultValue={user.id}>
                      {members
                        .filter((m) => m.active)
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.email}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
              </>
            )}
            {error && (
              <p role="alert" className="alert">
                {error}
              </p>
            )}
            <div className="modal-actions">
              {modal.server && (
                <button
                  type="button"
                  className="btn danger"
                  disabled={busy}
                  onClick={() => {
                    if (
                      confirm(
                        "Remove this integration? Its tools will no longer be available.",
                      )
                    )
                      action(async () => {
                        await api("servers/" + modal.server.id, "DELETE");
                        M(null);
                      }, "Integration removed.");
                  }}
                >
                  Remove
                </button>
              )}
              <button
                type="button"
                className="btn secondary"
                onClick={() => M(null)}
              >
                Cancel
              </button>
              <button className="btn primary" disabled={busy}>
                {busy
                  ? "Saving…"
                  : modal.server
                    ? "Save changes"
                    : modal.type === "servers"
                      ? "Connect integration"
                      : modal.type === "members"
                        ? "Create invitation"
                        : "Create key"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
// Render the assistant's common Markdown as React text nodes, never HTML.
function AssistantText({ text }) {
  const inline = (value) => value.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> :
    part.startsWith("`") && part.endsWith("`") ? <code key={i}>{part.slice(1, -1)}</code> : part);
  const lines = text.split("\n"), blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line.startsWith("|") && i + 1 < lines.length && /^\s*\|?\s*:?-{3}/.test(lines[i + 1])) {
      const cells = (row) => row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim());
      const head = cells(line), rows = []; i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(cells(lines[i++]));
      i--;
      blocks.push(<div className="answer-table" key={i}><table><thead><tr>{head.map((c, j) => <th key={j}>{inline(c)}</th>)}</tr></thead><tbody>{rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}>{inline(c)}</td>)}</tr>)}</tbody></table></div>);
    } else if (/^#{1,6} /.test(line)) blocks.push(<h4 key={i}>{inline(line.replace(/^#{1,6} /, ""))}</h4>);
    else if (/^[-*] /.test(line)) blocks.push(<p className="answer-list-item" key={i}>• {inline(line.slice(2))}</p>);
    else blocks.push(<p key={i}>{inline(line)}</p>);
  }
  return <div className="assistant-answer">{blocks}</div>;
}

function Stores({ api, user, onSync }) {
  const [rows, R] = useState([]),
    [settings, S] = useState(null),
    [error, E] = useState(""),
    [dialog, M] = useState(null),
    [busy, B] = useState(false),
    [confirmation, C] = useState(""),
    [notice, N] = useState(""),
    [loaded, L] = useState(false);
  async function load() {
    try {
      const d = await api("stores");
      R(d.stores);
      S(d.config);
      E("");
    } catch (e) {
      E(e.message);
    } finally {
      L(true);
    }
  }
  useEffect(() => {
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, []);
  async function submit(e) {
    e.preventDefault();
    B(true);
    E("");
    try {
      if (dialog.type === "delete") {
        if (confirmation !== dialog.store.name) return;
        await api("stores/" + dialog.store.id, "DELETE");
        N(
          "Gateway tools removed. Namespace and storage cleanup is in progress.",
        );
      } else {
        const name = new FormData(e.currentTarget).get("name");
        await api("stores", "POST", { id: dialog.id, name });
        N(
          "Store queued. You can leave this page while provisioning continues.",
        );
      }
      M(null);
      await load();
      onSync();
    } catch (e) {
      E(e.message);
    } finally {
      B(false);
    }
  }
  const active = rows.filter((r) => r.status === "Ready").length,
    progressing = rows.filter((r) => r.status === "Provisioning").length;
  return (
    <div className="stores-view">
      <div className="stores-intro">
        <div>
          <span className="feature-kicker">
            <Icon name="shop" size={16} /> YOUR STOREFRONT COLLECTION
          </span>
          <h2>
            Start something
            <br />
            <em>of your own.</em>
          </h2>
          <p>
            Create an isolated WooCommerce store. Its tools join your gateway
            automatically, with the same team permissions.
          </p>
          <div className="store-guardrails">
            <span>
              <Icon name="lock" size={13} /> Separate credentials
            </span>
            <span>
              <Icon name="grid" size={13} /> Isolated namespaces
            </span>
            <span>
              <Icon name="tool" size={13} /> Connected tools
            </span>
          </div>
        </div>
        <div className="store-intro-action">
          <div>
            <strong>{active}</strong>
            <span>ready to explore</span>
          </div>
          <button
            className="btn light"
            disabled={!settings?.enabled || busy}
            onClick={() => {
              M({ type: "create", id: crypto.randomUUID() });
              E("");
            }}
          >
            <Icon name="plus" size={16} />
            Create store
          </button>
        </div>
      </div>
      <div className="stores-toolbar">
        <div>
          <span className="live-dot" />
          {rows.length} stores <span className="slash">/</span> {progressing}{" "}
          provisioning
        </div>
        <div>
          <span className="muted">
            Up to {settings?.max_per_user ?? "—"} stores per person
          </span>
          <button className="btn secondary small" onClick={load}>
            <Icon name="refresh" size={14} />
            Refresh
          </button>
        </div>
      </div>
      {error && (
        <div role="alert" className="alert">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="notice">
          {notice}
          <button onClick={() => N("")} aria-label="Dismiss store notification">
            <Icon name="close" size={15} />
          </button>
        </div>
      )}
      {settings && !settings.enabled && (
        <div className="info-strip">
          <Icon name="lock" />
          <p>
            Store provisioning is disabled on this installation. An operator can
            enable it through Helm values.
          </p>
        </div>
      )}
      {!loaded ? (
        <Empty title="Opening your collection" text="Loading store status…" />
      ) : rows.length ? (
        <div className="managed-store-grid">
          {rows.map((r, i) => (
            <article className="panel managed-store" key={r.id}>
              <div className={"store-preview tone-" + (i % 3)}>
                <div className="preview-browser">
                  <i />
                  <i />
                  <i />
                  <span>URUMI STUDIO</span>
                </div>
                <div className="preview-content">
                  <span>SPACE FOR YOUR NEXT IDEA</span>
                  <h3>{r.name}</h3>
                  <div className="preview-books">
                    <i />
                    <i />
                    <i />
                  </div>
                </div>
                <span className="preview-status">
                  <Badge value={r.status} />
                </span>
              </div>
              <div className="managed-store-body">
                <div className="card-heading">
                  <h3>{r.name}</h3>
                  <span className="mini-label">WOOCOMMERCE</span>
                </div>
                <span className="store-owner">
                  {r.owner_id === user.id ? "Your store" : r.owner_email} ·
                  Created {date(r.created_at)}
                </span>
                <p className="store-url">{r.url.replace(/^https?:\/\//, "")}</p>
                {r.status === "Provisioning" && (
                  <div className="provision-progress">
                    <div>
                      <span />
                      <span />
                      <span />
                    </div>
                    <p>
                      <i className="live-dot" />
                      {r.stage}
                    </p>
                  </div>
                )}
                {r.status === "Deleting" && (
                  <p className="cleanup-status">
                    <Icon name="refresh" size={13} className="spin" />
                    {r.stage}
                  </p>
                )}
                {r.error && <p className="store-error">{r.error}</p>}
                {r.status === "Ready" && (
                  <div className="store-connected">
                    <Icon name="check" size={14} />
                    {r.tools?.length || 0} tools connected to your gateway
                  </div>
                )}
                <details className="store-resource-details">
                  <summary>
                    Resources and tool names
                    <Icon name="code" size={14} />
                  </summary>
                  <p>
                    Namespace <code>{r.namespace}</code>
                  </p>
                  <p>
                    Dedicated database, content volume, credentials and network
                    policies.
                  </p>
                  {r.status === "Ready" &&
                    r.tools?.map((t) => (
                      <code key={t.public_name}>{t.public_name}</code>
                    ))}
                </details>
                <div className="managed-store-actions">
                  {r.status === "Ready" ? (
                    <a
                      className="btn primary small"
                      href={r.url + "/shop/"}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open store
                      <Icon name="external" size={13} />
                    </a>
                  ) : r.status === "Failed" ? (
                    <button
                      className="btn secondary small"
                      disabled={busy}
                      onClick={async () => {
                        B(true);
                        try {
                          await api("stores/" + r.id + "/retry", "POST", {});
                          await load();
                          N(
                            "Retry queued. Existing resources and credentials will be reused.",
                          );
                        } catch (e) {
                          E(e.message);
                        } finally {
                          B(false);
                        }
                      }}
                    >
                      <Icon name="refresh" size={13} />
                      Retry setup
                    </button>
                  ) : (
                    <span className="muted">
                      {r.status === "Deleting"
                        ? "Cleaning up safely…"
                        : "Setting things up…"}
                    </span>
                  )}
                  {r.status !== "Deleting" && (
                    <button
                      className="btn ghost small store-delete"
                      onClick={() => {
                        M({ type: "delete", store: r });
                        C("");
                        E("");
                      }}
                    >
                      Delete store
                    </button>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty
          title="Your next store starts here"
          text="Create a store and we’ll connect its products and orders to your gateway."
        />
      )}
      <div className="info-strip">
        <Icon name="lock" />
        <p>
          <strong>Independence by design.</strong> Each store has its own
          database, credentials, volumes, quotas, and network boundary. Deleting
          it removes its gateway tools and Kubernetes resources.
        </p>
      </div>
      {dialog && (
        <Modal
          title={
            dialog.type === "create"
              ? "Create your next store"
              : "Delete " + dialog.store.name + "?"
          }
          onClose={() => {
            if (!busy) {
              M(null);
              E("");
            }
          }}
        >
          <form onSubmit={submit}>
            {dialog.type === "create" ? (
              <>
                <p className="muted">
                  We’ll prepare WooCommerce, the Urumi Studio theme, and a
                  private MCP server. Your team can use its tools once the store
                  is ready.
                </p>
                <Field
                  label="Store name"
                  name="name"
                  placeholder="e.g. Sunday Studio"
                  minLength={2}
                  maxLength={60}
                />
                <div className="store-create-facts">
                  <span>
                    <Icon name="check" size={14} />
                    Automatic gateway registration
                  </span>
                  <span>
                    <Icon name="check" size={14} />
                    Same storefront design and guest checkout
                  </span>
                  <span>
                    <Icon name="check" size={14} />
                    Resource quotas and a{" "}
                    {Math.round((settings?.timeout_seconds ?? 900) / 60)} minute
                    provisioning deadline
                  </span>
                </div>
              </>
            ) : (
              <>
                <p className="delete-warning">
                  This permanently removes this store’s products, orders,
                  database, credentials and volumes. Its tools disappear from
                  the gateway immediately. Other stores are unaffected.
                </p>
                <label>
                  Type <strong>{dialog.store.name}</strong> to confirm
                  <input
                    name="confirmation"
                    required
                    value={confirmation}
                    onChange={(e) => C(e.target.value)}
                    autoComplete="off"
                  />
                </label>
              </>
            )}
            {error && (
              <p role="alert" className="alert">
                {error}
              </p>
            )}
            <div className="modal-actions">
              <button
                className="btn secondary"
                type="button"
                onClick={() => M(null)}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                className={
                  "btn " + (dialog.type === "delete" ? "danger" : "primary")
                }
                disabled={
                  busy ||
                  (dialog.type === "delete" &&
                    confirmation !== dialog.store.name)
                }
              >
                {busy
                  ? "Working…"
                  : dialog.type === "delete"
                    ? "Delete store permanently"
                    : "Create store"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
function Field({ label, ...props }) {
  return (
    <label>
      {label}
      <input required {...props} />
    </label>
  );
}
function Stat({ label, value, icon, detail }) {
  return (
    <article className="stat">
      <div>
        <span>{label}</span>
        <Icon name={icon} size={18} />
      </div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}
function ServerCard({ server: s, compact, onEdit, onToggle, busy }) {
  return (
    <article className="panel server-card">
      <div className="card-heading">
        <span
          className={
            "integration-icon " +
            (s.slug === "store"
              ? "commerce"
              : s.slug === "inventory"
                ? "inventory"
                : "knowledge")
          }
        >
          <Icon
            name={
              s.slug === "store"
                ? "shop"
                : s.slug === "inventory"
                  ? "grid"
                  : "audit"
            }
            size={24}
          />
        </span>
        <Badge value={s.status} />
      </div>
      <h3>{s.name}</h3>
      <p className="server-description">
        {s.slug === "store"
          ? "Products, orders, and your storefront."
          : s.slug === "inventory"
            ? "Synthetic stock data for your demo."
            : s.slug === "knowledge"
              ? "Store policies and useful answers."
              : "Your connected MCP integration."}
      </p>
      <div className="server-tools">
        <Icon name="tool" size={14} />
        {s.tools?.length || 0} tools<span>Streamable HTTP</span>
      </div>
      {!compact && (
        <>
          <div className="server-meta">
            <span>Credential</span>
            <strong>
              {s.credential_configured ? "Configured" : "Not set"}
            </strong>
          </div>
          <details className="server-details">
            <summary>Endpoint and tools</summary>
            <code>{s.url}</code>
            {s.tools?.map((t) => (
              <span key={t.name}>{t.name}</span>
            ))}
          </details>
          {s.last_error && <p className="error-text">{s.last_error}</p>}
        </>
      )}
      <div className="card-actions">
        <button className="btn secondary small" onClick={onEdit}>
          {compact ? "View integration" : "Configure"}
          <Icon name="arrow" size={14} />
        </button>
        {!compact && (
          <button
            className="btn ghost small"
            onClick={onToggle}
            disabled={busy}
          >
            {s.enabled ? "Disable" : "Enable"}
          </button>
        )}
      </div>
    </article>
  );
}
function AuditTable({ rows }) {
  if (!rows.length)
    return (
      <Empty
        title="Your activity starts here"
        text="Tool calls will appear here with user attribution and outcomes."
      />
    );
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Tool call</th>
            <th>Caller</th>
            <th>Outcome</th>
            <th>Duration</th>
            <th>Time</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id || i}>
              <td>
                <strong className="mono">{r.tool}</strong>
                <small>{r.server_name || "Unknown server"}</small>
              </td>
              <td>{r.user_email || "Unknown caller"}</td>
              <td>
                <Badge value={r.outcome} />
                {r.error_code && <small>{r.error_code}</small>}
              </td>
              <td className="mono">{r.duration_ms ?? "—"} ms</td>
              <td>{date(r.timestamp)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function Modal({ title, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <button
          className="btn ghost small"
          type="button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function Chat({ api, user, toolCount }) {
  const [messages, S] = useState([]),
    [activity, A] = useState([]),
    [busy, B] = useState(false),
    [error, E] = useState(""),
    [config, C] = useState(null),
    [writes, W] = useState(false),
    [draft, D] = useState("");
  const end = useRef(null);
  useEffect(() => {
    api("chat")
      .then(C)
      .catch((e) => E(e.message));
  }, []);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, busy]);
  async function send(e) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    const next = [...messages, { role: "user", content: text }].slice(-11);
    S(next);
    A([]);
    E("");
    B(true);
    D("");
    try {
      const d = await api("chat", "POST", {
        messages: next.map((m) => ({
          ...m,
          content: m.content.slice(0, 4000),
        })),
        allow_writes: writes,
      });
      A(d.activity || []);
      S([...next, { role: "assistant", content: d.answer }]);
    } catch (e) {
      E(e.message);
      A(e.data?.activity || []);
    } finally {
      B(false);
      W(false);
    }
  }
  return (
    <div className="chat-layout">
      <section className="chat-panel">
        <div className="chat-top">
          <div>
            <span className="live-dot" />
            <strong>Workspace assistant</strong>
            <span className="mini-label">{toolCount} TOOLS AVAILABLE</span>
          </div>
          <button
            className="btn ghost small"
            disabled={busy}
            onClick={() => {
              S([]);
              A([]);
              E("");
              W(false);
            }}
          >
            New conversation
            <Icon name="plus" size={15} />
          </button>
        </div>
        <div className="conversation" aria-live="polite">
          {!messages.length ? (
            <div className="chat-welcome">
              <span className="assistant-mark">
                <Icon name="bolt" size={32} />
              </span>
              <span className="eyebrow">YOUR TOOLS, IN CONVERSATION</span>
              <h2>
                What can we
                <br />
                get done today?
              </h2>
              <p>
                Find answers and take action across your connected workspace.
              </p>
              <div className="suggestions">
                {[
                  ["shop", "What orders came in today?"],
                  ["grid", "Find notebook inventory and shipping guidance."],
                  ["tool", "List the products in my store."],
                ].map(([icon, text]) => (
                  <button key={text} onClick={() => D(text)}>
                    <Icon name={icon} />
                    <span>{text}</span>
                    <Icon name="arrow" size={16} />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) => (
              <article key={i} className={"message " + m.role}>
                <span className={"message-avatar " + m.role}>
                  {m.role === "user" ? (
                    user.email[0].toUpperCase()
                  ) : (
                    <Icon name="bolt" size={18} />
                  )}
                </span>
                <div>
                  <strong>
                    {m.role === "user" ? "You" : "Urumi assistant"}
                  </strong>
                  <div className="message-content">{m.role === "assistant" ? <AssistantText text={m.content} /> : m.content}</div>
                </div>
              </article>
            ))
          )}
          {busy && (
            <div className="thinking" role="status">
              <i />
              <i />
              <i />
              <span>Working through your tools…</span>
            </div>
          )}
          {error && (
            <div role="alert" className="alert">
              {error}
            </div>
          )}
          <div ref={end} />
        </div>
        <form className="composer" onSubmit={send}>
          <label className="sr-only" htmlFor="message">
            Message
          </label>
          <textarea
            id="message"
            name="message"
            value={draft}
            onChange={(e) => D(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form.requestSubmit();
              }
            }}
            maxLength={4000}
            required
            disabled={busy}
            placeholder="Ask your workspace anything…"
          />
          <div className="composer-actions">
            <label className="check">
              <input
                type="checkbox"
                checked={writes}
                onChange={(e) => W(e.target.checked)}
                disabled={busy}
              />
              Approve changes for this message
            </label>
            <button
              className="btn primary"
              disabled={busy || !config?.configured || !draft.trim()}
              aria-label="Send message"
            >
              <Icon name="arrow" size={20} />
            </button>
          </div>
        </form>
        <p className="chat-disclaimer">
          AI can make mistakes. Review tool results.{" "}
          {config?.configured
            ? "Messages and tool data go to your configured model provider."
            : "Model provider is not configured."}
        </p>
      </section>
      <aside className="activity-panel">
        <div className="section-heading">
          <h3>Tool activity</h3>
          <span className="mini-label">{activity.length} CALLS</span>
        </div>
        <p className="muted">
          A clear view of what the assistant does on your behalf.
        </p>
        {activity.length ? (
          activity.map((a, i) => (
            <article className="activity-item" key={i}>
              <div>
                <span className="icon-tile">
                  <Icon name="tool" size={17} />
                </span>
                <Badge value={a.outcome} />
              </div>
              <strong>{a.tool}</strong>
              <small>{a.duration_ms} ms</small>
              <details>
                <summary>Inputs and result</summary>
                <pre>
                  {JSON.stringify(
                    { arguments: a.arguments, result: a.result },
                    null,
                    2,
                  )}
                </pre>
              </details>
            </article>
          ))
        ) : (
          <div className="activity-empty">
            <Icon name="audit" size={30} />
            <p>No tools called yet.</p>
            <small>
              Calls and results will appear here after your message completes.
            </small>
          </div>
        )}
        <div className="chat-security">
          <Icon name="lock" size={18} />
          <div>
            <strong>Your identity. Your access.</strong>
            <p>
              Calls use your permissions and are recorded under your account.
            </p>
          </div>
        </div>
        <details className="chat-model">
          <summary>Session details</summary>
          <p>{config?.configured ? config.model : "No model configured"}</p>
          <p>
            Conversation is kept in this page’s memory. Tool audit records are
            retained. Write approval applies to one message and never overrides
            your role.
          </p>
        </details>
      </aside>
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
