/** 第一次进入的分步引导。帮助页按同一份文案重放。 */

export const GUIDE_SEEN_KEY = "grokbot:guideSeen";

export type GuidePage = "dashboard" | "pairing" | "cli" | "cliconfig" | "workspaces" | "logs";

export type GuideStep = {
  page: GuidePage;
  /** 侧栏上的页面名 */
  nav: string;
  /** 步骤条上的短标题 */
  short: string;
  title: string;
  body: string;
};

export const GUIDE_STEPS: GuideStep[] = [
  {
    page: "dashboard",
    nav: "总览",
    short: "启动",
    title: "启动 Agent",
    body: "客户端只负责管理，真正执行任务的是本机 Agent 进程。打开「总览」，如果显示未运行，点「启动 Agent」。侧栏底部变成「Agent 已连接」后，后面的步骤才可用。",
  },
  {
    page: "pairing",
    nav: "连接与配对",
    short: "配对",
    title: "连接 Relay，配对手机",
    body: "手机和这台电脑通过 Relay 通信。在「连接与配对」里确认本机或远程地址，再发布配对码。用手机 App 扫二维码，或输入配对码。配对成功后，手机才能把任务发到这台电脑。",
  },
  {
    page: "cli",
    nav: "CLI 管理",
    short: "安装",
    title: "安装要用的命令行工具",
    body: "对话和改代码由本机的 Claude、Codex、Grok 等 CLI 执行。打开「CLI 管理」，点「重新探测」看哪些已经装好。缺的点「安装」，装完再探测一次，状态应是就绪。用不到的工具可以不装。",
  },
  {
    page: "cliconfig",
    nav: "CLI 配置",
    short: "配置",
    title: "填写 API 地址和密钥",
    body: "多数 CLI 使用智谱 GLM Coding Plan 的 Key（bigmodel.cn → 个人编程套餐 → 新建）。到「CLI 配置」按工具填写 Base URL 和 Key，点保存。Base URL 留空会用该工具的默认地址。各工具写到哪个文件，见「帮助」里的 CLI 配置说明。",
  },
  {
    page: "workspaces",
    nav: "工作空间",
    short: "目录",
    title: "添加允许操作的项目目录",
    body: "工作空间是手机可以下发任务的项目目录白名单。点「新增」，填写唯一 ID、显示名称和本机绝对路径，保存后再点「探测路径」。只有标成有效的目录，手机才能对它下发任务。",
  },
  {
    page: "logs",
    nav: "日志",
    short: "验证",
    title: "从手机发一条任务",
    body: "回到手机，选择工作空间和工具，发一条任务。执行过程在「日志」里看。如果失败，先确认 Agent 仍连接、对应 CLI 已就绪、Key 已保存，以及工作空间路径探测为有效。",
  },
];

export function shouldShowGuide(): boolean {
  try {
    return localStorage.getItem(GUIDE_SEEN_KEY) !== "1";
  } catch {
    return false;
  }
}

export function markGuideSeen(): void {
  try {
    localStorage.setItem(GUIDE_SEEN_KEY, "1");
  } catch {
    /* 无 localStorage 时下次仍会再出现，可接受 */
  }
}
