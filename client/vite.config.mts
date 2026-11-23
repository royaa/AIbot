import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  root: "src",
  base: "./", // Electron loadFile 本地加载：必须相对路径，否则 /assets/... 解析到盘符根导致黑屏
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "../dist-renderer",
    emptyOutDir: true,
  },
});
