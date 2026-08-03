---
name: hyperplan
description: Use when a complex plan needs adversarial review of assumptions, scope, architecture, evidence, and execution risk before implementation begins.
---

# Hyperplan

Say `HYPERPLAN MODE ENABLED!` once, then act as the lead. Hyperplan is a planning workflow, not an implementation workflow. It uses Claude Code's `Agent` tool from the main conversation and keeps all delegated work read-only.

## Entry gate

Proceed only when:

- the user wants a plan rather than an immediate implementation;
- the request has enough complexity or consequence to justify multiple independent reviewers; and
- the `Agent` tool is available in the current conversation.

Subagents cannot launch other subagents. Keep orchestration in the main conversation. If this skill is running inside a subagent, return a concise scope analysis and tell the caller to run Hyperplan from the main conversation.

For a small or already-settled request, skip fan-out and ask the plugin's `omo-adaptive:planner` agent for one focused plan.

## Bounded roster

Launch no more than three independent reviewers at once:

| Agent | Question it must answer |
|---|---|
| `omo-adaptive:metis` | What is ambiguous, contradictory, missing, or dependent on a user decision? |
| `omo-adaptive:explorer` | What does the repository actually do, and which files, symbols, tests, and boundaries prove it? |
| `omo-adaptive:code-reviewer` | What implementation, regression, security, or maintainability risks would make the obvious plan fail? |

If the plan depends materially on third-party behavior, replace the least relevant lane with `omo-adaptive:librarian`. Do not add a fourth concurrent lane. The librarian must cite current primary documentation or immutable source links.

Each Agent prompt must include:

- the user's request verbatim;
- the repository or path in scope;
- explicit read-only instructions;
- the lane's single question;
- a request for `file:line` evidence, commands checked, and explicit unknowns; and
- a limit of seven findings.

Do not assign model aliases or claim access to tools that do not appear in the current session. If a named plugin agent is unavailable, perform that lane locally and disclose the reduced roster.

## Workflow

### 1. Establish the evidence baseline

Read the applicable repository instructions. Inspect status, relevant manifests, entry points, tests, and the smallest useful history or diff. Record:

- objective and non-goals;
- hard constraints;
- current behavior with citations;
- unresolved user decisions; and
- verification commands available in the repository.

This baseline is an in-conversation evidence artifact. Do not create a file merely to hold intermediate notes.

### 2. Run independent reviews

Invoke the selected plugin agents through separate `Agent` calls. They must not see or anchor on each other's conclusions. Wait for every selected lane before synthesizing.

Reject any returned claim that lacks evidence when evidence is obtainable. Mark an unverifiable claim as an open question, not a fact.

### 3. Apply the adversarial filter

Build a compact challenge matrix:

| Claim | Evidence | Strongest challenge | Outcome |
|---|---|---|---|
| ... | ... | ... | KEEP / REVISE / DROP |

- `KEEP`: evidence supports the claim and the challenge does not invalidate it.
- `REVISE`: part survives, but scope or wording must change.
- `DROP`: contradicted, speculative, unnecessary, or outside the user's goal.

Distill the survivors into an insight bundle with five sections: original request, hard constraints, evidence-backed decisions, risks with mitigations, and open questions. Preserve citations and name which lane supplied each material insight.

### 4. Formalize with the planner

Use the `Agent` tool with `omo-adaptive:planner`. Give it the complete insight bundle and require:

- ordered, startable work items;
- exact files or discovery anchors;
- dependencies and safe parallel opportunities;
- a verification command or observable success criterion for every item;
- user-decision gates before dependent work; and
- no implementation.

The planner owns the executable plan. Surface its response and any plan artifact path it creates.

### 5. Review the plan once

Send the resulting plan to `omo-adaptive:momus` through the `Agent` tool. Require it to verify that referenced paths exist, tasks are startable, dependencies are ordered, and QA scenarios are concrete.

- `OKAY`: present the plan.
- `ITERATE`: send the critique and original insight bundle to one fresh `omo-adaptive:planner` call, then present the corrected plan.
- `REJECT`: do not disguise the plan as ready; report the blocking ambiguity and request the missing user decision.

Cap the entire workflow at six Agent invocations. Do not loop reviews indefinitely.

## Delivery

Lead with the plan's outcome, followed by:

1. the executable plan or its artifact path;
2. unresolved decisions that genuinely block execution;
3. the evidence and review lanes used; and
4. any reduced-coverage disclosure.

Do not claim consensus, complete repository coverage, or guaranteed correctness. Hyperplan provides adversarial evidence and an executable plan; it does not replace implementation-time tests and review.
