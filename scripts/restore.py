#!/usr/bin/env python3
"""Restore only after explicit data-replacement acknowledgement; rehearsal should use a disposable cluster."""
import argparse, json, pathlib, subprocess
p=argparse.ArgumentParser()
p.add_argument('--context',required=True)
p.add_argument('--backup',required=True)
p.add_argument('--confirm-replace-data',action='store_true')
a=p.parse_args()
if not a.confirm_replace_data: p.error('Restoration overwrites current application data; pass --confirm-replace-data only for the intended target.')
folder=pathlib.Path(a.backup).resolve()
manifest=json.loads((folder/'manifest.json').read_text())
if manifest['format']!=1: raise SystemExit('Unsupported backup format.')
base=['kubectl','--context',a.context,'-n','urumi']
def run(*args,**kwargs): return subprocess.run([*base,*args],check=True,**kwargs)
def load(filename,*args):
    with (folder/filename).open('rb') as f: run(*args,stdin=f)
run('scale','deployment/urumi-gateway','--replicas=0')
run('rollout','status','deployment/urumi-gateway','--timeout=120s')
run('exec','deployment/urumi-store','--','wp','maintenance-mode','activate','--allow-root')
# Keep existing matching credentials. Restore secrets first when recovering onto fresh empty volumes.
current=json.loads(subprocess.check_output([*base,'get','secret','urumi-platform-secrets','-o','json']))['data']
saved=json.loads((folder/'secrets.json').read_text())
platform=next(s for s in saved['items'] if s['metadata']['name']=='urumi-platform-secrets')['data']
if current.get('ENCRYPTION_KEY')!=platform.get('ENCRYPTION_KEY'):
    raise SystemExit('Target encryption key differs. Install saved Secrets into the recovery cluster before restoring data; gateway stays stopped.')
load('store.sql','exec','-i','deployment/urumi-database','--','sh','-c',
     'export MYSQL_PWD="$MARIADB_PASSWORD"; exec mariadb -u wordpress wordpress')
load('platform.dump','exec','-i','deployment/urumi-platform-database','--','pg_restore','-U','urumi','-d','urumi','--clean','--if-exists','--no-owner','--exit-on-error')
load('wordpress.tar.gz','exec','-i','deployment/urumi-store','--','tar','-xzf','-','-C','/var/www/html')
run('exec','deployment/urumi-store','--','wp','maintenance-mode','deactivate','--allow-root')
run('scale','deployment/urumi-gateway',f"--replicas={manifest['gateway_replicas']}")
run('rollout','status','deployment/urumi-gateway','--timeout=180s')
print('Restore complete. Verify records, identities, store URL, and tools before reopening traffic.')
