import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: "./",
  server: {
    proxy: {
      "/rss": "http://127.0.0.1:8787",
      "/ai": "http://127.0.0.1:8787",
      "/health": "http://127.0.0.1:8787",
    },
  },
  plugins: [react(), tailwindcss()],
});
