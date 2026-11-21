import { defineConfig } from "tsup";

// Workspace packages ship TypeScript source, so they are bundled in. Native modules stay external and are installed in the image.
export default defineConfig({
  entry: { main: "src/main.ts", "admin-cli": "src/admin-cli.ts" },
  format: ["esm"],
  target: "node22",
  platform: "node",
  outDir: "dist",
  clean: true,
  noExternal: [/^@shop\//],
  external: ["sharp", "pg-native"],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
