export interface Finding {
  severity: string
  title: string
  [k: string]: unknown
}

export interface FindingWithId extends Finding {
  id: string
}

export function assignIssueIds(input: {
  findings: Finding[]
  prefix: string
  startAt?: number
}): FindingWithId[] {
  const { findings, prefix, startAt = 1 } = input
  return findings.map((finding, index) => ({
    ...finding,
    id: `${prefix}-${String(startAt + index).padStart(3, "0")}`,
  }))
}
