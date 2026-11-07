import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts"],
  format: ["esm"],
  platform: "node",
  target: "node24",
  clean: true,
  // Paylaşılan paket TS kaynağı olarak duruyor, bundle'a dahil et
  noExternal: ["@panel/shared"],
});
