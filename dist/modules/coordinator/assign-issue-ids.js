function assignIssueIds(input) {
  const { findings, prefix, startAt = 1 } = input;
  return findings.map((finding, index) => ({
    ...finding,
    id: `${prefix}-${String(startAt + index).padStart(3, "0")}`
  }));
}
export {
  assignIssueIds
};
