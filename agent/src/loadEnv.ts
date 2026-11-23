import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const agentRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(agentRoot, ".env");
if (fs.existsSync(envFile)) {
  // agent/.env 优先于进程里已有的同名变量，避免系统环境盖住这里的配置
  dotenv.config({ path: envFile, override: true });
}
