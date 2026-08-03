# Phase 4 — Scoped Oracle Consultation

After 2 materially different failed hypothesis rounds, pause and decide whether an independent framing would expose a blind spot. Continuing unchanged is wasteful; automatically spawning several reviewers is also wasteful.

Start with one Oracle using the framing most likely to challenge the current evidence. Add another framing only when the first leaves a specific, orthogonal ambiguity that runtime evidence cannot resolve cheaply.

> **Wrong tool for routine verification.** This consultation is for a stuck root-cause hunt. If the task is a high-risk extraction, reverse-engineering result, audit, or compliance artifact that needs independent review, use the scoped **Verification Oracle** pattern in [partial-runtime-evidence.md](partial-runtime-evidence.md#verification-oracle-pattern-for-non-debug-tasks). Ordinary implementation and validation do not need an Oracle.

---

## When to invoke

| Situation | Invoke? |
|---|---|
| 1 round failed, you have new distinguishing evidence | No — run one more round with a refined hypothesis set |
| 2 materially different rounds failed and one framing could expose a blind spot | **Yes — invoke one** |
| 2 rounds failed but a cheap decisive runtime query remains | No — run the query first |
| You've been investigating >2 hours on the same bug | Consider one if its expected value exceeds the handoff cost |
| 1 round failed but the user is watching and wants speed | No — one round isn't enough to justify Oracle cost. Resist the urge. |

---

## Choose an orthogonal framing

An Oracle can inherit the framing of its prompt, so choose the frame that most directly challenges the current blind spot. The three options below cover distinct bug-cause categories:

- **A (obvious-but-missed)** — embarrassingly simple causes the investigator walked past.
- **B (system-boundary)** — causes living at integration seams, not in the code being read.
- **C (invariant-violation)** — assumptions load-bearing to current hypotheses that may themselves be false.

Invoke one initially. A second or third call is justified only when its question is genuinely orthogonal, the remaining uncertainty is consequential, and the evidence cannot answer it more cheaply. Never spawn all three merely because the prompt library contains three.

---

## Prompt library (choose the smallest applicable set)

```
task(subagent_type="oracle", load_skills=[], run_in_background=true,
     prompt="[CONTEXT: bug description + evidence captured so far, verbatim, with file:line refs]

     Framing A — OBVIOUS-BUT-MISSED.
     What is the most embarrassing, most obvious cause that a senior engineer would spot in 30 seconds and we've overlooked? Consider:
     - typos, off-by-one
     - wrong variable name / wrong constant / wrong import
     - stale cache, wrong file edited, wrong process inspected
     - attached to the wrong instance of the service
     - test harness running different code than the app
     - editing src/ while running dist/

     Give me exactly three candidate causes ranked by likelihood, with one sentence each explaining why our evidence is consistent with each.")

task(subagent_type="oracle", load_skills=[], run_in_background=true,
     prompt="[CONTEXT: bug description + evidence captured so far]

     Framing B — SYSTEM-BOUNDARY.
     What if the bug is NOT in the code we've been reading, but at a boundary? Consider:
     - third-party SDK behavior that contradicts its docs
     - middleware that mutates the request or response
     - a proxy/gateway/load balancer that rewrites headers or bodies
     - build-time vs runtime env-var resolution
     - module-load-order issue
     - shared-library version mismatch (system lib vs bundled lib)
     - ABI difference (native addons, glibc versions, musl vs glibc)
     - wrong transport (HTTP/1.1 vs HTTP/2, TLS version negotiation)

     Give me three candidate causes, each naming the specific boundary and the specific contract assumption that might be violated.")

task(subagent_type="oracle", load_skills=[], run_in_background=true,
     prompt="[CONTEXT: bug description + evidence captured so far]

     Framing C — INVARIANT-VIOLATION.
     Which invariants that we've been ASSUMING TRUE might actually be false?
     Enumerate the five assumptions most load-bearing to our current hypotheses, then for each:
     - describe the smallest runtime query that would falsify it
     - predict what the observable would be if the invariant holds vs if it fails

     We want at least one of these queries to be decisive.")
```

---

## Synthesizing Oracle evidence

Treat an Oracle response as a source of hypotheses and discriminating queries, not as proof. Runtime evidence still decides the cause.

When more than one framing was justified, synthesize them in this order:

### 1. Agreement scan

Note which candidate causes appear in at least two Oracles' outputs. Independent agreement across orthogonal framings is strong signal — when the obvious-but-missed framing and the system-boundary framing both land on the same cause, that's usually the bug.

### 2. Disagreement scan

Note where Oracles disagree. Disagreement is genuine uncertainty that runtime evidence (not more reasoning) must resolve. Each disagreement becomes a candidate for the next round's distinguishing query.

### 3. New falsification queries

Framing C produces concrete "one query that would decide it" suggestions. Pull these verbatim into your new round's evidence-gathering plan — they are designed to be decisive.

### 4. Build the next hypothesis set

Use the smallest set that covers the live ambiguity, following Phase 2. Prefer the agreement scan for the leading cause and add a disagreement candidate only when one observation can distinguish it.

Record in the journal:

```markdown
## Oracle Consultation — Round <N>
- Invoked at: <ISO timestamp>
- Framing(s) used: <A, B, or C and why each was worth the cost>
- Candidate causes: <ranked list with the observation that would distinguish each>

### Cross-framing agreement (only if multiple calls ran)
- <candidate> appeared in <frames>

### New hypothesis set
1. <hypothesis> — evidence to gather: <one-liner>
2. ...
```

### 5. Reset the counter

Reset the "consecutive failed rounds" counter to 0. Return to Phase 3, working locally unless the investigations independently pass the delegation gate.

---

## If another 2 materially different rounds fail

You are genuinely stuck. This is the escalation threshold.

Use `05-escalate.md` when progress now requires a user decision, new authority, or unavailable evidence. Carry the concise trace of hypotheses, observations, and any Oracle framing used. Do not guess a fix or add more reviewers without a new independent question.
