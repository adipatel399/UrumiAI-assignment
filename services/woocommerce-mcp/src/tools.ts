import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { DateTime } from 'luxon';
import { z } from 'zod';
import type { Config } from './config.js';
import { StoreError, WooCommerceApi } from './woocommerce.js';

const orderStatus = z.enum(['pending', 'processing', 'on-hold', 'completed', 'cancelled', 'refunded', 'failed']);
const page = z.number().int().min(1).default(1);
const perPage = z.number().int().min(1).max(100).default(20);
const id = z.number().int().positive();
const timestamp = z.iso.datetime({ offset: true });

export function todayRange(zone: string, now: DateTime = DateTime.now()) {
  const start = now.setZone(zone).startOf('day');
  return { after: start.toUTC().toFormat("yyyy-MM-dd'T'HH:mm:ss"),
    before: start.plus({ days: 1 }).minus({ seconds: 1 }).toUTC().toFormat("yyyy-MM-dd'T'HH:mm:ss") };
}

function text(data: Record<string, unknown>): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
}
async function execute(operation: () => Promise<Record<string, unknown>>): Promise<CallToolResult> {
  try { return text(await operation()); }
  catch (error) {
    const failure = error instanceof StoreError ? error : new StoreError('TOOL_ERROR', 'The tool could not complete.');
    return { ...text({ error: { code: failure.code, message: failure.message, ...(failure.status ? { status: failure.status } : {}) } }), isError: true };
  }
}

export function createStoreServer(config: Config) {
  const api = new WooCommerceApi(config);
  const server = new McpServer({ name: 'urumi-woocommerce', version: '0.1.0' });
  const read = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

  server.registerTool('list_products', {
    description: 'List store products with bounded pagination. Follow total_pages to retrieve more pages.',
    inputSchema: { page, per_page: perPage, search: z.string().max(200).optional(), sku: z.string().max(100).optional() },
    annotations: read,
  }, ({ page, per_page, search, sku }, extra) => execute(async () => {
    const query: Record<string, string> = { page: String(page), per_page: String(per_page) };
    if (search !== undefined) query.search = search;
    if (sku !== undefined) query.sku = sku;
    const result = await api.request('GET', 'products', query, undefined, extra.signal);
    return { products: result.data, pagination: { page, per_page, ...result.pagination } };
  }));

  server.registerTool('create_product', {
    description: 'Create and publish a simple product. Price is a decimal string in the store currency. Writes are not automatically retried.',
    inputSchema: {
      name: z.string().trim().min(1).max(200),
      price: z.string().regex(/^(0|[1-9]\d{0,8})(\.\d{1,2})?$/).describe('For example "199.00"; no currency symbol.'),
      description: z.string().max(5000).optional(), sku: z.string().trim().min(1).max(100).optional(),
      virtual: z.boolean().default(false).describe('True for a product that needs no shipping.'),
    }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, ({ name, price, description, sku, virtual }, extra) => execute(async () => ({
    product: (await api.request('POST', 'products', {}, {
      name, type: 'simple', status: 'publish', regular_price: price, virtual,
      ...(description === undefined ? {} : { description }), ...(sku === undefined ? {} : { sku }),
    }, extra.signal)).data,
  })));

  server.registerTool('list_orders', {
    description: `List orders by creation time, newest first. period=today uses ${config.STORE_TIMEZONE}, not the computer's timezone. Results are paginated.`,
    inputSchema: { page, per_page: perPage, period: z.enum(['all', 'today']).default('all'),
      after: timestamp.optional(), before: timestamp.optional(), status: orderStatus.optional() }, annotations: read,
  }, ({ page, per_page, period, after, before, status }, extra) => execute(async () => {
    if (period === 'today' && (after || before)) throw new StoreError('INVALID_DATE_RANGE', 'Use period=today or explicit dates, not both.');
    if (after && before && Date.parse(after) > Date.parse(before)) throw new StoreError('INVALID_DATE_RANGE', 'after must be earlier than or equal to before.');
    const query: Record<string, string> = { page: String(page), per_page: String(per_page), orderby: 'date', order: 'desc', dates_are_gmt: 'true' };
    const range = period === 'today' ? todayRange(config.STORE_TIMEZONE) : {
      ...(after ? { after: DateTime.fromISO(after).toUTC().toFormat("yyyy-MM-dd'T'HH:mm:ss") } : {}),
      ...(before ? { before: DateTime.fromISO(before).toUTC().toFormat("yyyy-MM-dd'T'HH:mm:ss") } : {}),
    };
    Object.assign(query, range);
    if (status) query.status = status;
    const result = await api.request('GET', 'orders', query, undefined, extra.signal);
    return { orders: result.data, timezone: config.STORE_TIMEZONE, range, pagination: { page, per_page, ...result.pagination } };
  }));

  server.registerTool('get_order', {
    description: 'Retrieve a single WooCommerce order by its numeric ID.', inputSchema: { order_id: id }, annotations: read,
  }, ({ order_id }, extra) => execute(async () => ({ order: (await api.request('GET', `orders/${order_id}`, {}, undefined, extra.signal)).data })));

  server.registerTool('update_order_status', {
    description: 'Change order status. This is a write and may trigger store workflows or notifications. A refunded status alone does not issue a payment refund.',
    inputSchema: { order_id: id, status: orderStatus },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  }, ({ order_id, status }, extra) => execute(async () => ({ order: (await api.request('PUT', `orders/${order_id}`, {}, { status }, extra.signal)).data })));

  return server;
}
