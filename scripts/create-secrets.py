#!/usr/bin/env python3
"""Generate credentials privately and apply a Kubernetes Secret via stdin."""
import json, os, pathlib, secrets, subprocess

from provisioning import private_json, secret

data = private_json('store-credentials.json', lambda: {
    'db-password':secrets.token_urlsafe(32), 'db-root-password':secrets.token_urlsafe(32),
    'WP_ADMIN_USER':'storeadmin','WP_ADMIN_PASSWORD':secrets.token_urlsafe(24),
    'WP_ADMIN_EMAIL':'admin@example.test',
})
secret('urumi-store-secrets',data)
print('Store credentials provisioned privately; values not printed.')
