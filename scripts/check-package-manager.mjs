// Preinstall guard for av-opencode-plugins.
//
// This is NOT a security control — npm_config_user_agent is trivially
// spoofable (e.g., npm_config_user_agent='bun/x' npm install bypasses it).
// Its purpose is to catch accidental `npm install` / `yarn install`
// invocations from developers unfamiliar with the bun-only convention.
// Real enforcement is via `packageManager` + README/AGENTS Prerequisites docs.
const ua = process.env.npm_config_user_agent ?? ""
if (!ua.startsWith("bun/")) {
  console.error("This project requires bun (>= 1.3.13). Detected:", ua || "<unset>")
  console.error("Install: https://bun.sh")
  console.error("See README.md Prerequisites for details.")
  process.exit(1)
}
