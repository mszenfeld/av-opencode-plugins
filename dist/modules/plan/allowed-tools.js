const SERENA_READ_TOOLS = [
  "serena_find_symbol",
  "serena_find_referencing_symbols",
  "serena_get_symbols_overview",
  "serena_search_for_pattern",
  "serena_find_file",
  "serena_list_dir",
  "serena_read_file"
];
const STRUCTURED_TOOLS = ["Read", "Glob", "Grep", "Write"];
const BASH_TOOLS = [
  "Bash(gh:*)",
  "Bash(git:*)",
  "Bash(command:*)",
  "Bash(date:*)",
  "Bash(mkdir:*)"
];
const HARNESS_TOOLS = ["skill", "question"];
const VELES_TOOLS = [
  ...SERENA_READ_TOOLS,
  ...STRUCTURED_TOOLS,
  ...BASH_TOOLS,
  ...HARNESS_TOOLS
];
export {
  VELES_TOOLS
};
