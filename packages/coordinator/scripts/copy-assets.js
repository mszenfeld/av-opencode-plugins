import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(__dirname, "..")
const srcAgents = path.join(packageRoot, "src", "agents")
const distAgents = path.join(packageRoot, "dist", "agents")

fs.mkdirSync(distAgents, { recursive: true })

const files = fs.readdirSync(srcAgents).filter((f) => f.endsWith(".md"))
for (const file of files) {
  fs.copyFileSync(path.join(srcAgents, file), path.join(distAgents, file))
  console.log(`Copied src/agents/${file} → dist/agents/${file}`)
}
