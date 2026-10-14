#!/usr/bin/env python3
"""Verify the local two-user gateway and controlled failure/recovery flow."""
import os, subprocess
if subprocess.check_output(['kubectl','config','current-context'],text=True).strip() != 'k3d-urumi':
    raise SystemExit('Select k3d-urumi before running local cluster checks.')
def run(*args): subprocess.run(args,check=True)
def stage(name): subprocess.run(['node','services/platform/dist/test/cluster.js'],env={**os.environ,'CHECK_STAGE':name},check=True)
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
