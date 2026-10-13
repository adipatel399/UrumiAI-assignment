<?php
// Liveness checks PHP/HTTP, not the database, to avoid restart storms.
header('Content-Type: text/plain');
echo "ok\n";

