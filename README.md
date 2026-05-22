# AppVerk OpenCode Plugins

[![Plugins](https://img.shields.io/badge/plugins-9-blue.svg)](#repository-structure)

OpenCode plugin packages for AppVerk. The root plugin loads the AppVerk plugin bundle from this repository, which currently provides:

> **Plugin count:** The badge above reflects every plugin registered in `defaultPluginFactories` (`src/index.ts`). This includes `packages/*` workspaces, absorbed modules under `src/modules/` (e.g. `commit`, `qa`, `coordinator`), and harness-resident plugins under `src/hooks/` (e.g. Pantheon). Keep it in sync whenever a new plugin is added or removed there.

- A **controlled commit workflow** (`/commit`) that enforces AppVerk git policies.
- A **Python development workflow** (`/python`) with TDD, coding standards, and stack-specific patterns (FastAPI, Django, Celery, SQLAlchemy, Pydantic).
- A **TypeScript + React development workflow** (`/frontend`) with TDD, coding standards, and stack-specific patterns (Tailwind, Zustand, TanStack Query, React Hook Form, TanStack Router).
- A **code review workflow** (`/review`) with parallel security and quality audits, verification agents, fix commands, feedback analysis, and skill-agent integration.
- A **QA workflow** (`/create-qa-plan`, `/run-qa`) for end-to-end testing — generates test plans from PR descriptions and executes them via Playwright (frontend) or HTTP + DB (backend).
- A **Swift development workflow** (`/swift`) with TDD, coding standards, and modern Apple stack patterns (SwiftUI, `@Observable`, SPM, SwiftData).
- A **Pantheon coordinator** (`@perun`) — primary agent that delegates QA and fix work to specialist subagents via the deterministic `dispatch_parallel` and `assign_issue_ids` tools.
- A **Pantheon session-notification hook** (macOS only) that surfaces agent idle, question, and permission events as native banners — see [docs/plugins/pantheon.md](docs/plugins/pantheon.md).
- A **global skill registry** that makes all AppVerk development skills available to every OpenCode agent via a single `load_appverk_skill` tool, with mandatory activation rules injected into every agent's system prompt.

## Installation

Add the root plugin package to your OpenCode config:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "av-opencode-plugins@git+https://github.com/AppVerk/av-opencode-plugins.git#v0.2.16"
  ]
}
```

Restart OpenCode after updating the config. The root plugin installs the AppVerk plugin bundle and registers the following automatically:

- **Commands:** `/commit`, `/python`, `/frontend`, `/swift`, `/review`, `/fix`, `/fix-report`, `/analyze-feedback`, `/create-qa-plan`, `/run-qa`.
- **Agents:** `@perun` (Pantheon coordinator) alongside the per-stack primaries and QA/review subagents.
- **Global tools:** `load_appverk_skill`, `dispatch_parallel`, `assign_issue_ids`.

See the [Available Commands & Agents](#available-commands--agents) table below for the full inventory.

## Usage

### Commit workflow

Create a commit for the current repository changes:

```text
/commit
```

Create a commit and append a work item reference:

```text
/commit AV-42
```

The command uses the packaged AppVerk workflow, generates a Conventional Commit style message, and routes the final commit through the controlled runtime instead of allowing raw `git commit` from the bash tool.

### /python — Python development workflow

Run the Python development workflow with TDD and stack-specific patterns:

```text
/python Add user authentication endpoint with JWT
```

The `/python` command:

1. Detects your project stack (FastAPI, Django, Celery, etc.)
2. Loads relevant Python development skills
3. Follows TDD: writes tests first, then implementation
4. Runs quality gates (typecheck, tests, lint)

You can also invoke the agent directly:

```bash
opencode agent python-developer "Refactor user service to use repository pattern"
```

### /frontend — TypeScript + React development workflow

Run the TypeScript + React development workflow with TDD and stack-specific patterns:

```text
/frontend Add user profile form with validation
```

The `/frontend` command:

1. Detects your project stack (Tailwind, Zustand, TanStack Query, etc.)
2. Loads relevant TypeScript + React development skills
3. Follows TDD: writes tests first, then implementation
4. Runs quality gates (typecheck, tests, lint)

You can also invoke the agent directly:

```bash
opencode agent frontend-developer "Refactor auth store to use Zustand"
```

### /swift — Swift development workflow

Run the Swift development workflow with TDD and modern Apple stack patterns:

```text
/swift Add user profile screen with SwiftData persistence
```

The `/swift` command:

1. Detects your project stack (SwiftUI, SwiftData, URLSession, etc.)
2. Loads relevant Swift development skills
3. Follows TDD: writes tests first, then implementation
4. Runs quality gates (build, tests)

You can also invoke the agent directly:

```bash
opencode agent swift-developer "Refactor networking layer to use async/await"
```

### @perun — Pantheon coordinator

Delegate QA, review, and fix workflows to specialist subagents through the Pantheon coordinator:

```text
@perun uruchom QA dla docs/testing/plans/2026-05-18-feature-auth-test-plan.md
```

The `@perun` agent:

1. Parses the referenced plan, review report, or QA report
2. Dispatches specialist subagents in parallel via the global `dispatch_parallel` tool (one `@qa-tester` task per scenario, or `@fix-auto` workers). `dispatch_parallel` runs a 4-wide worker pool internally, so a 30-scenario plan drains through 4 workers concurrently without the caller composing waves manually.
3. Assigns deterministic issue IDs across aggregated results via the global `assign_issue_ids` tool
4. Synthesizes a unified report and returns control to the user

`dispatch_parallel` and `assign_issue_ids` are exposed globally to every agent, so other primaries (`@python-developer`, `@frontend-developer`, etc.) can use them directly when coordination is needed.

### Global Skill Registry

All AppVerk development skills are automatically available to every OpenCode agent (built-in and custom) through the `load_appverk_skill` tool. When any agent starts a chat session, mandatory activation rules are injected into its system prompt.

Load a skill manually at any time:

```text
Use the load_appverk_skill tool with name "python-coding-standards"
```

Available skills include:

- `python-coding-standards`, `python-tdd-workflow`, `fastapi-patterns`, `sqlalchemy-patterns`, `pydantic-patterns`, `async-python-patterns`, `uv-package-manager`, `django-web-patterns`, `django-orm-patterns`, `celery-patterns`
- `frontend-coding-standards`, `frontend-tdd-workflow`, `tailwind-patterns`, `zustand-patterns`, `tanstack-query-patterns`, `form-patterns`, `tanstack-router-patterns`, `pnpm-package-manager`
- `standards-discovery` (code review)

### Code review workflow

Run a comprehensive code review with parallel security and quality audits:

```text
/review Review the authentication module for security issues and code quality
```

The `/review` command:

1. Detects your project stack and loads relevant skills (Python, Frontend, PHP)
2. Launches `security-auditor`, `code-quality-auditor`, and optionally `documentation-auditor` agents in parallel
3. Runs verification agents (`cross-verifier`, `challenger`) to validate findings
4. Aggregates findings with unique issue IDs (SEC-001, ARCH-001, etc.)
5. Generates a structured markdown report
6. Optionally saves to `docs/reviews/YYYY-MM-DD-<branch>.md`

### Fix commands

Fix a single issue by ID from a saved report:

```text
/fix SEC-001
```

Or paste the full issue block directly:

```text
/fix [paste issue block from /review or /run-qa]
```

Batch-fix issues from a saved report:

```text
/fix-report docs/reviews/2026-04-22-feature-auth.md
```

### Feedback analysis

Analyze PR comments and generate response drafts:

```text
/analyze-feedback 123
```

Classifies each comment as "Address" or "Reject" and optionally publishes responses via GitHub CLI.

### QA workflow

Generate a structured test plan from a PR description or ticket:

```text
/create-qa-plan Add two-factor authentication to the login flow
```

The `/create-qa-plan` command:

1. Parses the feature description or ticket text
2. Generates test cases with preconditions, steps, and expected results
3. Writes the plan to `docs/testing/plans/YYYY-MM-DD-<topic>-test-plan.md`

Run a saved test plan or perform an ad-hoc QA check:

```text
/run-qa docs/testing/plans/2026-04-29-feature-auth-test-plan.md
```

The `/run-qa` command:

1. Loads the test plan or creates a quick checklist for the given path
2. Routes each scenario to `@qa-tester` based on its `FE-`/`BE-` prefix
3. Dispatches one `@qa-tester` task per scenario through `dispatch_parallel`'s 4-wide worker pool — scenarios with `**Depends-on:**` declarations are grouped into sequential waves via topological sort
4. Executes tests using native Playwright tools (frontend scenarios) or native HTTP and DB CLI tools (backend scenarios)
5. Collects results into a markdown report with pass/fail status

The `@qa-tester` agent is a single logical agent registered as two variants (`qa-tester-fe`, `qa-tester-be`) so the FE and BE tool allowlists stay separate at the OpenCode runtime layer. Perun routes each scenario to the right variant, but every user-facing surface (TUI, report, tab-completion display) shows just `qa-tester`. See [docs/plugins/qa.md](docs/plugins/qa.md) for the variant-split rationale.

## Available Commands & Agents

| Command / Agent          | Description                                                                                                                       | Mode       | Docs                                        |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------- |
| `/commit`                | Controlled commit workflow — Conventional Commit messages, bash-level blocking for direct `git commit`/`git push`.                | —          | [Guide](docs/plugins/commit.md)             |
| `/python`                | Python development workflow — TDD, coding standards, and stack-specific patterns (FastAPI, Django, Celery, SQLAlchemy).           | —          | [Guide](docs/plugins/python-developer.md)   |
| `/frontend`              | TypeScript + React development workflow — TDD, coding standards, and stack-specific patterns (Tailwind, Zustand, TanStack Query). | —          | [Guide](docs/plugins/frontend-developer.md) |
| `/swift`                 | Swift development workflow — TDD, coding standards, and modern Apple stack patterns (SwiftUI, `@Observable`, SPM).                | —          | [Guide](docs/plugins/swift-developer.md)    |
| `/review`                | Code review workflow — parallel security, quality, and documentation audits with verification and structured reports.             | —          | [Guide](docs/plugins/code-review.md)        |
| `/fix`                   | Fix a single issue by ID or pasted issue block from a saved review or QA report.                                                  | —          | [Guide](docs/plugins/code-review.md)        |
| `/fix-report`            | Batch-fix issues from a saved review or QA report with interactive selection.                                                     | —          | [Guide](docs/plugins/code-review.md)        |
| `/analyze-feedback`      | Analyze PR feedback comments, classify validity, and generate response drafts.                                                    | —          | [Guide](docs/plugins/code-review.md)        |
| `/create-qa-plan`        | Generate a structured QA test plan from a PR description or ticket.                                                               | —          | [Guide](docs/plugins/qa.md)                 |
| `/run-qa`                | Execute a saved test plan or ad-hoc QA check via Playwright or HTTP + DB.                                                         | —          | [Guide](docs/plugins/qa.md)                 |
| `load_appverk_skill`     | Load any AppVerk development skill by name. Available to all agents globally.                                                     | —          | [Guide](docs/plugins/skill-registry.md)     |
| `dispatch_parallel`      | Global tool — deterministic parallel dispatch of specialist subagents (QA, fix, audit).                                           | —          | [Guide](docs/plugins/coordinator.md)        |
| `assign_issue_ids`       | Global tool — deterministic issue ID assignment across aggregated specialist results.                                             | —          | [Guide](docs/plugins/coordinator.md)        |
| Pantheon                 | Session-notification hook (macOS only) — surfaces agent idle, questions, and permission events as native macOS banners.          | —          | [Guide](docs/plugins/pantheon.md)           |
| `@perun`                 | Pantheon coordinator — primary agent that delegates to QA/fix/review specialists via `dispatch_parallel` and `assign_issue_ids`.  | `primary`  | [Guide](docs/plugins/coordinator.md)        |
| `@python-developer`      | Direct agent invocation for Python tasks outside of `/python`.                                                                    | `primary`  | [Guide](docs/plugins/python-developer.md)   |
| `@frontend-developer`    | Direct agent invocation for TypeScript + React tasks outside of `/frontend`.                                                      | `primary`  | [Guide](docs/plugins/frontend-developer.md) |
| `@swift-developer`       | Direct agent invocation for Swift tasks outside of `/swift`.                                                                      | `primary`  | [Guide](docs/plugins/swift-developer.md)    |
| `@security-auditor`      | Direct agent invocation for security audits with skill-agent delegation.                                                          | `subagent` | [Guide](docs/plugins/code-review.md)        |
| `@code-quality-auditor`  | Direct agent invocation for code quality audits with skill-agent delegation.                                                      | `subagent` | [Guide](docs/plugins/code-review.md)        |
| `@documentation-auditor` | Documentation audit agent — verifies code changes are reflected in docs.                                                          | `subagent` | [Guide](docs/plugins/code-review.md)        |
| `@cross-verifier`        | Cross-domain correlation agent — finds intersections between findings.                                                            | `subagent` | [Guide](docs/plugins/code-review.md)        |
| `@challenger`            | Adversarial review agent — challenges findings for false positives.                                                               | `subagent` | [Guide](docs/plugins/code-review.md)        |
| `@synthesis-agent`       | **Planned** — deduplicates and groups findings into actionable PRs. Not yet implemented.                                          | `subagent` | [Guide](docs/plugins/code-review.md)        |
| `@qa-tester`             | QA testing subagent — executes a single scenario per dispatch (FE via Playwright, BE via HTTP + DB CLI). Registered as variants `qa-tester-fe` and `qa-tester-be` in `/agents` for runtime tool-allowlist isolation; presented as the single logical name everywhere user-facing — see [qa.md](docs/plugins/qa.md). | `subagent` | [Guide](docs/plugins/qa.md)                 |
| `@feedback-analyzer`     | Per-comment classification agent for PR feedback analysis.                                                                        | `subagent` | [Guide](docs/plugins/code-review.md)        |
| `@fix-auto`              | Auto-fix subagent — performs fixes without user confirmation.                                                                     | `subagent` | [Guide](docs/plugins/code-review.md)        |

> **Note on Mode:** Commands always appear in tab-completion. Agents marked `primary` also appear in tab-completion, while `subagent` agents are hidden and must be invoked explicitly (e.g., `@fix-auto`).

## Repository Structure

- `src/modules/commit/` - plugin source for the commit workflow (TypeScript only).
- `src/commands/commit.md` - the `/commit` slash-command template.
- `tests/modules/commit/` - tests for the commit workflow.
- `docs/plugins/commit.md` - package-level behavior and usage guide.
- `packages/python-developer` - plugin source, tests, skill files, and build scripts for the Python development workflow.
- `docs/plugins/python-developer.md` - package-level behavior and usage guide.
- `packages/code-review` - plugin source, tests, agent prompts, command template, and build scripts for the code review workflow.
- `docs/plugins/code-review.md` - package-level behavior and usage guide.
- `packages/frontend-developer` - plugin source, tests, skill files, and build scripts for the TypeScript + React development workflow.
- `docs/plugins/frontend-developer.md` - package-level behavior and usage guide.
- `packages/skill-registry` - global skill registry source, tests, and build scripts.
- `docs/plugins/skill-registry.md` - package-level behavior and usage guide.
- `src/modules/qa/` - absorbed QA plugin source (TypeScript only). Registers the `qa-tester-fe` / `qa-tester-be` subagent variants composed via `prompt-builder.ts`. Assets live under `src/commands/{create-qa-plan,run-qa}.md`, `src/skills/qa/**`, and `src/modules/qa/prompt-sections/*.md`. Tests in `tests/modules/qa/`.
- `docs/plugins/qa.md` - package-level behavior and usage guide.
- `packages/swift-developer` - plugin source, tests, skill files, and build scripts for the Swift development workflow.
- `docs/plugins/swift-developer.md` - package-level behavior and usage guide.
- `src/modules/coordinator/` - absorbed Pantheon coordinator source (TypeScript only). Registers `@perun`, `dispatch_parallel` (4-worker pool, cap 50), and `assign_issue_ids`. Asset: `src/agents/perun.md`. Tests in `tests/modules/coordinator/`.
- `docs/plugins/coordinator.md` - package-level behavior and usage guide.
- `src/hooks/session-notification` - harness-resident Pantheon plugin (session-notification hook) wired in directly from `src/index.ts` rather than as a `packages/*` workspace.
- `docs/plugins/pantheon.md` - plugin-level behavior and configuration guide.
- `package.json` - workspace definition and shared validation commands.

## Local Development

Install workspace dependencies:

```bash
npm install
```

Run the main validation commands:

```bash
npm run typecheck
npm run test
npm run build
npm run check
```

## Documentation

- [Commit Plugin Guide](docs/plugins/commit.md)
- [Python Developer Plugin Guide](docs/plugins/python-developer.md)
- [Code Review Plugin Guide](docs/plugins/code-review.md)
- [Frontend Developer Plugin Guide](docs/plugins/frontend-developer.md)
- [Skill Registry Plugin Guide](docs/plugins/skill-registry.md)
- [QA Plugin Guide](docs/plugins/qa.md)
- [Swift Developer Plugin Guide](docs/plugins/swift-developer.md)
- [Pantheon Plugin Guide](docs/plugins/pantheon.md)
- [Coordinator Plugin Guide](docs/plugins/coordinator.md)

### Architecture & Migration

Canonical reference for the in-progress `src/` TypeScript absorption program — read these before adding or modifying an absorbed module (Stage 1 of N: commit pilot):

- [Spec: src TypeScript migration — commit pilot (design)](docs/superpowers/specs/2026-05-20-src-typescript-migration-commit-pilot-design.md) — design rationale (e.g. `bundle: false`, build-order constraints, `tsup.root.config.ts` filename).
- [Plan: src TypeScript migration — commit pilot](docs/superpowers/plans/2026-05-20-src-typescript-migration-commit-pilot.md) — staged execution plan for absorbing modules into `src/`.

## License

This repository currently does not include a top-level `LICENSE` file. Add one before publishing or distributing the packages beyond internal use.
