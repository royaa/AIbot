import "./loadEnv.js";
import qrcode from "qrcode-terminal";
import { AgentCore, type PairingInfo } from "./core.js";
import { startControlServer } from "./ctl/server.js";

/** `npm run agent:pair` → 每次连上 Relay 都发布配对码；`npm run agent` → 仅有 token 时跳过 */
const pairMode =
  process.argv.includes("--pair") || process.argv.includes("--repair");

const core = new AgentCore({
  pairMode,
  onEvent: (e) => {
    switch (e.type) {
      case "log":
        (e.level === "error" ? console.error : e.level === "warn" ? console.warn : console.log)(e.text);
        break;
      case "pairing":
        printPairing(e.info);
        break;
      default:
        break;
    }
  },
});

function printPairing(info: PairingInfo | null) {
  if (!info) return;
  console.log("请用手机 App 扫码或输入配对码\n");
  qrcode.generate(info.qrPayload, { small: true });
}

core.start();

// 本地控制通道（PC 客户端 attach 用）；GROKBOT_CTL=0 可关闭
startControlServer(core);

function shutdown() {
  core.stop();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
