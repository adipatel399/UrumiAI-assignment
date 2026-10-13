#!/usr/bin/env python3
"""Verify actual network isolation with a temporary unprivileged test pod."""
import json, subprocess, uuid

def run(*args, **kwargs):
    return subprocess.run(['kubectl', *args], text=True, check=True, **kwargs)

context = run('config', 'current-context', capture_output=True).stdout.strip()
if context != 'k3d-urumi':
    raise SystemExit('Select k3d-urumi before running local isolation checks.')
name = 'store-network-check-' + uuid.uuid4().hex[:8]
code = '$s=@fsockopen("urumi-database",3306,$e,$m,5); if($s){echo "FAIL: unauthorized connection succeeded\\n";exit(1);} echo "PASS: unauthorized database connection blocked\\n";'
pod = {
    'apiVersion': 'v1', 'kind': 'Pod',
    'metadata': {'name': name, 'namespace': 'urumi', 'labels': {'app': 'network-check'}},
    'spec': {
        'restartPolicy': 'Never', 'activeDeadlineSeconds': 60,
        'automountServiceAccountToken': False,
        'securityContext': {'runAsUser': 33, 'runAsGroup': 33, 'runAsNonRoot': True},
        'containers': [{
            'name': 'check', 'image': 'urumi-store:0.1.0', 'imagePullPolicy': 'IfNotPresent',
            'command': ['php', '-r', code],
            'resources': {'requests': {'cpu': '10m', 'memory': '32Mi'},
                          'limits': {'cpu': '100m', 'memory': '64Mi'}},
            'securityContext': {'allowPrivilegeEscalation': False, 'capabilities': {'drop': ['ALL']}},
        }],
    },
}
try:
    run('apply', '-f', '-', input=json.dumps(pod))
    run('wait', '-n', 'urumi', '--for=jsonpath={.status.phase}=Succeeded',
        'pod/' + name, '--timeout=60s')
    run('logs', '-n', 'urumi', name)
finally:
    run('delete', 'pod', '-n', 'urumi', name, '--ignore-not-found', '--wait=false')

