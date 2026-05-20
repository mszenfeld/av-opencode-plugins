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
