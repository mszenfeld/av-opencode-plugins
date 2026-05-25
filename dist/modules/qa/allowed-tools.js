const SHARED_TOOLS = [
  "Read",
  "Write",
  "skill",
  "Bash(mkdir:*)",
  "Bash(command:*)",
  // Bash(echo:*) intentionally removed — shell var-expansion can leak secret
  // values (e.g. `echo "credentials: $TEST_USER_PASSWORD"` would persist to
  // the QA report). Use `Bash(printf:*)` for status reporting instead.
  // See SEC-002 (CWE-532, OWASP A09:2025).
  "Bash(printf:*)"
];
const FE_TOOLS = [
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
  "Bash(playwright:*)"
];
const BE_TOOLS = [
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
  "Bash(tail:./*)"
];
function toolsForVariant(stack) {
  const stackTools = stack === "fe" ? FE_TOOLS : BE_TOOLS;
  return Array.from(/* @__PURE__ */ new Set([...SHARED_TOOLS, ...stackTools]));
}
export {
  BE_TOOLS,
  FE_TOOLS,
  SHARED_TOOLS,
  toolsForVariant
};
