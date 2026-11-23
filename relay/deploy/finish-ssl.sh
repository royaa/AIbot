#!/usr/bin/env bash
set -euo pipefail
DOMAIN="${1:-}"
if [[ -z "$DOMAIN" ]]; then
  echo "usage: finish-ssl.sh <domain>" >&2
  exit 1
fi
certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos --register-unsafely-without-email --redirect
systemctl reload nginx
echo "HTTPS ready: wss://${DOMAIN}/ws"
