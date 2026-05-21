import { fileURLToPath } from "node:url"
import path from "node:path"
import { copyAssets } from "../../../scripts/copy-assets.mjs"

const root = path.dirname(fileURLToPath(import.meta.url))

copyAssets(
  [
    { from: "src/commands", to: "dist/commands", type: "dir" },
    { from: "src/agents", to: "dist/agents", type: "dir" },
    { from: "src/skills", to: "dist/skills", type: "dir" },
    { from: "src/modules/prompt-sections", to: "dist/modules/prompt-sections", type: "dir" },
  ],
  path.resolve(root, "..")
)
