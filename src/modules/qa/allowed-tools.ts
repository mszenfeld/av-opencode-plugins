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

// zmora-setup has no direct Bash actuators for recipe execution; the plugin's
// `execute_recipe` tool is the sole channel that mints/refreshes bindings.
// Read/Glob/Grep are permitted only for inspecting project context when
// diagnosing recipe failures — not for executing anything.
export const SETUP_TOOLS = [
  "Read",
  "Glob",
  "Grep",
  "execute_recipe",
]

export type QaTesterStack = "fe" | "be" | "setup"

export function toolsForVariant(stack: QaTesterStack): string[] {
  switch (stack) {
    case "fe":
      return Array.from(new Set([...SHARED_TOOLS, ...FE_TOOLS]))
    case "be":
      return Array.from(new Set([...SHARED_TOOLS, ...BE_TOOLS]))
    case "setup":
      return SETUP_TOOLS
  }
}
