# DNS（在域名控制台添加）

| 类型 | 主机记录 | 记录值 |
|------|----------|--------|
| A | replay | 101.133.226.127 |

完整域名：`replay.githun.cn`

## 连接地址（明文 WebSocket，无证书）

- WebSocket：`ws://replay.githun.cn/ws`
- 健康检查：`http://replay.githun.cn/health`

## PC Agent 配置

在 `agent/agent.config.json` 或 `agent.config.local.json`：

```json
{
  "relayUrl": "ws://replay.githun.cn/ws"
}
```

或环境变量：`RELAY_URL=ws://replay.githun.cn/ws`

## Flutter App

配对页 Relay 地址填：`ws://replay.githun.cn/ws`

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
sed -i 's|RELAY_PUBLIC_URL=.*|RELAY_PUBLIC_URL=ws://replay.githun.cn/ws|' /opt/grokbot-relay/.env && systemctl restart grokbot-relay
```

## 重新部署（本机）

```powershell
$env:GROKBOT_SSH_PASS='你的密码'
$env:GROKBOT_DOMAIN='replay.githun.cn'
python relay/deploy/upload_deploy.py
```

勿将 SSH 密码写入 Git 仓库。

## 可选：以后启用 HTTPS

见 `finish-ssl.sh` 与 `nginx-replay.githun.cn.conf` 注释；启用后需把客户端改回 `wss://`。
