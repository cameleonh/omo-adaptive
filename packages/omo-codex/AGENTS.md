# packages/omo-codex/ - Codex CLI Light Edition (lazycodex)

**Generated:** 2026-08-03 (upstream base a6dbc0ca, branch main, package v4.19.4)

## Adaptive Codex QA

Match QA to the changed Codex surface:

- Pure prose in rules or skills: inspect the diff, parse frontmatter, and verify source-to-bundle synchronization. Do not drive a live session or add tests that pin wording.
- Installer or `config.toml` behavior: run the narrow installer/config tests and `.agents/skills/codex-qa/scripts/install-verify.sh` against an isolated local build.
- Hook or live-session behavior: add the component unit probe and `app-server-drive.sh --plugin` so the matching hook event is observed.
- Cross-component, release, security, or migration work: run `bun run test:codex`, the applicable isolated live route, and record durable evidence.

Whenever QA launches Codex, use a throwaway `CODEX_HOME` and the local build, never the published package or the user's real `~/.codex`. The bundled QA scripts hash the real config before and after. Store artifacts under `.omo/evidence/<YYYYMMDD>-<short-slug>/` when the change is Deep, release-bound, explicitly audited, or needs a durable reviewer handoff.

### Dev dogfood (real `~/.codex`, distinct from the isolated QA flow above)

`bun run install:codex-dev` swaps your real install for this repo's local build stamped as version `dev` (env `LAZYCODEX_DEV_VERSION`, default `dev`). Everywhere the plugin version shows (cache dir `.../omo/dev/`, `plugin.json`, and the per-turn `(OmO dev)` hook prefix) reads `dev`, so you can SEE which build is loaded. This is dogfooding on your REAL home; it is NOT a substitute for the mandatory isolated-`CODEX_HOME` QA above. Impl: `resolveLazyCodexPluginVersion` `versionOverride` (`src/install/lazycodex-version-stamp.ts`) fed from `env.LAZYCODEX_DEV_VERSION` in `runCodexInstaller`; display in `get-local-version` (`dev` status on a non-semver stamp).


## OVERVIEW

