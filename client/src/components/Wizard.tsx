import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { CheckCircle2, Download, Play, X } from "lucide-react";
import type { CliInstallStartAck, CliProbeItem } from "@grokbot/protocol";
import { api, beginInstall, errorText, request, useStore } from "../lib/api.js";
import { Btn, Input, Pill, SecretInput } from "./ui.js";

const WIZARD_FLAG = "grokbot:wizardDone";

const INSTALLABLE: { id: string; target: string; label: string }[] = [
  { id: "claude", target: "claude", label: "Claude Code" },
  { id: "agent", target: "cursorAgent", label: "Cursor Agent" },
  { id: "codex", target: "codex", label: "Codex" },
  { id: "opencode", target: "opencode", label: "OpenCode" },
  { id: "pi", target: "pi", label: "Pi Coding Agent" },
  { id: "droid", target: "droid", label: "Droid" },
  { id: "crush", target: "crush", label: "Crush" },
];

export function shouldShowWizard(): boolean {
  try {
    return !localStorage.getItem(WIZARD_FLAG);
  } catch {
    return false;
  }
}

export function Wizard({ onClose }: { onClose: () => void }) {
  const store = useStore();
  const [step, setStep] = useState(0);
  const [probes, setProbes] = useState<Record<string, CliProbeItem>>({});
  const [glmKey, setGlmKey] = useState("");
  const [keySaved, setKeySaved] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  useEffect(() => {
    if (step === 1 && store.ctl === "attached") {
      void request<{ items: CliProbeItem[] }>("cli.probe")
        .then((r) => setProbes(Object.fromEntries(r.items.map((i) => [i.id, i]))))
        .catch(() => {});
    }
  }, [step, store.ctl]);

  const finish = () => {
    try {
      localStorage.setItem(WIZARD_FLAG, "1");
    } catch {
      /* 无 localStorage 也不影响 */
    }
    onClose();
  };

  const install = async (id: string, target: string) => {
    setInstalling(target);
    beginInstall(target);
    try {
      await request<CliInstallStartAck>("cli.install", { target });
      // 完成/输出经事件进入 store；install.done 后 installBusy 清空
    } catch {
      /* 错误在安装面板可见 */
    } finally {
      setInstalling(null);
    }
  };

  const pairing = store.status?.currentPairing ?? null;
  const steps = ["启动 Agent", "安装 CLI", "配置 API", "配对手机"];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="flex max-h-[86vh] w-[560px] flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl">
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <div>
            <div className="text-sm font-semibold">欢迎使用 AI Bot</div>
            <div className="text-[11px] text-dim">四步完成：{steps.join(" → ")}</div>
          </div>
          <button onClick={finish} className="rounded p-1 text-dim hover:bg-panel2 hover:text-fg" title="跳过向导">
            <X size={16} />
          </button>
        </div>

        {/* 步骤条 */}
        <div className="flex gap-1.5 px-6 pt-4">
          {steps.map((s, i) => (
            <div key={s} className="flex-1">
              <div className={`h-1 rounded-full ${i <= step ? "bg-accent" : "bg-line"}`} />
              <div className={`mt-1.5 text-[10px] ${i === step ? "text-accent" : "text-dim"}`}>
                {i + 1}. {s}
              </div>
            </div>
          ))}
        </div>

        {/* 内容 */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {step === 0 && (
            <div className="space-y-4 text-center">
              <div className="pt-4 text-4xl">🚀</div>
              <p className="text-xs leading-5 text-dim">
                客户端只是管理面，真正干活的是 Agent 服务进程。
                <br />
                点击下方按钮以独立进程启动（之后开机自启也可在 Agent 侧配置）。
              </p>
              {store.ctl === "attached" ? (
                <Pill tone="ok">
                  <CheckCircle2 size={12} /> Agent 已运行
                </Pill>
              ) : (
                <div className="space-y-3">
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
                    <pre className="whitespace-pre-wrap text-left text-[11px] leading-5 text-err">{startError}</pre>
                  )}
                  <p className="text-[11px] text-dim">启动成功后才能下一步。右上角关闭可跳过向导。</p>
                </div>
              )}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-2">
              <p className="mb-2 text-[11px] text-dim">选择需要的 CLI 安装（输出在「CLI 管理」页可见，可全部跳过）：</p>
              {INSTALLABLE.map((t) => {
                const p = probes[t.id];
                const ready = p?.installed && !p.probeError;
                return (
                  <div key={t.id} className="flex items-center justify-between rounded-lg border border-line bg-panel2/60 px-3 py-2">
                    <div className="flex items-center gap-2 text-xs">
                      {t.label}
                      {ready ? (
                        <Pill tone="ok">就绪{p.version ? ` · ${p.version.split(" ")[0]}` : ""}</Pill>
                      ) : (
                        <Pill tone="dim">未装</Pill>
                      )}
                    </div>
                    <Btn
                      variant="ghost"
                      disabled={ready || store.installBusy !== null}
                      loading={store.installBusy === t.target}
                      onClick={() => void install(t.id, t.target)}
                    >
                      <Download size={12} /> 安装
                    </Btn>
                  </div>
                );
              })}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <p className="text-[11px] leading-5 text-dim">
                各 CLI 用智谱 GLM Coding Plan 的 API Key（
                <span className="text-fg">bigmodel.cn</span> → 个人编程套餐 → 新建）。
                这里先把 Key 配给 Grok CLI；其余工具稍后在「CLI 配置」页逐个填写。
              </p>
              <SecretInput value={glmKey} onChange={(e) => setGlmKey(e.target.value)} placeholder="粘贴 GLM API Key" />
              <div className="flex items-center gap-3">
                <Btn
                  disabled={!glmKey.trim()}
                  loading={false}
                  onClick={() =>
                    void request("cli.config.set", { cli: "grok", apiKey: glmKey.trim() })
                      .then(() => setKeySaved(true))
                      .catch(() => setKeySaved(false))
                  }
                >
                  保存到 Grok CLI
                </Btn>
                {keySaved && <span className="text-[11px] text-ok">✓ 已保存（可下一步）</span>}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4 text-center">
              {pairing ? (
                <>
                  <div className="inline-block rounded-xl bg-white p-3">
                    <QRCodeSVG value={pairing.qrPayload} size={160} />
                  </div>
                  <div className="font-mono text-2xl font-bold tracking-[0.3em] text-accent">{pairing.pairCode}</div>
                  <div className="text-[11px] text-dim">手机 App 扫码或输入配对码</div>
                </>
              ) : (
                <>
                  <p className="text-xs leading-5 text-dim">
                    {store.status?.tokenPresent
                      ? "手机已配对过。需要配对新手机时点下方按钮发布配对码。"
                      : "点击按钮发布配对码（Agent 需已连接 Relay）。"}
                  </p>
                  <Btn
                    variant="ghost"
                    onClick={() =>
                      void request("pair.restart").catch(() => {})
                    }
                  >
                    发布配对码
                  </Btn>
                </>
              )}
            </div>
          )}
        </div>

        {/* 底部 */}
        <div className="flex items-center justify-between border-t border-line px-6 py-3.5">
          <Btn variant="ghost" disabled={step === 0} onClick={() => setStep(step - 1)}>
            上一步
          </Btn>
          {step < 3 ? (
            <Btn
              disabled={step === 0 && store.ctl !== "attached"}
              onClick={() => setStep(step + 1)}
            >
              下一步
            </Btn>
          ) : (
            <Btn onClick={finish}>
              <CheckCircle2 size={13} /> 完成
            </Btn>
          )}
        </div>
      </div>
    </div>
  );
}
