import { contextBridge, ipcRenderer } from "electron";
import type { CtlFrame } from "@grokbot/protocol";

contextBridge.exposeInMainWorld("grokbot", {
  onState: (cb: (s: string) => void) => {
    ipcRenderer.on("ctl:state", (_e, s) => cb(s));
  },
  /** 页面订阅可能晚于 did-finish-load 的补发，启动时主动拉一次当前状态 */
  getCtlState: () => ipcRenderer.invoke("ctl:getState") as Promise<string>,
  onFrame: (cb: (f: CtlFrame) => void) => {
    const handler = (_e: unknown, f: CtlFrame) => cb(f);
    ipcRenderer.on("ctl:frame", handler as never);
    return () => ipcRenderer.removeListener("ctl:frame", handler as never);
  },
  request: (type: string, payload?: unknown) =>
    ipcRenderer.invoke("ctl:req", type, payload) as Promise<unknown>,
  startAgent: () => ipcRenderer.invoke("agent:start") as Promise<{ ok: boolean }>,
  stopAgent: () => ipcRenderer.invoke("agent:stop") as Promise<{ ok: boolean }>,
  restartAgent: () => ipcRenderer.invoke("agent:restart") as Promise<{ ok: boolean }>,
});
