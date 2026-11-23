"""Upload relay bundle to remote server. Requires: pip install paramiko."""
import io
import json
import os
import stat
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

try:
    import paramiko
except ImportError:
    subprocess.check_call([sys.executable, "-m", "pip", "install", "paramiko", "-q"])
    import paramiko

ROOT = Path(__file__).resolve().parents[2]
DOMAIN = os.environ.get("GROKBOT_DOMAIN", "replay.githun.cn")
HOST = os.environ.get("GROKBOT_SSH_HOST", "101.133.226.127")
USER = os.environ.get("GROKBOT_SSH_USER", "root")
PASSWORD = os.environ.get("GROKBOT_SSH_PASS", "")
REMOTE_DIR = "/opt/grokbot-relay"


def build_local():
    subprocess.check_call(["npm", "run", "build", "-w", "shared/protocol"], cwd=ROOT, shell=True)
    subprocess.check_call(["npm", "run", "build", "-w", "relay"], cwd=ROOT, shell=True)


def make_bundle(tar_path: Path):
    protocol = ROOT / "shared" / "protocol"
    relay = ROOT / "relay"
    prod_pkg = relay / "deploy" / "package.production.json"

    with tarfile.open(tar_path, "w:gz") as tar:
        def add_file(local: Path, arcname: str):
            tar.add(local, arcname=arcname)

        add_file(prod_pkg, "package.json")
        add_file(relay / "deploy" / "remote-setup.sh", "remote-setup.sh")
        for p in (protocol / "dist").rglob("*"):
            if p.is_file():
                tar.add(p, arcname=f"vendor/protocol/dist/{p.relative_to(protocol / 'dist')}")
        add_file(protocol / "package.json", "vendor/protocol/package.json")
        for p in (relay / "dist").rglob("*"):
            if p.is_file():
                tar.add(p, arcname=f"dist/{p.relative_to(relay / 'dist')}")
        add_file(relay / ".env.example", ".env.example")


def ssh_run(client: paramiko.SSHClient, cmd: str, timeout=600):
    print(f"$ {cmd[:120]}...")
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    code = stdout.channel.recv_exit_status()
    if out:
        print(out)
    if err:
        print(err, file=sys.stderr)
    if code != 0:
        raise RuntimeError(f"Command failed ({code}): {cmd}")
    return out


def main():
    if not PASSWORD:
        print("Set GROKBOT_SSH_PASS", file=sys.stderr)
        sys.exit(1)

    build_local()

    with tempfile.NamedTemporaryFile(suffix=".tar.gz", delete=False) as tmp:
        bundle = Path(tmp.name)
    make_bundle(bundle)

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"Connecting {USER}@{HOST}...")
    client.connect(HOST, username=USER, password=PASSWORD, timeout=30)

    sftp = client.open_sftp()
    ssh_run(client, f"mkdir -p {REMOTE_DIR}")
    remote_tar = f"{REMOTE_DIR}/bundle.tar.gz"
    sftp.put(str(bundle), remote_tar)
    sftp.close()
    bundle.unlink(missing_ok=True)

    ssh_run(
        client,
        f"cd {REMOTE_DIR} && tar xzf bundle.tar.gz && rm bundle.tar.gz && sed -i 's/\\r$//' remote-setup.sh && chmod +x remote-setup.sh",
    )
    if "--sync" in sys.argv:
        # 同步 protocol（兼容目录拷贝 / symlink→vendor）、重启 Node，并刷新 Nginx（含 /files 反代）
        ssh_run(
            client,
            f"cd {REMOTE_DIR} && "
            f"if [ -L node_modules/@grokbot/protocol ]; then "
            f"  echo 'protocol via symlink → vendor already updated by tar'; "
            f"elif [ -d node_modules/@grokbot/protocol ]; then "
            f"  cp -rf vendor/protocol/dist/* node_modules/@grokbot/protocol/dist/; "
            f"else "
            f"  mkdir -p node_modules/@grokbot && ln -sfn ../../vendor/protocol node_modules/@grokbot/protocol; "
            f"fi && "
            f"export RELAY_BUILD_ID=\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\" && "
            f"if grep -q '^RELAY_BUILD_ID=' .env 2>/dev/null; then "
            f"  sed -i \"s/^RELAY_BUILD_ID=.*/RELAY_BUILD_ID=$RELAY_BUILD_ID/\" .env; "
            f"else "
            f"  echo \"RELAY_BUILD_ID=$RELAY_BUILD_ID\" >> .env; "
            f"fi && "
            f"bash remote-setup.sh {DOMAIN}",
            timeout=300,
        )
    else:
        ssh_run(client, f"bash {REMOTE_DIR}/remote-setup.sh {DOMAIN}", timeout=900)

    client.close()
    print(f"\nRelay: ws://{DOMAIN}/ws")
    print(f"Health: http://{DOMAIN}/health")


if __name__ == "__main__":
    main()
