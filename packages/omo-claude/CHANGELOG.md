# Changelog

All notable changes to the Claude Code plugin are documented in this file.

## 4.20.0 — 2026-08-03

### Changed

- Ported the orchestration workflow to Claude Code-native agents, skills, tools, and invocation syntax.
- Added an adaptive orchestrator as the default main agent through `settings.json`.
- Normalized the 14-agent inventory and removed duplicate legacy command definitions in favor of 10 discoverable skills.
- Reworked the default GitHub-triage route behind a bounded read-only MCP and a reviewer with no shell or write tools; added field, request, per-envelope, and cumulative session caps.
- Added a non-model PR-state helper that excludes remote prose and revalidates mutation refs, SHAs, enums, and aggregate checks.
- Bound approved PR merges and branch deletion to immutable source SHAs, and made release dispatch fail closed when the workflow does not validate provenance before credential use.
- Replaced the shell-dependent ultrawork hook with a fail-open Node.js hook that emits Claude Code's structured hook output.
- Made publishing, dead-code removal, and PR workflows manual-only entry points with explicit side-effect gates.
- Added a Node contract test and strict Claude plugin validation workflow.
- Aligned package metadata and the bundled license with the repository's `SUL-1.0` license and added project attribution.
- Documented the source-versus-cache boundary and the version-bump/update release workflow.
