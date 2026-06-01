---
allowed-tools: Bash(gh:*), Bash(git:*), Bash(command:*), Bash(echo:*), Bash(find:*), Bash(ls:*), Bash(cat:*), Bash(head:*), Bash(mkdir:*), Bash(jq:*), Bash(date:*), Read, Write, Glob, Grep, todowrite, skill, question
argument-hint: [PR number, branch name, or natural language description of changes to analyze]
description: Analyze code changes (PR, branch, commits) and generate a detailed QA test plan with FE and BE scenarios, edge cases, and tool detection.
---

# QA Test Plan Generator

Analyze code changes and generate a comprehensive QA test plan.

**Input:** `$ARGUMENTS` (PR number, branch, `last N commits`, `staged`, or empty for the default: open PR on current branch → branch diff vs main).

## Workflow

### Step 1: Create progress tasks

Create these tasks with `todowrite`:

| # | subject | activeForm |
|---|---------|-----------|
| 1 | Author test plan | Authoring test plan... |
| 2 | Save & propose next step | Saving test plan... |

Mark task 1 `in_progress`.

### Step 2: Author the plan

Load and follow the authoring skill, passing `$ARGUMENTS` as the diff-source argument:

```
skill(name: "qa-plan-authoring")
```

The skill resolves the diff source, classifies FE/BE, gathers context, detects tools, generates the `## Setup` section and FE/BE scenarios (loading `test-plan-format` for the structure), and saves the plan to `docs/testing/plans/YYYY-MM-DD-<topic>-test-plan.md`.

Mark task 1 `completed`, task 2 `in_progress`.

### Step 3: Propose next step

After the skill saves the plan, display:

> **Test plan saved to `docs/testing/plans/<filename>`.**
>
> Review the plan, then run the tests with:
>
> `/run-qa`
>
> or specify the plan path:
>
> `/run-qa docs/testing/plans/<filename>`

Mark task 2 `completed`.
