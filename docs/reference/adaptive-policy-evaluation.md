# Adaptive policy benchmark

> [!IMPORTANT]
> Run this benchmark on Linux or in WSL. Its evidence directory is anchored through POSIX directory descriptors so that path swaps cannot redirect later artifact writes. Native Windows installation of OMO Adaptive is supported, but the benchmark intentionally refuses to weaken this filesystem boundary; on Windows, clone and run the evaluation inside WSL.

This is the executable comparison protocol for OMO Adaptive. It compares the policy variant loaded from a preinstalled isolated Codex template. It preserves the inherited marketplace identity: marketplace `sisyphuslabs`, plugin `omo`, enabled as `omo@sisyphuslabs`.

The benchmark command is:

```bash
bun script/adaptive-policy-benchmark.ts \
  --variant adaptive|upstream \
  --tier Light|Standard|Deep \
  --model <model> \
  --reasoning-effort medium \
  --codex-home-template <template-directory> \
  --output <output-directory> \
  [--case <case-id>] [--repetitions 5] [--dry-run]
```

`--reasoning-effort` defaults to `medium`; `--repetitions` defaults to exactly `5`. The runner records the template directory hash and the template-marker hash in `manifest.json` and every run summary.

## Checkout and hook preflight

Use the immutable fork tag. Verify the revision before installing dependencies:

```bash
git clone --branch v4.19.4-adaptive.2 --depth 1 https://github.com/cameleonh/omo-adaptive.git
cd omo-adaptive
test "$(git describe --tags --exact-match)" = "v4.19.4-adaptive.2"
git rev-parse HEAD
git submodule update --init --recursive
bun install
```

The app-server driver is a hook preflight only. It uses a local mock model and is not the benchmark capture path. Keep all environment changes inside a subshell so no `CODEX_HOME` export can affect a later real-home command:

```bash
(
  preflight_root="$(mktemp -d)"
  trap 'rm -rf "$preflight_root"' EXIT
  export HOME="$preflight_root/home"
  export CODEX_HOME="$preflight_root/codex"
  export XDG_CONFIG_HOME="$preflight_root/xdg-config"
  export XDG_CACHE_HOME="$preflight_root/xdg-cache"
  export XDG_DATA_HOME="$preflight_root/xdg-data"
  export XDG_STATE_HOME="$preflight_root/xdg-state"
  mkdir -p "$HOME" "$CODEX_HOME" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$XDG_DATA_HOME" "$XDG_STATE_HOME"
  mkdir -p .omo/evidence
  preflight_evidence="$(mktemp -d .omo/evidence/adaptive-policy-preflight.XXXXXX)"
  bash .agents/skills/codex-qa/scripts/app-server-drive.sh --plugin \
    > "$preflight_evidence/app-server-drive.log" 2>&1
)
```

Stop if this command exits nonzero. The `.log` artifact intentionally preserves the driver's JSON event output and trailing PASS/FAIL status lines as one mixed diagnostic stream. The outer trap removes the preflight's explicitly assigned HOME and XDG root; the driver may create its own separately managed temporary directories. Do not use `bun run install:codex-dev` for the benchmark: when `CODEX_HOME` is unset, that command writes the real home and is outside this protocol.

## Prepare isolated templates

The benchmark copies a template into a fresh sandbox for each run. A template must already contain the matching Codex plugin installation and must have this root marker:

```json
{
  "variant": "adaptive",
  "sourceRevision": "<resolved-commit>"
}
```

The marker filename is exactly `adaptive-policy-benchmark-template.json`. The marker is not trusted on its own. The runner also parses `config.toml`, requires enabled `omo@sisyphuslabs` state, resolves the active marketplace manifest and cached plugin within the template, and verifies the full GPT-5.6 rule and programming-skill hashes against the selected variant's trusted revision. Adaptive must match the current checkout and upstream must match `a6dbc0ca0c75d91575d24598d39e244ed5905ced`. Missing, escaped, stale, or mislabeled policy artifacts are rejected before any matrix is created. Accepted templates are materialized, symlink-free snapshots; `external_symlinks` is therefore always empty in recorded metadata. Never pass `~/.codex` as a template: the runner rejects it, and the preparation commands below use newly created directories.

