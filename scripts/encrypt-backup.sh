#!/usr/bin/env bash
# Encrypt an existing private backup directory with an age public recipient.
set -euo pipefail
folder="${1:?Pass the private backup directory}"
recipient_file="${2:?Pass a file containing the age public recipient}"
output="${3:?Pass a new .tar.age output path}"
[[ -d "$folder" && -f "$folder/manifest.json" ]] || { echo 'Not a backup directory'; exit 1; }
[[ ! -e "$output" ]] || { echo 'Output already exists; choose a new path'; exit 1; }
umask 077
tar -czf - -C "$folder" . | age -R "$recipient_file" -o "$output"
echo 'Encrypted backup created. Keep the private identity separate; test decryption before removing plaintext.'
