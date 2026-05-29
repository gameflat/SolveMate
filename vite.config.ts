import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const extraAllowedHosts = (process.env.VITE_ALLOWED_HOSTS || "")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);

export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: ["frp-put.com", ".cpolar.cn", ".cpolar.top", ...extraAllowedHosts],
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
});
