#!/usr/bin/env python3
import json, pathlib, os, secrets, subprocess
root = pathlib.Path(__file__).resolve().parents[1]
if subprocess.check_output(['kubectl','config','current-context'],text=True).strip() != 'k3d-urumi':
    raise SystemExit('Select k3d-urumi before local provisioning.')
path = root / '.local/platform-credentials.json'
if path.exists(): data = json.loads(path.read_text())
else:
    data = {'PGPASSWORD':secrets.token_urlsafe(32),'ENCRYPTION_KEY':secrets.token_hex(32),
            'BOOTSTRAP_EMAIL':'admin@example.test','BOOTSTRAP_PASSWORD':secrets.token_urlsafe(32),
            'SUPPORT_MCP_TOKEN':secrets.token_urlsafe(48)}
    with os.fdopen(os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600),'w') as f: json.dump(data,f,indent=2)
woo = json.loads((root/'.local/woocommerce-mcp-credentials.json').read_text())
def apply(name, values):
    manifest={'apiVersion':'v1','kind':'Secret','metadata':{'name':name,'namespace':'urumi'},'type':'Opaque','stringData':values}
    subprocess.run(['kubectl','apply','-f','-'],input=json.dumps(manifest),text=True,check=True)
apply('urumi-platform-secrets',{**data,'WOO_MCP_TOKEN':woo['MCP_BEARER_TOKEN']})
apply('urumi-platform-database-secrets',{'POSTGRES_PASSWORD':data['PGPASSWORD']})
apply('urumi-support-secrets',{'SUPPORT_MCP_TOKEN':data['SUPPORT_MCP_TOKEN']})
print('Platform credentials provisioned; private backup in .local, no secret values printed.')
