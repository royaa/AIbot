import "dotenv/config";
import crypto from "node:crypto";
import Fastify from "fastify";
import { WebSocketServer } from "ws";
import {
  createMessage,
  parseWireMessage,
  type PairCompletePayload,
  type PairStartPayload,
  type TaskCatchupPayload,
  type TaskCreatePayload,
  type TaskOutputPayload,
  type TaskStatusPayload,
  type WireMessage,
} from "@grokbot/protocol";
import {
  appendTaskOutput,
  consumePairCode,
  getDevice,
  getTaskOutputsAfter,
  getTaskRow,
  pruneOldTasks,
  registerDevice,
  savePairCode,
  upsertTask,
} from "./db.js";
import { signToken, verifyToken } from "./auth.js";
import {
  handleDownload,
  handleUpload,
  initFiles,
  maxFileBytes,
  startFileCleanupTimer,
} from "./files.js";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "0.0.0.0";

type Client = {
  ws: import("ws").WebSocket;
  role?: "mobile" | "agent";
  agentId?: string;
  deviceId?: string;
};

const agents = new Map<string, Client>();
const mobilesByAgent = new Map<string, Set<Client>>();
/** 最近一次 agent.status，供晚加入的手机补发 */
const lastAgentStatus = new Map<string, WireMessage>();
/** 最近 file.offer（内存级，cap 20），供晚加入/重连的手机补发 */
const recentFileOffers = new Map<string, WireMessage[]>();

function pushFileOffer(agentId: string, msg: WireMessage) {
  let list = recentFileOffers.get(agentId);
  if (!list) {
    list = [];
    recentFileOffers.set(agentId, list);
  }
  list.push(msg);
  while (list.length > 20) list.shift();
}

function replayFileOffersToMobile(agentId: string, mobileWs: import("ws").WebSocket) {
  for (const msg of recentFileOffers.get(agentId) ?? []) send(mobileWs, msg);
}

function send(ws: import("ws").WebSocket, msg: WireMessage) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function replayAgentStatusToMobile(agentId: string, mobileWs: import("ws").WebSocket) {
  const cached = lastAgentStatus.get(agentId);
  if (cached) send(mobileWs, cached);
}

function broadcastToMobiles(agentId: string, msg: WireMessage) {
  const set = mobilesByAgent.get(agentId);
  if (!set) return;
  for (const c of set) send(c.ws, msg);
}

/**
 * Agent 单槽注册：新连接顶替旧连接时必须主动关闭旧 socket。
 * 否则旧 Agent 侧收不到 close 事件、永不重连（且 Relay 无心跳探活），
 * 槽位被清空后手机端将永远看到 Agent 离线、无法下发新任务。
 */
function registerAgentSlot(agentId: string, client: Client) {
  const prev = agents.get(agentId);
  if (prev && prev.ws !== client.ws) {
    try {
      prev.ws.close(4000, "replaced by new agent connection");
    } catch {
      /* 旧 socket 可能已死，忽略 */
    }
  }
  agents.set(agentId, client);
}

function routeToAgent(agentId: string, msg: WireMessage) {
  const agent = agents.get(agentId);
  if (agent) send(agent.ws, msg);
}

const app = Fastify({ logger: true, bodyLimit: maxFileBytes + 1024 });

const buildId =
  process.env.RELAY_BUILD_ID ??
  new Date().toISOString().slice(0, 19).replace("T", " ");

app.get("/health", async () => ({
  ok: true,
  agents: agents.size,
  buildId,
  features: ["ws", "files"],
}));

// 大文件走 HTTP 旁路：application/octet-stream 不做 JSON 解析，透传原始流给上传处理
app.addContentTypeParser("application/octet-stream", (_req, body, done) =>
  done(null, body),
);
app.post("/files/upload", handleUpload);
app.get("/files/:fileId", handleDownload);

initFiles();
startFileCleanupTimer();

// 启动即清理过期任务数据（防 task_outputs 无限膨胀），日志一行留痕
{
  const pruned = pruneOldTasks();
  if (pruned > 0) console.log(`[db] 已清理 ${pruned} 条过期任务（含输出）`);
}

