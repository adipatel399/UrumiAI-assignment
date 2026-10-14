import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
function App() {
  const generation = useRef(0);
  const [user, U] = useState(null),
    [csrf, C] = useState(""),
    [tab, T] = useState("keys"),
    [rows, R] = useState([]),
    [error, E] = useState(""),
    [secret, S] = useState(""),
    [members, M] = useState([]),
    [notice, N] = useState("");
  async function api(path, method = "GET", body) {
    const r = await fetch("/api/" + path, {
      method,
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = r.status === 204 ? {} : await r.json();
    if (!r.ok) {
      E(data.error);
      throw Error(data.error);
    }
    return data;
  }
  async function load() {
    const current = ++generation.current;
    try {
      const d = await api(tab);
      if (current === generation.current) R(d[tab] ?? d.events ?? []);
    } catch (e) {
      E(e.message);
    }
  }
  useEffect(() => {
    api("me")
      .then((d) => {
        U(d.user);
        C(d.csrf_token);
      })
      .catch(() => E(""));
  }, []);
  useEffect(() => {
    if (user) {
      load();
      if (user.role === "admin")
        api("members")
          .then((d) => M(d.members))
          .catch((e) => E(e.message));
    }
  }, [user, tab]);
  async function submit(e, path, body) {
    e.preventDefault();
    E("");
    try {
      const d = await api(path, "POST", body);
      if (path === "login") {
        generation.current++;
        R([]);
        M([]);
        S("");
        T("keys");
        U(d.user);
        C(d.csrf_token);
        N("");
        return;
      }
      if (path === "invitations/accept") {
        N("Invitation accepted. Sign in with your email and new password.");
        history.replaceState(null, "", "/");
        return;
      }
      if (d.key) S(d.key.token);
      if (d.invitation) S(d.invitation.accept_url);
      await load();
    } catch (x) {
      E(x.message);
    }
  }
  const form = (path, fields, build) => (
    <form
      onSubmit={(e) => {
        const f = Object.fromEntries(new FormData(e.currentTarget));
        submit(e, path, build ? build(f) : f);
      }}
    >
      {fields.map(([name, label, type = "text"]) => (
        <label key={name}>
          {label}
          <input
            name={name}
            type={type}
            required={!["credential", "header"].includes(name)}
          />
        </label>
      ))}
      <button>Create</button>
    </form>
  );
  return (
    <>
      <header>
        <strong>URUMI</strong>
        <span>Team MCP workspace</span>
        {user && (
          <button
            onClick={async () => {
              await api("logout", "POST", {});
              generation.current++;
              R([]);
              M([]);
              S("");
              C("");
              T("keys");
              U(null);
            }}
          >
            Sign out
          </button>
        )}
      </header>
      <main>
        {notice && <p role="status">{notice}</p>}
        {error && <p role="alert">{error}</p>}
        {!user ? (
          <section>
            <h1>Welcome to your workspace</h1>
            <p>Sign in to manage your team’s integrations.</p>
            <form
              onSubmit={(e) =>
                submit(
                  e,
                  "login",
                  Object.fromEntries(new FormData(e.currentTarget)),
                )
              }
            >
              <label>
                Email
                <input name="email" type="email" required />
              </label>
              <label>
                Password
                <input name="password" type="password" required />
              </label>
              <button>Sign in</button>
            </form>
            {new URLSearchParams(location.search).get("token") && (
              <form
                onSubmit={(e) =>
                  submit(e, "invitations/accept", {
                    token: new URLSearchParams(location.search).get("token"),
                    password: new FormData(e.currentTarget).get("password"),
                  })
                }
              >
                <h2>Accept invitation</h2>
                <label>
                  New password
                  <input
                    name="password"
                    type="password"
                    minLength="12"
                    required
                  />
                </label>
                <button>Accept invitation</button>
              </form>
            )}
          </section>
        ) : (
          <>
            <h1>Your team workspace</h1>
            <p>
              {user.email} · {user.role}
            </p>
            <nav>
              {(user.role === "admin"
                ? ["servers", "members", "keys", "tools", "audit"]
                : ["keys", "tools"]
              ).map((x) => (
                <button
                  aria-pressed={tab === x}
                  onClick={() => {
                    T(x);
                    S("");
                    E("");
                  }}
                  key={x}
                >
                  {x}
                </button>
              ))}
            </nav>
            <section>
              <h2>{tab}</h2>
              <button onClick={load}>Refresh</button>
              {secret && (
                <aside>
                  <strong>Copy now — shown only here</strong>
                  <pre>{secret}</pre>
                  <button onClick={() => S("")}>Dismiss</button>
                </aside>
              )}
              {tab === "keys" && (
                <>
                  <form
                    onSubmit={(e) =>
                      submit(
                        e,
                        "keys",
                        Object.fromEntries(new FormData(e.currentTarget)),
                      )
                    }
                  >
                    <label>
                      Key name
                      <input name="name" required />
                    </label>
                    {user.role === "admin" && (
                      <label>
                        Key owner
                        <select name="user_id" defaultValue={user.id}>
                          {members.map((m) => (
                            <option value={m.id} key={m.id}>
                              {m.email}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <button>Create key</button>
                  </form>
                  <p>Gateway URL: {location.origin}/mcp</p>
                </>
              )}
              {tab === "members" &&
                form("invitations", [["email", "Invite email", "email"]])}
              {tab === "servers" &&
                form(
                  "servers",
                  [
                    ["slug", "Stable server ID"],
                    ["name", "Display name"],
                    ["url", "MCP URL", "url"],
                    ["header", "Credential header (optional)"],
                    ["credential", "Optional credential", "password"],
                  ],
                  (f) => ({
                    slug: f.slug,
                    name: f.name,
                    url: f.url,
                    ...(f.credential
                      ? {
                          credential: {
                            header: f.header || "Authorization",
                            value: f.header
                              ? f.credential
                              : "Bearer " + f.credential,
                          },
                        }
                      : {}),
                  }),
                )}
              {rows.map((r, i) => (
                <article key={r.id ?? r.name ?? i}>
                  <h3>{r.name ?? r.email ?? r.tool ?? r.id}</h3>
                  {tab === "keys" && (
                    <p>
                      {r.prefix}… · {r.revoked_at ? "Revoked" : "Active"} ·
                      Created {new Date(r.created_at).toLocaleString()}
                    </p>
                  )}
                  {tab === "servers" && (
                    <>
                      <p>
                        {r.status} · {r.url}
                      </p>
                      {r.last_error && <p role="alert">{r.last_error}</p>}
                      <p>
                        Credential:{" "}
                        {r.credential_configured ? "Configured" : "None"}
                      </p>
                      <p>
                        Tools:{" "}
                        {r.tools?.map((t) => t.name).join(", ") ||
                          "No tools discovered"}
                      </p>
                    </>
                  )}
                  {tab === "members" && (
                    <p>
                      {r.role} · {r.active ? "Active" : "Disabled"}
                    </p>
                  )}
                  {tab === "audit" && (
                    <>
                      <p>
                        {r.user_email || "Unknown caller"} ·{" "}
                        {r.server_name || "Unknown server"} · {r.outcome} ·{" "}
                        {r.duration_ms} ms
                      </p>
                      <p>
                        {new Date(r.timestamp).toLocaleString()}{" "}
                        {r.error_code || ""}
                      </p>
                    </>
                  )}
                  {tab === "tools" && (
                    <>
                      <p>{r.description}</p>
                      <details>
                        <summary>Tool inputs</summary>
                        <pre>{JSON.stringify(r.inputSchema, null, 2)}</pre>
                      </details>
                    </>
                  )}
                  {tab === "keys" && !r.revoked_at && (
                    <button
                      onClick={async () => {
                        try {
                          await api("keys/" + r.id, "DELETE");
                          load();
                        } catch (e) {
                          E(e.message);
                        }
                      }}
                    >
                      Revoke key
                    </button>
                  )}
                  {tab === "servers" && (
                    <>
                      <button
                        onClick={async () => {
                          await api("servers/" + r.id, "PATCH", {
                            enabled: !r.enabled,
                          });
                          load();
                        }}
                      >
                        {r.enabled ? "Disable" : "Enable"}
                      </button>
                      <button
                        onClick={async () => {
                          if (confirm("Remove this registration?")) {
                            await api("servers/" + r.id, "DELETE");
                            load();
                          }
                        }}
                      >
                        Remove
                      </button>
                      <form
                        onSubmit={async (e) => {
                          e.preventDefault();
                          try {
                            const f = Object.fromEntries(
                              new FormData(e.currentTarget),
                            );
                            await api("servers/" + r.id, "PATCH", {
                              name: f.name,
                              url: f.url,
                              read_tools: f.read_tools
                                .split(",")
                                .map((x) => x.trim())
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
                                : {}),
                            });
                            load();
                          } catch (x) {
                            E(x.message);
                          }
                        }}
                      >
                        <label>
                          Name
                          <input name="name" defaultValue={r.name} />
                        </label>
                        <label>
                          URL
                          <input name="url" defaultValue={r.url} />
                        </label>
                        <label>
                          Member tools, comma separated
                          <input
                            name="read_tools"
                            defaultValue={r.read_tools?.join(",")}
                          />
                        </label>
                        <label>
                          Credential header
                          <input name="header" placeholder="Authorization" />
                        </label>
                        <label>
                          Replace credential
                          <input name="credential" type="password" />
                        </label>
                        <button>Save changes</button>
                      </form>
                    </>
                  )}
                </article>
              ))}
            </section>
          </>
        )}
      </main>
    </>
  );
}
createRoot(document.getElementById("root")).render(<App />);
