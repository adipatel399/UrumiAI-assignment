#!/usr/bin/env python3
"""Provision platform secrets into the explicitly selected installation."""
import json, secrets
from provisioning import PRIVATE, private_json, secret

data=private_json('platform-credentials.json',lambda:{
    'PGPASSWORD':secrets.token_urlsafe(32),'ENCRYPTION_KEY':secrets.token_hex(32),
    'BOOTSTRAP_EMAIL':'admin@example.test','BOOTSTRAP_PASSWORD':secrets.token_urlsafe(32),
    'SUPPORT_MCP_TOKEN':secrets.token_urlsafe(48),
})
woo=json.loads((PRIVATE/'woocommerce-mcp-credentials.json').read_text())
secret('urumi-platform-secrets',{**data,'WOO_MCP_TOKEN':woo['MCP_BEARER_TOKEN']})
secret('urumi-platform-database-secrets',{'POSTGRES_PASSWORD':data['PGPASSWORD']})
secret('urumi-support-secrets',{'SUPPORT_MCP_TOKEN':data['SUPPORT_MCP_TOKEN']})
print('Platform credentials provisioned privately; values not printed.')
