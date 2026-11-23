#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${1:-replay.githun.cn}"
APP_DIR="/opt/grokbot-relay"
NODE_MAJOR=20

install_base() {
  if command -v dnf >/dev/null 2>&1; then
    dnf install -y curl ca-certificates gnupg2 nginx openssl gcc-c++ make python3
    dnf install -y certbot python3-certbot-nginx || dnf install -y epel-release && dnf install -y certbot python3-certbot-nginx
  elif command -v yum >/dev/null 2>&1; then
    yum install -y curl ca-certificates gnupg2 nginx openssl
    yum install -y certbot python3-certbot-nginx || yum install -y epel-release && yum install -y certbot python3-certbot-nginx
  elif command -v apt-get >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq curl ca-certificates gnupg nginx certbot python3-certbot-nginx openssl
  else
    echo "Unsupported OS: no dnf/yum/apt-get"
    exit 1
  fi
}

install_node() {
  if command -v node >/dev/null 2>&1; then
    return
  fi
  curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  if command -v dnf >/dev/null 2>&1; then
    dnf install -y nodejs
  else
    yum install -y nodejs
  fi
}

install_base
install_node

mkdir -p "$APP_DIR/data"
cd "$APP_DIR"

if [ ! -f package.json ]; then
  echo "ERROR: $APP_DIR/package.json missing"
  exit 1
fi

npm install --omit=dev
npm rebuild better-sqlite3 2>/dev/null || npm install better-sqlite3 --build-from-source || true

if [ ! -f dist/index.js ]; then
  echo "ERROR: dist/index.js missing"
  exit 1
fi

if [ ! -f .env ]; then
  JWT=$(openssl rand -hex 32)
  cat > .env <<EOF
PORT=8787
HOST=127.0.0.1
JWT_SECRET=${JWT}
RELAY_PUBLIC_URL=ws://${DOMAIN}/ws
EOF
  chmod 600 .env
fi

cat > /etc/systemd/system/grokbot-relay.service <<'UNIT'
[Unit]
Description=Grok Bot Relay
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/grokbot-relay
EnvironmentFile=/opt/grokbot-relay/.env
ExecStart=/usr/bin/node /opt/grokbot-relay/dist/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable grokbot-relay
systemctl restart grokbot-relay

# ── 看门狗：进程 hang（活着但不响应）时 systemd Restart 救不了，用 health 探活自动重启 ──
# 连续 3 次失败才动手（状态文件计数），恢复成功即清零；日志在 /var/log/grokbot-watchdog.log
cat > /usr/local/bin/grokbot-relay-watchdog.sh <<'WD'
#!/bin/bash
STATE=/run/grokbot-watchdog.fail
if curl -fsS -m 5 http://127.0.0.1:8787/health >/dev/null 2>&1; then
  [ -f "$STATE" ] && rm -f "$STATE"
  exit 0
fi
N=$(( $(cat "$STATE" 2>/dev/null || echo 0) + 1 ))
echo "$(date '+%F %T') health 失败（连续 $N 次）" >> /var/log/grokbot-watchdog.log
if [ "$N" -ge 3 ]; then
  echo "$(date '+%F %T') 连续 ${N} 次失败，重启 grokbot-relay" >> /var/log/grokbot-watchdog.log
  rm -f "$STATE"
  systemctl restart grokbot-relay
else
  echo "$N" > "$STATE"
fi
WD
chmod +x /usr/local/bin/grokbot-relay-watchdog.sh
cat > /etc/cron.d/grokbot-relay-watchdog <<'CRON'
* * * * * root /usr/local/bin/grokbot-relay-watchdog.sh
CRON
chmod 644 /etc/cron.d/grokbot-relay-watchdog

NGINX_CONF="/etc/nginx/conf.d/grokbot-relay.conf"
if [ -d /etc/nginx/sites-available ]; then
  NGINX_CONF="/etc/nginx/sites-available/grokbot-relay"
fi

cat > "$NGINX_CONF" <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    location /health {
        proxy_pass http://127.0.0.1:8787/health;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
    }

    location /ws {
        proxy_pass http://127.0.0.1:8787/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    # 大文件上传/下载（Agent POST /files/upload，手机 GET /files/:id）
    location /files/ {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Authorization \$http_authorization;
        proxy_request_buffering off;
        proxy_buffering off;
        client_max_body_size 512m;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    location / {
        return 200 'Grok Bot Relay OK\n';
        add_header Content-Type text/plain;
    }
}
NGINX

if [ -d /etc/nginx/sites-enabled ]; then
  ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/grokbot-relay
  rm -f /etc/nginx/sites-enabled/default
fi

nginx -t
systemctl enable nginx
systemctl restart nginx

if command -v firewall-cmd >/dev/null 2>&1; then
  firewall-cmd --permanent --add-service=http || true
  firewall-cmd --permanent --add-service=https || true
  firewall-cmd --reload || true
fi

# 默认 ws:// 明文：不跑 Certbot，避免 HTTP 301 导致 WebSocket 握手失败。
# 若需 HTTPS，部署前设置 GROKBOT_ENABLE_TLS=1 并改用 wss://。
if [ "${GROKBOT_ENABLE_TLS:-0}" = "1" ]; then
  if certbot certificates 2>/dev/null | grep -q "${DOMAIN}"; then
    certbot renew --dry-run || true
  else
    certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos --register-unsafely-without-email || true
  fi
fi

echo "=== deploy done ==="
systemctl is-active grokbot-relay
curl -sS http://127.0.0.1:8787/health || true
