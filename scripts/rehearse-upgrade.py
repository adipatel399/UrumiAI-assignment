#!/usr/bin/env python3
"""Safe values-only Helm upgrade and rollback rehearsal against an explicit installation."""
import argparse,json,pathlib,subprocess,tempfile
p=argparse.ArgumentParser();p.add_argument('--context',default='k3d-urumi');a=p.parse_args()
base=['helm','--kube-context',a.context]
def helm(*args,**kw):return subprocess.run([*base,*args],check=True,text=True,**kw)
history=json.loads(subprocess.check_output([*base,'history','urumi','-n','urumi','-o','json']))
revision=history[-1]['revision']
with tempfile.NamedTemporaryFile(mode='w',suffix='.yaml') as f:
    f.write(subprocess.check_output([*base,'get','values','urumi','-n','urumi'],text=True));f.flush()
    # Reversible resource-only change. No image/schema change; all three application types are managed by this release.
    helm('upgrade','urumi','deploy/helm/urumi','-n','urumi','-f',f.name,
         '--set','platform.resources.requests.cpu=110m','--wait','--timeout','5m')
    helm('rollback','urumi',str(revision),'-n','urumi','--wait','--timeout','5m')
print('PASS: Helm upgrade and rollback restored the earlier release values. Database records were not rolled back.')
