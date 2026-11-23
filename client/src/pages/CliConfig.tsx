import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import type { CliConfigView, CliConfigSetPayload, CliConfigTarget } from "@grokbot/protocol";
import { request, useStore } from "../lib/api.js";
import { Btn, Card, Empty, ErrorText, Field, Input, SecretInput } from "../components/ui.js";

const TABS: { key: CliConfigTarget; label: string }[] = [
  { key: "grok", label: "Grok" },
  { key: "claude", label: "Claude" },
  { key: "codex", label: "Codex" },
  { key: "opencode", label: "OpenCode" },
  { key: "pi", label: "Pi" },
  { key: "droid", label: "Droid" },
  { key: "crush", label: "Crush" },
];

const DEFAULT_BASE_URL: Partial<Record<CliConfigTarget, string>> = {
  grok: "https://open.bigmodel.cn/api/coding/paas/v4",
  claude: "https://open.bigmodel.cn/api/anthropic",
  codex: "https://open.bigmodel.cn/api/v1",
  opencode: "https://open.bigmodel.cn/api/coding/paas/v4",
  droid: "https://open.bigmodel.cn/api/anthropic",
  crush: "https://open.bigmodel.cn/api/coding/paas/v4",
};

export function CliConfigPage() {
  const store = useStore();
  const [tab, setTab] = useState<CliConfigTarget>("grok");
  const [view, setView] = useState<CliConfigView | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [key, setKey] = useState("");
  const [model, setModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (store.ctl !== "attached") return;
    setMsg("");
    setErr("");
    void request<CliConfigView>("cli.config.get", { cli: tab })
      .then((v) => {
        setView(v);
        setBaseUrl("baseUrl" in v ? v.baseUrl : "");
        setKey("apiKey" in v ? v.apiKey : "authToken" in v ? v.authToken : "");
        setModel("model" in v ? v.model : "");
      })
      .catch((e: Error) => {
        setView(null);
        setErr(e.message);
      });
  }, [tab, store.ctl]);

  const save = async () => {
    setSaving(true);
    setMsg("");
    setErr("");
    const payload: CliConfigSetPayload = (() => {
      switch (tab) {
        case "grok":
          return { cli: "grok", baseUrl, apiKey: key };
        case "claude":
          return { cli: "claude", baseUrl, authToken: key };
        case "codex":
          return { cli: "codex", baseUrl, apiKey: key };
        case "opencode":
          return { cli: "opencode", baseUrl, apiKey: key };
        case "pi":
          return { cli: "pi", apiKey: key };
        case "droid":
          return { cli: "droid", baseUrl, apiKey: key, model };
        case "crush":
          return { cli: "crush", baseUrl, apiKey: key };
      }
    })();
    try {
      await request("cli.config.set", payload);
      setMsg("已保存（落盘到对应 CLI 配置文件）");
      const v = await request<CliConfigView>("cli.config.get", { cli: tab });
      setView(v);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const keyLabel =
    tab === "claude" ? "Auth Token（ANTHROPIC_AUTH_TOKEN）" : "API Key";
  const hasBaseUrl = tab !== "pi";

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-md px-3 py-1.5 text-xs transition ${
              tab === t.key
                ? "bg-accent/15 font-medium text-accent"
                : "bg-panel text-dim hover:text-fg"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Card title={`${TABS.find((t) => t.key === tab)?.label} API 配置`}>
        {store.ctl !== "attached" ? (
          <Empty text="Agent 未连接" />
        ) : err ? (
          <Empty text={err} />
        ) : view === null ? (
          <Empty text="读取中…" />
        ) : (
          <div className="space-y-4">
            {hasBaseUrl && (
              <Field
                label="API Base URL"
                hint={DEFAULT_BASE_URL[tab] ? `留空默认 ${DEFAULT_BASE_URL[tab]}` : undefined}
              >
                <Input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder={DEFAULT_BASE_URL[tab] ?? "https://…"}
                />
              </Field>
            )}
            {tab === "droid" && (
              <Field label="模型编码" hint="BYOK customModels 的 model 字段，如 glm-5.3">
                <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="glm-5.3" />
              </Field>
            )}
            <Field
              label={keyLabel}
              hint={
                tab === "pi"
                  ? `写入环境变量 ${"envKey" in view ? view.envKey : "ZAI_CODING_CN_API_KEY"}；也可在 pi 内执行 ${"loginCommand" in view ? view.loginCommand : "/login zai-coding-cn"}`
                  : pathHint(view)
              }
            >
              <SecretInput value={key} onChange={(e) => setKey(e.target.value)} placeholder="粘贴 API Key" />
            </Field>
            <div className="flex items-center gap-3">
              <Btn onClick={() => void save()} loading={saving}>
                <Save size={13} /> 保存配置
              </Btn>
              {msg && <span className="text-[11px] text-ok">{msg}</span>}
            </div>
            <ErrorText>{err}</ErrorText>
          </div>
        )}
      </Card>
    </div>
  );
}

function pathHint(v: CliConfigView): string {
  if ("settingsPath" in v) return `写入 ${v.settingsPath} 的 env 段`;
  if ("configPath" in v) return `写入 ${v.configPath}（key 以 bearer token 落盘）`;
  if ("configFile" in v) return `写入 ${v.configFile}`;
  if ("authFile" in v) return `密钥写入 ${v.authFile}`;
  return "";
}
