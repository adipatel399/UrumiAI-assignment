FROM docker.io/library/wordpress:7.1.3-php8.3-apache@sha256:8ecd8d8e374167ea22235acf30f80d1165b82f07ffa5bcef90c1cad8f7be251f
ARG WOOCOMMERCE_VERSION=11.2.1
ARG WP_CLI_VERSION=2.12.0
RUN curl -fsSL "https://github.com/wp-cli/wp-cli/releases/download/v${WP_CLI_VERSION}/wp-cli-${WP_CLI_VERSION}.phar" -o /usr/local/bin/wp \
    && chmod +x /usr/local/bin/wp \
    && curl -fsSL "https://downloads.wordpress.org/plugin/woocommerce.${WOOCOMMERCE_VERSION}.zip" -o /tmp/woocommerce.zip \
    && php -r '$z=new ZipArchive(); $z->open("/tmp/woocommerce.zip"); $z->extractTo("/usr/src/wordpress/wp-content/plugins");' \
    && rm /tmp/woocommerce.zip
COPY healthz.php readyz.php /usr/src/wordpress/
COPY bootstrap.sh bootstrap.php install.php /opt/urumi/

COPY theme /opt/urumi/theme
COPY studio-bootstrap.php /opt/urumi/studio-bootstrap.php
COPY managed-bootstrap.sh managed-api.php /opt/urumi/
