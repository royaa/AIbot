import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { RotateCw, Square, Play } from "lucide-react";
import { api, errorText, fmtTime, fmtUptime, useStore } from "../lib/api.js";
import { RelayPicker } from "../components/RelayPicker.js";
import { Btn, Card, Empty, Pill } from "../components/ui.js";

const CONN: Record<string, { tone: "ok" | "err" | "warn" | "dim"; text: string }> = {
  connected: { tone: "ok", text: "已连接 Relay" },
  connecting: { tone: "warn", text: "连接中" },
  disconnected: { tone: "err", text: "与 Relay 断开" },
  stopped: { tone: "dim", text: "已停止" },
};

export function DashboardPage() {
  const store = useStore();
  const st = store.status;
  const [startError, setStartError] = useState<string | null>(null);

  if (store.ctl !== "attached") {
    return (
      <div className="mx-auto max-w-xl pt-24 text-center">
        <div className="mb-4 text-5xl">🤖</div>
        <div className="mb-2 text-base font-semibold">Agent 未运行</div>
        <p className="mb-6 text-xs leading-5 text-dim">
          Agent 服务未启动或控制通道不可用。
          <br />
          点击下方按钮以独立进程启动（不影响本窗口）。
        </p>
        <Btn
          onClick={() => {
            setStartError(null);
            void api.startAgent().catch((e: unknown) => setStartError(errorText(e)));
          }}
          loading={store.ctl === "connecting"}
        >
          <Play size={13} /> 启动 Agent
        </Btn>
        {startError && (
          <pre className="mx-auto mt-4 max-w-md whitespace-pre-wrap text-left text-[11px] leading-5 text-err">
            {startError}
          </pre>
        )}
      </div>
    );
  }

  const conn = st ? CONN[st.connectionState] ?? { tone: "dim" as const, text: st.connectionState } : undefined;
  const pairing = st?.currentPairing ?? null;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Card title="Relay">
        <RelayPicker />
      </Card>
      {/* 状态卡 */}
      <Card
        title="Agent 状态"
        actions={
          <>
            <Btn variant="ghost" onClick={() => void api.restartAgent()}>
              <RotateCw size={13} /> 重启
            </Btn>
            <Btn variant="danger" onClick={() => void api.stopAgent()}>
              <Square size={13} /> 停止
            </Btn>
          </>
        }
      >
        <div className="grid grid-cols-3 gap-4">
          <Stat label="Relay 连接" value={conn ? <Pill tone={conn.tone}>{conn.text}</Pill> : "-"} />
          <Stat label="运行时长" value={fmtUptime(st?.uptimeMs ?? 0)} />
          <Stat label="版本" value={`v${st?.version ?? "-"}`} />
          <Stat label="Agent ID" value={<span className="font-mono text-[11px] break-all">{st?.agentId?.slice(0, 13) ?? "-"}…</span>} />
          <Stat label="Relay 地址" value={st?.relayUrl ?? "-"} />
          <Stat label="进行中任务" value={String(st?.runningTasks?.length ?? 0)} />
        </div>
        {st?.connectDetail && (
          <div className="mt-3 rounded-md bg-warn/10 px-3 py-1.5 text-[11px] text-warn">
            {st.connectDetail}
          </div>
        )}
      </Card>

      {/* 配对码 */}
      <Card title="手机配对">
        {pairing ? (
          <div className="flex items-center gap-6">
            <div className="rounded-xl bg-white p-3">
              <QRCodeSVG value={pairing.qrPayload} size={148} />
            </div>
            <div className="space-y-2">
              <div className="text-[11px] text-dim">手机 App 扫码，或输入配对码</div>
              <div className="font-mono text-3xl font-bold tracking-[0.3em] text-accent">
                {pairing.pairCode}
              </div>
              <div className="text-[11px] text-dim">
                有效期至 {new Date(pairing.expiresAt).toLocaleTimeString()} · Relay {pairing.relayUrl}
              </div>
            </div>
          </div>
        ) : st?.tokenPresent ? (
          <div className="flex items-center gap-3 text-xs text-dim">
            <Pill tone="ok">已配对</Pill>
            手机已持有 token；重新配对请到「连接与配对」页。
          </div>
        ) : (
          <Empty text="暂无配对信息（Agent 正在连接 Relay…）" />
        )}
      </Card>

      {/* 最近日志 */}
      <Card title="最近日志">
        <div className="max-h-64 overflow-y-auto font-mono text-[11px] leading-5">
          {store.logs.length === 0 ? (
            <Empty text="暂无日志" />
          ) : (
            store.logs.slice(-40).map((l, i) => (
              <div key={i} className="flex gap-2">
                <span className="text-dim/60">{fmtTime(l.ts)}</span>
                <span
                  className={
                    l.level === "error"
                      ? "text-err"
                      : l.level === "warn"
                        ? "text-warn"
                        : "text-dim"
                  }
                >
                  {l.text}
                </span>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[11px] text-dim">{label}</div>
      <div className="text-xs font-medium">{value}</div>
    </div>
  );
}
