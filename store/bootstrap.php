<?php
// Safe to rerun: create pages and a seed product only if absent.
WC_Install::create_pages();
update_option('woocommerce_currency', 'INR');
update_option('woocommerce_default_country', 'IN');
update_option('timezone_string', 'Asia/Kolkata');
update_option('woocommerce_enable_guest_checkout', 'yes');
update_option('show_on_front', 'page');
update_option('page_on_front', (int) get_option('woocommerce_shop_page_id'));
update_option('woocommerce_cod_settings', [
  'enabled' => 'yes', 'title' => 'Cash on delivery',
  'description' => 'Demo checkout only. No payment will be collected.',
  'enable_for_virtual' => 'yes'
]);
update_option('woocommerce_onboarding_profile', ['completed' => true]);
$products = wc_get_products(['sku' => 'URUMI-DEMO-001', 'limit' => 1]);
if (!$products) {
  $p = new WC_Product_Simple();
  $p->set_name('Urumi Demo Notebook');
  $p->set_sku('URUMI-DEMO-001');
  $p->set_regular_price('199');
  $p->set_description('A virtual demo product for testing checkout. Nothing will be shipped.');
  $p->set_virtual(true); // Avoid shipping setup in the assessment's test checkout.
  $p->set_status('publish');
  $p->save();
}
echo "Store configured; demo product ready.\n";

