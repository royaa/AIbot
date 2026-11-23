import { app, BrowserWindow, ipcMain, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { ControlClient, type CtlState } from "./control.js";
import { startAgent } from "./agentProcess.js";
import { initTray, rebuildMenu, destroyTray } from "./tray.js";

/** 渲染层控制台/加载失败日志落盘（黑屏类问题排障用） */
const rendererLog = path.join(app.getPath("userData"), "renderer.log");
const logR = (line: string) => {
  try {
    fs.appendFileSync(rendererLog, `${new Date().toLocaleString()} ${line}\n`);
  } catch {
    /* 日志失败不影响运行 */
  }
};

// ─── 单实例 ────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      win.show();
      win.focus();
    }
  });
}

let mainWindow: BrowserWindow | null = null;
let quitting = false;
const control = new ControlClient();

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 960,
    minHeight: 620,
    backgroundColor: "#0b0e14",
    title: "AI Bot 控制台",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.on("close", (e) => {
    // 关窗 → 缩到托盘；真正退出走托盘菜单/退出前清理
    if (!quitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("console-message", (_e, level, message) => {
    if (level >= 1) logR(`[console:${level}] ${message}`);
  });
  mainWindow.webContents.on("did-fail-load", (_e, code, desc, url) => {
    logR(`[did-fail-load] ${code} ${desc} ${url}`);
  });
  mainWindow.webContents.on("preload-error", (_e, preloadPath, err) => {
    logR(`[preload-error] ${preloadPath}: ${err.message}`);
  });
  mainWindow.webContents.on("did-finish-load", () => {
    // 关键：ctl 可能在页面加载前就已 attach（Agent 常驻、客户端后启动），
    // 状态广播渲染层没听到会永远停在初始态 → 补发当前状态
    broadcastState(control.state);
  });
  void mainWindow.loadFile(path.join(__dirname, "..", "dist-renderer", "index.html"));

  // 挂载探针：加载 3 秒后抓 root 子节点数与 preload 桥（黑屏排障）
  setTimeout(() => {
    void mainWindow?.webContents
      .executeJavaScript(
        `document.getElementById("root")?.children.length + " nodes, bridge=" + (window.grokbot ? "ok" : "MISSING")`,
      )
      .then((r) => logR(`[probe] ${r}`))
      .catch((e: Error) => logR(`[probe] 失败: ${e.message}`));
  }, 3000);
}

function broadcastState(s: CtlState): void {
  rebuildMenu(s);
  mainWindow?.webContents.send("ctl:state", s);
}

control.onState = (s) => {
  logR(`[ctl-state] ${s}`);
  broadcastState(s);
};
control.onFrame = (frame) => {
  mainWindow?.webContents.send("ctl:frame", frame);
};

// ─── IPC ───────────────────────────────────────────────────
ipcMain.handle("ctl:req", (_e, type: string, payload: unknown) =>
  control.request(type, payload),
);

ipcMain.handle("ctl:getState", () => control.state);

ipcMain.handle("agent:start", async () => {
  await startAgent();
  return { ok: true };
});

ipcMain.handle("agent:stop", async () => {
  try {
    await control.request("agent.stop");
    return { ok: true };
  } catch {
    // Agent 未连接时视为已停止
    return { ok: true };
  }
});

ipcMain.handle("agent:restart", async () => {
  try {
    await control.request("agent.stop");
  } catch {
    /* 本来就没连上 */
  }
  await new Promise((r) => setTimeout(r, 1200));
  await startAgent();
  return { ok: true };
});

// ─── 生命周期 ──────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow();
  initTray({
    onOpen: () => mainWindow?.show(),
    onStart: () => void startAgent().catch(() => {}),
    onStop: () => void control.request("agent.stop").catch(() => {}),
  });
  control.start();
});

app.on("before-quit", () => {
  quitting = true;
  control.stop();
  destroyTray();
});

app.on("window-all-closed", () => {
  // 缩托盘常驻，不退出
});
