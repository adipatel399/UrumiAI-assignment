<?php
// Idempotent presentation setup. Existing orders and products are retained.
if (!defined('ABSPATH')) exit;
update_option('blogname', 'Urumi Studio');
update_option('blogdescription', 'A little room for big ideas');
// Native shortcodes retain WooCommerce validation, totals, nonce and checkout behavior.
foreach (['cart' => '[woocommerce_cart]', 'checkout' => '[woocommerce_checkout]'] as $page => $content) {
    $id = wc_get_page_id($page);
    if ($id > 0) wp_update_post(['ID' => $id, 'post_content' => $content]);
}
$seed = [
    ['STUDIO-NOTE-001', 'The Everyday Notebook', '249', 'notes.jpg', 'Notebooks', 'A fresh page for your everyday ideas. A virtual demo edition for notes, lists, and the occasional brilliant thought.'],
    ['STUDIO-JOURNAL-001', 'The Quiet Morning Journal', '349', 'journal.jpg', 'Journals', 'Make a little time for yourself. A virtual journal for morning reflections and moments worth keeping.'],
    ['STUDIO-PLAN-001', 'The Weekly Focus Planner', '299', 'planner.jpg', 'Planners', 'A clearer view of your week. A virtual planner for priorities, small wins, and whatever comes next.'],
];
require_once ABSPATH . 'wp-admin/includes/image.php';
require_once ABSPATH . 'wp-admin/includes/file.php';
require_once ABSPATH . 'wp-admin/includes/media.php';
foreach ($seed as [$sku, $name, $price, $file, $category, $description]) {
    $existing = wc_get_product_id_by_sku($sku);
    if ($existing) continue;
    $term = term_exists($category, 'product_cat');
    if (!$term) $term = wp_insert_term($category, 'product_cat');
    $product = new WC_Product_Simple();
    $product->set_name($name); $product->set_sku($sku); $product->set_regular_price($price);
    $product->set_description($description . ' This is a demonstration product. No item is shipped and no payment is collected.');
    $product->set_short_description($description); $product->set_virtual(true); $product->set_status('publish');
    if (!is_wp_error($term)) $product->set_category_ids([(int)$term['term_id']]);
    $id = $product->save();
    $tmp = wp_tempnam($file);
    if ($tmp && copy('/opt/urumi/theme/assets/' . $file, $tmp)) {
        $attachment = media_handle_sideload(['name'=>'urumi-' . $file, 'tmp_name'=>$tmp], $id, 'Illustrative stationery photograph');
        if (!is_wp_error($attachment)) {
            update_post_meta($attachment, '_wp_attachment_image_alt', $name . ' — illustrative stationery photograph');
            $product->set_image_id($attachment); $product->save();
        } elseif (file_exists($tmp)) unlink($tmp);
    }
}
echo "Studio theme configured; collection ready. Existing data retained.\n";
