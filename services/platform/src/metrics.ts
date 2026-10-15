import { Database } from './database.js';
export const buckets = [0.1, 0.5, 1, 5, 10, 30];
export async function metrics(db: Database) {
  const result =
    await db.query(`SELECT u.id,u.slug,u.name,u.status,u.enabled,u.last_error,u.checked_at,
    count(a.id)::int AS calls, count(a.id) FILTER (WHERE a.outcome IN ('error','rejected'))::int AS failures,
    count(a.id) FILTER (WHERE a.outcome='started')::int AS in_progress,
    count(a.id) FILTER (WHERE a.outcome<>'started')::int AS completed,
    COALESCE(sum(a.duration_ms) FILTER (WHERE a.outcome<>'started'),0)::float8 / 1000 AS duration_seconds,
    COALESCE(avg(a.duration_ms) FILTER (WHERE a.outcome<>'started'),0)::float8 AS mean_ms,
    COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY a.duration_ms) FILTER (WHERE a.outcome<>'started'),0)::float8 AS p95_ms,
    ARRAY[${buckets.map((x) => `count(a.id) FILTER (WHERE a.outcome<>'started' AND a.duration_ms<=${x * 1000})::int`).join(',')}] AS buckets
    FROM upstreams u LEFT JOIN audit_log a ON a.server_id=u.id GROUP BY u.id ORDER BY u.slug`);
  return result.rows;
}
const label = (s: string) =>
  s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
export function prometheus(rows: any[]) {
  const out = [
    '# HELP urumi_tool_calls_total Tool attempts attributed to registered servers, retained audit history.',
    '# TYPE urumi_tool_calls_total counter',
    '# HELP urumi_tool_failures_total Failed or rejected tool attempts.',
    '# TYPE urumi_tool_failures_total counter',
    '# HELP urumi_upstream_connected Last discovery observation: enabled and connected.',
    '# TYPE urumi_upstream_connected gauge',
    '# HELP urumi_tool_duration_seconds Completed tool call latency including gateway checks.',
    '# TYPE urumi_tool_duration_seconds histogram',
  ];
  for (const r of rows) {
    const l = `server="${label(r.slug)}",server_id="${label(r.id)}"`;
    out.push(
      `urumi_tool_calls_total{${l}} ${r.calls}`,
      `urumi_tool_failures_total{${l}} ${r.failures}`,
      `urumi_upstream_connected{${l}} ${r.enabled && r.status === 'Connected' ? 1 : 0}`,
    );
    buckets.forEach((b, i) =>
      out.push(`urumi_tool_duration_seconds_bucket{${l},le="${b}"} ${r.buckets[i]}`),
    );
    out.push(
      `urumi_tool_duration_seconds_bucket{${l},le="+Inf"} ${r.completed}`,
      `urumi_tool_duration_seconds_count{${l}} ${r.completed}`,
      `urumi_tool_duration_seconds_sum{${l}} ${r.duration_seconds}`,
    );
  }
  return out.join('\n') + '\n';
}
