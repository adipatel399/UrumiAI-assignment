#!/usr/bin/env python3
"""Verify the local two-user gateway and controlled failure/recovery flow."""
import os, subprocess, time, urllib.request, urllib.error, socket
if subprocess.check_output(['kubectl','config','current-context'],text=True).strip() != 'k3d-urumi':
    raise SystemExit('Select k3d-urumi before running local cluster checks.')
def run(*args): subprocess.run(args,check=True)
def stage(name):
    # Deployment readiness can precede Traefik's endpoint update. Retry only this read-only probe.
    for attempt in range(60):
        try:
            opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
            probe=urllib.request.Request('http://127.0.0.1:8080/readyz',headers={'Host':'gateway.localhost'})
            with opener.open(probe,timeout=2) as response:
                if response.status==200: break
        except (urllib.error.URLError,OSError,socket.timeout): pass
        time.sleep(0.5)
    else: raise SystemExit('Gateway ingress did not become ready.')
    subprocess.run(['node','services/platform/dist/test/cluster.js'],env={**os.environ,'CHECK_STAGE':name},check=True)
run('npm','run','build')
stage('baseline')
try:
    run('kubectl','scale','deployment/urumi-inventory-mcp','-n','urumi','--replicas=0')
    run('kubectl','rollout','status','deployment/urumi-inventory-mcp','-n','urumi','--timeout=180s')
    stage('outage')
finally:
    run('kubectl','scale','deployment/urumi-inventory-mcp','-n','urumi','--replicas=1')
    run('kubectl','rollout','status','deployment/urumi-inventory-mcp','-n','urumi','--timeout=180s')
stage('recovery')
run('kubectl','rollout','restart','deployment/urumi-platform-database','-n','urumi')
run('kubectl','rollout','status','deployment/urumi-platform-database','-n','urumi','--timeout=180s')
run('kubectl','rollout','restart','deployment/urumi-gateway','-n','urumi')
run('kubectl','rollout','status','deployment/urumi-gateway','-n','urumi','--timeout=180s')
stage('persistence')
