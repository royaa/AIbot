import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const logDir = path.join(dir, "..", "logs");

export function audit(event: string, detail: Record<string, unknown>) {
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  const line = JSON.stringify({ ts: Date.now(), event, ...detail }) + "\n";
  fs.appendFileSync(path.join(logDir, "audit.log"), line);
}
