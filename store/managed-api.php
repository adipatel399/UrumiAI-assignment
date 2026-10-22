<?php
// Run only inside a namespace-local initialization Job. Never print credential values.
$user = get_user_by('login', 'urumi_mcp_service');
if (!$user) {
    $id = wp_insert_user(['user_login'=>'urumi_mcp_service','user_pass'=>getenv('SERVICE_USER_PASSWORD'),'role'=>'shop_manager','user_email'=>'mcp-service@example.test']);
    if (is_wp_error($id)) throw new RuntimeException('Store service principal creation failed.');
    $user = get_user_by('id', $id);
}
global $wpdb;
$table = $wpdb->prefix . 'woocommerce_api_keys';
$hash = wc_api_hash(getenv('WOO_CONSUMER_KEY'));
if (!$wpdb->get_var($wpdb->prepare("SELECT key_id FROM $table WHERE consumer_key=%s", $hash))) {
    $ok = $wpdb->insert($table, ['user_id'=>$user->ID,'description'=>'Managed store MCP','permissions'=>'read_write','consumer_key'=>$hash,'consumer_secret'=>getenv('WOO_CONSUMER_SECRET'),'truncated_key'=>substr(getenv('WOO_CONSUMER_KEY'),-7)]);
    if (!$ok) throw new RuntimeException('Store service key creation failed.');
}
update_option('blogname', getenv('MANAGED_STORE_NAME'));
update_option('urumi_managed_store_name', getenv('MANAGED_STORE_NAME'));
echo "Managed store initialization complete.\n";
