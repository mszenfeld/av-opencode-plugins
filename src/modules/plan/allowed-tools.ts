// Built-in tool allow-list for the Veles planning agent (emitted into the
// prompt frontmatter). PLUGIN tools (dispatch_parallel / dispatch_background /
// poll_background / wait_background) are NOT listed here — they are enabled via
// the `AgentConfig.tools` boolean map in index.ts (mirrors QA's execute_recipe
// opt-in). The git/gh/command/date/mkdir Bash tokens are the BROAD forms that
// are exact members of the /create-qa-plan command's allow-list, so the shared
// qa-plan-authoring skill's allowed-tools are an exact subset of both callers.

const SERENA_READ_TOOLS = [
  "serena_find_symbol",
  "serena_find_referencing_symbols",
  "serena_get_symbols_overview",
  "serena_search_for_pattern",
  "serena_find_file",
  "serena_list_dir",
  "serena_read_file",
]

const STRUCTURED_TOOLS = ["Read", "Glob", "Grep", "Write"]

const BASH_TOOLS = [
  "Bash(gh:*)",
  "Bash(git:*)",
  "Bash(command:*)",
  "Bash(date:*)",
  "Bash(mkdir:*)",
]

const HARNESS_TOOLS = ["skill", "question"]

export const VELES_TOOLS: string[] = [
  ...SERENA_READ_TOOLS,
  ...STRUCTURED_TOOLS,
  ...BASH_TOOLS,
  ...HARNESS_TOOLS,
]
