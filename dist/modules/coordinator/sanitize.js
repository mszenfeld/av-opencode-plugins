import path from "node:path";
function neutralizeUntrustedOutput(s) {
  if (s.length === 0) {
    return s;
  }
  let out = s.replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, "");
  out = out.replace(/\x9D[\s\S]*?(?:\x07|\x1b\\)/g, "");
  out = out.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "");
  out = out.replace(/\x9B[0-9;?]*[a-zA-Z]/g, "");
  out = out.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, "");
  out = out.replace(/[‪-‮⁦-⁩]/g, "");
  out = out.replace(/[​-‍﻿]/g, "");
  out = out.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return out;
}
const VARIANT_SUFFIX_PATTERN = /\bqa-tester-(?:fe|be)\b/g;
function normalizeVariantSuffix(s) {
  if (s.length === 0) {
    return s;
  }
  return s.replace(VARIANT_SUFFIX_PATTERN, "qa-tester");
}
const PLAN_DATE_PREFIX = /^\d{4}-\d{2}-\d{2}-/;
const PLAN_SUFFIX = /-test-plan$/;
const VALID_TOPIC = /^[a-z0-9-]+$/i;
function deriveReportPath(planPath, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    throw new Error(`deriveReportPath: invalid date "${today}", expected YYYY-MM-DD`);
  }
  const base = path.posix.basename(planPath).replace(/\.md$/, "");
  const withoutDate = base.replace(PLAN_DATE_PREFIX, "");
  const topic = withoutDate.replace(PLAN_SUFFIX, "");
  if (topic.length === 0) {
    throw new Error(`deriveReportPath: empty topic derived from "${planPath}"`);
  }
  if (!VALID_TOPIC.test(topic)) {
    throw new Error(
      `deriveReportPath: invalid topic "${topic}" (allowed: a-z, 0-9, -)`
    );
  }
  return path.posix.join("docs/testing/reports", `${today}-${topic}-report.md`);
}
export {
  deriveReportPath,
  neutralizeUntrustedOutput,
  normalizeVariantSuffix
};
