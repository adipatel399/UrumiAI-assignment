import { createHmac, randomBytes } from 'node:crypto';
import type { Config } from './config.js';

const encode = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

// WooCommerce's one-legged OAuth signs its canonical home URL, not Service DNS.
export function signedAuthorization(method: string, canonicalUrl: string, query: Record<string, string>, key: string, secret: string) {
  const params: Record<string, string> = {
    ...query, oauth_consumer_key: key, oauth_nonce: randomBytes(16).toString('hex'),
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(), oauth_signature_method: 'HMAC-SHA256',
  };
  const normalized = Object.keys(params).sort().map(k => `${encode(k)}=${encode(params[k])}`).join('&');
  const base = `${method}&${encode(canonicalUrl)}&${encode(normalized)}`;
  const signature = createHmac('sha256', `${secret}&`).update(base).digest('base64');
  const oauth = { ...params, oauth_signature: signature };
  return 'OAuth ' + Object.entries(oauth).filter(([k]) => k.startsWith('oauth_'))
    .map(([k, v]) => `${encode(k)}="${encode(v)}"`).join(', ');
}

export class StoreError extends Error {
  constructor(public code: string, message: string, public status?: number) { super(message); }
}

export class WooCommerceApi {
  constructor(private config: Config) {}

  async request(method: string, path: string, query: Record<string, string> = {}, body?: unknown, signal?: AbortSignal) {
    const network = new URL(`${this.config.WOO_BASE_URL.replace(/\/$/, '')}/wp-json/wc/v3/${path}`);
    const canonical = new URL(`${this.config.WOO_PUBLIC_URL.replace(/\/$/, '')}/wp-json/wc/v3/${path}`);
    // WooCommerce checks the scheme of the actual request, even when home uses HTTPS.
    canonical.protocol = network.protocol;
    for (const [key, value] of Object.entries(query)) network.searchParams.set(key, value);
    const timeout = AbortSignal.timeout(this.config.WOO_TIMEOUT_MS);
    const combined = signal ? AbortSignal.any([timeout, signal]) : timeout;
    try {
      const response = await fetch(network, {
        method, redirect: 'error', signal: combined,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json',
          Authorization: signedAuthorization(method, canonical.href, query, this.config.WOO_CONSUMER_KEY, this.config.WOO_CONSUMER_SECRET) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!response.ok) {
        // Upstream bodies may contain arbitrary content: do not reflect them or credentials.
        await response.body?.cancel();
        const message = response.status === 404 ? 'The requested store resource does not exist.'
          : [401, 403].includes(response.status) ? 'Store authentication or permissions failed.'
          : 'WooCommerce rejected the request.';
        throw new StoreError('STORE_HTTP_ERROR', message, response.status);
      }
      const data: unknown = await response.json();
      return { data, pagination: {
        total: Number(response.headers.get('x-wp-total') ?? 0),
        total_pages: Number(response.headers.get('x-wp-totalpages') ?? 0),
      } };
    } catch (error) {
      if (error instanceof StoreError) throw error;
      if (timeout.aborted) throw new StoreError('STORE_TIMEOUT', 'WooCommerce did not respond before the timeout. A write may have completed; check the store before retrying.');
      if (signal?.aborted) throw new StoreError('CALL_CANCELLED', 'The tool call was cancelled. A write may have completed; check before retrying.');
      throw new StoreError('STORE_UNAVAILABLE', 'Cannot reach WooCommerce or read its response. A write may have completed; check before retrying.');
    }
  }
}
