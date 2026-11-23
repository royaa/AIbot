import { useCallback, useEffect, useRef, useState } from "react";
import { Download, RefreshCw, Save, Search, Trash2 } from "lucide-react";
import type { CliInstallStartAck, CliInstallTarget, CliProbeItem } from "@grokbot/protocol";
import { beginInstall, clearInstall, request, useStore } from "../lib/api.js";
import { Btn, Card, Empty, Pill } from "../components/ui.js";

/** 允许从这里删掉本机安装的 CLI。浏览器 / IDE 不在此列 */
const DELETABLE = new Set([
  "claude",
  "agent",
  "codex",
  "opencode",
  "pi",
  "droid",
  "crush",
  "grok",
  "dsh",
]);

/** probe id → cli.install target（无安装器的工具不显示安装按钮） */
const INSTALL_TARGET: Record<string, CliInstallTarget> = {
  claude: "claude",
  agent: "cursorAgent",
  codex: "codex",
  workbuddy: "workbuddy",
  opencode: "opencode",
  pi: "pi",
  droid: "droid",
  crush: "crush",
};

export function CliManagePage() {
  const store = useStore();
  const [items, setItems] = useState<CliProbeItem[] | null>(null);
  const [paths, setPaths] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CliProbeItem | null>(null);
  const [err, setErr] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);

  const probe = useCallback(async (ids?: string[]) => {
    try {
      const r = await request<{ items: CliProbeItem[] }>("cli.probe", ids ? { ids } : undefined);
      setItems((prev) => {
        if (!ids || !prev) return r.items;
        // 局部刷新合并
        const map = new Map(prev.map((p) => [p.id, p]));
        for (const it of r.items) map.set(it.id, it);
        return [...map.values()];
      });
      setPaths((p) => {
        const next = { ...p };
        for (const it of r.items) if (next[it.id] === undefined) next[it.id] = it.configured;
        return next;
      });
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (store.ctl === "attached") void probe();
  }, [store.ctl, probe]);

  useEffect(() => {
    panelRef.current?.scrollTo({ top: panelRef.current.scrollHeight });
  }, [store.installLines]);

  const savePath = async (it: CliProbeItem) => {
    setBusyId(it.id);
    setErr("");
    try {
      await request("config.set", { tools: { [it.cfgKey]: paths[it.id] ?? "" } });
      await probe([it.id]);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const install = async (it: CliProbeItem, update = false) => {
    const target = INSTALL_TARGET[it.id];
    if (!target) return;
    beginInstall(target);
    setErr("");
    try {
      await request<CliInstallStartAck>("cli.install", { target, update });
      // 输出经 install.output 事件流式进入 store.installLines；完成事件自动停止
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const remove = async (it: CliProbeItem) => {
    setBusyId(it.id);
    setErr("");
    try {
      await request("cli.uninstall", { id: it.id });
      setPendingDelete(null);
      await probe([it.id]);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Card
        title="本机 CLI 工具"
        actions={
          <Btn variant="ghost" onClick={() => void probe()} loading={busyId === "__probe__"}>
            <Search size={13} /> 重新探测
          </Btn>
        }
      >
        {err && <div className="mb-3 rounded-md bg-err/10 px-3 py-1.5 text-[11px] text-err">{err}</div>}
        {items === null ? (
          <Empty text={store.ctl === "attached" ? "探测中…" : "Agent 未连接"} />
        ) : (
          <div className="space-y-2.5">
            {items.map((it) => {
              const installable = Boolean(INSTALL_TARGET[it.id]);
              const ready = it.installed && !it.probeError;
              const target = INSTALL_TARGET[it.id];
              return (
                <div
                  key={it.id}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-panel2/60 px-3.5 py-2.5"
                >
                  <div className="w-32 shrink-0">
                    <div className="text-xs font-semibold">{it.label}</div>
                    <div className="text-[10px] text-dim">{it.version ?? (it.installed ? "" : "未装")}</div>
                  </div>
                  <Pill tone={it.installed && !it.probeError ? "ok" : it.configured ? "err" : "dim"}>
                    {it.installed && !it.probeError ? "就绪" : it.configured ? "异常" : "未安装"}
                  </Pill>
                  <input
                    value={paths[it.id] ?? ""}
                    onChange={(e) => setPaths({ ...paths, [it.id]: e.target.value })}
                    placeholder="路径或 PATH 中的命令名"
                    className="min-w-56 flex-1 rounded-md border border-line bg-panel px-2.5 py-1.5 font-mono text-[11px] outline-none focus:border-accent/60"
                  />
                  <Btn variant="ghost" onClick={() => void savePath(it)} loading={busyId === it.id} title="保存路径到 agent 配置">
                    <Save size={12} />
                  </Btn>
                  {installable && !ready && (
                    <Btn
                      onClick={() => void install(it, false)}
                      disabled={store.installBusy !== null}
                      loading={store.installBusy !== null && store.installBusy === target}
                    >
                      <Download size={12} /> 安装
                    </Btn>
                  )}
                  {installable && ready && (
                    <Btn
                      variant="ghost"
                      onClick={() => void install(it, true)}
                      disabled={store.installBusy !== null}
                      loading={store.installBusy !== null && store.installBusy === target}
                    >
                      <RefreshCw size={12} /> 更新
                    </Btn>
                  )}
                  {ready && DELETABLE.has(it.id) && (
                    <Btn variant="danger" onClick={() => setPendingDelete(it)}>
                      <Trash2 size={12} /> 删除
                    </Btn>
                  )}
                  {(it.probeError || it.loginHint) && (
                    <div className="w-full text-[10px] leading-4 text-dim">
                      {it.probeError && <span className="text-err">{it.probeError}。</span>}
                      {it.loginHint}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {pendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="w-[440px] rounded-2xl border border-err/40 bg-panel p-6 shadow-2xl">
            <div className="text-sm font-semibold text-err">删除本机安装</div>
            <p className="mt-3 text-xs leading-5 text-fg">
              将删除电脑上已安装的 {pendingDelete.label}，不是只取消配置。
              程序文件会被卸掉，Agent 里的路径也会清掉。此操作不能撤销。
            </p>
            <p className="mt-2 break-all font-mono text-[11px] text-dim">
              {pendingDelete.resolved || pendingDelete.configured || "（路径未知）"}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Btn variant="ghost" onClick={() => setPendingDelete(null)}>
                取消
              </Btn>
              <Btn variant="danger" loading={busyId === pendingDelete.id} onClick={() => void remove(pendingDelete)}>
                确认删除本地安装
              </Btn>
            </div>
          </div>
        </div>
      )}

      {/* 安装输出面板 */}
      {(store.installBusy !== null || store.installLines.length > 0) && (
        <Card
          title={`安装 / 更新输出${store.installBusy ? ` — ${store.installBusy} 进行中` : ""}`}
          actions={
            store.installBusy === null ? (
              <Btn variant="ghost" onClick={clearInstall}>
                清空
              </Btn>
            ) : undefined
          }
        >
          <div ref={panelRef} className="max-h-72 overflow-y-auto rounded-lg bg-bg p-3 font-mono text-[11px] leading-5">
            {store.installLines.map((l, i) => (
              <div key={i} className={l.startsWith("——") ? "mt-1 text-accent" : "text-dim"}>
                {l}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
