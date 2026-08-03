# Phase 2 + 3 — Hypothesis Formation & Investigation

A hypothesis becomes useful when one observation can confirm or refute it. Start with the smallest decisive set, then widen only when the evidence leaves real ambiguity.

---

## Phase 2 — Hypothesis Formation

### Start with the strongest falsifiable hypothesis

For a narrow, deterministic failure, one strong hypothesis and one discriminating observation may be enough. Add alternatives when the first observation is inconclusive, the system crosses several plausible boundaries, or the cost of following the wrong lead is high. The goal is not a quota; it is evidence that distinguishes the live possibilities without encouraging confirmation bias.

### Generate across orthogonal axes

When multiple hypotheses are warranted, do not make them variations of "the handler has a bug." Span the space:

| Axis | Example framing |
|---|---|
| **User-code logic** | "The handler early-returns because condition X is unexpectedly true" |
| **Library/SDK behavior** | "The third-party client swallows the error and returns a stub" |
| **Environment/config** | "The env var is read at module-load time before it gets populated, so it's empty" |
| **Async/timing** | "The promise rejects (or goroutine panics) after the response is already sent" |
| **Silent side-effect** | "An earlier turn mutated shared state that the current turn inherits" |
| **Observability gap** | "The error is raised but suppressed before logging; it only exists as an unawaited rejection / ignored signal" |
| **Binary-level** (when applicable) | "The function we think is running is actually jumped over by a patched thunk / a different version loaded" |
| **Build-vs-runtime** | "The code we're reading is not the code that's running — stale build, wrong symlink, cached wheel, or dist/ ahead of src/" |

### For each active hypothesis, record

1. **Claim** — one sentence.
2. **Distinguishing evidence** — the exact value or state that confirms or refutes it, AND where to read it (file:line, log source, breakpoint location, memory address).
3. **If true, the fix is** — two words. Forces you to think through fix cost before committing to the hunt.

### Collapse and expansion rule

If two hypotheses have identical distinguishing evidence, they are not operationally different; collapse them. Do not invent a third hypothesis to satisfy a count. Expand the set only when an observation fails to decide the current one or reveals a genuinely different causal axis.

---

## Phase 3 — Investigation

### Default path: work locally

Run the single observation most likely to distinguish the active hypotheses. A routine log read, one reproduction, one breakpoint, or one narrow code path does not justify delegation.

### Delegated path: only after the delegation gate

Delegate only when all three conditions hold:

1. At least two investigations are genuinely independent.
2. Each investigation is substantial enough to justify its own context and handoff.
3. Parallel work is expected to save more time or add more confidence than coordination and synthesis will cost.

Use the smallest number of investigators that covers those independent evidence sources, with one falsifiable evidence question per investigator. Team mode is appropriate for a Deep investigation with several long-running runtime, log, and reproduction lanes; the mere presence of team tools is not a reason to create a team.

```
task(subagent_type="explore", load_skills=[], run_in_background=true,
     prompt="[CONTEXT: bug summary + which hypothesis you own + what state to look at]
     Runtime state investigation for hypothesis 1: ...")
task(subagent_type="explore", load_skills=[], run_in_background=true,
     prompt="Log/timing investigation for hypothesis 2: ...")
```

While delegated investigations run, continue useful non-overlapping work. Synthesize raw evidence against the hypotheses; do not accept an investigator's conclusion without the observation that supports it. Oracle consultation remains separate and is described in `04-oracle-triple.md`.

---

## Evidence capture discipline (both paths)

For every piece of runtime state captured, record in the journal:

```markdown
### <ISO timestamp> — <what you looked at>
- Source: <file:line | log source | curl command | breakpoint address>
- Value: `<verbatim>`
- Interpretation: <one line — why this matters>
- Refutes/Confirms: H<n>
```

**Verbatim values only. No paraphrasing.**

- `messages.length=0` is evidence.
- "messages seemed empty" is not evidence — it's a memory of an observation, and memory of observations is where debug sessions go to die.

If you find yourself about to paraphrase, stop, go back, and copy the raw value.

---

## Round completion

A "round" is complete when every active hypothesis has confirming or refuting evidence, or when the chosen evidence sources are exhausted without a decisive result. If two materially different rounds end inconclusively, consider the scoped Oracle consultation in `04-oracle-triple.md`.
