import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseAllowedBashPrograms } from "@appverk/opencode-skill-utils";
const FALLBACK_ALLOWLIST = ["mkdir", "ls", "./scripts/qa-preflight.sh"];
function readCoordinatorBashAllowlist() {
  try {
    const perunMd = fileURLToPath(new URL("../../agents/perun.md", import.meta.url));
    const text = readFileSync(perunMd, "utf8");
    const line = text.match(/^allowed-tools:.*$/m)?.[0] ?? "";
    const programs = parseAllowedBashPrograms(line);
    if (programs.length === 0) {
      console.warn("[coordinator-policy] perun.md frontmatter yielded no Bash(...) programs; using fallback allowlist");
      return FALLBACK_ALLOWLIST;
    }
    return programs;
  } catch (err) {
    console.warn(`[coordinator-policy] could not read perun.md allowlist (${String(err)}); using fallback allowlist`);
    return FALLBACK_ALLOWLIST;
  }
}
export {
  readCoordinatorBashAllowlist
};
