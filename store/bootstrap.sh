#!/usr/bin/env bash
set -euo pipefail
cd /var/www/html
if ! wp core is-installed --allow-root >/dev/null 2>&1; then
  # WP-CLI's interactive prompt echoes secrets; install via PHP without printing them.
  php /opt/urumi/install.php
fi
wp plugin activate woocommerce --allow-root
wp rewrite structure '/%postname%/' --hard --allow-root
wp eval-file /opt/urumi/bootstrap.php --allow-root


# Keep the versioned theme in the image, then install it into persistent content.
mkdir -p /var/www/html/wp-content/themes/urumi-studio
cp -R /opt/urumi/theme/. /var/www/html/wp-content/themes/urumi-studio/
chown -R www-data:www-data /var/www/html/wp-content/themes/urumi-studio
wp theme activate urumi-studio --allow-root
wp eval-file /opt/urumi/studio-bootstrap.php --allow-root
