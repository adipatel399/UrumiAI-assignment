import { Agent } from 'undici';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

// IPv4 public destinations only. Internal services use a separate explicit hostname allowlist.
export function publicAddress(address: string) {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split('.').map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}
export async function resolvePublic(hostname: string, resolver = lookup) {
  const addresses = await resolver(hostname, { all: true, family: 4 });
  if (!addresses.length || addresses.some((x) => !publicAddress(x.address)))
    throw new Error('Destination resolves to a prohibited network.');
  return addresses;
}
export function destinationAgent(url: URL, trustedHosts: string[]) {
  if (
    (isIP(url.hostname) || url.hostname.startsWith('[')) &&
    !trustedHosts.includes(url.hostname)
  )
    throw new Error('Literal destination addresses are prohibited.');
  // This lookup supplies the actual socket address. There is no second unchecked DNS lookup.
  return new Agent({
    connect: {
      timeout: 10000,
      lookup: (hostname, options, callback) => {
        if (hostname !== url.hostname)
          return callback(new Error('Destination changed.'), '', 4);
        const resolution = trustedHosts.includes(hostname)
          ? lookup(hostname, { all: true })
          : resolvePublic(hostname);
        void resolution
          .then((addresses) => {
            if (options.all) callback(null, addresses);
            else callback(null, addresses[0].address, addresses[0].family);
          })
          .catch(() =>
            callback(new Error('Destination lookup refused or unavailable.'), '', 4),
          );
      },
    },
  });
}
