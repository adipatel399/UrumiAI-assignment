<?php
if (!defined('ABSPATH')) exit;
add_action('after_setup_theme', function () {
    add_theme_support('title-tag');
    add_theme_support('post-thumbnails');
    add_theme_support('woocommerce', ['thumbnail_image_width' => 650, 'single_image_width' => 1000, 'product_grid' => ['default_columns' => 3, 'default_rows' => 4]]);
    add_theme_support('wc-product-gallery-lightbox');
    add_theme_support('wc-product-gallery-slider');
});
add_action('wp_enqueue_scripts', function () {
    wp_enqueue_style('urumi-studio', get_stylesheet_uri(), [], filemtime(get_stylesheet_directory() . '/style.css'));
    wp_enqueue_script('wc-cart-fragments');
    wp_enqueue_script('urumi-studio', get_template_directory_uri() . '/studio.js', [], filemtime(get_template_directory() . '/studio.js'), true);
});
add_filter('loop_shop_columns', fn() => 3);
add_filter('loop_shop_per_page', fn() => 12);
add_filter('woocommerce_show_page_title', '__return_false');
add_filter('woocommerce_placeholder_img_src', function ($src) {
    global $product;
    $name = $product instanceof WC_Product ? strtolower($product->get_name()) : '';
    $file = str_contains($name, 'planner') ? 'planner.jpg' : (str_contains($name, 'journal') ? 'journal.jpg' : 'notes.jpg');
    return get_template_directory_uri() . '/assets/' . $file;
});
add_action('woocommerce_before_shop_loop_item_title', function () {
    global $product;
    if ($product && $product->get_date_created() && $product->get_date_created()->getTimestamp() > time() - 7 * DAY_IN_SECONDS) echo '<span class="product-new">Just added</span>';
}, 5);
add_action('woocommerce_shop_loop_item_title', function () {
    global $product;
    echo '<span class="product-type">' . ($product && $product->is_virtual() ? 'DIGITAL EDITION' : 'STUDIO ESSENTIAL') . '</span>';
}, 5);
add_action('woocommerce_single_product_summary', function () {
    echo '<span class="product-type">THE URUMI COLLECTION</span>';
}, 4);
add_action('woocommerce_single_product_summary', function () {
    echo '<div class="product-assurance"><span>01 &nbsp; A little space for your ideas</span><span>02 &nbsp; Simple guest checkout</span><span>03 &nbsp; Demo order — no payment collected</span></div><p class="illustration-note">Photography is illustrative. This assessment store uses virtual demo products; no physical items are shipped.</p>';
}, 35);
add_filter('woocommerce_add_to_cart_fragments', function ($fragments) {
    $count = WC()->cart ? WC()->cart->get_cart_contents_count() : 0;
    $fragments['span.cart-count'] = '<span class="cart-count">' . esc_html($count) . '</span>';
    return $fragments;
});
remove_action('woocommerce_before_main_content', 'woocommerce_breadcrumb', 20);
add_filter('woocommerce_output_related_products_args', function ($args) { $args['posts_per_page'] = 3; $args['columns'] = 3; return $args; });
function urumi_icon($name) {
    $paths = ['bag' => 'M5 7h14l1 14H4L5 7Z M9 8V6a3 3 0 0 1 6 0v2', 'search' => 'M21 21l-5-5 M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14', 'arrow' => 'M4 12h16 m-6-6 6 6-6 6'];
    return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' . ($paths[$name] ?? $paths['arrow']) . '"/></svg>';
}
