import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// run.py passes the real backend port through VITE_BACKEND_PORT.
const backendPort = process.env.VITE_BACKEND_PORT || "8000";
const port = Number(process.env.VITE_PORT || 5173);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port, proxy: { "/api": `http://localhost:${backendPort}` } },
});
