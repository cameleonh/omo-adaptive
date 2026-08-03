---
name: get-unpublished-changes
description: "Read-only comparison of HEAD with published OMO releases across shared components, OpenCode, Codex, and the Claude Code plugin. Use for unpublished changes, changelog analysis, release impact, or version recommendations."
---

# Get Unpublished Changes

Analyze the real diff between the latest published state and `HEAD`. Do not mutate the repository, update refs, install dependencies, create files, commit, push, or publish.

## Read-only contract

- Use only read operations such as `Read`, `Grep`, `Glob`, `git status`, `git log`, `git show`, `git diff`, `git tag`, `git ls-remote`, `npm view`, and read-only `gh` queries.
- Do not run `git fetch`, `git pull`, checkout, package installation, formatters, generators, or tests that write snapshots.
- Preserve secrets and personal data. Summarize sensitive diffs instead of reproducing credentials or private content.
- If a release baseline cannot be proven, say so and label the affected conclusion as provisional. Never invent a tag or version.

## Release layers

Classify every changed path before grouping the results:

| Layer | Includes | Release question |
|---|---|---|
| `omo pure components` | `packages/*-core`, MCP packages, shared skills, and reusable scripts | Does a shared contract or payload need a patch, minor, or major note? |
| `omo opencode` | OpenCode adapter, root CLI, config, hooks, tools, and OpenCode-facing docs | What bump and migration note do the OpenCode packages need? |
| `omo codex` | `packages/omo-codex`, `lazycodex-ai`, Codex plugin metadata, and marketplace payload | Is a Codex-specific release or marketplace update required? |
| `omo claude` | `packages/omo-claude`, Claude plugin manifests, settings, agents, skills, hooks, scripts, tests, and cache/install behavior | Does the Claude Code plugin need a version bump, reinstall, or restart note? |

Keep paths containing `senpi`, `omo-senpi`, `senpi-task`, `pi-goal`, or `pi-webfetch` out of user-facing release notes unless the user explicitly asks for those adapters. Record them in an internal-adapter exclusion ledger so they are not silently lost.

## Procedure

1. Read repository instructions and inspect `git status --short`, the current branch, full `HEAD` SHA, tags, and configured upstream without changing them.
2. Read the current versions from the relevant manifests. Query published npm versions for `oh-my-opencode`, `oh-my-openagent`, and `lazycodex-ai` when network access is available.
3. Resolve a defensible baseline for each layer:
   - Prefer the exact release tag associated with the published version.
   - For the Claude adapter, also inspect `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, Git history for `packages/omo-claude`, and any user-supplied installed-cache path.
   - If source and an installed Claude cache are both available, compare them read-only and distinguish uncommitted source drift from unpublished committed changes.
4. List commits in the selected range, but use their diffs only as an index. Read the actual changed hunks and relevant callers or consumers.
5. Classify every file into one or more release layers, then group the real behavior changes as feature, fix, refactor, docs, packaging, or internal-only.
6. Identify breaking behavior, install or cache implications, migration needs, and cross-layer coupling.
7. Recommend patch, minor, or major for each affected layer and one overall workflow bump. Explain the highest-severity reason that controls the overall recommendation.

## Output

Start directly with the result. Include:

1. Comparison anchors: published versions or tags, `HEAD` SHA, and any baseline uncertainty.
2. Unpublished changes grouped by feature, fix, refactor, docs, and packaging. Describe what the diff actually does and why it matters, not the commit subject.
3. A layered impact matrix with one row for each of the four release layers.
4. Breaking changes and migration or reinstall notes. For Claude, state whether the installed cache differs from source and whether a version bump plus plugin update is required.
5. The internal-adapter exclusion ledger.
6. Layer-specific semver recommendations and one overall recommendation.

If there are no unpublished changes for a layer, say `none` and cite the comparison anchor used to reach that conclusion.
