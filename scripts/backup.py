#!/usr/bin/env python3
"""Quiesce application writes and save a private, consistent demo backup."""
import argparse, datetime, json, os, pathlib, subprocess
p=argparse.ArgumentParser()
p.add_argument('--context',required=True)
p.add_argument('--output',required=True)
p.add_argument('--allow-plaintext',action='store_true',help='Private local rehearsal only; backup contains credentials.')
a=p.parse_args()
if not a.allow_plaintext: p.error('Choose a private local destination and explicitly acknowledge --allow-plaintext; encrypt before off-host storage.')
os.umask(0o077)
out=pathlib.Path(a.output).resolve()
out.mkdir(parents=True,exist_ok=False,mode=0o700)
base=['kubectl','--context',a.context,'-n','urumi']
def run(*args,**kwargs): return subprocess.run([*base,*args],check=True,**kwargs)
def save(name,*args):
    with (out/name).open('wb') as f: run(*args,stdout=f)
replicas=json.loads(subprocess.check_output([*base,'get','deployment/urumi-gateway','-o','json']))['spec']['replicas']
maintenance=False
try:
    run('scale','deployment/urumi-gateway','--replicas=0')
    run('rollout','status','deployment/urumi-gateway','--timeout=120s')
    run('exec','deployment/urumi-store','--','wp','maintenance-mode','activate','--allow-root')
    maintenance=True
    save('store.sql','exec','deployment/urumi-database','--','sh','-c',
         'export MYSQL_PWD="$MARIADB_PASSWORD"; exec mariadb-dump -u wordpress --single-transaction --routines --triggers wordpress')
    save('platform.dump','exec','deployment/urumi-platform-database','--','pg_dump','-U','urumi','-d','urumi','-Fc')
    save('wordpress.tar.gz','exec','deployment/urumi-store','--','tar','-czf','-','-C','/var/www/html','.')
    save('secrets.json','get','secrets','-o','json')
    with (out/'values.yaml').open('wb') as f:
        subprocess.run(['helm','--kube-context',a.context,'get','values','urumi','-n','urumi','--all'],check=True,stdout=f)
    (out/'manifest.json').write_text(json.dumps({'created_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'context':a.context,'format':1,'contains_secrets':True,'gateway_replicas':replicas},indent=2))
finally:
    if maintenance: run('exec','deployment/urumi-store','--','wp','maintenance-mode','deactivate','--allow-root')
    run('scale','deployment/urumi-gateway',f'--replicas={replicas}')
    if replicas: run('rollout','status','deployment/urumi-gateway','--timeout=180s')
print('Private backup complete. Contains raw credentials: encrypt before transfer; never commit.')
