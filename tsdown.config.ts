import { defineConfig } from "tsdown"

export default defineConfig({
  entry: ["src/ai-gateway.ts", "src/oidc.ts", "src/runtime-cache.ts"],
  format: "esm",
  dts: true,
  clean: true,
  sourcemap: true,
  fixedExtension: false,
  exports: true,
})
