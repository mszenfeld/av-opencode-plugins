// Preinstall guard for av-opencode-plugins.
//
// This is NOT a security control — npm_config_user_agent is trivially
// spoofable (e.g., npm_config_user_agent='bun/x' npm install bypasses it).
// Its purpose is to catch accidental `npm install` / `yarn install`
// invocations from developers unfamiliar with the bun-only convention.
// Real enforcement is via `packageManager` + README/AGENTS Prerequisites docs.
const MIN_BUN = [1, 3, 13]
const MIN_BUN_STR = MIN_BUN.join(".")

const ua = process.env.npm_config_user_agent ?? ""
if (!ua.startsWith("bun/")) {
  console.error(`This project requires bun (>= ${MIN_BUN_STR}). Detected:`, ua || "<unset>")
  console.error("Install: https://bun.sh")
  console.error("See README.md Prerequisites for details.")
  process.exit(1)
}

const m = ua.match(/^bun\/(\d+)\.(\d+)\.(\d+)/)
if (m) {
  const version = m.slice(1, 4).map(Number)
  if (!isAtLeast(version, MIN_BUN)) {
    console.error(`This project requires bun >= ${MIN_BUN_STR}. Detected:`, ua)
    console.error("Upgrade: https://bun.sh")
    console.error("See README.md Prerequisites for details.")
    process.exit(1)
  }
} else {
  // Non-semver bun user-agent (e.g. `bun/dev`, canary/source builds): we can't
  // parse a version, so we can't prove >= MIN_BUN_STR. Warn rather than fail —
  // this guard is best-effort (see header), and blocking canary builds would be
  // more disruptive than the unlikely case of an outdated source build.
  console.warn(`Could not parse a bun version from "${ua}"; cannot verify >= ${MIN_BUN_STR}. Proceeding.`)
}

// Lexicographic [major, minor, patch] comparison: version >= min.
function isAtLeast(version, min) {
  for (let i = 0; i < min.length; i++) {
    if (version[i] > min[i]) return true
    if (version[i] < min[i]) return false
  }
  return true
}
