import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: {
      index: "extension-src/pi-rules/app/index.ts"
    },
    format: ["cjs", "esm"],
    dts: true,
    sourcemap: true,
    clean: true,
    target: "node20",
    outDir: "dist",
    external: [
      "@earendil-works/pi-coding-agent",
      "@earendil-works/pi-ai",
      "@earendil-works/pi-tui",
      "typebox"
    ]
  },
  {
    entry: {
      "pi-rules": "extension-src/pi-rules/pi/index.ts"
    },
    format: ["esm"],
    dts: false,
    sourcemap: true,
    clean: false,
    target: "node20",
    outDir: "dist/extensions",
    external: [
      "@earendil-works/pi-coding-agent",
      "@earendil-works/pi-ai",
      "@earendil-works/pi-tui",
      "typebox"
    ]
  }
]);
