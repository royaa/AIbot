import { useEffect, useRef, useState } from "react";
import {
  LayoutDashboard,
  QrCode,
  Terminal,
  KeyRound,
  FolderTree,
  ScrollText,
  Settings as SettingsIcon,
  CircleHelp,
  Sun,
  Moon,
} from "lucide-react";
import { initStore, useStore } from "./lib/api.js";
import { useTheme } from "./lib/theme.js";
import { Pill } from "./components/ui.js";
import { RelaySetup } from "./components/RelayPicker.js";
import { Guide } from "./components/Guide.js";
import { getRelayBook } from "./lib/relays.js";
import { GUIDE_STEPS, markGuideSeen, shouldShowGuide } from "./lib/guide.js";
import { DashboardPage } from "./pages/Dashboard.js";
import { PairingPage } from "./pages/Pairing.js";
import { CliManagePage } from "./pages/CliManage.js";
import { CliConfigPage } from "./pages/CliConfig.js";
import { WorkspacesPage } from "./pages/Workspaces.js";
import { LogsPage } from "./pages/Logs.js";
import { SettingsPage } from "./pages/Settings.js";
import { HelpPage } from "./pages/Help.js";

const NAV = [
  { key: "dashboard", label: "总览", icon: LayoutDashboard },
  { key: "pairing", label: "连接与配对", icon: QrCode },
  { key: "cli", label: "CLI 管理", icon: Terminal },
  { key: "cliconfig", label: "CLI 配置", icon: KeyRound },
  { key: "workspaces", label: "工作空间", icon: FolderTree },
  { key: "logs", label: "日志", icon: ScrollText },
  { key: "settings", label: "设置", icon: SettingsIcon },
  { key: "help", label: "帮助", icon: CircleHelp },
] as const;

type PageKey = (typeof NAV)[number]["key"];

export function App() {
  const [page, setPage] = useState<PageKey>("dashboard");
  const [relaySetup, setRelaySetup] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideStep, setGuideStep] = useState(0);
  const guideReturn = useRef<PageKey | null>(null);
  const pageRef = useRef<PageKey>("dashboard");
  pageRef.current = page;
  const store = useStore();
  const { theme, setTheme } = useTheme();

  const openGuide = (fromReplay: boolean) => {
    guideReturn.current = fromReplay ? pageRef.current : null;
    setGuideStep(0);
    setPage(GUIDE_STEPS[0].page);
    setGuideOpen(true);
  };

  const closeGuide = () => {
    markGuideSeen();
    setGuideOpen(false);
    const back = guideReturn.current;
    guideReturn.current = null;
    if (back) setPage(back);
  };

  useEffect(() => {
    initStore();
    if (!getRelayBook().ready) setRelaySetup(true);
    else if (shouldShowGuide()) openGuide(false);
    // 只在进入时决定要不要引导
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goGuideStep = (index: number) => {
    const next = GUIDE_STEPS[index];
    if (!next) return;
    setGuideStep(index);
    setPage(next.page);
  };

  const closeRelay = () => {
    setRelaySetup(false);
    if (shouldShowGuide()) openGuide(false);
  };

  const ctlTone =
    store.ctl === "attached" ? "ok" : store.ctl === "connecting" ? "warn" : "err";
  const ctlText =
    store.ctl === "attached"
      ? "Agent 已连接"
      : store.ctl === "connecting"
        ? "连接中…"
        : "Agent 未运行";

  return (
    <div className="flex h-full">
      {/* 侧栏 */}
      <aside className="flex w-48 shrink-0 flex-col border-r border-line bg-panel">
        <div className="flex items-center gap-2 px-4 py-4">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-[13px] font-bold text-accent-fg">
            AI
          </div>
          <div>
            <div className="text-[13px] font-semibold">AI Bot</div>
            <div className="text-[10px] text-dim">PC 控制台</div>
          </div>
        </div>
        <nav className={`mt-1 flex-1 space-y-0.5 px-2 ${guideOpen ? "pointer-events-none" : ""}`}>
          {NAV.map((n) => {
            const Icon = n.icon;
            const active = page === n.key;
            const guided = guideOpen && GUIDE_STEPS[guideStep]?.page === n.key;
            return (
              <button
                key={n.key}
                onClick={() => setPage(n.key)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs transition ${
                  active
                    ? "bg-accent/15 font-medium text-accent"
                    : "text-dim hover:bg-panel2 hover:text-fg"
                } ${guided ? "ring-2 ring-accent" : ""}`}
              >
                <Icon size={15} />
                {n.label}
              </button>
            );
          })}
        </nav>
        <div className="border-t border-line px-3 py-3">
          <div className="mb-2 grid grid-cols-2 gap-0.5 rounded-lg bg-panel2 p-0.5">
            {(
              [
                ["day", "白天", Sun],
                ["night", "夜晚", Moon],
              ] as const
            ).map(([key, label, Icon]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTheme(key)}
                className={`flex items-center justify-center gap-1 rounded-md px-1 py-1.5 text-[11px] transition ${
                  theme === key
                    ? "bg-panel font-medium text-fg shadow-sm"
                    : "text-dim hover:text-fg"
                }`}
              >
                <Icon size={12} />
                {label}
              </button>
            ))}
          </div>
          <div className="px-1">
            <Pill tone={ctlTone}>{ctlText}</Pill>
          </div>
        </div>
      </aside>

      {/* 内容区 */}
      <main className="h-full flex-1 overflow-y-auto p-6">
        {page === "dashboard" && <DashboardPage />}
        {page === "pairing" && <PairingPage />}
        {page === "cli" && <CliManagePage />}
        {page === "cliconfig" && <CliConfigPage />}
        {page === "workspaces" && <WorkspacesPage />}
        {page === "logs" && <LogsPage />}
        {page === "settings" && <SettingsPage />}
        {page === "help" && <HelpPage onReplay={() => openGuide(true)} />}
      </main>

      {relaySetup && <RelaySetup onClose={closeRelay} />}
      {guideOpen && <Guide step={guideStep} onStep={goGuideStep} onClose={closeGuide} />}
    </div>
  );
}