Prepare the Adaptive template from the checked-out fork:

```bash
adaptive_source_template="$(mktemp -d)"
adaptive_snapshot_root="$(mktemp -d)"
adaptive_template="$adaptive_snapshot_root/codex-home"
checkout_root="$(pwd -P)"
adaptive_install_state="$(mktemp -d)"
mkdir -p "$adaptive_install_state/home" "$adaptive_install_state/xdg-config" "$adaptive_install_state/xdg-cache" "$adaptive_install_state/xdg-data" "$adaptive_install_state/xdg-state"
HOME="$adaptive_install_state/home" \
XDG_CONFIG_HOME="$adaptive_install_state/xdg-config" \
XDG_CACHE_HOME="$adaptive_install_state/xdg-cache" \
XDG_DATA_HOME="$adaptive_install_state/xdg-data" \
XDG_STATE_HOME="$adaptive_install_state/xdg-state" \
CODEX_HOME="$adaptive_source_template" \
CODEX_LOCAL_BIN_DIR="$adaptive_install_state/bin" \
OMO_DISABLE_POSTHOG=1 \
OMO_CODEX_DISABLE_POSTHOG=1 \
node packages/omo-codex/scripts/install-local.mjs install --no-tui --no-codex-autonomous --repo-root "$checkout_root"
adaptive_revision="$(git rev-parse HEAD)"
bun script/adaptive-policy-benchmark/snapshot.ts \
  --source "$adaptive_source_template" --target "$adaptive_template" \
  --checkout-root "$checkout_root" --variant adaptive --revision "$adaptive_revision"
test -z "$(find "$adaptive_template" -type l -print -quit)"
```

Prepare the upstream template from the recorded upstream base. This is a separate temporary checkout and isolated home:

```bash
upstream_checkout="$(mktemp -d)"
upstream_snapshot_root="$(mktemp -d)"
upstream_template="$upstream_snapshot_root/codex-home"
benchmark_checkout="$(pwd -P)"
git clone --no-checkout https://github.com/code-yeongyu/oh-my-openagent.git "$upstream_checkout"
git -C "$upstream_checkout" checkout --detach a6dbc0ca
test "$(git -C "$upstream_checkout" rev-parse HEAD)" = "a6dbc0ca0c75d91575d24598d39e244ed5905ced"
(
  cd "$upstream_checkout"
  upstream_physical="$(pwd -P)"
  git submodule update --init --recursive
  bun install
  upstream_source_template="$(mktemp -d)"
  upstream_install_state="$(mktemp -d)"
  mkdir -p "$upstream_install_state/home" "$upstream_install_state/xdg-config" "$upstream_install_state/xdg-cache" "$upstream_install_state/xdg-data" "$upstream_install_state/xdg-state"
  HOME="$upstream_install_state/home" \
  XDG_CONFIG_HOME="$upstream_install_state/xdg-config" \
  XDG_CACHE_HOME="$upstream_install_state/xdg-cache" \
  XDG_DATA_HOME="$upstream_install_state/xdg-data" \
  XDG_STATE_HOME="$upstream_install_state/xdg-state" \
  CODEX_HOME="$upstream_source_template" \
  CODEX_LOCAL_BIN_DIR="$upstream_install_state/bin" \
  OMO_DISABLE_POSTHOG=1 \
  OMO_CODEX_DISABLE_POSTHOG=1 \
  node packages/omo-codex/scripts/install-local.mjs install --no-tui --no-codex-autonomous --repo-root "$upstream_physical"
  upstream_revision="$(git rev-parse HEAD)"
  bun "$benchmark_checkout/script/adaptive-policy-benchmark/snapshot.ts" \
    --source "$upstream_source_template" --target "$upstream_template" \
    --checkout-root "$upstream_physical" --variant upstream --revision "$upstream_revision"
  test -z "$(find "$upstream_template" -type l -print -quit)"
)
```

