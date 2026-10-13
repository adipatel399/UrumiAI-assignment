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

