#!/usr/bin/env python3
"""Provision a dedicated WooCommerce principal and its Kubernetes Secret."""
import json, os, pathlib, secrets, subprocess

from provisioning import PRIVATE, private_json, kube, secret

data=private_json('woocommerce-mcp-credentials.json',lambda:{
    'WOO_CONSUMER_KEY':'ck_'+secrets.token_hex(20),
    'WOO_CONSUMER_SECRET':'cs_'+secrets.token_hex(20),
    'MCP_BEARER_TOKEN':secrets.token_urlsafe(48),
    'SERVICE_USER_PASSWORD':secrets.token_urlsafe(48),
})
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
kube('exec','-i','-n','urumi','deployment/urumi-store','--','wp','eval',php,'--allow-root',input=json.dumps(data))
secret('urumi-woocommerce-mcp-secrets',{k:v for k,v in data.items() if k!='SERVICE_USER_PASSWORD'})
print('Dedicated store principal and MCP Secret ready; values not printed.')
