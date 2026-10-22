#!/usr/bin/env bash
set -euo pipefail
cd /var/www/html
for attempt in $(seq 1 120); do
  if [[ -f wp-config.php ]] && php -r 'mysqli_report(MYSQLI_REPORT_OFF); $d=@new mysqli(getenv("WORDPRESS_DB_HOST"),getenv("WORDPRESS_DB_USER"),getenv("WORDPRESS_DB_PASSWORD"),getenv("WORDPRESS_DB_NAME"));exit($d->connect_errno?1:0);' >/dev/null 2>&1; then break; fi
  sleep 2
done
bash /opt/urumi/bootstrap.sh
wp eval-file /opt/urumi/managed-api.php --allow-root
