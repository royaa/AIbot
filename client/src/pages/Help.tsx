import { Play } from "lucide-react";
import { GUIDE_STEPS } from "../lib/guide.js";
import { Btn, Card } from "../components/ui.js";

const CLI_DOCS: {
  name: string;
  where: string;
  fields: string;
  baseUrl: string;
  note: string;
}[] = [
  {
    name: "Grok",
    where: "Agent 配置，并同步到 ~/.grok/user-settings.json",
    fields: "API Base URL、API Key",
    baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
    note: "不用单独登录。保存后，手机选 Grok 即可用这把 Key。",
  },
  {
    name: "Claude",
    where: "~/.claude/settings.json 的 env",
    fields: "ANTHROPIC_BASE_URL、ANTHROPIC_AUTH_TOKEN",
    baseUrl: "https://open.bigmodel.cn/api/anthropic",
    note: "页面上的密钥字段是 Auth Token。若系统环境变量里已经有 ANTHROPIC_BASE_URL，读取时优先用环境变量。",
  },
  {
    name: "Codex",
    where: "~/.codex/config.toml（provider 的 base_url 与 experimental_bearer_token）",
    fields: "API Base URL、API Key",
    baseUrl: "https://open.bigmodel.cn/api/v1",
    note: "Key 按 bearer token 写入。若还没有 ~/.codex/models.json，保存时会补一份，默认模型 glm-5.3。config.toml 解析失败时不会覆盖原文件。",
  },
  {
    name: "OpenCode",
    where: "~/.config/opencode/opencode.json，密钥在 ~/.local/share/opencode/auth.json",
    fields: "API Base URL、API Key",
    baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
    note: "也可以在终端运行 opencode auth login，选择 Zhipu AI Coding Plan。",
  },
  {
    name: "Pi",
    where: "Agent 的环境变量 ZAI_CODING_CN_API_KEY",
    fields: "API Key（无 Base URL）",
    baseUrl: "无，走智谱 Coding 端点",
    note: "也可以先打开 pi，再执行 /login zai-coding-cn。登录凭证在 ~/.pi/agent/auth.json。",
  },
  {
    name: "Droid",
    where: "~/.factory/settings.json 的 BYOK customModels",
    fields: "API Base URL、API Key、模型编码",
    baseUrl: "https://open.bigmodel.cn/api/anthropic",
    note: "模型编码默认 glm-5.3。第一次运行 droid 还要在浏览器登录 Factory 账户。",
  },
  {
    name: "Crush",
    where: "~/.config/crush/crush.json",
    fields: "API Base URL、API Key",
    baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
    note: "保存后启动 Crush，用 /models 选 GLM 模型。",
  },
];

export function HelpPage({ onReplay }: { onReplay: () => void }) {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Card
        title="新手引导"
        actions={
          <Btn onClick={onReplay}>
            <Play size={13} /> 重放引导
          </Btn>
        }
      >
        <p className="text-xs leading-6 text-dim">
          第一次打开控制台会按下面的顺序走一遍。之后随时可以重放，重放只讲解步骤，不会改动已经保存的配置。
        </p>
        <ol className="mt-3 space-y-2">
          {GUIDE_STEPS.map((s, i) => (
            <li key={s.page} className="flex gap-3 text-xs leading-5">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[11px] font-medium text-accent">
                {i + 1}
              </span>
              <span>
                <span className="font-medium text-fg">{s.title}</span>
                <span className="text-dim"> · {s.nav}</span>
                <span className="mt-0.5 block text-dim">{s.body}</span>
              </span>
            </li>
          ))}
        </ol>
      </Card>

      <Card title="CLI 配置说明">
        <div className="space-y-3 text-xs leading-6 text-dim">
          <p>
            「CLI 配置」把每个工具的接口地址和密钥写到这台电脑对应的配置文件里，Agent 调用 CLI 时就会用这些凭证。密钥建议用智谱 GLM Coding Plan：打开 bigmodel.cn，进入个人编程套餐，新建 API Key，再粘贴到对应工具。
          </p>
          <p>
            Base URL 可以留空，保存时使用下表里的默认地址。只影响本机文件，不会发到手机。Cursor Agent 用终端命令 agent login，WorkBuddy 在第一次任务弹出的 Chrome 里登录 workbuddy.cn，这两项不在「CLI 配置」页。
          </p>
        </div>
        <div className="mt-4 space-y-2">
          {CLI_DOCS.map((item) => (
            <div key={item.name} className="rounded-lg border border-line bg-panel2/50 px-3 py-2.5">
              <div className="text-xs font-medium">{item.name}</div>
              <dl className="mt-1.5 space-y-1 text-[11px] leading-5 text-dim">
                <div>
                  <span className="text-fg/80">写入 </span>
                  {item.where}
                </div>
                <div>
                  <span className="text-fg/80">要填 </span>
                  {item.fields}
                </div>
                <div>
                  <span className="text-fg/80">默认地址 </span>
                  <span className="font-mono text-[10px]">{item.baseUrl}</span>
                </div>
                <div>{item.note}</div>
              </dl>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
