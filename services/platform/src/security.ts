import {
  createHash,
  createHmac,
  randomBytes,
  scrypt,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
} from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
const derive = (
  password: string,
  salt: string,
  size: number,
  options: { N: number; r: number; p: number; maxmem: number },
) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(password, salt, size, options, (error, key) => (error ? reject(error) : resolve(key))),
  );
export const token = () => randomBytes(32).toString('base64url');
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const equal = (a: string, b: string) =>
  timingSafeEqual(Buffer.from(digest(a)), Buffer.from(digest(b)));
export const csrf = (session: string, key: string) =>
  createHmac('sha256', key).update(session).digest('hex');
export async function passwordHash(password: string) {
  const salt = randomBytes(16).toString('hex');
  const key = (await derive(password, salt, 64, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  })) as Buffer;
  return `${salt}:${key.toString('hex')}`;
}
export async function passwordMatches(password: string, stored: string) {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const key = (await derive(password, salt, 64, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  })) as Buffer;
  return equal(key.toString('hex'), hash);
}
export function encrypt(value: unknown, key: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((x) => x.toString('base64')).join('.');
}
export function decrypt<T>(value: string, key: string): T {
  const [iv, tag, data] = value.split('.').map((x) => Buffer.from(x, 'base64'));
  const cipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  cipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([cipher.update(data), cipher.final()]).toString());
}
export async function validateUpstream(value: string, allowed: string[]) {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    !['http:', 'https:'].includes(url.protocol)
  )
    throw new Error('Invalid upstream URL.');
  if (allowed.includes(url.hostname)) return url;
  if (url.protocol !== 'https:' || isIP(url.hostname) || (url.port && url.port !== '443'))
    throw new Error('External upstreams must use a public HTTPS hostname on port 443.');
  const addresses = await lookup(url.hostname, { all: true });
  if (
    !addresses.length ||
    addresses.some(({ address }) => {
      // Conservative policy: reject IPv6 external destinations until pinned resolution is added.
      if (isIP(address) !== 4) return true;
      const [a, b] = address.split('.').map(Number);
      return (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 100 && b >= 64 && b <= 127) ||
        a >= 224
      );
    })
  )
    throw new Error('Upstream resolves to a prohibited network.');
  return url;
}
