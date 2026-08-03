# Phase 9 + 10 — Cleanup & Applicable Verification

The working tree after the session should contain only the requested fix and directly related tests, documentation, or configuration. Temporary debugging artifacts must be gone.

---

## Phase 9 — Cleanup & Revert

### The walk

If a journal was created, open its "Artifacts to revert" list. Walk it top to bottom and check each item only after its scoped cleanup succeeds. If the investigation created no journal or artifacts, skip this phase.

### Standard revert operations

Most sessions create some combination of these artifacts. The commands below are the defaults — your journal should have the exact commands for this session.

```bash
# --- Temporary source edits (instrumentation statements, debug prints) ---
git checkout <file>                              # reverts only that file
git diff <file>                                  # verify clean

# --- tmux sessions ---
tmux kill-session -t <session-name>
tmux ls                                          # confirm gone

# --- Temp fixtures / scratch scripts ---
rm -f /tmp/debug-*.*
ls /tmp/debug-*.* 2>/dev/null                    # confirm gone (ls returns non-zero when no match)

# --- Background processes (debugger-attached runtimes) ---
pkill -f 'node --inspect' || true
pkill -f 'python -m pdb' || true
pkill -f 'debugpy' || true
pkill -f 'dlv' || true
pkill -f 'gdb' || true
pkill -f 'lldb' || true

# --- Debug-relevant ports confirmed free ---
lsof -iTCP:9229 -sTCP:LISTEN -nP 2>/dev/null     # Node inspector default
lsof -iTCP:5678 -sTCP:LISTEN -nP 2>/dev/null     # debugpy default
lsof -iTCP:2345 -sTCP:LISTEN -nP 2>/dev/null     # dlv default
lsof -iTCP:9999 -sTCP:LISTEN -nP 2>/dev/null     # pwndbg/gdb-server default

# --- Env var overrides in current shell ---
unset DEBUG_OVERRIDE_FOO
unset PYTHONBREAKPOINT
unset RUST_LOG
unset DEBUG

# --- Ghidra scratch projects (if created just for this session) ---
# rm -rf ~/ghidra-projects/debug-scratch

# --- Core dumps from debugging (if any) ---
rm -f ./core ./core.* ~/core.*

# --- Playwright trace files ---
rm -rf playwright-report/ test-results/
```

### The verify command

This is the single most important check of the whole skill:

```bash
git status
git diff --stat
```

The diff must contain **only**:

1. The real fix.
2. The applicable regression test, when the behavior has a suitable test seam.
3. Directly related documentation or configuration required by the fix.

### Detector checklist — scan the diff for these

If `git status` shows any untracked debug file, or `git diff` shows any of the patterns below, **you are not done**. Clean it.

| Pattern | Usually means |
|---|---|
| `debugger;` | Node debug statement left behind |
| `breakpoint()` | Python debug statement left behind |
| `dbg!(...)` | Rust debug macro left behind |
| `fmt.Println("DEBUG: ...")` | Go ad-hoc print |
| `console.log("[DEBUG]` | Node ad-hoc log |
| `print(f"DEBUG: ` | Python ad-hoc print |
| `// TODO DEBUG`, `// HACK`, `// XXX` | Stale debug marker |
| `// <PROJECT>-DEBUG` | Session-specific marker from this skill's edits |
| Commented-out code blocks near the fix | Dead code from trial fixes |
| Reordered imports or formatting in unrelated files | Drift from your editor's autoformat during the session |

### Remove the journal

Only once the git check is clean, and only if this investigation created the journal:

```bash
rm .debug-journal.md
sed -i.bak '/^\.debug-journal\.md$/d' .git/info/exclude && rm -f .git/info/exclude.bak
```

The journal is not part of the fix; it doesn't belong in the commit or in the git exclude list.

---

## Phase 10 — Final Verification

Use only the gates that apply to the changed behavior and its consequence of failure. Report concise evidence for the checks that ran; do not manufacture work to fill every category.

### Applicable gates

1. **Behavior lock** — for a bug fix or new behavior with a suitable test seam, confirm the focused test fails without the fix and passes with it. A diagnosis-only request or untestable external condition can use captured runtime evidence instead.

2. **Regression scope** — run the narrowest affected suite. Add the full package or repository suite only for cross-cutting, release-bound, or repository-mandated changes.

3. **Matching-surface QA** — when user-visible runtime behavior changed, rerun the original scenario or closest safe equivalent. Pure internal, prose, or configuration changes may be covered by parsing and targeted contract tests.

4. **Artifact cleanup** — if the investigation created temporary artifacts, confirm they are gone and the diff contains only intended task changes.

If an applicable gate lacks evidence, return to the appropriate phase. An inapplicable gate is omitted, not treated as a failure.

### Final message template

Keep it short. Evidence-dense. The user should be able to skim it in 30 seconds.

```markdown
Fixed.

**Root cause**: <one sentence — the mechanism, not the symptom>
**Fix**: `<file:line>` — <two words>
**Test**: `<test file>::<test name>` — red without fix, green with fix (when applicable)
**QA**: <one line describing the matching-surface or contract check and what you saw>

Diff:
```
<git diff --stat output — should be tiny>
```

**Next steps I didn't take** (awaiting your decision):
- <follow-up 1, if any — from QA silent-failure scan or refactor opportunities noted during Phase 7>
- <follow-up 2 — or "none" if nothing else surfaced>
```

### Example (from a real session)

```markdown
Fixed.

**Root cause**: pi-mono Agent's `model.baseUrl` was hardcoded to `api.anthropic.com`, so the `ANTHROPIC_BASE_URL` env var was silently ignored. The proxy API key was rejected by the real Anthropic API with 401, but pi-mono packaged the error into the assistant message's `errorMessage` field instead of throwing, so the route's try/catch never fired and the client received HTTP 200 with empty content.

**Fix**: `core/pi-bridge/modelResolver.ts:117` — override baseUrl
**Test**: `__tests__/core/modelResolver.test.ts::resolves_env_override` — red without fix, green with fix
**QA**: `curl -X POST /api/refinement/chat` with proxy env set, observed non-zero usage and non-empty content

Diff:
```
 core/pi-bridge/modelResolver.ts              | 3 +++
 __tests__/core/modelResolver.test.ts         | 42 ++++++++++++++++++++++
 2 files changed, 45 insertions(+)
```

**Next steps I didn't take** (awaiting your decision):
- pi-mono itself silently swallows LLM errors into `errorMessage`; adding a throw-on-error wrapper at our orchestrator layer would surface these upstream
- Same silent-failure pattern exists in the planning route — likely the same fix applies
```
