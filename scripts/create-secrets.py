#!/usr/bin/env python3
"""Generate credentials privately and apply a Kubernetes Secret via stdin."""
import json, os, pathlib, secrets, subprocess

root = pathlib.Path(__file__).resolve().parents[1]
path = root / '.local' / 'store-credentials.json'
path.parent.mkdir(mode=0o700, exist_ok=True)
path.parent.chmod(0o700)
if path.exists():
    data = json.loads(path.read_text())
else:
    data = {
        'db-password': secrets.token_urlsafe(32),
        'db-root-password': secrets.token_urlsafe(32),
        'WP_ADMIN_USER': 'storeadmin',
        'WP_ADMIN_PASSWORD': secrets.token_urlsafe(24),
        'WP_ADMIN_EMAIL': 'admin@example.test',
    }
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as f:
        json.dump(data, f, indent=2)
manifest = {'apiVersion': 'v1', 'kind': 'Secret',
            'metadata': {'name': 'urumi-store-secrets', 'namespace': 'urumi'},
            'type': 'Opaque', 'stringData': data}
subprocess.run(['kubectl', 'apply', '-f', '-'], input=json.dumps(manifest), text=True, check=True)
print('Credentials saved privately in .local/store-credentials.json; values not printed.')
