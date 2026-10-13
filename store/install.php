<?php
define('WP_INSTALLING', true);
$url = getenv('STORE_URL');
$parts = parse_url($url);
$_SERVER['HTTP_HOST'] = $parts['host'] . (isset($parts['port']) ? ':' . $parts['port'] : '');
$_SERVER['REQUEST_URI'] = '/';
if ($parts['scheme'] === 'https') $_SERVER['HTTPS'] = 'on';
require '/var/www/html/wp-load.php';
require_once ABSPATH . 'wp-admin/includes/upgrade.php';
if (!is_blog_installed()) {
    wp_install('Urumi Demo Store', getenv('WP_ADMIN_USER'), getenv('WP_ADMIN_EMAIL'),
               true, '', getenv('WP_ADMIN_PASSWORD'));
    update_option('home', $url);
    update_option('siteurl', $url);
    echo "WordPress installed.\n";
}
