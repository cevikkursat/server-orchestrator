import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Geliştirmede API isteklerini backend'e yönlendir (cookie aynı origin'de kalır)
    // 127.0.0.1: "localhost" IPv6 (::1) olarak çözülüp başka bir uygulamaya gidebilir
    proxy: { "/api": { target: `http://127.0.0.1:${process.env.API_PORT ?? 3100}`, ws: true } },
  },
});
