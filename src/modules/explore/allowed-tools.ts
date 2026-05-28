// Read-only allow-list for the Triglav exploration agent.
//
// The REAL read-only boundary is the exclusion of every structured write tool
// (Write/Edit/serena-write) — OpenCode's allow-list is deny-by-default, so an
// unlisted write tool is not callable.
//
// The Bash entries below have been tightened from raw omo-parity: git is
// invoked with `--no-pager` to neutralize the pager/GIT_EXTERNAL_DIFF spawn
// vector, and the search verbs (grep/rg) are scoped to the working tree
// (`./*`) like the cat/head/tail entries. This is still NOT a sandbox.
// Token-matching cannot inspect flag values, so residual code-exec/file-write
// vectors remain — e.g. `rg --pre <prog>` (runs an arbitrary preprocessor) and
// `git -c core.pager=<cmd>` (re-introduces a pager). Closing those fully
// requires an exec sandbox, which is out of scope here. Per AGENTS.md, Bash
// token-matching is defense-in-depth, not a security boundary.

const SERENA_READ_TOOLS = [
  "serena_find_symbol",
  "serena_find_referencing_symbols",
  "serena_get_symbols_overview",
  "serena_search_for_pattern",
  "serena_find_file",
  "serena_list_dir",
  "serena_read_file",
]

const STRUCTURED_READ_TOOLS = ["Read", "Glob", "Grep"]

const READONLY_BASH_TOOLS = [
  "Bash(grep:./*)",
  "Bash(cat:./*)",
  "Bash(head:./*)",
  "Bash(tail:./*)",
  "Bash(rg:./*)",
  "Bash(git --no-pager log:*)",
  "Bash(git --no-pager blame:*)",
]

export const TRIGLAV_TOOLS: string[] = [
  ...SERENA_READ_TOOLS,
  ...STRUCTURED_READ_TOOLS,
  ...READONLY_BASH_TOOLS,
]
