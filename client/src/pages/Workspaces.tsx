import { useEffect, useState } from "react";
import { CheckCircle2, FolderPlus, Save, Search, Trash2, XCircle } from "lucide-react";
import type { AgentConfigDto, WorkspaceDto, WorkspacesProbeResult } from "@grokbot/protocol";
import { request, useStore } from "../lib/api.js";
import { Btn, Card, Empty, ErrorText, HelpTip } from "../components/ui.js";

type Row = WorkspaceDto & { problem?: string; ok?: boolean };

export function WorkspacesPage() {
  const store = useStore();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [probing, setProbing] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const load = async () => {
    try {
      const cfg = await request<AgentConfigDto>("config.get");
      setRows(cfg.workspaces.map((w) => ({ ...w })));
      await probe(false);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const probe = async (standalone = true) => {
    if (standalone) setProbing(true);
    try {
      const r = await request<WorkspacesProbeResult>("workspaces.probe");
      setRows((prev) => {
        if (!prev) return prev;
        const byId = new Map(r.items.map((i) => [i.id, i]));
        return prev.map((row) => {
          const p = byId.get(row.id);
          return p ? { ...row, ok: p.exists && p.isDirectory, problem: p.problem } : row;
        });
      });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      if (standalone) setProbing(false);
    }
  };

  useEffect(() => {
    if (store.ctl === "attached") void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.ctl]);

  const save = async () => {
    if (!rows) return;
    setSaving(true);
    setMsg("");
    setErr("");
    try {
      const cleaned = rows.map(({ id, name, path }) => ({ id: id.trim(), name: name.trim(), path: path.trim() }));
      await request("config.set", { workspaces: cleaned });
      setMsg("已保存并热生效（无需重启 Agent）；手机端工作区列表将在下次状态上报后刷新");
      setRows(cleaned.map((w, i) => ({ ...w, ok: rows[i].ok, problem: rows[i].problem })));
      await probe(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const update = (i: number, patch: Partial<Row>) =>
    setRows((prev) => prev!.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  return (
    <div className="mx-auto max-w-4xl">
      <Card
        title={
          <span className="inline-flex items-center gap-1">
            工作空间（手机可下发的项目目录白名单）
            <HelpTip label="工作空间是什么">
              <div className="mb-1 text-xs font-medium text-fg">工作空间是什么</div>
              <p>工作空间是这台电脑上允许手机下发任务的项目目录白名单。</p>
              <ul className="mt-2 list-disc space-y-1 pl-4">
                <li>每一行是一个项目。ID 用来识别，名称显示在手机上，路径必须是本机绝对路径。</li>
                <li>手机只能在这些目录里跑命令、改文件。白名单以外的路径会被拒绝。</li>
                <li>保存后立即生效，不用重启 Agent。点「探测路径」可以检查目录是否存在。</li>
              </ul>
            </HelpTip>
          </span>
        }
        actions={
          <>
            <Btn
              variant="ghost"
              onClick={() => setRows((prev) => [...(prev ?? []), { id: "", name: "", path: "" }])}
            >
              <FolderPlus size={13} /> 新增
            </Btn>
            <Btn variant="ghost" onClick={() => void probe()} loading={probing}>
              <Search size={13} /> 探测路径
            </Btn>
            <Btn onClick={() => void save()} loading={saving}>
              <Save size={13} /> 保存
            </Btn>
          </>
        }
      >
        {rows === null ? (
          <Empty text={store.ctl === "attached" ? "读取中…" : "Agent 未连接"} />
        ) : rows.length === 0 ? (
          <Empty text="暂无工作区，点「新增」添加" />
        ) : (
          <div className="space-y-2">
            {/* 表头 */}
            <div className="grid grid-cols-[130px_140px_1fr_120px_32px] gap-2 px-1 text-[10px] font-medium text-dim">
              <div>ID（唯一）</div>
              <div>名称</div>
              <div>本机绝对路径</div>
              <div>状态</div>
              <div />
            </div>
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-[130px_140px_1fr_120px_32px] items-center gap-2">
                <RowInput value={r.id} placeholder="如 myapp" onChange={(v) => update(i, { id: v })} mono />
                <RowInput value={r.name} placeholder="显示名称" onChange={(v) => update(i, { name: v })} />
                <RowInput value={r.path} placeholder="D:\\projects\\myapp" onChange={(v) => update(i, { path: v })} mono />
                <div className="flex items-center gap-1 text-[11px]">
                  {r.ok === undefined ? (
                    <span className="text-dim/50">未探测</span>
                  ) : r.ok ? (
                    <span className="inline-flex items-center gap-1 text-ok">
                      <CheckCircle2 size={12} /> 有效
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-err" title={r.problem}>
                      <XCircle size={12} /> 无效
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setRows((prev) => prev!.filter((_, k) => k !== i))}
                  className="justify-self-center rounded p-1 text-dim transition hover:bg-err/15 hover:text-err"
                  title="删除"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
            <div className="pt-2">
              {msg && <span className="text-[11px] text-ok">{msg}</span>}
              <ErrorText>{err}</ErrorText>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function RowInput({
  value,
  onChange,
  placeholder,
  mono,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full rounded-md border border-line bg-panel2 px-2.5 py-1.5 text-xs outline-none transition placeholder:text-dim/40 focus:border-accent/60 ${mono ? "font-mono text-[11px]" : ""}`}
    />
  );
}
