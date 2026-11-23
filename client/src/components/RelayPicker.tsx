import { useEffect, useState } from "react";
import type { AgentConfigDto } from "@grokbot/protocol";
import { errorText, request, useStore } from "../lib/api.js";
import {
  activeRelayUrl,
  addRemote,
  adoptAgentRelay,
  LOCAL_RELAY,
  markRelayReady,
  removeRemote,
  selectLocal,
  selectRemote,
  useRelayBook,
} from "../lib/relays.js";
import { Btn, Input } from "./ui.js";

/** 本地 / 多个远程之间切换。defer 时只改选择，由外层「完成」再下发。 */
export function RelayPicker({
  defer = false,
  onApplied,
}: {
  defer?: boolean;
  onApplied?: (url: string) => void;
}) {
  const store = useStore();
  const book = useRelayBook();
  const [localDraft, setLocalDraft] = useState(book.localUrl);
  const [remoteDraft, setRemoteDraft] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setLocalDraft(book.localUrl);
  }, [book.localUrl]);

  useEffect(() => {
    if (store.ctl !== "attached") return;
    let cancel = false;
    void request<AgentConfigDto>("config.get")
      .then((c) => {
        if (!cancel) adoptAgentRelay(c.relayUrl);
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, [store.ctl]);

  const apply = async (url: string) => {
    setMsg("");
    if (defer) {
      onApplied?.(url);
      return;
    }
    if (store.ctl !== "attached") {
      setMsg("已保存。Agent 连上后会切到这个地址");
      onApplied?.(url);
      return;
    }
    setBusy(true);
    try {
      await request("config.set", { relayUrl: url });
      setMsg("已切换，Agent 正在重连…");
      onApplied?.(url);
    } catch (e) {
      setMsg(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (defer || !book.ready || store.ctl !== "attached") return;
    let cancel = false;
    void request<AgentConfigDto>("config.get")
      .then(async (c) => {
        if (cancel) return;
        const want = activeRelayUrl();
        if (c.relayUrl === want) return;
        setBusy(true);
        try {
          await request("config.set", { relayUrl: want });
          if (!cancel) setMsg("已按保存的选择切换 Relay");
        } catch (e) {
          if (!cancel) setMsg(errorText(e));
        } finally {
          if (!cancel) setBusy(false);
        }
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, [defer, book.ready, book.mode, book.activeRemoteId, book.localUrl, store.ctl]);

  const useLocal = () => {
    const url = localDraft.trim() || LOCAL_RELAY;
    if (!/^wss?:\/\//i.test(url)) {
      setMsg("本地地址要以 ws:// 或 wss:// 开头");
      return;
    }
    selectLocal(url);
    void apply(url);
  };

  const useRemote = (id: string) => {
    selectRemote(id);
    const hit = book.remotes.find((r) => r.id === id);
    if (hit) void apply(hit.url);
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Btn variant={book.mode === "local" ? "primary" : "ghost"} onClick={useLocal} loading={busy && book.mode === "local"}>
          本地
        </Btn>
        <Btn
          variant={book.mode === "remote" ? "primary" : "ghost"}
          disabled={book.remotes.length === 0}
          onClick={() => {
            const id = book.activeRemoteId || book.remotes[0]?.id;
            if (id) useRemote(id);
          }}
        >
          远程
        </Btn>
        <span className="self-center text-[11px] text-dim">
          当前 {activeRelayUrl(book)}
        </span>
      </div>

      {book.mode === "local" && (
        <div className="flex gap-2">
          <Input value={localDraft} onChange={(e) => setLocalDraft(e.target.value)} placeholder={LOCAL_RELAY} />
          <Btn onClick={useLocal} loading={busy}>
            使用本地
          </Btn>
        </div>
      )}

      <div className="space-y-2">
        {book.remotes.length === 0 ? (
          <p className="text-[11px] text-dim">还没有远程 Relay。没有远程时默认走本地 {LOCAL_RELAY}。</p>
        ) : (
          book.remotes.map((r) => {
            const active = book.mode === "remote" && (book.activeRemoteId === r.id || (!book.activeRemoteId && book.remotes[0]?.id === r.id));
            return (
              <div key={r.id} className="flex items-center gap-2">
                <span className={`min-w-0 flex-1 truncate font-mono text-[11px] ${active ? "text-accent" : "text-fg"}`}>
                  {r.url}
                </span>
                <Btn variant={active ? "primary" : "ghost"} onClick={() => useRemote(r.id)} loading={busy && active}>
                  使用
                </Btn>
                <Btn
                  variant="danger"
                  onClick={() => {
                    removeRemote(r.id);
                    setMsg("已从列表移除，没有删除 Relay 服务本身");
                  }}
                >
                  移除
                </Btn>
              </div>
            );
          })
        )}
        <div className="flex gap-2">
          <Input
            value={remoteDraft}
            onChange={(e) => setRemoteDraft(e.target.value)}
            placeholder="ws://replay.githun.cn/ws"
          />
          <Btn
            variant="ghost"
            onClick={() => {
              setMsg("");
              try {
                addRemote(remoteDraft);
                const url = remoteDraft.trim();
                setRemoteDraft("");
                if (!defer) void apply(url);
              } catch (e) {
                setMsg(errorText(e));
              }
            }}
          >
            添加远程
          </Btn>
        </div>
      </div>
      {msg && <div className="text-[11px] text-dim">{msg}</div>}
    </div>
  );
}

export function RelaySetup({ onClose }: { onClose: () => void }) {
  const store = useStore();
  const [busy, setBusy] = useState(false);
  const done = async () => {
    markRelayReady();
    const url = activeRelayUrl();
    if (store.ctl === "attached") {
      setBusy(true);
      try {
        await request("config.set", { relayUrl: url });
      } catch {
        /* 总览页会按已保存的选择再切一次 */
      } finally {
        setBusy(false);
      }
    }
    onClose();
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-[560px] rounded-2xl border border-line bg-panel p-6 shadow-2xl">
        <div className="mb-1 text-sm font-semibold">先选择 Relay</div>
        <p className="mb-4 text-[11px] leading-5 text-dim">
          没有保存过远程地址时，默认连本机 Relay。远程可以保存多个，之后在总览页随时切换。
        </p>
        <RelayPicker defer />
        <div className="mt-5 flex justify-end">
          <Btn onClick={() => void done()} loading={busy}>
            完成
          </Btn>
        </div>
      </div>
    </div>
  );
}
