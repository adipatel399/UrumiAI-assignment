#!/usr/bin/env python3
"""Provision a dedicated WooCommerce principal and its Kubernetes Secret."""
import json, os, pathlib, secrets, subprocess

root = pathlib.Path(__file__).resolve().parents[1]
context = subprocess.check_output(['kubectl', 'config', 'current-context'], text=True).strip()
if context != 'k3d-urumi':
    raise SystemExit('Select k3d-urumi before provisioning local MCP credentials.')
path = root / '.local' / 'woocommerce-mcp-credentials.json'
path.parent.mkdir(mode=0o700, exist_ok=True)
path.parent.chmod(0o700)
if path.exists():
    data = json.loads(path.read_text())
else:
    data = {'WOO_CONSUMER_KEY': 'ck_' + secrets.token_hex(20),
            'WOO_CONSUMER_SECRET': 'cs_' + secrets.token_hex(20),
            'MCP_BEARER_TOKEN': secrets.token_urlsafe(48),
            'SERVICE_USER_PASSWORD': secrets.token_urlsafe(48)}
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as f:
        json.dump(data, f, indent=2)
# The credential values travel over stdin, not shell arguments or terminal output.
php = r'''
$credentials = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
$user = get_user_by('login', 'urumi_mcp_service');
if (!$user) {
  $id = wp_insert_user(['user_login'=>'urumi_mcp_service',
    'user_pass'=>$credentials['SERVICE_USER_PASSWORD'], 'role'=>'shop_manager',
    'user_email'=>'mcp-service@example.test']);
  if (is_wp_error($id)) { fwrite(STDERR, "Service principal creation failed.\n"); exit(1); }
  $user = get_user_by('id', $id);
}
global $wpdb;
$table = $wpdb->prefix . 'woocommerce_api_keys';
$hash = wc_api_hash($credentials['WOO_CONSUMER_KEY']);
$existing = $wpdb->get_var($wpdb->prepare("SELECT key_id FROM $table WHERE consumer_key = %s", $hash));
if (!$existing) {
  $ok = $wpdb->insert($table, ['user_id'=>$user->ID, 'description'=>'Urumi WooCommerce MCP',
    'permissions'=>'read_write', 'consumer_key'=>$hash,
    'consumer_secret'=>$credentials['WOO_CONSUMER_SECRET'],
    'truncated_key'=>substr($credentials['WOO_CONSUMER_KEY'], -7)]);
  if (!$ok) { fwrite(STDERR, "API key provisioning failed.\n"); exit(1); }
}
echo "Dedicated store principal and API key ready.\n";
'''
subprocess.run(['kubectl', 'exec', '-i', '-n', 'urumi', 'deployment/urumi-store', '--',
                'wp', 'eval', php, '--allow-root'], input=json.dumps(data), text=True, check=True)
manifest = {'apiVersion':'v1', 'kind':'Secret',
            'metadata':{'name':'urumi-woocommerce-mcp-secrets', 'namespace':'urumi'},
            'type':'Opaque', 'stringData': {k:v for k,v in data.items() if k != 'SERVICE_USER_PASSWORD'}}
subprocess.run(['kubectl','apply','-f','-'], input=json.dumps(manifest), text=True, check=True)
print('MCP credentials applied. Private backup is in .local; secret values not printed.')

