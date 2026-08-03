# Phase 0 + 1 — Environment Assessment & Optional Journal

Before attaching a debugger or mutating runtime state, map what is running. Create a journal when the investigation will create temporary edits, processes, ports, fixtures, or environment overrides. A read-only inspection or one clean reproduction with no artifacts does not need a journal.

---

## Phase 0 — Environment Assessment

Map the ground truth before you attach. Attaching the wrong way wastes the first hour.

### 1. Identify the runtime

Read the actual manifest file, don't guess from extensions:

- Python → `pyproject.toml`, `requirements*.txt`, `setup.py`, `uv.lock`, `.python-version`
- Node → `package.json` (check `scripts`, check `engines`, check `type: module`)
- Rust → `Cargo.toml`, `rust-toolchain*`
- Go → `go.mod`, `go.sum`
- Native / mixed → `Makefile`, `CMakeLists.txt`, the binary itself (`file <path>`)

### 2. Load the matching runtime reference

The moment you know the runtime, open `references/runtimes/<runtime>.md`. The commands in this phase (and every phase after) are runtime-specific. The shape of the answers is the same; the commands are not.

### 3. Gather observable environment state

The shape of the answers you need (commands in the runtime reference):

| Question | Why it matters |
|---|---|
| What binary/interpreter/runtime actually launches the process? | Determines debugger flag plumbing. Wrappers (`tsx`, `poetry run`, `cargo run`, `bun`, supervisor scripts) change how flags propagate. |
| Is there already a debug-relevant port in use, or another instance of the service running? | Either attach to it or kill it deliberately — never silently compete. |
| Are symbols / source maps / debug info present and correct? | This determines whether breakpoints land on the right lines. Compiled-but-not-debug builds, stripped binaries, and incomplete source maps all silently misplace breakpoints. |
| Does the code path require env vars, config files, or auth tokens to reach the bug? | Missing env often produces early-return paths that masquerade as the bug itself. |
| Is there an existing failing test or known repro? | Prefer amplifying an existing repro over inventing one. |
| Are watchers (file watchers, hot reloaders, supervisors) going to restart the process mid-session? | If yes, turn them off before attaching. Restarts drop inspector connections and invalidate breakpoints. |

### 4. Gate check

If any answer is "I'm not sure", you are not ready for Phase 1. Investigate until certain. Guessing here cascades into false-positive hypotheses in Phase 2.

---

## Phase 1 — Journal Setup (when artifacts are expected)

For a durable or multi-step investigation that will create artifacts, open **one** journal file at the project root: `.debug-journal.md`. It is the source of truth for everything the investigation must undo. Skip this phase when no temporary state will be created.

### Exclude from git (don't pollute the committed ignore list)

```bash
grep -qx '.debug-journal.md' .git/info/exclude || echo '.debug-journal.md' >> .git/info/exclude
```

`.git/info/exclude` is per-clone and not committed — perfect for local-session artifacts.

### Journal template

```markdown
# Debug Journal — <short bug name>
Started: <ISO timestamp>
Goal: <one-sentence user request>

## Environment snapshot (Phase 0)
- Runtime: <language + version + launcher>
- Entry: <command that starts the process>
- Ports / sockets: <app=..., debugger=..., etc>
- Git HEAD: <sha>, working tree clean? <yes/no>
- References read: <list the files from references/ you loaded — proves you did the gate>

## Hypotheses
1. [STATUS] <hypothesis> — distinguishing evidence: <what would confirm/refute> — if true, fix is: <two words>
2. ...

## Failed hypothesis round counter
- Round 1: <result>
- Round 2: <result>
<!-- After 2 materially different failures, consider one scoped Oracle consultation (see 04-oracle-triple.md). -->

## Artifacts to revert
<!-- Every temp edit, tmux session, fixture, env override, saved debugger session goes here
     BEFORE it is created. The rule is journal-then-modify. -->
- [ ] `src/foo.py` — added `breakpoint()` on 2 lines. Revert: `git checkout src/foo.py`
- [ ] tmux session `debug-server`. Kill: `tmux kill-session -t debug-server`
- [ ] `/tmp/debug-payload.json`. Remove: `rm /tmp/debug-payload.json`
- [ ] env var in current shell: `FOO_BASE_URL=...`. Unset when done.
- [ ] GDB session save: `~/ghidra-projects/scratch.gzf`. Remove if not promoting.

## Findings
<!-- Append observed values here with timestamp. Verbatim only, no paraphrasing. -->

## Oracle consultation (if invoked)
<!-- Record only the framing(s) that were justified and the resulting discriminating queries. -->

## Final fix
<!-- File paths + test path. Filled during Phase 7. -->
```

### The journal-then-modify rule

Before a temporary debugging modification to the repo, shell, or system state, append it to "Artifacts to revert" first. Ordinary production edits that are already tracked by the task's version-control workflow do not belong in this temporary-artifact journal.

If you catch yourself about to run a command that creates a file, opens a port, or modifies source — stop, journal the intended artifact with its revert command, then run the command. Not the other way around.

### Why a single journal (not scattered TODO comments)

- One `git checkout`, one `rm`, one `tmux kill-session` list — simple Phase 9 walk.
- Survives interruptions. If you get pulled away mid-session, the next agent (or you later) can continue or revert without guessing.
- Prevents the most common failure: leaving `console.log`/`print()`/`dbg!` scattered across the tree.
