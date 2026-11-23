import { useEffect, useRef, useState } from "react";
import type { AgentLogLevel } from "@grokbot/protocol";
import { fmtTime, useStore } from "../lib/api.js";
import { Card, Empty } from "../components/ui.js";

const LEVELS: (AgentLogLevel | "all")[] = ["all", "info", "warn", "error"];

export function LogsPage() {
  const store = useStore();
  const [level, setLevel] = useState<(typeof LEVELS)[number]>("all");
  const [autoscroll, setAutoscroll] = useState(true);
  const boxRef = useRef<HTMLDivElement>(null);

  const logs = store.logs.filter((l) => level === "all" || l.level === level);

  useEffect(() => {
    if (autoscroll) boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight });
  }, [store.logs, autoscroll, level]);

  return (
    <div className="mx-auto max-w-4xl">
      <Card
        title="Agent 日志"
        actions={
          <div className="flex items-center gap-2">
            {LEVELS.map((l) => (
              <button
                key={l}
                onClick={() => setLevel(l)}
                className={`rounded px-2 py-0.5 text-[11px] transition ${
                  level === l ? "bg-accent/15 font-medium text-accent" : "text-dim hover:text-fg"
                }`}
              >
                {l === "all" ? "全部" : l}
              </button>
            ))}
            <label className="ml-2 flex cursor-pointer items-center gap-1 text-[11px] text-dim">
              <input
                type="checkbox"
                checked={autoscroll}
                onChange={(e) => setAutoscroll(e.target.checked)}
                className="accent-accent"
              />
              自动滚动
            </label>
          </div>
        }
      >
        {logs.length === 0 ? (
          <Empty text="暂无日志" />
        ) : (
          <div ref={boxRef} className="max-h-[calc(100vh-220px)] overflow-y-auto rounded-lg bg-bg p-3 font-mono text-[11px] leading-5">
            {logs.map((l, i) => (
              <div key={i} className="flex gap-2">
                <span className="shrink-0 text-dim/60">{fmtTime(l.ts)}</span>
                <span
                  className={`shrink-0 font-semibold ${
                    l.level === "error" ? "text-err" : l.level === "warn" ? "text-warn" : "text-dim"
                  }`}
                >
                  [{l.level}]
                </span>
                <span className={l.level === "error" ? "text-err" : "text-fg/90"}>{l.text}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