const server = await app.listen({ port, host });
const wss = new WebSocketServer({ server: app.server, path: "/ws" });

app.log.info(`Relay listening on http://${host}:${port} (ws path /ws)`);

wss.on("connection", (ws) => {
  const client: Client = { ws };

  ws.on("message", (data) => {
    let msg: WireMessage;
    try {
      msg = parseWireMessage(JSON.parse(data.toString()));
    } catch (e) {
      send(
        ws,
        createMessage("error", "relay", {
          code: "invalid_message",
          message: e instanceof Error ? e.message : "Invalid message",
        }),
      );
      return;
    }

    switch (msg.type) {
      case "hello": {
        const p = msg.payload as {
          token?: string;
          role: string;
          agentId?: string;
          deviceId?: string;
        };
        if (p.token) {
          const token = p.token;
          try {
            const claims = verifyToken(token);
            client.role = claims.role;
            client.agentId = claims.agentId;
            client.deviceId = claims.deviceId ?? claims.sub;
            if (claims.role === "agent" && claims.agentId) {
              registerAgentSlot(claims.agentId, client);
            }
            if (claims.role === "mobile" && claims.agentId) {
              let set = mobilesByAgent.get(claims.agentId);
              if (!set) {
                set = new Set();
                mobilesByAgent.set(claims.agentId, set);
              }
              set.add(client);
              replayAgentStatusToMobile(claims.agentId, ws);
              replayFileOffersToMobile(claims.agentId, ws);
            }
          } catch {
            send(ws, createMessage("error", "relay", { code: "auth", message: "Invalid token" }));
            ws.close();
            return;
          }
        }
        send(ws, createMessage("hello", "relay", { role: "relay", version: "0.1.0" }));
        break;
      }
      case "pair.start": {
        if (msg.role !== "agent") break;
        const p = msg.payload as PairStartPayload;
        savePairCode(p.pairCode, p.agentId, p.hostname, p.expiresAt);
        client.role = "agent";
        client.agentId = p.agentId;
        registerAgentSlot(p.agentId, client);
        const agentToken = signToken({
          sub: p.agentId,
          role: "agent",
          agentId: p.agentId,
        });
        send(
          ws,
          createMessage("auth.token", "relay", {
            accessToken: agentToken,
            deviceId: p.agentId,
            agentId: p.agentId,
          }),
        );
        break;
      }
      case "pair.complete": {
        if (msg.role !== "mobile") break;
        const p = msg.payload as PairCompletePayload;
        const row = consumePairCode(p.pairCode);
        if (!row) {
          send(ws, createMessage("error", "relay", { code: "pair", message: "配对码无效或已过期" }));
          break;
        }
        const deviceId = crypto.randomUUID();
        registerDevice(deviceId, p.deviceName, row.agent_id);
        client.role = "mobile";
        client.deviceId = deviceId;
        client.agentId = row.agent_id;
        let set = mobilesByAgent.get(row.agent_id);
        if (!set) {
          set = new Set();
          mobilesByAgent.set(row.agent_id, set);
        }
        set.add(client);
        const mobileToken = signToken({
          sub: deviceId,
          role: "mobile",
          agentId: row.agent_id,
          deviceId,
        });
        send(
          ws,
          createMessage("auth.token", "relay", {
            accessToken: mobileToken,
            deviceId,
            agentId: row.agent_id,
          }),
        );
        replayAgentStatusToMobile(row.agent_id, ws);
        replayFileOffersToMobile(row.agent_id, ws);
        break;
      }
      case "agent.status": {
        if (client.role === "agent" && client.agentId) {
          lastAgentStatus.set(client.agentId, msg);
          broadcastToMobiles(client.agentId, msg);
        }
        break;
      }
      case "task.create": {
        if (client.role !== "mobile" || !client.agentId) break;
        const p = msg.payload as TaskCreatePayload;
        if (!agents.has(client.agentId)) {
          send(
            ws,
            createMessage("task.status", "relay", {
              taskId: p.taskId,
              status: "failed",
              message:
                "PC Agent 离线或未连上 Relay。请在电脑启动 npm run agent；若 Agent 正在显示配对码，请在 App 侧栏点「重新配对」。",
            }),
          );
          break;
        }
        upsertTask(
          p.taskId,
          client.agentId,
          client.deviceId,
          p.tool,
          p.prompt,
          "queued",
        );
        routeToAgent(client.agentId, msg);
        break;
      }
      case "task.cancel":
      case "task.confirm.response": {
        if (client.role === "mobile" && client.agentId) {
          routeToAgent(client.agentId, msg);
        }
        break;
      }
      case "task.catchup": {
        if (client.role !== "mobile" || !client.agentId) break;
        const p = msg.payload as TaskCatchupPayload;
        for (const item of p.tasks) {
          const row = getTaskRow(item.taskId);
          if (!row || row.agent_id !== client.agentId) continue;
          const afterSeq = item.afterSeq ?? -1;
          const outputs = getTaskOutputsAfter(item.taskId, afterSeq);
          for (const out of outputs) {
            send(
              ws,
              createMessage("task.output", "relay", {
                taskId: item.taskId,
                seq: out.seq,
                kind: out.kind,
                text: out.text,
              }),
            );
          }
          send(
            ws,
            createMessage("task.status", "relay", {
              taskId: item.taskId,
              status: row.status,
            }),
          );
        }
        break;
      }
      case "task.output": {
        const p = msg.payload as TaskOutputPayload;
        appendTaskOutput(p.taskId, p.seq, p.kind, p.text);
        if (client.role === "agent" && client.agentId) {
          broadcastToMobiles(client.agentId, msg);
        }
        break;
      }
      case "task.status": {
        const p = msg.payload as TaskStatusPayload;
        upsertTask(
          p.taskId,
          client.agentId ?? "unknown",
          client.deviceId,
          "unknown",
          "",
          p.status,
        );
        if (client.role === "agent" && client.agentId) {
          broadcastToMobiles(client.agentId, msg);
        }
        break;
      }
      case "task.confirm.request": {
        if (client.role === "agent" && client.agentId) {
          broadcastToMobiles(client.agentId, msg);
        }
        break;
      }
      case "file.offer": {
        // Agent 已把文件上传到 /files/upload，通知手机走 HTTP 下载
        if (client.role === "agent" && client.agentId) {
          pushFileOffer(client.agentId, msg);
          broadcastToMobiles(client.agentId, msg);
        }
        break;
      }
      default:
        break;
    }
  });

  ws.on("close", () => {
    if (client.agentId && client.role === "agent") {
      const agentId = client.agentId;
      // 仅当当前映射仍是本连接时才清（避免旧连接 close 误删新 Agent）
      if (agents.get(agentId)?.ws === ws) {
        agents.delete(agentId);
        const prev = lastAgentStatus.get(agentId);
        const prevPayload = prev?.payload as
          | {
              hostname?: string;
              workspaces?: { id: string; name: string; path: string }[];
              tools?: Record<string, string | undefined>;
              toolCatalog?: unknown;
              toolModels?: unknown;
            }
          | undefined;
        const offline = createMessage("agent.status", "relay", {
          agentId,
          hostname: prevPayload?.hostname ?? "offline",
          online: false,
          workspaces: prevPayload?.workspaces ?? [],
          tools: prevPayload?.tools ?? {},
          ...(prevPayload?.toolCatalog
            ? { toolCatalog: prevPayload.toolCatalog as never }
            : {}),
          ...(prevPayload?.toolModels
            ? { toolModels: prevPayload.toolModels as never }
            : {}),
        });
        lastAgentStatus.set(agentId, offline);
        broadcastToMobiles(agentId, offline);
      }
    }
    if (client.agentId && client.role === "mobile") {
      const set = mobilesByAgent.get(client.agentId);
      set?.delete(client);
    }
  });
});

export { getDevice };
