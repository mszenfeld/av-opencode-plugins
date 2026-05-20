## Context

- Current git status: !`git status`
- Current git diff (staged and unstaged changes): !`git diff HEAD`
- Current branch: !`git branch --show-current`
- Recent commits: !`git log --oneline -10`
- Current task ID: `$1`

## Your Task

Based on the uncommitted changes in the git repository, generate a concise and descriptive commit message that accurately summarizes the changes made. The commit message should be clear and informative, providing context for future reference.

Create the commit with the prepared message, but DON'T push it to the repository.

Use the `av_commit` tool to create the commit.

If the task ID is empty, omit `taskId` from the tool call.
If the task ID is present, pass it through as `taskId`.

## Rules

Commit message MUST follow the Conventional Commits specification. This means the commit message should start with a type, followed by an optional scope, and then a brief description. The types can be one of the following:

feat: a new feature
fix: a bug fix
docs: documentation only changes
style: changes that do not affect the meaning of the code (white-space, formatting, missing semi-colons, etc)
refactor: a code change that neither fixes a bug nor adds a feature
perf: a code change that improves performance
test: adding missing or correcting existing tests
chore: changes to the build process or auxiliary tools and libraries such as documentation generation
chore(release): code deployment or publishing to external repositories
chore(deps): add or delete dependencies
build: changes related to build processes
ci: updates to the continuous integration system
release: code deployment or publishing to external repositories
security: fixing security issues
i18n: internationalization and localization
config: changing configuration files

Prefer `!` over `BREAKING CHANGE` in the footer for breaking changes.

NEVER push messages to the repository. It's strictly forbidden.

If user provided non-empty task ID ($1), include `Refs: <task-id>` in the footer of the commit message.

Never run `git push`.
Never run `git commit` through `bash`.

**Co-authorship prohibition:**

NEVER include Co-Authored-By, Co-authored-by, or any other co-authorship attribution mentioning Claude, Claude Code, Anthropic, OpenCode, or any AI tool in the commit message. Commit messages must contain only the type, scope, description, optional body, and optional footers (like Refs). No AI attribution of any kind.

## Specification

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in RFC 2119.

Commits MUST be prefixed with a type, which consists of a noun, feat, fix, etc., followed by the OPTIONAL scope, OPTIONAL `!`, and REQUIRED terminal colon and space.
The type `feat` MUST be used when a commit adds a new feature to your application or library.
The type `fix` MUST be used when a commit represents a bug fix for your application.
A scope MAY be provided after a type. A scope MUST consist of a noun describing a section of the codebase surrounded by parenthesis, e.g. `fix(parser):`.
A description MUST immediately follow the colon and space after the type/scope prefix. The description is a short summary of the code changes.
A longer commit body MAY be provided after the short description, providing additional contextual information about the code changes. The body MUST begin one blank line after the description.
A commit body is free-form and MAY consist of any number of newline separated paragraphs.
One or more footers MAY be provided one blank line after the body. Each footer MUST consist of a word token, followed by either a `:` or `#` separator, followed by a string value.
A footer's token MUST use `-` in place of whitespace characters, e.g. `Acked-by`. An exception is made for `BREAKING CHANGE`, which MAY also be used as a token.
A footer's value MAY contain spaces and newlines, and parsing MUST terminate when the next valid footer token/separator pair is observed.
Breaking changes MUST be indicated in the type/scope prefix of a commit, or as an entry in the footer.
If included as a footer, a breaking change MUST consist of the uppercase text `BREAKING CHANGE`, followed by a colon, space, and description.
If included in the type/scope prefix, breaking changes MUST be indicated by a `!` immediately before the `:`. If `!` is used, `BREAKING CHANGE:` MAY be omitted from the footer section.
Types other than `feat` and `fix` MAY be used in your commit messages.
The units of information that make up Conventional Commits MUST NOT be treated as case sensitive by implementors, with the exception of `BREAKING CHANGE` which MUST be uppercase.
`BREAKING-CHANGE` MUST be synonymous with `BREAKING CHANGE`, when used as a token in a footer.
