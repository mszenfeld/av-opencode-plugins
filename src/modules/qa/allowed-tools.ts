// Per-variant tool allowlists for zmora variants. Splitting at this layer
// keeps the runtime tool-allowlist as the security boundary: one variant
// cannot exec the other variant's tools regardless of prompt content.

export const SHARED_TOOLS = [
  "Read",
  "Write",
  "skill",
  "Bash(mkdir:*)",
  "Bash(command:*)",
  // Bash(echo:*) intentionally removed — shell var-expansion can leak secret
  // values (e.g. `echo "credentials: $TEST_USER_PASSWORD"` would persist to
  // the QA report). Use `Bash(printf:*)` for status reporting instead.
  // See SEC-002 (CWE-532, OWASP A09:2025).
  "Bash(printf:*)",
]

export const FE_TOOLS = [
  "playwright_browser_navigate",
  "playwright_browser_click",
  "playwright_browser_fill_form",
  "playwright_browser_snapshot",
  "playwright_browser_take_screenshot",
  "playwright_browser_press_key",
  "playwright_browser_select_option",
  "playwright_browser_hover",
  "playwright_browser_wait_for",
  "playwright_browser_evaluate",
  "playwright_browser_console_messages",
  "playwright_browser_navigate_back",
  "playwright_browser_tabs",
  "playwright_browser_handle_dialog",
  "playwright_browser_resize",
  "playwright_browser_close",
  "playwright_browser_drag",
  "playwright_browser_type",
  "playwright_browser_file_upload",
  "playwright_browser_network_requests",
  "Bash(playwright:*)",
]

export const BE_TOOLS = [
  "Bash(curl:*)",
  "Bash(httpie:*)",
  "Bash(http:*)",
  "Bash(psql:*)",
  "Bash(sqlite3:*)",
  "Bash(mysql:*)",
  "Bash(mongosh:*)",
  "Bash(redis-cli:*)",
  "Bash(jq:*)",
  "Bash(grep:*)",
  "Bash(cat:./*)",
  "Bash(head:./*)",
  "Bash(tail:./*)",
]

export type QaTesterStack = "fe" | "be"

export function toolsForVariant(stack: QaTesterStack): string[] {
  const stackTools = stack === "fe" ? FE_TOOLS : BE_TOOLS
  // Dedup is unnecessary (FE_TOOLS and BE_TOOLS are disjoint) but cheap and
  // future-proof if someone moves an entry into SHARED_TOOLS.
  return Array.from(new Set([...SHARED_TOOLS, ...stackTools]))
}
