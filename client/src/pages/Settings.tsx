import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import type { AgentConfigDto } from "@grokbot/protocol";
import { request, useStore } from "../lib/api.js";
import { Btn, Card, Empty, Field, Input, Switch } from "../components/ui.js";

export function SettingsPage() {
  const store = useStore();
  const [cfg, setCfg] = useState<AgentConfigDto | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (store.ctl === "attached") {
      setMsg("");
      setErr("");
      void request<AgentConfigDto>("config.get")
        .then(setCfg)
        .catch((e: Error) => setErr(e.message));
    }
  }, [store.ctl]);

  const patch = (p: Partial<AgentConfigDto>) =>
    setCfg((prev) => (prev ? { ...prev, ...p } : prev));

  const save = async () => {
    if (!cfg) return;
    setSaving(true);
    setMsg("");
    setErr("");
    try {
      await request("config.set", {
        autoApprove: cfg.autoApprove,
        session: cfg.session ?? {},
        fileOffer: cfg.fileOffer ?? {},
        skills: cfg.skills ?? {},
        mcp: cfg.mcp ?? {},
      });
      setMsg("已保存并热生效");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (store.ctl !== "attached") return <Empty text="Agent 未连接（先在总览页启动 Agent）" />;
  if (!cfg) return <Empty text="读取中…" />;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Card title="安全">
        <Switch
          checked={cfg.autoApprove !== false}
          onChange={(v) => patch({ autoApprove: v })}
          label="自动同意危险操作（autoApprove）"
          hint="关闭后，危险操作会推到手机二次确认（120 秒超时未确认即取消）"
        />
      </Card>

      <Card title="会话上下文（长任务自动压缩）">
        <div className="grid grid-cols-3 gap-3">
          <Field label="上下文上限（字符）">
            <Input
              type="number"
              value={cfg.session?.maxContextChars ?? 12000}
              onChange={(e) => patch({ session: { ...cfg.session, maxContextChars: Number(e.target.value) } })}
            />
          </Field>
          <Field label="保留最近轮数">
            <Input
              type="number"
              value={cfg.session?.keepRecentTurns ?? 6}
              onChange={(e) => patch({ session: { ...cfg.session, keepRecentTurns: Number(e.target.value) } })}
            />
          </Field>
          <Field label="摘要工具">
            <Input
              value={cfg.session?.summarizeTool ?? "claude"}
              onChange={(e) => patch({ session: { ...cfg.session, summarizeTool: e.target.value } })}
            />
          </Field>
        </div>
      </Card>

      <Card title="文件推送（任务产物自动发到手机）">
        <Switch
          checked={cfg.fileOffer?.enabled !== false}
          onChange={(v) => patch({ fileOffer: { ...cfg.fileOffer, enabled: v } })}
          label="任务成功后自动扫描推送新产物"
        />
        <div className="mt-3 grid grid-cols-3 gap-3">
          <Field label="匹配模式（逗号分隔）">
            <Input
              value={(cfg.fileOffer?.patterns ?? ["**/*.apk"]).join(", ")}
              onChange={(e) =>
                patch({
                  fileOffer: {
                    ...cfg.fileOffer,
                    patterns: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                  },
                })
              }
            />
          </Field>
          <Field label="单次最多文件数">
            <Input
              type="number"
              value={cfg.fileOffer?.maxFiles ?? 3}
              onChange={(e) => patch({ fileOffer: { ...cfg.fileOffer, maxFiles: Number(e.target.value) } })}
            />
          </Field>
          <Field label="单文件上限 MB">
            <Input
              type="number"
              value={cfg.fileOffer?.maxFileMb ?? 500}
              onChange={(e) => patch({ fileOffer: { ...cfg.fileOffer, maxFileMb: Number(e.target.value) } })}
            />
          </Field>
        </div>
      </Card>

      <Card title="技能注入（跨 CLI 公共技能）">
        <Switch
          checked={cfg.skills?.enabled !== false}
          onChange={(v) => patch({ skills: { ...cfg.skills, enabled: v } })}
          label="启用 agent/skills 下的公共技能"
        />
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Field label="仅加载（留空=全部）">
            <Input
              value={(cfg.skills?.include ?? []).join(", ")}
              onChange={(e) =>
                patch({ skills: { ...cfg.skills, include: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) } })
              }
            />
          </Field>
          <Field label="始终跳过">
            <Input
              value={(cfg.skills?.exclude ?? []).join(", ")}
              onChange={(e) =>
                patch({ skills: { ...cfg.skills, exclude: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) } })
              }
            />
          </Field>
        </div>
      </Card>

      <Card title="公共 MCP">
        <Switch
          checked={cfg.mcp?.autoSync !== false}
          onChange={(v) => patch({ mcp: { ...cfg.mcp, autoSync: v } })}
          label="启动时自动投影到本机 CLI"
          hint="mcp.catalog.json → ~/.cursor / ~/.claude / ~/.codex"
        />
        <Switch
          checked={cfg.mcp?.injectClaude !== false}
          onChange={(v) => patch({ mcp: { ...cfg.mcp, injectClaude: v } })}
          label="Claude 任务带 --mcp-config"
          hint="当次会话立即生效，不等 CLI 重启"
        />
      </Card>

      <div className="sticky bottom-0 -mx-6 flex items-center gap-3 border-t border-line bg-bg/90 px-6 py-3 backdrop-blur">
        <Btn onClick={() => void save()} loading={saving}>
          <RotateCcw size={13} /> 保存全部设置
        </Btn>
        {msg && <span className="text-[11px] text-ok">{msg}</span>}
        {err && <span className="text-[11px] text-err">{err}</span>}
      </div>
    </div>
  );
}
