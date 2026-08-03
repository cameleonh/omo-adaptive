---
name: remove-deadcode
description: "Safely find and remove unused code inside an explicit scope, using an isolated worktree, reference evidence, and project tests. Use only when the user directly requests dead-code removal or unused-code cleanup."
argument-hint: "[file, directory, package, or symbol]"
disable-model-invocation: true
---

# Remove Dead Code

Remove only code that is proven unused. This workflow is intentionally manual because deletion can be difficult to recover from and dynamic consumers are easy to miss.

## Non-negotiable safety rules

- Require an explicit scan scope. If the user did not provide one, ask before proceeding. Never silently expand a file request to a repository-wide cleanup.
- Perform mutations only in a task-owned git worktree, or in a worktree the user explicitly identified as isolated for this cleanup. The user's primary working directory is read-only context.
- Record the original repository, branch, full base SHA, worktree path, and `git status --short` before editing.
- Preserve all pre-existing changes. An assigned file with an unexpected diff is not clean ownership and must be skipped until the user resolves it.
- Do not delete entry points, public exports, configuration, generated registries, migrations, tests, fixtures, skills, hooks, templates, or package metadata merely because a text search finds no callers.
- Do not commit, push, open a PR, or notify another service unless the user separately authorizes that action.
- Never use `git checkout --`, `git restore`, `git reset`, or an entire-file overwrite as failure recovery.

## Phase 1: Read-only discovery

1. Read all applicable repository instructions and identify the language, build system, exported surfaces, registries, and test commands.
2. Run the project's language-native unused-code checks when they already exist. Do not add a new dependency solely for this scan.
3. Use `Grep`, `Glob`, and `Read` to inspect imports, re-exports, string-based registration, reflection, framework conventions, package exports, tests, generated code, and configuration consumers.
4. For broad scopes, use the Claude Code `Agent` tool with one or more `omo-adaptive:explorer` agents for independent read-only searches. Give each agent a distinct question and an exact scope.
5. For every candidate, capture at least two independent evidence types when available, such as compiler output plus reference search, or export analysis plus tests.

Text search alone is not proof. Dynamic loading, dependency injection, serialization names, CLI registration, and external package consumers can all make a symbol live without a direct import.

## Phase 2: Candidate review gate

Apply false-positive guards and present the proposed changes before editing:

| Candidate | Exact location | Proposed action | Reference evidence | Dynamic-consumer checks | Validation command |
|---|---|---|---|---|---|

If more than 50 candidates remain, stop and ask the user to narrow the scope. If any candidate affects a public or dynamically registered surface, mark it `uncertain` and do not remove it.

Ask the user to approve the exact candidate table. Approval of the scan scope is not approval of every deletion.

## Phase 3: Isolated execution

After candidate approval:

1. Create or enter the approved task-owned worktree at the recorded base SHA. Verify every owned path is clean in that worktree.
2. Group changes by exact file ownership. Two concurrent agents must never edit the same file.
3. Use the Claude Code `Agent` tool with `omo-adaptive:worker-low` or `omo-adaptive:worker-medium` only when independent batches justify parallelism. Give each worker the exact files, symbols, actions, and validation commands. Tell it not to commit or push.
4. Make the smallest approved deletion. Do not opportunistically refactor neighboring code.
5. Run the narrow typecheck, lint, or test that can detect a broken consumer, followed by the relevant package or project suite. Compare failures with the recorded baseline.

## Patch-only rollback

Each batch begins with clean owned paths, so its diff is attributable to that batch. Before validation, save the exact binary diff for only those paths as the batch patch.

If validation fails because of the batch:

1. Check that the reverse of the saved patch applies cleanly.
2. Reverse-apply only that saved patch.
3. Re-run the narrow validation to prove the isolated worktree returned to its prior state.
4. Report the failed candidate and evidence. Do not try a broader rollback.

If the reverse patch no longer applies, stop and preserve the worktree for inspection. Never replace the whole file or discard another actor's changes.

## Completion report

Report:

- repository, branch, base SHA, and worktree path
- approved scope and candidates
- removed symbols or files with evidence
- skipped or uncertain candidates with reasons
- exact validation commands and results
- final diff summary and worktree status
- confirmation that no commit, push, PR, merge, or external notification occurred

Leave the verified changes uncommitted. Ask whether the user wants a separate commit or PR workflow.
