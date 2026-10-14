#!/usr/bin/env python3
"""Exercise the internal MCP service without publishing or port-forwarding it."""
import json, os, subprocess, uuid

def run(*args, **kwargs):
    return subprocess.run(['kubectl', *args], text=True, check=True, **kwargs)

if run('config', 'current-context', capture_output=True).stdout.strip() != 'k3d-urumi':
    raise SystemExit('Select k3d-urumi before running local integration checks.')
gateway = subprocess.run(['kubectl','get','deployment/urumi-gateway','-n','urumi'],capture_output=True)
if gateway.returncode == 0:
    print('Gateway installed: verifying store tools through the gateway boundary.')
    subprocess.run(['node','services/platform/dist/test/cluster.js'],env={**os.environ,'CHECK_STAGE':'baseline'},check=True)
    raise SystemExit(0)
run('rollout','status','deployment/urumi-store','-n','urumi','--timeout=180s')
run('rollout','status','deployment/urumi-woocommerce-mcp','-n','urumi','--timeout=180s')
image = run('get', 'deployment/urumi-woocommerce-mcp', '-n', 'urumi',
            '-o', 'jsonpath={.spec.template.spec.containers[0].image}', capture_output=True).stdout

def check(label, command, credentialed=False):
    name = 'mcp-check-' + uuid.uuid4().hex[:8]
    container = {'name':'check', 'image':image, 'imagePullPolicy':'IfNotPresent', 'command':command,
        'resources':{'requests':{'cpu':'25m','memory':'64Mi'},'limits':{'cpu':'500m','memory':'192Mi'}},
        'securityContext':{'allowPrivilegeEscalation':False,'readOnlyRootFilesystem':True,'capabilities':{'drop':['ALL']}}}
    if credentialed:
        container['envFrom'] = [{'secretRef':{'name':'urumi-woocommerce-mcp-secrets'}}]
        container['env'] = [
            {'name':'WOO_BASE_URL','value':'http://urumi-store'},
            {'name':'WOO_PUBLIC_URL','value':'http://store.localhost:8080'},
            {'name':'STORE_TIMEZONE','value':'Asia/Kolkata'},
        ]
    pod={'apiVersion':'v1','kind':'Pod','metadata':{'name':name,'namespace':'urumi','labels':{'app':label}},
         'spec':{'restartPolicy':'Never','activeDeadlineSeconds':120,'automountServiceAccountToken':False,
            'securityContext':{'runAsUser':1000,'runAsGroup':1000,'runAsNonRoot':True,'seccompProfile':{'type':'RuntimeDefault'}},
            'containers':[container]}}
    try:
        run('apply','-f','-',input=json.dumps(pod))
        result = subprocess.run(['kubectl','wait','-n','urumi','--for=jsonpath={.status.containerStatuses[0].state.terminated.reason}',
                                 'pod/'+name,'--timeout=120s'],text=True)
        run('logs','-n','urumi',name)
        if result.returncode: raise SystemExit('MCP integration check failed.')
        exit_code = run('get','pod',name,'-n','urumi',
                        '-o','jsonpath={.status.containerStatuses[0].state.terminated.exitCode}',capture_output=True).stdout
        if exit_code != '0': raise SystemExit('MCP integration check failed.')
    finally:
        run('delete','pod','-n','urumi',name,'--ignore-not-found','--wait=false')

# Trusted caller label is used only by this temporary test pod; no NetworkPolicy is weakened.
check('urumi-gateway', ['node','services/woocommerce-mcp/dist/test/smoke.js'], credentialed=True)
code = "fetch('http://urumi-woocommerce-mcp:3000/healthz',{signal:AbortSignal.timeout(3000)}).then(()=>{console.error('FAIL: untrusted pod reached MCP');process.exit(1)}).catch(()=>console.log('PASS: untrusted pod cannot reach internal MCP'))"
check('untrusted-test-client', ['node','-e',code])
