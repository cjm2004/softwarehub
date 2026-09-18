import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  build: {
    emptyOutDir: false
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:31880",
      "/go": "http://127.0.0.1:31880",
      "/uploads": "http://127.0.0.1:31880"
    }
  }
});
