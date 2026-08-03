#!/usr/bin/env bun
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import {
  TIERS, criterionMet, loadCorpus, resolveCasePaths, sha256Directory, sha256File, validateCase,
  type CorpusCase, type Tier, type Variant,
} from "./adaptive-policy-benchmark/core"
import {
  REASONING_EFFORTS, TOOL_POLICY, buildCodexCommand, createFixtureBaseline, loadTemplateMetadata, loadTierControl, relocateTemplateConfig, revalidateTemplateMetadata,
  type ReasoningEffort, type TemplateMetadata, type TierControl,
} from "./adaptive-policy-benchmark/policy"
import { claimOutputTarget, prepareOutputTarget } from "./adaptive-policy-benchmark/paths"
import { evaluateCompletionOracles } from "./adaptive-policy-benchmark/oracles"
import { runCommandWithTimeout, type ProcessResult } from "./adaptive-policy-benchmark/process-tree"
import { deriveEvents, evaluateVerificationExpectation } from "./adaptive-policy-benchmark/events"
import { sandboxEnvironment } from "./adaptive-policy-benchmark/environment"

const CORPUS_ROOT = join(import.meta.dir, "fixtures/adaptive-policy-benchmark")
const TOOLCHAIN_BIN = join(import.meta.dir, "..", "node_modules", ".bin")

type Options = {
  readonly variant: Variant
  readonly tier: Tier
  readonly model: string
  readonly template: string
  readonly output: string
  readonly caseFilter: string | null
  readonly repetitions: number
  readonly dryRun: boolean
  readonly reasoningEffort: ReasoningEffort
  readonly timeoutMs: number | null
}

type CodexProcess = { readonly command: readonly string[]; readonly cwd: string; readonly env: NodeJS.ProcessEnv; readonly timeoutMs: number }
type RunMetadata = {
  readonly checkout_tag: string | null
  readonly checkout_commit: string | null
  readonly package_version: string
  readonly corpus_commit: string | null
  readonly corpus_manifest_sha256: string
  readonly corpus_sha256: string
  readonly template: TemplateMetadata
  readonly tier_control: TierControl
  readonly reasoning_setting: ReasoningEffort
  readonly tool_policy: typeof TOOL_POLICY
}
type BenchmarkRun = { readonly options: Options; readonly corpusCase: CorpusCase; readonly runId: string; readonly metadata: RunMetadata }

class UsageError extends Error {
  readonly name = "UsageError"
}

function optionValue(args: readonly string[], name: string): string | null {
  const equals = args.find((argument) => argument.startsWith(`${name}=`))
  if (equals !== undefined) return equals.slice(name.length + 1)
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] ?? null : null
}

function parseOptions(args: readonly string[]): Options {
  const variantValue = optionValue(args, "--variant") ?? args.find((argument) => argument === "adaptive" || argument === "upstream")
  const tierValue = optionValue(args, "--tier")
  const tier = TIERS.find((candidate) => candidate.toLowerCase() === tierValue?.toLowerCase())
  const repetitionsValue = optionValue(args, "--repetitions") ?? "5"
  const repetitions = Number(repetitionsValue)
  const reasoningValue = optionValue(args, "--reasoning-effort") ?? "medium"
  const reasoningEffort = REASONING_EFFORTS.find((candidate) => candidate === reasoningValue)
  const timeoutValue = optionValue(args, "--timeout-ms")
  const timeoutMs = timeoutValue === null ? null : Number(timeoutValue)
  const model = optionValue(args, "--model")
  const template = optionValue(args, "--codex-home-template")
  const output = optionValue(args, "--output")
  if ((variantValue !== "adaptive" && variantValue !== "upstream") || tier === undefined || model === null || template === null || output === null || reasoningEffort === undefined) {
    throw new UsageError("Required: --variant adaptive|upstream --tier Light|Standard|Deep --model MODEL --codex-home-template PATH --output PATH")
  }
  if (!Number.isInteger(repetitions) || repetitions <= 0) throw new UsageError("--repetitions must be a positive integer")
  if (timeoutMs !== null && (!Number.isInteger(timeoutMs) || timeoutMs <= 0)) throw new UsageError("--timeout-ms must be a positive integer")
  return { variant: variantValue, tier, model, template: resolve(template), output: resolve(output), caseFilter: optionValue(args, "--case"), repetitions, dryRun: args.includes("--dry-run"), reasoningEffort, timeoutMs }
}

async function runCodex(input: CodexProcess): Promise<ProcessResult> {
  return runCommandWithTimeout(input)
}

async function gitValue(args: readonly string[]): Promise<string | null> {
  const result = Bun.spawnSync(["git", ...args], { cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "ignore" })
  return result.exitCode === 0 ? result.stdout.toString().trim() || null : null
}

