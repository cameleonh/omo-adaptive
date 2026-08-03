# Sisyphus Labs Codex Marketplace

Native Codex marketplace for the `omo` plugin.

## Plugin

`omo` is one Codex plugin namespace with isolated internal components:

- `components/comment-checker`: runs comment-checker automatically after successful `apply_patch` edits.
- `components/git-bash`: exposes the Windows Git Bash MCP and reminds Codex before shell-like calls.
- `components/rules`: injects local project rule files into Codex context through lifecycle hooks.
- `components/lsp`: exposes Language Server Protocol diagnostics, navigation, symbols, and rename tools through MCP and post-edit hooks.
- `components/ultrawork`: injects the ultrawork orchestration directive when a user prompt contains `ultrawork` or `ulw`.
- `components/ulw-loop`: durable repo-native multi-goal orchestration with embedded success criteria and observable evidence audit (`.omo/ulw-loop/`).
- `components/start-work-continuation`: resumes `.omo/boulder.json` start-work plans from stop boundaries.
- `components/telemetry`: emits anonymous daily active telemetry when enabled.

## Install

```bash
npx lazycodex-ai install
```

The installer builds `omo`, copies a clean versioned cache entry into `~/.codex/plugins/cache/sisyphuslabs/omo`, installs runtime dependencies in the cache, writes a local marketplace snapshot under `~/.codex/.tmp/marketplaces/sisyphuslabs/plugins/omo`, copies bundled-agent TOMLs into `~/.codex/agents/`, registers the `sisyphuslabs` marketplace from the local built cache, enables `[plugins."omo@sisyphuslabs"]`, and sets `plugins = true` plus `codex_hooks = true` under `[features]` in `~/.codex/config.toml`.

Codex 0.120 discovers hooks from `~/.codex/hooks.json`, not directly from the plugin manifest. The manifest paths remain available for newer plugin-aware engines; the installer materializes only `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, and `Stop` groups, preserves user and unsupported groups, and replaces only the OMO-marked groups on reinstall. Uninstall removes only those marked groups.

If your local Codex build exposes plugin install commands, you can use those instead. For older local builds, the installer replaces the manual copy fallback:

```text
~/.codex/plugins/cache/sisyphuslabs/omo/0.1.0
```
