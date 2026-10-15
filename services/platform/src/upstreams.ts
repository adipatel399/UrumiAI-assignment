import { Agent } from 'undici';
import { destinationAgent } from './network.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Database, type Upstream } from './database.js';
import { decrypt, digest, validateUpstream } from './security.js';
type Entry = {
  client?: Client;
  agent?: Agent;
  tools: Tool[];
  fingerprint: string;
  refresh?: Promise<void>;
};
export const exposedName = (slug: string, name: string) => {
  const full = slug + '__' + name;
  return full.length <= 64 && /^[a-zA-Z0-9_.-]+$/.test(full)
    ? full
    : slug + '__tool_' + digest(name).slice(0, 24);
};
export const failure = (code: string, message: string): CallToolResult => ({
  isError: true,
  content: [{ type: 'text', text: JSON.stringify({ error: { code, message } }) }],
  structuredContent: { error: { code, message } },
});
function diagnostic(error: unknown) {
  const e = error as {
    code?: unknown;
    name?: unknown;
    cause?: { code?: unknown };
  };
  if (e?.code === 401 || e?.code === 403)
    return 'Authentication rejected. Check the configured upstream credential.';
  if (
    e?.name === 'TimeoutError' ||
    e?.code === -32001 ||
    e?.cause?.code === 'UND_ERR_CONNECT_TIMEOUT'
  )
    return 'Connection or tool deadline exceeded. Check service health and latency.';
  if (e?.cause?.code === 'ECONNREFUSED' || e?.cause?.code === 'ENOTFOUND')
    return 'Service connection refused or DNS unavailable. Check its address and deployment.';
  if (typeof e?.code === 'number' && e.code >= 400 && e.code <= 599)
    return `Upstream returned HTTP ${e.code}. Check service health and credentials.`;
  return 'Connection, destination policy, or protocol check failed. Check the URL, deployment, and network policy.';
}
export class Upstreams {
  entries = new Map<string, Entry>();
  constructor(public db: Database) {}
  async rows() {
    return (await this.db.query<Upstream>('SELECT * FROM upstreams ORDER BY slug')).rows;
  }
  async refreshAll() {
    const rows = await this.rows();
    for (const id of this.entries.keys())
      if (!rows.some((r) => r.id === id && r.enabled)) await this.forget(id);
    await Promise.allSettled(rows.map((row) => this.refresh(row)));
  }
  async forget(id: string) {
    const entry = this.entries.get(id);
    this.entries.delete(id);
    await entry?.client?.close().catch(() => {});
    await entry?.agent?.destroy().catch(() => {});
  }
  async refresh(row: Upstream) {
    if (!row.enabled) {
      await this.forget(row.id);
      await this.db.query(
        "UPDATE upstreams SET status='Disabled',last_error=NULL WHERE id=$1",
        [row.id],
      );
      return;
    }
    const fingerprint = digest(row.url + (row.credential ?? ''));
    let entry = this.entries.get(row.id);
    if (entry && entry.fingerprint !== fingerprint) {
      await this.forget(row.id);
      entry = undefined;
    }
    if (!entry) {
      entry = { tools: [], fingerprint };
      this.entries.set(row.id, entry);
    }
    if (entry.refresh) return entry.refresh;
    const current = entry;
    current.refresh = (async () => {
      try {
        const deadline = AbortSignal.timeout(this.db.config.UPSTREAM_TIMEOUT_MS);
        const url = await validateUpstream(
          row.url,
          this.db.config.UPSTREAM_ALLOWED_HOSTS.split(','),
        );
        if (!current.client) {
          const credential = row.credential
            ? decrypt<{ header: string; value: string }>(
                row.credential,
                this.db.config.ENCRYPTION_KEY,
              )
            : undefined;
          const client = new Client({
            name: 'urumi-gateway',
            version: '0.1.0',
          });
          current.client = client;
          await current.agent?.destroy();
          current.agent = destinationAgent(
            url,
            this.db.config.UPSTREAM_ALLOWED_HOSTS.split(','),
          );
          const transport = new StreamableHTTPClientTransport(url, {
            requestInit: {
              headers: credential ? { [credential.header]: credential.value } : {},
            },
            fetch: (input, init) =>
              fetch(input, {
                ...init,
                dispatcher: current.agent,
                redirect: 'error',
                signal: AbortSignal.any([
                  ...(init?.signal ? [init.signal] : []),
                  AbortSignal.timeout(this.db.config.UPSTREAM_TIMEOUT_MS),
                ]),
              } as RequestInit & { dispatcher: Agent }),
          });
          await client.connect(transport, {
            timeout: this.db.config.UPSTREAM_TIMEOUT_MS,
            signal: deadline,
          });
        }
        const tools: Tool[] = [];
        let cursor: string | undefined;
        for (let page = 0; page < 20; page++) {
          const listed = await current.client.listTools(cursor ? { cursor } : {}, {
            timeout: this.db.config.UPSTREAM_TIMEOUT_MS,
            signal: deadline,
          });
          tools.push(...listed.tools);
          cursor = listed.nextCursor;
          if (!cursor) break;
        }
        if (cursor) throw new Error('Tool catalog too large');
        current.tools = tools;
        await this.db.query(
          "UPDATE upstreams SET status='Connected',last_error=NULL,checked_at=now() WHERE id=$1 AND enabled=true",
          [row.id],
        );
      } catch (error) {
        await current.client?.close().catch(() => {});
        current.client = undefined;
        await this.db.query(
          "UPDATE upstreams SET status='Unreachable',last_error=$2,checked_at=now() WHERE id=$1 AND enabled=true",
          [row.id, diagnostic(error)],
        );
      }
    })().finally(() => {
      current.refresh = undefined;
    });
    return current.refresh;
  }
  async catalog(role: string) {
    const rows = await this.rows();
    return rows
      .filter((r) => r.enabled)
      .flatMap((row) =>
        (this.entries.get(row.id)?.tools ?? [])
          .filter((tool) => role === 'admin' || row.read_tools.includes(tool.name))
          .map((tool) => ({
            row,
            original: tool.name,
            tool: {
              ...tool,
              name: exposedName(row.slug, tool.name),
              description: `[${row.name}] ${tool.description ?? ''}`,
            },
          })),
      );
  }
  async call(
    row: Upstream,
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<CallToolResult> {
    const entry = this.entries.get(row.id);
    if (!entry?.client)
      return failure(
        'UPSTREAM_UNREACHABLE',
        'The upstream is unreachable. Other servers remain available.',
      );
    try {
      return (await entry.client.callTool({ name, arguments: args }, undefined, {
        timeout: this.db.config.UPSTREAM_TIMEOUT_MS,
        signal,
      })) as CallToolResult;
    } catch (error) {
      await entry.client.close().catch(() => {});
      entry.client = undefined;
      await this.db.query(
        "UPDATE upstreams SET status='Unreachable',last_error=$2,checked_at=now() WHERE id=$1 AND enabled=true",
        [row.id, diagnostic(error)],
      );
      return failure(
        'UPSTREAM_CALL_FAILED',
        'Upstream call failed or timed out. A write may have completed; inspect state before retrying.',
      );
    }
  }
  async close() {
    await Promise.allSettled([...this.entries.keys()].map((id) => this.forget(id)));
  }
}
