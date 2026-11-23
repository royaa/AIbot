#!/usr/bin/env bash
set -euo pipefail
DOMAIN="${1:-replay.githun.cn}"
certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos --register-unsafely-without-email --redirect
systemctl reload nginx
echo "HTTPS ready: wss://${DOMAIN}/ws"
