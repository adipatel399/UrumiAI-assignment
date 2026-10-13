<?php
// Readiness checks the database without redirecting to the WordPress installer.
mysqli_report(MYSQLI_REPORT_OFF);
$db = @new mysqli(getenv('WORDPRESS_DB_HOST'), getenv('WORDPRESS_DB_USER'), getenv('WORDPRESS_DB_PASSWORD'), getenv('WORDPRESS_DB_NAME'));
http_response_code($db->connect_errno ? 503 : 200);
header('Content-Type: text/plain');
echo $db->connect_errno ? "database unavailable\n" : "ok\n";

