#!/usr/bin/env python3
"""Exercise real local NetworkPolicy paths; no cloud resource creation or credential output."""
import json, subprocess, uuid

def run(*args,**kwargs): return subprocess.run(['kubectl',*args],check=True,text=True,**kwargs)
if run('config','current-context',capture_output=True).stdout.strip()!='k3d-urumi':
    raise SystemExit('Select k3d-urumi before local security checks.')
services=json.loads(run('get','services','-n','urumi','-o','json',capture_output=True).stdout)
ips={s['metadata']['name']:s['spec']['clusterIP'] for s in services['items']}

def node_checks(paths):
    return "const net=require('node:net');(async()=>{for(const [host,port,allowed] of "+json.dumps(paths)+") {const connected=await new Promise(resolve=>{const s=net.connect({host,port});let done=false;const finish=v=>{if(done)return;done=true;s.destroy();resolve(v)};s.setTimeout(2000,()=>finish(false));s.on('connect',()=>finish(true));s.on('error',()=>finish(false));});if(connected!==allowed)throw Error('Unexpected network result: '+host+':'+port);console.log('PASS: '+host+':'+port+' '+(allowed?'allowed':'blocked'));}})().catch(()=>{console.error('Network boundary check failed');process.exit(1)});"
# Positive paths make a blanket broken network fail the test rather than appear secure.
run('exec','-n','urumi','deployment/urumi-gateway','--','node','-e',node_checks([
    [ips['urumi-platform-database'],5432,True], [ips['urumi-woocommerce-mcp'],3000,True],
    [ips['urumi-inventory-mcp'],3000,True],[ips['urumi-knowledge-mcp'],3000,True],
    [ips['urumi-store'],80,False],[ips['urumi-database'],3306,False],
    ['169.254.169.254',80,False],['10.43.0.1',443,False],
]))
run('exec','-n','urumi','deployment/urumi-inventory-mcp','--','node','-e',node_checks([
    [ips['urumi-platform-database'],5432,False],[ips['urumi-woocommerce-mcp'],3000,False],['1.1.1.1',443,False]
]))
for workload in ['gateway','inventory-mcp','knowledge-mcp','woocommerce-mcp']:
    run('exec','-n','urumi','deployment/urumi-'+workload,'--','node','-e',
        "if(process.getuid()===0||require('node:fs').existsSync('/var/run/secrets/kubernetes.io/serviceaccount/token'))process.exit(1);console.log('PASS: non-root process; no Kubernetes service account token');")
name='boundary-check-'+uuid.uuid4().hex[:8]
pod={'apiVersion':'v1','kind':'Pod','metadata':{'name':name,'namespace':'urumi'},'spec':{
    'restartPolicy':'Never','activeDeadlineSeconds':40,'automountServiceAccountToken':False,
    'securityContext':{'runAsNonRoot':True,'runAsUser':1000,'seccompProfile':{'type':'RuntimeDefault'}},
    'containers':[{'name':'check','image':'urumi-platform:0.1.0','imagePullPolicy':'IfNotPresent','command':['node','-e',node_checks([
        [ips['urumi-store'],80,False],[ips['urumi-gateway'],3000,False],[ips['urumi-woocommerce-mcp'],3000,False],
        [ips['urumi-platform-database'],5432,False],[ips['urumi-database'],3306,False]])],
        'securityContext':{'allowPrivilegeEscalation':False,'readOnlyRootFilesystem':True,'capabilities':{'drop':['ALL']}},
        'resources':{'requests':{'cpu':'10m','memory':'32Mi'},'limits':{'cpu':'100m','memory':'64Mi'}}}]}}
try:
    run('apply','-f','-',input=json.dumps(pod))
    run('wait','-n','urumi','--for=jsonpath={.status.phase}=Succeeded','pod/'+name,'--timeout=50s')
    run('logs','-n','urumi',name)
finally: run('delete','pod','-n','urumi',name,'--ignore-not-found','--wait=false')
print('PASS: explicit permitted flows, prohibited paths, default-deny isolation, and custom-service privileges.')
