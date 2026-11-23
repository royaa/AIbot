# DNS（在域名控制台添加）

| 类型 | 主机记录 | 记录值 |
|------|----------|--------|
| A | 你的主机记录 | 你的服务器 IP |

完整域名：`你的域名`

## 连接地址（明文 WebSocket，无证书）

- WebSocket：`ws://你的域名/ws`
- 健康检查：`http://你的域名/health`

## PC Agent 配置

在 `agent/agent.config.json` 或 `agent.config.local.json`：

```json
{
  "relayUrl": "ws://你的域名/ws"
}
```

或环境变量：`RELAY_URL=ws://你的域名/ws`

## Flutter App

配对页 Relay 地址填：`ws://你的域名/ws`

Android 需允许明文流量（本项目已在 `AndroidManifest.xml` 开启 `usesCleartextTraffic`）。

## 服务器路径

- 应用目录：`/opt/grokbot-relay`
- systemd：`grokbot-relay`
- Nginx：`/etc/nginx/conf.d/grokbot-relay.conf`

## 阿里云安全组

入方向放行 **80**（HTTP + WS 走 80 端口）。

## 维护命令（SSH 登录后）

```bash
systemctl status grokbot-relay
journalctl -u grokbot-relay -f
systemctl restart grokbot-relay
# 修改 .env 中 RELAY_PUBLIC_URL 后重启
sed -i 's|RELAY_PUBLIC_URL=.*|RELAY_PUBLIC_URL=ws://你的域名/ws|' /opt/grokbot-relay/.env && systemctl restart grokbot-relay
```

## 重新部署（本机）

```powershell
$env:GROKBOT_SSH_PASS='你的密码'
$env:GROKBOT_DOMAIN='你的域名'
python relay/deploy/upload_deploy.py
```

勿将 SSH 密码写入 Git 仓库。

## 可选：以后启用 HTTPS

见 `finish-ssl.sh` 与 `nginx-relay.conf` 注释；启用后需把客户端改回 `wss://`。
