import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Required: Stellar SDK uses Node builtins that need polyfills in the browser
  define: {
    global: {},
  },
  resolve: {
    alias: {
      // Alias Buffer for browser compatibility
      buffer: "buffer/",
    },
  },
  optimizeDeps: {
    include: ["@stellar/stellar-sdk"],
  },
  build: {
    target: "esnext",
    rollupOptions: {
      output: {
        manualChunks: {
          stellar: ["@stellar/stellar-sdk"],
        },
      },
    },
  },
});