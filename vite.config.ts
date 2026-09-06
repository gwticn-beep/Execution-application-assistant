import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import deployment from "./vercel.json" with { type: "json" };

export default defineConfig({
  base: "./",
  plugins: [react()],
  preview: { headers: Object.fromEntries(deployment.headers[0].headers.map(header => [header.key, header.value])) },
  build: {
    target: "es2022",
    rollupOptions: { output: { codeSplitting: false } },
    chunkSizeWarningLimit: 6500,
  },
});
