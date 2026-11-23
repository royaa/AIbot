import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { RefreshCw } from "lucide-react";
import type { AgentConfigDto } from "@grokbot/protocol";
import { request, useStore } from "../lib/api.js";
import { RelayPicker } from "../components/RelayPicker.js";
import { Btn, Card, Empty, ErrorText, Pill } from "../components/ui.js";

export function PairingPage() {
  const store = useStore();
  const [tokenPresent, setTokenPresent] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    void request<AgentConfigDto>("config.get")
      .then((c) => {
        setTokenPresent(Boolean(c.tokenPresent));
      })
      .catch((e: Error) => setMsg(e.message));
  }, [store.ctl]);

  const repair = async () => {
    setRepairing(true);
    setMsg("");
    try {
      await request("pair.restart");
      setMsg("已切换配对模式，重连后总览页会出现新二维码");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setRepairing(false);
    }
  };

  const pairing = store.status?.currentPairing ?? null;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Card title="Relay 连接">
        <div className="space-y-4">
          <RelayPicker />
          <div className="flex items-center gap-3 text-xs text-dim">
            配对 token：
            {tokenPresent ? <Pill tone="ok">已配置</Pill> : <Pill tone="warn">未配置</Pill>}
            <span>「重新配对」会发布新配对码，旧手机可继续使用直到 token 被替换</span>
          </div>
          <ErrorText>{msg}</ErrorText>
        </div>
      </Card>

      <Card
        title="扫码配对"
        actions={
          <Btn variant="ghost" onClick={() => void repair()} loading={repairing}>
            <RefreshCw size={13} /> 重新配对
          </Btn>
        }
      >
        {pairing ? (
          <div className="flex items-center gap-6">
            <div className="rounded-xl bg-white p-3">
              <QRCodeSVG value={pairing.qrPayload} size={150} />
            </div>
            <div className="space-y-2">
              <div className="font-mono text-3xl font-bold tracking-[0.3em] text-accent">
                {pairing.pairCode}
              </div>
              <div className="text-[11px] text-dim">手机 App → 设置 → 扫码 / 输入配对码</div>
              <div className="text-[11px] text-dim">有效期至 {new Date(pairing.expiresAt).toLocaleTimeString()}</div>
            </div>
          </div>
        ) : (
          <Empty text="当前无配对码。点击「重新配对」发布新码；无 token 的 Agent 连上 Relay 后也会自动发布。" />
        )}
      </Card>
    </div>
  );
}
