import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // 开发模式：/api 代理到后端（后端需先启动：uv run python -m main ui 的 server 单独跑）
    proxy: {
      "/api": "http://127.0.0.1:7860",
    },
  },
});
