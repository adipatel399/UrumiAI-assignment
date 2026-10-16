"""Shared, explicit-context provisioning helpers; secret values never appear in arguments."""
import os, pathlib, subprocess, json
ROOT = pathlib.Path(__file__).resolve().parents[1]
CONTEXT = os.environ.get('URUMI_CONTEXT', 'k3d-urumi')
NAMESPACE = 'urumi'
PRIVATE = pathlib.Path(os.environ.get('URUMI_CREDENTIAL_DIR', str(ROOT / '.local'))).resolve()
PRIVATE.mkdir(mode=0o700, parents=True, exist_ok=True)
PRIVATE.chmod(0o700)
if not os.environ.get('URUMI_CONTEXT'):
    current = subprocess.check_output(['kubectl', 'config', 'current-context'], text=True).strip()
    if current != CONTEXT:
        raise SystemExit('Select k3d-urumi, or explicitly set URUMI_CONTEXT and URUMI_CREDENTIAL_DIR for a remote installation.')

def kube(*args, **kwargs):
    return subprocess.run(['kubectl', '--context', CONTEXT, *args], check=True, text=True, **kwargs)

def secret(name, values):
    manifest = {'apiVersion':'v1','kind':'Secret','metadata':{'name':name,'namespace':NAMESPACE},
                'type':'Opaque','stringData':values}
    kube('apply','-f','-',input=json.dumps(manifest))

def private_json(filename, generate):
    path = PRIVATE / filename
    if path.exists():
        path.chmod(0o600)
        return json.loads(path.read_text())
    names={'store-credentials.json':'urumi-store-secrets','platform-credentials.json':'urumi-platform-secrets',
           'woocommerce-mcp-credentials.json':'urumi-woocommerce-mcp-secrets'}
    if filename in names:
        existing=subprocess.run(['kubectl','--context',CONTEXT,'-n',NAMESPACE,'get','secret',names[filename]],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        if existing.returncode==0:
            raise SystemExit('Installation already has credentials but its private backup is missing. Recover the original file; do not overwrite live Secrets.')
    data = generate()
    with os.fdopen(os.open(path, os.O_WRONLY|os.O_CREAT|os.O_EXCL, 0o600), 'w') as f:
        json.dump(data,f,indent=2)
    return data