Keep `adaptive_template` and `upstream_template` available in the shell that runs the matrix. The template, marker, active plugin manifest, GPT-5.6 rule, and programming-skill hashes make the preinstalled state auditable. For each live run, the runner copies the symlink-free template without dereferencing, revalidates the source, compares the complete copied-directory hash before relocation, rewrites the copied marketplace source, and validates the installed-policy contract again before invoking Codex. Codex and oracle children receive an allowlisted environment with sandbox HOME, CODEX_HOME, XDG, PATH, and temporary directories; ambient API/token variables are not inherited, so authentication must exist only in the copied template.

## Dry-run matrix

Run all six cells first. Each cell uses a distinct output directory so its `manifest.json` cannot overwrite another cell. This validates inputs and writes only a planned five-run matrix. It does not invoke Codex.

```bash
mkdir -p .omo/evidence
benchmark_root="$(mktemp -d .omo/evidence/adaptive-policy-benchmark-dry-run.XXXXXX)"
benchmark_model="gpt-5.6"

bun script/adaptive-policy-benchmark.ts --variant adaptive --tier Light --model "$benchmark_model" --codex-home-template "$adaptive_template" --output "$benchmark_root/adaptive-light" --dry-run
bun script/adaptive-policy-benchmark.ts --variant adaptive --tier Standard --model "$benchmark_model" --codex-home-template "$adaptive_template" --output "$benchmark_root/adaptive-standard" --dry-run
bun script/adaptive-policy-benchmark.ts --variant adaptive --tier Deep --model "$benchmark_model" --codex-home-template "$adaptive_template" --output "$benchmark_root/adaptive-deep" --dry-run
bun script/adaptive-policy-benchmark.ts --variant upstream --tier Light --model "$benchmark_model" --codex-home-template "$upstream_template" --output "$benchmark_root/upstream-light" --dry-run
bun script/adaptive-policy-benchmark.ts --variant upstream --tier Standard --model "$benchmark_model" --codex-home-template "$upstream_template" --output "$benchmark_root/upstream-standard" --dry-run
bun script/adaptive-policy-benchmark.ts --variant upstream --tier Deep --model "$benchmark_model" --codex-home-template "$upstream_template" --output "$benchmark_root/upstream-deep" --dry-run
```

Use `--case <case-id>` only to limit a cell to one committed corpus case. Keep the model, reasoning effort, and repetition count the same for the two variants of the same case and tier.

## Live matrix and artifact review

Live runs can incur cost and require model credentials. After explicit approval for both, provide the required model credential or authentication to both isolated templates through the approved secret-management method. Scope credentials to those templates, do not use the real `~/.codex`, and do not place credential values in prompts, commands, `environment.json`, `raw.ndjson`, `stderr.txt`, `summary.json`, or `manifest.json`.

Create a new root, assign it to `benchmark_root`, then rerun the same six commands above and remove only `--dry-run`:

```bash
mkdir -p .omo/evidence
live_root="$(mktemp -d .omo/evidence/adaptive-policy-benchmark-live.XXXXXX)"
benchmark_root="$live_root"
```

The benchmark rejects an existing cell output directory. The unique dry-run and live roots prevent `manifest.json` overwrite without moving or reusing a prior result directory.

The actual artifact layout is:

```text
<output>/
  manifest.json
  runs/<case>/<variant>/<tier>/<run>/
    environment.json
    raw.ndjson
    stderr.txt
    summary.json
```

The benchmark process can exit successfully even when a model run fails or times out because it preserves those artifacts. Inspect every `summary.json` `completion.status`: `completed`, `failed`, `timed_out`, or `inconclusive`. Standard and Deep summaries also contain harness-owned `oracle_results`; an oracle can be `passed`, `failed`, `unknown`, or `timed_out`. Do not discard failed, inconclusive, or timed-out run directories.

The compared variable is `variant`. Tier and case are stratification variables. Compare Adaptive and upstream only for the same case and tier, using completion, `duration_ms`, tool-call records, `subagent_count`, and verification events. Do not treat raw numbers from different Light, Standard, and Deep workloads as a direct performance comparison.

Each fixture receives a tier-control `AGENTS.md` selected from the committed corpus. It classifies the case as Light, Standard, or Deep, but does not require additional tool use, delegation, or verification behavior. The installed policy is responsible for its own behavior.
