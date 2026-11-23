import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type ConversationTurn = {
  role: "user" | "assistant";
  tool: string;
  text: string;
  ts: number;
};

export type Conversation = {
  sessionId: string;
  summary: string;
  turns: ConversationTurn[];
  nativeSessions: Record<string, string>;
  lastTool?: string;
  updatedAt: number;
};

const dir = path.dirname(fileURLToPath(import.meta.url));
const sessionsDir = path.join(dir, "..", "..", "data", "sessions");

function safeId(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9-]/g, "_");
}

export function loadConversation(sessionId: string): Conversation {
  if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir, { recursive: true });
  const file = path.join(sessionsDir, `${safeId(sessionId)}.json`);
  if (!fs.existsSync(file)) {
    return {
      sessionId,
      summary: "",
      turns: [],
      nativeSessions: {},
      updatedAt: Date.now(),
    };
  }
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Conversation;
  raw.sessionId = sessionId;
  raw.nativeSessions ??= {};
  raw.turns ??= [];
  raw.summary ??= "";
  return raw;
}

export function saveConversation(conv: Conversation) {
  if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir, { recursive: true });
  conv.updatedAt = Date.now();
  const file = path.join(sessionsDir, `${safeId(conv.sessionId)}.json`);
  fs.writeFileSync(file, JSON.stringify(conv, null, 2));
}

export function estimateConversationChars(conv: Conversation): number {
  let n = conv.summary.length;
  for (const t of conv.turns) n += t.text.length + 32;
  return n;
}
