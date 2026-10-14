import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encrypt,
  decrypt,
  passwordHash,
  passwordMatches,
  digest,
  validateUpstream,
} from '../src/security.js';
import { exposedName } from '../src/upstreams.js';
test('password verification, encrypted credentials, and tamper rejection', async () => {
  const hash = await passwordHash('test-only-password');
  assert(!hash.includes('test-only-password'));
  assert(await passwordMatches('test-only-password', hash));
  assert(!(await passwordMatches('wrong', hash)));
  const key = 'ab'.repeat(32);
  const value = { header: 'Authorization', value: 'Bearer test-only-credential' };
  const ciphertext = encrypt(value, key);
  assert(!ciphertext.includes(value.value));
  assert.deepEqual(decrypt(ciphertext, key), value);
  assert.throws(() => decrypt(ciphertext, 'cd'.repeat(32)));
  assert.notEqual(digest('key-a'), digest('key-b'));
});
test('tool collisions and long names have stable distinct routes', () => {
  assert.equal(exposedName('inventory', 'search'), 'inventory__search');
  assert.notEqual(exposedName('inventory', 'search'), exposedName('knowledge', 'search'));
  assert(exposedName('store', 'x'.repeat(100)).length <= 64);
  assert.equal(exposedName('store', 'x'.repeat(100)), exposedName('store', 'x'.repeat(100)));
});
test('upstream destination policy rejects credentials, metadata and loopback', async () => {
  for (const url of [
    'http://169.254.169.254/latest/meta-data',
    'https://127.0.0.1/mcp',
    'http://user:password@urumi-woocommerce-mcp/mcp',
    'file:///etc/passwd',
  ])
    await assert.rejects(validateUpstream(url, ['urumi-woocommerce-mcp']));
  assert.equal(
    (await validateUpstream('http://urumi-woocommerce-mcp:3000/mcp', ['urumi-woocommerce-mcp']))
      .hostname,
    'urumi-woocommerce-mcp',
  );
});
