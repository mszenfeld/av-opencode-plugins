interface Finding {
    severity: string;
    title: string;
    [k: string]: unknown;
}
interface FindingWithId extends Finding {
    id: string;
}
declare function assignIssueIds(input: {
    findings: Finding[];
    prefix: string;
    startAt?: number;
}): FindingWithId[];

export { type Finding, type FindingWithId, assignIssueIds };
