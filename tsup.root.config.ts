// Filename is intentional: tsup.config.ts would be auto-discovered by
// workspace tsup runs and leak bundle:false into them, breaking their
// expected bundled output. The root build invokes this explicitly via
// `tsup --config tsup.root.config.ts` in package.json.
import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/**/*.ts", "!src/**/*.{test,spec}.ts"],
  format: ["esm"],
  dts: true,
  outDir: "dist",
  clean: true,
  bundle: false,
  target: "es2022",
  sourcemap: false,
})