`@oh-my-opencode/omo-codex` (private, v4.19.4): the Codex harness adapter = the **Light Edition** (omo for the OpenAI Codex CLI). Vendors a Codex plugin namespace `omo` + a TypeScript installer + telemetry. Public distribution = the live `lazycodex-ai` npm package/bin alias. `lazycodex` remains a root bin alias and the [`code-yeongyu/lazycodex`](https://github.com/code-yeongyu/lazycodex) repository identity, but is not an npm package. Codex marketplace identity = `sisyphuslabs` / plugin `omo` (`omo@sisyphuslabs`). Full identity + the publish/deploy pipeline live in the root [`AGENTS.md`](../../AGENTS.md) "CODEX LIGHT EDITION" section.

## LAYOUT

| Path | Purpose |
|------|---------|
| `package.json` | `@oh-my-opencode/omo-codex` (private). Deps: `@oh-my-opencode/utils`. Scripts: `typecheck`, `test`, `build:plugin`, `sync:skills`. |
| `marketplace.json` | Codex marketplace manifest. Declares marketplace `sisyphuslabs`, single installable plugin `omo`. |
| `MARKETPLACE.md` | Native Codex marketplace notes for `sisyphuslabs` / `omo`. |
| `index.d.ts` | Type barrel re-exporting `src/`. |
| `plugin/` | Vendored Codex plugin namespace `omo`; pkg `@sisyphuslabs/omo-codex-plugin` (dep `@oh-my-opencode/shared-skills`). Holds `.codex-plugin/plugin.json` (brandColor `#7C3AED`), declared `hooks/hooks.json` paths for plugin-aware engines, `components/` (11 workspaces + bootstrap + test-support + lcx), generated aggregate `skills/` (gitignored, built by sync-skills), `.mcp.json`. Codex 0.120 hook groups are materialized into `CODEX_HOME/hooks.json` by the installer. |
| `scripts/` | Generated/bundled Node ESM install entrypoints and parity tests. Published paths such as `scripts/install-local.mjs` stay stable while source lives in `src/install/`. |
| `src/` | TypeScript runtime consumed by the CLI: `install/` (Codex cache install, config mutation, agent links, local marketplace snapshot, cleanup, routing) + `telemetry/`. |
| `tsconfig.json` | Bun-targeted strict config; included in root `typecheck:packages`. |

## COMPONENTS (11 live workspaces + 3 special dirs)

Per `plugin/package.json` `workspaces[]`: `codegraph`, `comment-checker`, `git-bash`, `lazycodex-executor-verify`, `lsp`, `rules`, `start-work-continuation`, `teammode`, `telemetry`, `ultrawork`, `ulw-loop`. Special cases: `bootstrap` (runtime provisioner with its own package.json, deliberately OUTSIDE the workspaces array, built standalone by `plugin/scripts/build-components.mjs`), `test-support` (test helper dir, no package.json, not a component), and `lcx` (skills-only carrier under `plugin/components/lcx/`, no package.json and not a workspace; holds the `lcx-report-bug` / `lcx-contribute-bug-fix` / `lcx-doctor` skills that `sync-skills` copies from `components/lcx/skills/`). `workflow-selector` was removed 2026-06-29 (only an untracked `dist/` residue may linger locally). Each component is an isolated workspace under `plugin/components/<name>/` with its own `AGENTS.md` + declared `hooks/hooks.json` paths when it owns hook behavior. On Codex 0.120, materialization keeps only `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, and `Stop`; `PostCompact` and `SubagentStop` remain declared for newer plugin-aware engines. Older components originate from `code-yeongyu/codex-{rules,comment-checker,lsp,ultrawork,ulw-loop,start-work-continuation}`; `codegraph`, `teammode`, `bootstrap`, `lazycodex-executor-verify` are repo-native.

**sync-skills pipeline** (`plugin/scripts/sync-skills.mjs`, run by the plugin build): wipes `plugin/skills/` → copies 10 COMPONENT skills first (`comment-checker`, `lcx-report-bug`, `lcx-contribute-bug-fix`, `lcx-doctor`, `lsp`, `rules`, `teammode`, `ulw-loop`, `ulw-plan`, `ultrawork` from `plugin/components/*/skills/*`; same-named shared skills are skipped) → copies remaining shared skills → `adaptSkillForCodex()` inserts Codex Harness Tool Compatibility guidance, applies overlays (`start-work` / `review-work`), and writes `agents/openai.yaml` display metadata with the `(OmO) ` prefix.

**Ultrawork skill pointer:** the ultrawork `UserPromptSubmit` hook injects a compact `<ultrawork-mode>` pointer (<4096 bytes; Codex App truncates large hook output) directing the model to read the full directive from the bundled `ultrawork` skill; full-directive fallback when the skills tree is absent. Mirror copy in `ulw-loop/src/ultrawork-skill-pointer.ts`; byte-identity pinned by `plugin/test/ultrawork-skill-pointer.test.mjs`.

## INSTALL (mechanics)

Source entry: `src/install/install-codex.ts` plus `src/install/install-local-cli.ts`; generated Node entrypoints live at `packages/omo-codex/scripts/install*.mjs` for stable published paths. Targets: plugin cache `~/.codex/plugins/cache/sisyphuslabs/omo/<version>/`; local marketplace snapshot under `~/.codex/.tmp/marketplaces/sisyphuslabs/plugins/omo/`; durable agent TOML copies under `~/.codex/agents/`; enables `omo@sisyphuslabs` and `[features] codex_hooks = true` in `~/.codex/config.toml`; supported OMO hook groups in `~/.codex/hooks.json`; component CLIs into `~/.local/bin`. Reinstall preserves user/unsupported hook groups and replaces only OMO-marked groups; uninstall removes only those marked groups. Windows: Git Bash preflight discovers `OMO_CODEX_GIT_BASH_PATH`, standard Git for Windows locations, then PATH; if missing, it prints manual install guidance and stops without running `winget`. Non-Windows keeps the `git_bash` MCP manifest bundled but writes `enabled = false`.

## UNIFIED CONFIG (omo.jsonc)

The Codex codegraph loader (`plugin/shared/src/config-loader.ts`, `getCodexOmoConfig()`) reads the unified config surface through `@oh-my-opencode/omo-config-core` (imported by relative source path, keeping the plugin bundle dependency-clean): user layer `~/.omo/omo.jsonc` plus walked project `.omo/omo.json[c]` layers, resolved as the `[codex]` view (shared base -> `[codex]` -> `profiles.<P>` -> `profiles.<P>.[codex]`). `OMO_CODEGRAPH_*` / `CODEX_CODEGRAPH_*` environment overrides fold over the resolved config; unsupported keys (for example `codegraph.watch_debounce_ms`) and all loader/migration diagnostics surface as `warnings` on the result. Before reading, the loader runs `runCodexStartupMigration()`, which invokes ONLY the `2026-07-codex-config-jsonc` migration group: `~/.omo/config.jsonc` (plus its sidecar) imports into `~/.omo/omo.jsonc` via the shared lock+journal engine, no-clobber with skipped-value diagnostics, sources moving to `~/.omo/migration-backup-<UTC-ts>-opencode-config/.omo/`. The `oh-my-*` group is owned by the opencode/senpi side; whichever harness runs first applies each group exactly once via `_migrations` markers. Full semantics: [`docs/reference/omo-json.md`](../../docs/reference/omo-json.md).

## CONFIG MIGRATION (SessionStart)

The plugin `SessionStart` hook (matcher `^startup$`) runs `plugin/scripts/auto-update.mjs` → `migrateCodexConfig()` over `~/.codex/config.toml` plus any project `.codex/config.toml`, before the update throttle. Healthy marketplace-managed installs still skip npx self-update and point users at `codex plugin marketplace upgrade sisyphuslabs`; stale local marketplace cache/bin state is the exception, and starts the npx installer as a local repair when the cached marketplace manifest or managed component bins point at missing OMO payloads. The model-aware MultiAgentV2 migration reads the selected model from `CODEX_HOME/models_cache.json` (with the GPT-5.6 fallback) and migrates the invalid `max_concurrent_threads_per_session` key to `[agents].max_threads`, preserving a valid user cap. V2-preferred models enable `multi_agent_v2`; it uses the `[features]` boolean form unless valid supported user table fields require `[features.multi_agent_v2]`, which it preserves. Project cleanup migrates or removes only the obsolete cap and never removes `[agents].max_threads`. Opt-out: `LAZYCODEX_CONFIG_MIGRATION_DISABLED=1` / `OMO_CODEX_CONFIG_MIGRATION_DISABLED=1`. The hook also emits restart notifications: when an update starts it persists `pendingNotice` ({fromVersion, toVersion, startedAt}) in the auto-update state, and once a later startup runs at >= toVersion it emits an update-completed notice (checked before the throttle, so throttled startups still notify). Non-empty notices are printed as a single stdout JSON line (`hookSpecificOutput.additionalContext`, SessionStart) and audited as `notified` events in the update log; pinned by `plugin/test/auto-update-restart-notice.test.mjs` (part of `bun run test:codex`).

## TELEMETRY

Event `omo_codex_daily_active`, at most once per UTC day per machine. Two sources: install (`install_completed`) + plugin `SessionStart` (`session_start`). Id `sha256("omo-codex:" + hostname)`; dedup state `~/.local/share/omo-codex/posthog-activity.json`; PostHog person profiles disabled. Opt-out: `OMO_CODEX_DISABLE_POSTHOG=1` / `OMO_CODEX_SEND_ANONYMOUS_TELEMETRY=0` (global `OMO_*` flags also disable). Parity with the main plugin pinned by `src/telemetry/cross-package-equivalence.test.ts`.

## DEPLOY (sync script)

`script/sync-lazycodex-marketplace.ts <source-root> <lazycodex-root>` copies `marketplace.json` to `.agents/plugins/marketplace.json` and `plugin/` to `plugins/omo/`, bundles LSP/Git Bash MCP runtime dists into `plugins/omo/components/*/dist/`, bundles root CLI runtimes into `plugins/omo/dist/cli` and `plugins/omo/dist/cli-node`, rewrites `.mcp.json` paths, then validates via `script/lazycodex-marketplace-validation.ts`. Mechanism = file copy + commit push, NOT a git subtree. The triggering `publish.yml` behavior (`publish_lazycodex` input + automatic stable-release Codex marketplace sync gated on empty `dist_tag`) is documented in the root `AGENTS.md`.

## NOTES

- `@sisyphuslabs/omo-codex-plugin` (the shipped Codex plugin bundle) is distinct from `@oh-my-opencode/omo-codex` (this adapter package).
- Codex marketplace name is `sisyphuslabs`, never `lazycodex`.
- `@oh-my-opencode/omo-codex` is private (not published to npm on its own); its assets ship via the root `package.json` `files` array.
- `bunfig.toml` excludes `packages/omo-codex/plugin/**` from the root `bun test`; the plugin carries its own `node --test` suite. Full Codex suite: `bun run test:codex`.
- Per-component detail lives in `plugin/components/*/AGENTS.md`; do not duplicate it here.