async function executeRun(input: BenchmarkRun): Promise<void> {
  const { options, corpusCase, runId, metadata } = input
  const runDirectory = join(options.output, "runs", corpusCase.id, options.variant, options.tier, runId)
  await mkdir(dirname(runDirectory), { recursive: true })
  await mkdir(runDirectory)
  const sandbox = await mkdtemp(join(tmpdir(), "omo-adaptive-benchmark-"))
  const codexHome = join(sandbox, "codex-home")
  const cwd = join(sandbox, "workspace")
  const xdgConfig = join(sandbox, "xdg-config")
  const xdgCache = join(sandbox, "xdg-cache")
  const xdgData = join(sandbox, "xdg-data")
  const xdgState = join(sandbox, "xdg-state")
  const sandboxHome = join(sandbox, "home")
  const sandboxTemporary = join(sandbox, "tmp")
  try {
    const casePaths = await resolveCasePaths(CORPUS_ROOT, corpusCase)
    await revalidateTemplateMetadata(metadata.template, options.variant)
    await cp(metadata.template.directory_path, codexHome, { recursive: true, errorOnExist: true })
    await revalidateTemplateMetadata(metadata.template, options.variant)
    if (await sha256Directory(codexHome) !== metadata.template.directory_sha256) throw new TypeError("Copied template bytes do not match validated source")
    await relocateTemplateConfig(codexHome, metadata.template)
    await loadTemplateMetadata(codexHome, options.variant)
    await cp(casePaths.fixture, cwd, { recursive: true, errorOnExist: true })
    await writeFile(join(cwd, metadata.tier_control.path), metadata.tier_control.content, { flag: "wx" })
    await Promise.all([xdgConfig, xdgCache, xdgData, xdgState, sandboxHome, sandboxTemporary].map((path) => mkdir(path, { recursive: true })))
    const runEnvironment = sandboxEnvironment({ home: sandboxHome, codexHome, xdgConfig, xdgCache, xdgData, xdgState, temporary: sandboxTemporary, toolchainBin: TOOLCHAIN_BIN })
    const fixtureBaselineCommit = createFixtureBaseline(cwd, runEnvironment)
    const promptPath = casePaths.prompt
    const prompt = await readFile(promptPath, "utf8")
    const promptMetadata = { source: `script/fixtures/adaptive-policy-benchmark/${corpusCase.promptFile}`, sha256: await sha256File(promptPath) }
    const command = buildCodexCommand({ binary: process.env.CODEX_BIN ?? "codex", model: options.model, reasoningEffort: options.reasoningEffort, prompt })
    const effectiveTimeoutMs = options.timeoutMs ?? corpusCase.timeoutMs
    const oracleTimeoutMs = Math.min(effectiveTimeoutMs, 30_000)
    const environment = { command, cwd, codexHome, sandboxHome, sandboxTemporary, xdgConfig, xdgCache, xdgData, xdgState, toolchain_bin: TOOLCHAIN_BIN, fixture_baseline_commit: fixtureBaselineCommit, prompt: promptMetadata, template: metadata.template, tier_control: metadata.tier_control, reasoning_setting: options.reasoningEffort, tool_policy: TOOL_POLICY, timeout_ms: effectiveTimeoutMs, oracle_timeout_ms: oracleTimeoutMs }
    await writeFile(join(runDirectory, "environment.json"), `${JSON.stringify(environment, null, 2)}\n`, { flag: "wx" })
    const startedAt = new Date()
    const started = performance.now()
    let result: ProcessResult
    try {
      result = await runCodex({
        command, cwd, timeoutMs: effectiveTimeoutMs,
        env: runEnvironment,
      })
    }
    catch (error) { result = { stdout: "", stderr: error instanceof Error ? error.stack ?? error.message : String(error), exitCode: null, timedOut: false } }
    const finishedAt = new Date()
    const durationMs = Math.round(performance.now() - started)
    await writeFile(join(runDirectory, "raw.ndjson"), result.stdout, { flag: "wx" })
    await writeFile(join(runDirectory, "stderr.txt"), result.stderr, { flag: "wx" })
    const events = deriveEvents(result.stdout)
    const criterionTarget = join(cwd, corpusCase.completionCriterion.path)
    const criterionObserved = await Bun.file(criterionTarget).exists() && await criterionMet(cwd, corpusCase.completionCriterion)
    const oracleResults = await evaluateCompletionOracles({ corpusRoot: CORPUS_ROOT, corpusCase, cwd, env: runEnvironment, toolchainBin: TOOLCHAIN_BIN, timeoutMs: oracleTimeoutMs })
    const completionObserved = corpusCase.tier === "Light" ? criterionObserved : oracleResults.length > 0 && oracleResults.every((oracle) => oracle.status === "passed")
    const verificationExpectation = evaluateVerificationExpectation(corpusCase.expectedVerificationPatterns, events.verificationEvents)
    const status = result.timedOut ? "timed_out" : result.exitCode !== 0 ? "failed" : completionObserved && verificationExpectation.satisfied ? "completed" : "inconclusive"
    const notes = ["model version is not observable from Codex exec JSON", "verification expectations use heuristic command/tool-name matches", `${events.invalidLineCount} non-JSON stdout lines ignored`]
    const summary = {
      ...metadata, case_id: corpusCase.id, run_id: runId, tier: options.tier, variant: options.variant,
      prompt: promptMetadata, fixture_baseline_commit: fixtureBaselineCommit, attempt: Number(runId.slice(4)), model: options.model, model_version: null,
      timeout_ms: effectiveTimeoutMs, oracle_timeout_ms: oracleTimeoutMs,
      completion: { status, criterion: corpusCase.completionCriterion, criterion_observed: criterionObserved, observed: completionObserved, exit_code: result.exitCode },
      oracle_results: oracleResults,
      tool_calls: { count: events.toolCalls.length, records: events.toolCalls }, subagent_count: events.subagentCount,
      verification_events: events.verificationEvents, verification_expectation: verificationExpectation, duration_ms: durationMs,
      raw_ndjson_sha256: await sha256File(join(runDirectory, "raw.ndjson")), started_at: startedAt.toISOString(), finished_at: finishedAt.toISOString(),
      measurement_note: notes.join("; "),
    }
    await writeFile(join(runDirectory, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, { flag: "wx" })
  } finally { await rm(sandbox, { recursive: true, force: true }) }
}

export async function main(args: readonly string[]): Promise<number> {
  const options = parseOptions(args)
  if (!(await stat(options.template)).isDirectory()) throw new UsageError("Codex-home template must be a directory")
  if (options.template === resolve(homedir(), ".codex")) throw new UsageError("Refusing to use the real ~/.codex as a template")
  const preparedOutput = await prepareOutputTarget(options.output, options.template, resolve(homedir(), ".codex"))
  const claimedOutput = await claimOutputTarget(preparedOutput)
  try {
  const claimedOptions = { ...options, output: claimedOutput.artifactRoot, template: preparedOutput.canonicalTemplate }
  const template = await loadTemplateMetadata(claimedOptions.template, claimedOptions.variant)
  const tierControl = await loadTierControl(options.tier)
  const manifestPath = join(CORPUS_ROOT, "manifest.json")
  const corpus = await loadCorpus(manifestPath)
  const selected = corpus.cases.filter((item) => item.tier === claimedOptions.tier && (claimedOptions.caseFilter === null || item.id === claimedOptions.caseFilter))
  if (selected.length === 0) throw new UsageError("Case filter matched no cases in the selected tier")
  await Promise.all(selected.map((item) => validateCase(CORPUS_ROOT, item)))
  const checkoutCommit = await gitValue(["rev-parse", "HEAD"])
  const packageJson: unknown = JSON.parse(await readFile(join(import.meta.dir, "../package.json"), "utf8"))
  if (typeof packageJson !== "object" || packageJson === null || !("version" in packageJson) || typeof packageJson.version !== "string") throw new TypeError("Root package.json has no string version")
  const metadata: RunMetadata = {
    checkout_tag: await gitValue(["describe", "--tags", "--exact-match"]), checkout_commit: checkoutCommit,
    package_version: packageJson.version,
    corpus_commit: await gitValue(["log", "-1", "--format=%H", "--", "script/fixtures/adaptive-policy-benchmark"]),
    corpus_manifest_sha256: await sha256File(manifestPath), corpus_sha256: await sha256Directory(CORPUS_ROOT),
    template, tier_control: tierControl, reasoning_setting: claimedOptions.reasoningEffort, tool_policy: TOOL_POLICY,
  }
  const runs = selected.flatMap((item) => Array.from({ length: claimedOptions.repetitions }, (_, index) => ({ caseId: item.id, tier: claimedOptions.tier, variant: claimedOptions.variant, runId: `run-${String(index + 1).padStart(3, "0")}` })))
  await revalidateTemplateMetadata(template, claimedOptions.variant)
  await writeFile(join(claimedOutput.artifactRoot, "manifest.json"), `${JSON.stringify({ dryRun: claimedOptions.dryRun, ...metadata, model: claimedOptions.model, repetitions: claimedOptions.repetitions, runs }, null, 2)}\n`, { flag: "wx" })
  console.log(`Planned ${runs.length} benchmark runs in ${claimedOutput.canonicalPath}`)
  if (claimedOptions.dryRun) return 0
  for (const run of runs) {
    const corpusCase = selected.find((item) => item.id === run.caseId)
    if (corpusCase !== undefined) await executeRun({ options: claimedOptions, corpusCase, runId: run.runId, metadata })
  }
  return 0
  } finally { await claimedOutput.handle.close() }
}

if (import.meta.main) { // no-excuse-ok: catch
  try { process.exitCode = await main(Bun.argv.slice(2)) }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 }
}
