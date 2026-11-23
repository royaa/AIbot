/**
 * 主进程 + preload 打包为单文件 CJS（esbuild bundle）：
 * 运行时依赖（ws 等）全部内联，安装包无需携带 node_modules，
 * 也让 electron-builder 跳过其与 workspaces 不兼容的依赖安装步骤。
 */
import { build } from "esbuild";

const common = {
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  external: ["electron"],
  sourcemap: false,
  logLevel: "info",
};

await build({ ...common, entryPoints: ["electron/main.ts"], outfile: "dist/main.js" });
await build({ ...common, entryPoints: ["electron/preload.ts"], outfile: "dist/preload.js" });
console.log("[build-main] dist/main.js + dist/preload.js 完成");
