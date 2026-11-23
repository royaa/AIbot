"""只读诊断：grokbot-relay 挂死原因排查（不改动远端任何状态）。用法同 upload_deploy：需 GROKBOT_SSH_PASS。"""
import os
import sys
import subprocess

try:
    import paramiko
except ImportError:
    subprocess.check_call([sys.executable, "-m", "pip", "install", "paramiko", "-q"])
    import paramiko

HOST = os.environ.get("GROKBOT_SSH_HOST", "101.133.226.127")
USER = os.environ.get("GROKBOT_SSH_USER", "root")
PASSWORD = os.environ.get("GROKBOT_SSH_PASS", "")

if not PASSWORD:
    print("Set GROKBOT_SSH_PASS", file=sys.stderr)
    sys.exit(1)

CMDS = [
    ("服务状态", "systemctl status grokbot-relay --no-pager -l | head -25"),
    ("进程详情", "ps aux | grep -E 'node.*(relay|index)' | grep -v grep"),
    ("内存", "free -m"),
    ("负载", "uptime"),
    ("系统日志(oom/异常)", "journalctl -u grokbot-relay --no-pager -n 60 --output=short-iso"),
    ("内核OOM", "journalctl -k --no-pager -n 200 | grep -iE 'oom|killed process' | tail -10"),
    ("node连接数", "ss -tnp | grep node | head -15; ss -tn state established | grep -c ."),
    ("nginx错误日志尾部", "tail -15 /var/log/nginx/error.log 2>/dev/null"),
    ("磁盘", "df -h / | tail -1"),
    ("文件句柄", "pid=$(systemctl show -p MainPID --value grokbot-relay); echo MainPID=$pid; ls /proc/$pid/fd 2>/dev/null | wc -l; cat /proc/$pid/limits 2>/dev/null | grep 'open files'"),
]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASSWORD, timeout=15)

for title, cmd in CMDS:
    print(f"\n===== {title} =====")
    try:
        _, stdout, stderr = client.exec_command(cmd, timeout=30)
        out = stdout.read().decode("utf-8", "replace").strip()
        err = stderr.read().decode("utf-8", "replace").strip()
        if out:
            print(out)
        if err:
            print("[stderr]", err[:500])
    except Exception as e:
        print(f"[失败] {e}")

client.close()
print("\n===== 诊断结束（未做任何改动）=====")
