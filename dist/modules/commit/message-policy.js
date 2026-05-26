const COMMIT_HEADER = /^(feat|fix|docs|style|refactor|perf|test|chore|build|ci|release|security|i18n|config)(\([a-z0-9-]+\))?!?: .+$/i;
const DISALLOWED_FOOTERS = [/^co-authored-by:/i];
function sanitizeTaskId(taskId) {
  if (/[\r\n]/.test(taskId)) {
    throw new Error(
      "Task ID must not contain newlines or carriage returns."
    );
  }
  return taskId.trim();
}
function assertNoDisallowedFooters(lines) {
  if (lines.some(
    (line) => DISALLOWED_FOOTERS.some((pattern) => pattern.test(line.trim()))
  )) {
    throw new Error("Co-Authored-By footers are not allowed.");
  }
}
function normalizeCommitMessage(message, taskId) {
  const normalized = message.trim();
  if (!normalized) {
    throw new Error("Commit message cannot be empty.");
  }
  const lines = normalized.split(/\r?\n/);
  const header = lines[0] ?? "";
  if (!COMMIT_HEADER.test(header)) {
    throw new Error("Commit message must follow Conventional Commits.");
  }
  assertNoDisallowedFooters(lines);
  if (!taskId) {
    return normalized;
  }
  const sanitizedTaskId = sanitizeTaskId(taskId);
  if (!sanitizedTaskId) {
    return normalized;
  }
  const refsFooter = `Refs: ${sanitizedTaskId}`;
  if (lines.some((line) => line.trim() === refsFooter)) {
    return normalized;
  }
  const combined = `${normalized}

${refsFooter}`;
  assertNoDisallowedFooters(combined.split(/\r?\n/));
  return combined;
}
export {
  normalizeCommitMessage
};
