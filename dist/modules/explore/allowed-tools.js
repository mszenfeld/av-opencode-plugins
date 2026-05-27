const SERENA_READ_TOOLS = [
  "serena_find_symbol",
  "serena_find_referencing_symbols",
  "serena_get_symbols_overview",
  "serena_search_for_pattern",
  "serena_find_file",
  "serena_list_dir",
  "serena_read_file"
];
const STRUCTURED_READ_TOOLS = ["Read", "Glob", "Grep"];
const READONLY_BASH_TOOLS = [
  "Bash(grep:./*)",
  "Bash(cat:./*)",
  "Bash(head:./*)",
  "Bash(tail:./*)",
  "Bash(rg:./*)",
  "Bash(git --no-pager log:*)",
  "Bash(git --no-pager blame:*)"
];
const TRIGLAV_TOOLS = [
  ...SERENA_READ_TOOLS,
  ...STRUCTURED_READ_TOOLS,
  ...READONLY_BASH_TOOLS
];
export {
  TRIGLAV_TOOLS
};
