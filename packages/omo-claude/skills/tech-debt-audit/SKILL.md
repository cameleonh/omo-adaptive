---
name: tech-debt-audit
description: Use when a maintainer requests a codebase health check, technical-debt audit, architecture assessment, cleanup inventory, or evidence-backed refactoring priorities.
---

# Technical Debt Audit

Produce a grounded `TECH_DEBT_AUDIT.md` without changing product code. A suspicious pattern is a lead, not a finding: every reported debt item needs a concrete maintenance or correctness consequence and a `file:line` citation.

## Scope and artifact safety

Confirm the repository or paths in scope and whether the user wants the whole codebase or a diff-focused audit. Read all applicable repository instructions first.

If `TECH_DEBT_AUDIT.md` already exists, read it and preserve it. Update it only when the user clearly requested an update; otherwise create a date-suffixed report and name that path in the response. Do not edit source, configuration, dependencies, or tests during an audit.

## Native evidence toolkit

Use only capabilities visible in the current Claude Code session:

- `Glob`, `Grep`, and `Read` for structure and source evidence;
- `Bash` with `rg`, Git, line counts, and repository-declared scripts;
- `sg` only after confirming the executable exists and the target language is supported;
- language-native lint, typecheck, test, coverage, and build commands discovered from repository manifests; and
- optional code-intelligence or graph tools only when they are actually configured and their schemas are visible.

Do not promise diagnostics, callers, or impact data from an unavailable integration. Record missing tools and skipped checks as coverage limits.

## 1. Orient before judging

Build an evidence baseline:

1. map languages, packages, entry points, generated trees, and test locations;
2. read manifests, build configuration, public documentation, and architecture notes;
3. inspect recent Git churn without treating churn alone as debt;
4. identify large or highly connected files as review candidates, not automatic findings;
5. discover the repository's actual validation commands; and
6. write a one-paragraph mental model of runtime flow and module boundaries.

Exclude vendor, generated, cache, fixture, and build-output directories unless the repository treats them as authored or published source. State every exclusion.

## 2. Audit nine dimensions

| Dimension | Evidence to seek |
|---|---|
| Architecture | boundary violations, cycles, hidden coupling, oversized responsibilities, dead public surface, duplicated orchestration |
| Consistency | competing patterns for logging, validation, configuration, IO, errors, naming, and time handling |
| Types and contracts | unsafe escapes, unvalidated external input, ambiguous return shapes, public contract drift, ignored diagnostics |
| Tests | critical paths without behavioral tests, meaningful skips, flaky or slow suites, high-churn code without regression coverage |
| Dependencies and config | duplicate or obsolete dependencies, undocumented environment inputs, vulnerable versions, config/runtime disagreement |
| Performance and resources | avoidable serialization, unbounded work, N+1 behavior, sequential independent IO, leaked listeners or handles |
| Errors and observability | swallowed failures, inconsistent error contracts, missing context, unsafe retries, absent operational signals |
| Security hygiene | secret exposure, injection paths, unsafe file or subprocess handling, weak authorization, risky defaults |
| Documentation | examples or claims that disagree with code, missing migration guidance, stale architecture records |

Use language-aware structural search when available, with `rg` as the portable fallback. Run broad searches only to generate candidates; read surrounding code and dependencies before recording a finding.

For test, lint, typecheck, build, coverage, performance, dependency-audit, or security commands:

- use the repository's documented command and package manager;
- capture the exact command, exit status, and relevant output;
- avoid network access unless the user allowed it;
- do not let a command rewrite tracked files or lockfiles; and
- distinguish an existing failure from debt introduced by the audited diff.

## 3. Delegate only when the audit is genuinely large

For a large repository or three independent audit surfaces, use no more than three concurrent `Agent` calls:

| Agent | Read-only lane |
|---|---|
| `omo-adaptive:explorer` | Architecture, boundaries, churn hotspots, dependency direction, and documentation drift. |
| `omo-adaptive:code-reviewer` | Types, contracts, errors, consistency, security hygiene, and maintainability consequences. |
| `omo-adaptive:qa-executor` | Test/build health, resource and performance signals, skipped coverage, and reproducible command evidence. |

Give every lane explicit paths, exclusions, repository instructions, and a maximum of ten candidate findings. Require `file:line`, observed consequence, confidence, and commands checked. Tell the QA lane not to edit source and not to run state-changing or networked commands without authorization.

For a small repository or one narrow component, work locally. Delegation overhead is not evidence.

## 4. Validate and rank findings

For every candidate ask:

1. What observable behavior, maintenance cost, or change risk does this create?
2. Is the cited location authored and in scope?
3. Is there a repository convention or comment showing the pattern is intentional?
4. Can existing tests or tool output confirm or refute the concern?
5. Is the proposed fix smaller and safer than the debt?

Deduplicate by root cause. Keep independent symptoms only when they require different fixes.

Severity means:

- `Critical`: active security exposure, data loss, or severe incorrect behavior with evidence.
- `High`: likely production failure or a blocker to routine safe change.
- `Medium`: recurring maintainability or contract risk with a concrete consequence.
- `Low`: bounded cleanup whose benefit is real but non-urgent.

File size, age, TODO count, stylistic preference, and lack of comments are never sufficient on their own. Estimate effort as a range and state assumptions rather than false precision.

## 5. Write the report

The artifact must contain:

```markdown
# Technical Debt Audit

## Executive summary
## Scope, exclusions, and evidence commands
## Repository mental model

## Findings
| ID | Dimension | Severity | Location | Consequence | Evidence | Effort | Recommendation |

## Top five priorities
Rank by impact, confidence, dependency order, and effort.

## Quick wins
Only verified items likely to take under 30 minutes.

## Looks bad but is intentional
Document reviewed false positives and the evidence that cleared them.

## Open questions and coverage limits
```

Every concrete finding must cite `file:line` and every command-derived claim must name the command and result. If evidence is insufficient, move the item to open questions. In the final response, lead with overall health, the artifact path, the top risks, and what was not verified.
