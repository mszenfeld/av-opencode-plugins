function isSerenaAvailable(config) {
  const entry = config.mcp?.serena;
  if (entry === null || typeof entry !== "object") return false;
  const { enabled } = entry;
  return enabled !== false;
}
export {
  isSerenaAvailable
};
