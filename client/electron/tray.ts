import { Menu, Tray, nativeImage, app } from "electron";

let tray: Tray | null = null;
let onOpen: () => void = () => {};
let onStart: () => void = () => {};
let onStop: () => void = () => {};

/** 16×16 纯色方块图标（M5 打包时换正式 .ico） */
function makeIcon(): Electron.NativeImage {
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    buf[i * 4] = 0x4f; // R
    buf[i * 4 + 1] = 0x7c; // G
    buf[i * 4 + 2] = 0xff; // B
    buf[i * 4 + 3] = 0xff; // A
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

export function initTray(handlers: {
  onOpen: () => void;
  onStart: () => void;
  onStop: () => void;
}): void {
  onOpen = handlers.onOpen;
  onStart = handlers.onStart;
  onStop = handlers.onStop;
  tray = new Tray(makeIcon());
  tray.setToolTip("AI Bot Agent 控制台");
  rebuildMenu("unavailable");
}

export function rebuildMenu(ctlState: string): void {
  if (!tray) return;
  const running = ctlState !== "unavailable";
  const menu = Menu.buildFromTemplate([
    { label: "打开主界面", click: () => onOpen() },
    { type: "separator" },
    {
      label: running ? "停止 Agent" : "启动 Agent",
      click: () => (running ? onStop() : onStart()),
      enabled: ctlState !== "connecting",
    },
    { type: "separator" },
    { label: "退出", click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip(`AI Bot Agent — ${running ? "运行中" : "已停止"}`);
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}
