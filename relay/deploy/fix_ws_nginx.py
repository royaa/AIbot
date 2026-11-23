"""Restore plain ws:// on port 80 (no HTTP→HTTPS redirect). Requires GROKBOT_SSH_* env."""
import os
import subprocess
import sys
from pathlib import Path

try:
    import paramiko
except ImportError:
    subprocess.check_call([sys.executable, "-m", "pip", "install", "paramiko", "-q"])
    import paramiko

DOMAIN = os.environ.get("GROKBOT_DOMAIN", "replay.githun.cn")
HOST = os.environ.get("GROKBOT_SSH_HOST", "101.133.226.127")
USER = os.environ.get("GROKBOT_SSH_USER", "root")
PASSWORD = os.environ.get("GROKBOT_SSH_PASS", "")
NGINX_CONF = "/etc/nginx/conf.d/grokbot-relay.conf"

NGINX = f"""server {{
    listen 80;
    listen [::]:80;
    server_name {DOMAIN};

    location /health {{
        proxy_pass http://127.0.0.1:8787/health;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }}

    location /ws {{
        proxy_pass http://127.0.0.1:8787/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }}

    location / {{
        return 200 'Grok Bot Relay OK (ws://{DOMAIN}/ws)\\n';
        add_header Content-Type text/plain;
    }}
}}
"""


def main():
    if not PASSWORD:
        print("Set GROKBOT_SSH_PASS", file=sys.stderr)
        sys.exit(1)

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"Connecting {USER}@{HOST}...")
    client.connect(HOST, username=USER, password=PASSWORD, timeout=30)

    sftp = client.open_sftp()
    with sftp.file(NGINX_CONF, "w") as f:
        f.write(NGINX)
    sftp.close()

    for cmd in ("nginx -t", "systemctl reload nginx"):
        print(f"$ {cmd}")
        stdin, stdout, stderr = client.exec_command(cmd, timeout=60)
        out = stdout.read().decode()
        err = stderr.read().decode()
        code = stdout.channel.recv_exit_status()
        if out:
            print(out)
        if err:
            print(err, file=sys.stderr)
        if code != 0:
            sys.exit(code)

    stdin, stdout, stderr = client.exec_command(
        f"curl -sS -o /dev/null -w '%{{http_code}}' http://127.0.0.1/health", timeout=30
    )
    code = stdout.read().decode().strip()
    print(f"http://127.0.0.1/health -> {code}")
    client.close()
    print(f"Done. Use ws://{DOMAIN}/ws")


if __name__ == "__main__":
    main()
