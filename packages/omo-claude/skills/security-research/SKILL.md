---
name: security-research
description: Use when reviewing an authorized codebase, diff, release candidate, or local threat surface for exploitable security weaknesses and evidence-backed remediation guidance.
---

# Security Research

Run an exploitability-driven, report-only security review from the main Claude Code conversation. Use the `Agent` tool for bounded independent analysis; never turn the audit into autonomous exploitation or remediation.

## Authorization and safety gate

Before analysis, establish:

- the repository, paths, ref range, or component in scope;
- that the user is authorized to assess the target;
- whether network access, local execution, and temporary fixtures are allowed; and
- assets or environments that must not be touched.

If the target is unclear, default only to the current local repository and its working-tree or branch diff. Never probe a live service, third-party system, production account, or public endpoint merely because its URL appears in code. Do not use real credentials, secrets, personal data, destructive payloads, persistence, privilege escalation, or denial-of-service techniques.

This skill does not edit product code, commit, push, open issues, or publish advisories. Ask for separate authorization before any remediation.

## Evidence and severity standard

- A vulnerability needs a reachable attack path: attacker capability, controlled input, trust-boundary crossing, vulnerable sink, and impact.
- Cite exact `file:line` evidence and every command used. Preserve observed output for any reproduction.
- Classify the root weakness with CWE when the mapping is defensible.
- Use OWASP WSTG or ASVS as verification guidance where relevant.
- Use CVSS v4.0 only when every metric is stated. Otherwise use Critical, High, Medium, or Low with plain-language rationale.
- Treat a failed or unsafe reproduction as a reason to downgrade, reject, or mark residual uncertainty—not as proof.

## Workflow

### 1. Establish a local baseline

Read repository instructions and security documentation. Inspect the smallest useful diff, entry points, data flows, dependency manifests, configuration loaders, subprocess and filesystem boundaries, authentication and authorization checks, and existing security tests.

Record an evidence packet containing:

- scope and exclusions;
- current commit and base ref when applicable;
- changed and security-sensitive files;
- trust boundaries and attacker-controlled inputs;
- relevant test commands; and
- execution or network limits.

### 2. Launch independent hunter lanes

Use no more than three concurrent `Agent` calls:

| Agent | Assignment |
|---|---|
| `omo-adaptive:explorer` | Map entry points, trust boundaries, sources, sinks, privilege transitions, and reachable attack surface. |
| `omo-adaptive:code-reviewer` | Audit authorization, isolation, injection, secret handling, filesystem, subprocess, archive, hook, and configuration behavior. |
| `omo-adaptive:librarian` | Only when third-party behavior or an advisory is material; verify against current primary documentation and immutable source links. |

Omit a lane that has no independent question. Give each agent the scope packet, read-only rules, a limit of seven candidates, and this candidate schema:

1. title and affected location;
2. attacker capability and preconditions;
3. source-to-sink attack path;
4. concrete impact;
5. CWE candidate;
6. cited evidence; and
7. smallest safe verification method.

Agents must reject generic hardening advice and label assumptions. If a named plugin agent is unavailable, perform that lane locally and disclose reduced coverage.

### 3. Deduplicate and rank candidates

Merge candidates by root cause and attack path, not by wording. Remove findings that are unreachable, protected by an evidenced control, or based only on a dangerous-looking API name.

Shortlist only candidates worth reproduction. For each, define the expected vulnerable observation and the safe stop condition before executing anything.

### 4. Reproduce safely

Use `omo-adaptive:qa-executor` through the `Agent` tool for a local-only reproduction pass. Its prompt must forbid source edits and restrict writable output to disposable fixtures in a newly created temporary directory. It may run only commands already allowed by the user and must stop before any network probe or operation that could affect real data, accounts, services, or system configuration.

Prefer, in order:

1. an existing repository test;
2. a toy input against a local fixture;
3. a dry run or isolated parser invocation; or
4. a static proof when execution is unsafe.

For each candidate return `REPRODUCED`, `FALSIFIED`, or `NOT SAFELY TESTED`, plus exact commands, exit status, observed output, and limitations. Never manufacture a PoC result.

### 5. Final verification

Send the evidence packet, surviving candidates, and reproduction results to `omo-adaptive:gate-reviewer` with a read-only prompt. Ask it to verify that every finding has a complete attack path, calibrated severity, reproducible evidence, a minimal fix direction, and a regression check.

The main conversation makes the final decision. A reviewer label alone is not evidence.

## Report format

Lead with one verdict: `PASS`, `PASS WITH FINDINGS`, or `BLOCK`.

```markdown
## Scope and limits
- Target, base/ref, exclusions, commands, untested surfaces

## Findings
| Severity | Title | CWE | Location | Exploitability | Evidence |

## Finding details
- Attack path and prerequisites
- Observed or static proof
- Severity rationale
- Minimal remediation direction
- Regression verification

## Rejected or downgraded candidates
| Candidate | Reason | Remaining uncertainty |

## Residual risk
- What was not tested and why
```

Do not report speculative candidates as vulnerabilities. When nothing survives verification, say so plainly without claiming the target is universally secure.
