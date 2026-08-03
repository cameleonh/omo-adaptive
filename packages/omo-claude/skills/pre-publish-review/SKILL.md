---
name: pre-publish-review
description: Use when the user explicitly requests a release-readiness, pre-publish, or safe-to-publish review of the current repository or a named release candidate.
disable-model-invocation: true
---

# Pre-Publish Review

This is a read-only release gate. It reviews a concrete candidate and returns evidence; it never publishes, pushes, tags, merges, changes versions, or edits release files.

Run from the main Claude Code conversation so all review agents are launched directly. Subagents cannot delegate further.

## Entry gate

Require an explicit pre-publish review request. A plain request to publish or release is not permission to invoke this workflow.

Identify and verify:

- repository and package or artifact being released;
- exact candidate ref or commit;
- published or comparison base;
- intended version and release channel, when known; and
- user constraints on network access and verification commands.

If multiple plausible bases exist, ask before choosing. Never silently substitute the working tree, latest tag, registry version, or default branch for the requested candidate.

## 1. Build the release evidence packet

Use the `Skill` tool to invoke `omo-adaptive:get-unpublished-changes`, then independently verify its scope with read-only Git commands. At minimum capture:

- `git status --short`;
- candidate and base commit IDs;
- commit list for the exact range;
- changed-file list and diff stat;
- full diff or per-file diffs for every changed path;
- `git diff --check` for the range and relevant working-tree changes;
- package, lockfile, plugin, marketplace, or release metadata changes; and
- documented build, test, lint, typecheck, package, and validation commands.

If registry or remote lookup is unavailable, use a user-approved local base and record the limitation. Do not pretend a network-derived version was verified.

For this monorepo, map each change to the applicable release surface:

| Surface | Examples |
|---|---|
| shared/core | reusable packages, MCP runtimes, shared skills, release scripts |
| OpenCode | OpenCode adapter, CLI, hooks, tools, configuration, npm payload |
| Codex | `packages/omo-codex`, LazyCodex payload, bundled runtime metadata |
| Claude Code | `packages/omo-claude`, plugin agents, skills, hooks, marketplace metadata |

Mark unaffected surfaces explicitly. Do not infer a version bump from commit messages alone; inspect the diff and public behavior.

## 2. Run bounded review lanes

Launch at most four concurrent `Agent` calls. Every prompt receives the exact base, candidate, changed files, scope constraints, and evidence locations. Agents must read the actual diff and cite `file:line` or command output.

| Agent | Lane |
|---|---|
| `omo-adaptive:code-reviewer` | Correctness, public API and behavior compatibility, error handling, test relevance, and maintainability. |
| `omo-adaptive:code-reviewer` | Security, trust boundaries, dependency and artifact provenance, secrets, install/update hooks, and unsafe release behavior. |
| `omo-adaptive:qa-executor` | Run the smallest applicable validation matrix and report exact commands, exit codes, failures, skips, and artifacts. |
| `omo-adaptive:explorer` | Packaging contents, generated/source parity, documentation and changelog drift, version consistency, and blast radius. |

Omit a lane only when it is demonstrably irrelevant and say why. If a named plugin agent is unavailable, perform the lane locally and disclose reduced independence.

Review agents must not edit source, update lockfiles, install globally, publish, push, or contact users. If a verification command would mutate tracked files or external state, run it only in an approved isolated environment or report it as not run. A passing command without captured exit status is not release evidence.

Each lane returns:

- `PASS` or `FAIL`;
- risk: `SAFE`, `CAUTION`, `RISKY`, or `BLOCK`;
- blocking and non-blocking findings with evidence;
- breaking-change analysis and affected users;
- commands actually run; and
- untested or uncertain areas.

## 3. Determine version impact

Recommend a bump separately for every affected release surface and for the overall release workflow:

- `PATCH`: compatible defect correction with no new public behavior;
- `MINOR`: backward-compatible feature or meaningful new behavior;
- `MAJOR`: incompatible API, configuration, CLI, hook, skill, install, or default-behavior change.

Explain the user-visible reason. When surfaces version independently, do not force one surface's bump onto another without evidence.

## 4. Final gate review

After every lane returns, invoke `omo-adaptive:gate-reviewer` once through the `Agent` tool. Give it the evidence packet and complete lane outputs. Ask it to re-run the decisive checks and verify that:

- the reviewed range is exactly the candidate range;
- no changed path escaped review;
- every success claim has an artifact or command result;
- blocking findings are not softened by summary prose;
- version and migration recommendations match observed behavior; and
- no review action changed the candidate.

Do not deliver a final verdict before this gate returns. The main conversation still owns synthesis and must resolve contradictions against primary evidence.

## Verdict rules

- `BLOCK`: any confirmed critical/high security issue, broken required check, incomplete release artifact, unreviewed changed surface, or unsafe/unknown candidate range.
- `RISKY`: material unresolved compatibility, QA, migration, or deployment risk that the user may consciously accept but should not miss.
- `CAUTION`: all required checks pass, with bounded non-blocking concerns or explicitly accepted coverage gaps.
- `SAFE`: required checks pass, no blocking finding survives review, metadata is coherent, and residual risk is ordinary and stated.

Never convert `not run`, `not applicable`, or `could not verify` into a pass.

## Deliverable

```markdown
# Pre-Publish Review

## Verdict: SAFE | CAUTION | RISKY | BLOCK
- Candidate and base
- Scope and release surfaces
- Commands run and artifacts

## Blocking findings
## Non-blocking findings

## Version recommendation
| Surface | Bump | Evidence and user impact |

## Breaking changes and migration
## Validation matrix
| Check | Command | Result | Evidence |

## Packaging, provenance, and documentation
## Residual risk and post-release monitoring
```

End with the exact issues that must be resolved before publishing. Do not perform those fixes unless the user separately asks for implementation.
