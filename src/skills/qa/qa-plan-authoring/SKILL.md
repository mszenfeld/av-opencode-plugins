---
name: qa-plan-authoring
description: Author a QA test plan from a code diff — resolve diff source, classify FE/BE, gather context, detect tools, infer Setup, generate scenarios, save the plan.
activation: Load when generating a QA test plan from code changes (used by /create-qa-plan and by the Veles planner).
allowed-tools: Bash(gh:*), Bash(git:*), Bash(command:*), Bash(date:*), Bash(mkdir:*), Read, Write, Glob, Grep
---

# QA Plan Authoring

Produce a comprehensive QA test plan from a set of code changes. The caller
decides what to do with the saved plan (the `/create-qa-plan` command tells the
user to review and run `/run-qa`; the Veles planner returns a JSON summary to
Perun). This skill covers ONLY authoring + saving.

## Step 1: Resolve the diff source

Parse the caller's argument to choose the diff:

| Argument | Diff |
|----------|------|
| (empty) | open PR on current branch, else branch diff vs main |
| `#123` / `PR #123` | `gh pr diff 123` |
| `feature/xyz` | `git diff <main>...feature/xyz` |
| `this branch` / `current branch` / `ten branch` | `git diff <main>...HEAD` |
| `last N commits` / `ostatnie N commitów` | `git diff HEAD~N...HEAD` |
| `staged` | `git diff --staged` |

Default (no argument):

```bash
gh pr view --json number,title,headRefName,baseRefName 2>/dev/null
# if a PR exists:
gh pr diff <number>
# else, branch diff:
MAIN_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo "main")
git diff $MAIN_BRANCH...HEAD
```

Also collect the changed file list (`gh pr diff <n> --name-only`, or `git diff --name-only <range>`).

## Step 2: Classify each changed file FE vs BE

- **Frontend:** `.tsx/.jsx/.vue/.svelte/.css/.scss/.html`; paths with `app/ components/ pages/ views/ layouts/ styles/ public/ assets/ frontend/ client/ web/`.
- **Backend:** `.py/.php/.go/.java/.rb/.rs`; paths with `api/ controllers/ models/ migrations/ serializers/ services/ repositories/ backend/ server/`; `urls.py routes.py routes.php router.go`.
- **Ambiguous** (`.ts/.js`): inspect imports/path context.

For each file note: what changed, change kind (new/modify/delete/refactor), what behavior to test.

## Step 3: Gather context

Read related files: routers/URL configs, serializers/schemas, models for changed endpoints; parent components, stores, API calls for changed components; endpoints using changed models/migrations. Look for `docs/`, OpenAPI/Swagger (`openapi.{json,yaml}`, `swagger.{json,yaml}`), READMEs, and existing tests (what is already covered vs missing).

## Step 4: Detect available tools

```bash
command -v curl >/dev/null 2>&1 && echo "curl: available" || echo "curl: unavailable"
command -v http >/dev/null 2>&1 && echo "httpie: available" || echo "httpie: unavailable"
command -v psql >/dev/null 2>&1 && echo "psql: available" || echo "psql: unavailable"
command -v sqlite3 >/dev/null 2>&1 && echo "sqlite3: available" || echo "sqlite3: unavailable"
command -v mysql >/dev/null 2>&1 && echo "mysql: available" || echo "mysql: unavailable"
command -v playwright >/dev/null 2>&1 && echo "Playwright CLI: available" || echo "Playwright CLI: unavailable"
```

## Step 5: Output format + Setup section

Load the format skill: `skill(name: "test-plan-format")`. Follow it for frontmatter (`source`, `branch`, `base-url`, `detected-tools`) and overall structure.

Generate the `## Setup` section (placed after frontmatter, before `## FE Test Scenarios` / `## BE Test Scenarios`) by inferring from the diff:

- New `process.env.X` / `os.environ["X"]` / `getenv("X")` / `ENV["X"]` → add `X` to `**Required environment variables:**` (name must match `^[A-Z_][A-Z0-9_]*$`).
- New service URL (`https?://localhost:\d+`, `redis://`, `postgres://`, `mongodb://`) → `**Required services:**`.
- New DB connection string → `**Required databases:**` with an explicit scheme (`postgresql://…`, `mysql://…`, `redis://…`, `sqlite:///…`).

Rules: one backtick group per item; free text after it is for humans; ≤50 items; omit the whole `## Setup` section if nothing is needed. Mark items as best-effort inferences for the user to review.

## Step 6: Generate scenarios

- **FE** (if FE changes): one scenario per changed component/page/feature, concrete UI element names from the code, ≥2 edge cases each.
- **BE** (if BE changes): one scenario per changed endpoint, real paths/methods/payloads, DB checks with real table/column names, ≥2 edge cases each (error handling, auth, validation).

## Step 7: Save

```bash
mkdir -p docs/testing/plans
date +%Y-%m-%d
```

Write with the `Write` tool to `docs/testing/plans/YYYY-MM-DD-<topic>-test-plan.md`, where `<topic>` is a slug (lowercase, hyphens) summarizing the changes. Return the saved path to the caller.
