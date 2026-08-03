import { afterEach, describe, expect, test } from "bun:test"
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { validateCase, type CorpusCase, type Variant } from "./adaptive-policy-benchmark/core"
import { createInstalledTemplate } from "./adaptive-policy-benchmark/test-template"

const temporaryDirectories: string[] = []

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

async function createTemplate(root: string, variant: Variant): Promise<string> {
  return createInstalledTemplate(root, variant)
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("adaptive policy benchmark", () => {
  test("#given the committed corpus #when dry-run uses default repetitions #then it records a five-run matrix without invoking Codex", async () => {
    // given
    const root = await temporaryDirectory("adaptive-benchmark-")
    const template = await createTemplate(root, "adaptive")
    const output = join(root, "output")
    const invocationMarker = join(root, "codex-invoked")
    const fakeCodex = join(root, "must-not-run")
    await writeFile(fakeCodex, `#!/usr/bin/env bun\nawait Bun.write(${JSON.stringify(invocationMarker)}, "invoked")\n`)
    await chmod(fakeCodex, 0o755)

    // when
    const processResult = Bun.spawnSync([
      process.execPath,
      "script/adaptive-policy-benchmark.ts",
      "--variant", "adaptive",
      "--tier", "Light",
      "--model", "gpt-5.6",
      "--reasoning-effort", "high",
      "--codex-home-template", template,
      "--output", output,
      "--dry-run",
    ], { cwd: process.cwd(), env: { ...process.env, CODEX_BIN: fakeCodex } })

    // then
    expect(processResult.exitCode).toBe(0)
    const manifest = JSON.parse(await readFile(join(output, "manifest.json"), "utf8"))
    expect(manifest.dryRun).toBe(true)
    expect(manifest.runs).toHaveLength(5)
    expect(manifest.runs.every((run: { readonly tier: string }) => run.tier === "Light")).toBe(true)
    expect(processResult.stdout.toString()).toContain("Planned 5 benchmark runs")
    expect(await Bun.file(invocationMarker).exists()).toBe(false)
    expect(manifest.reasoning_setting).toBe("high")
    expect(manifest.template.marker.content).toEqual({ variant: "adaptive", sourceRevision: manifest.checkout_commit })
    expect(manifest.template.installation.policy_sha256).toBe(manifest.template.installation.expected_policy_sha256)
    expect(manifest.template.directory_sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(manifest.tier_control.path).toBe("AGENTS.md")
    expect(manifest.tier_control.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(manifest.tool_policy).toEqual({ sandbox: "workspace-write", approvalPolicy: "never", networkAccess: false })
  })

  test("#given an isolated template and fake Codex #when one live run completes #then raw and derived evidence are preserved without touching sources", async () => {
    // given
    const root = await temporaryDirectory("adaptive-benchmark-live-")
    const template = await createTemplate(root, "upstream")
    const output = join(root, "output")
    const fakeCodex = join(root, "fake-codex")
    await writeFile(join(template, "marker.txt"), "template-unchanged\n")
    await writeFile(fakeCodex, `#!/usr/bin/env bun
await Bun.write("README.md", "This fixture contains a reproducible benchmark.\\n")
const diffCheck = Bun.spawnSync(["git", "diff", "--check"])
const baseline = Bun.spawnSync(["git", "rev-parse", "HEAD"])
const config = await Bun.file(process.env.CODEX_HOME + "/config.toml").text()
const configSource = config.match(/^source = "([^"]+)"$/m)?.[1]
console.log(JSON.stringify({type:"item.started",item:{id:"tool-1",type:"command_execution",command:"git diff --check",status:"in_progress"}}))
console.log(JSON.stringify({type:"item.completed",item:{id:"tool-1",type:"command_execution",command:"git diff --check",status:"completed",exit_code:diffCheck.exitCode}}))
console.log(JSON.stringify({type:"item.started",item:{id:"tool-2",type:"mcp_tool_call",server:"collaboration",tool:"spawn_agent",status:"completed"}}))
console.error(JSON.stringify({codexHome:process.env.CODEX_HOME,home:process.env.HOME,xdgState:process.env.XDG_STATE_HOME,cwd:process.cwd(),configSource,agents:await Bun.file("AGENTS.md").text(),baseline:baseline.stdout.toString().trim(),openai:process.env.OPENAI_API_KEY,github:process.env.GITHUB_TOKEN}))
`)
    await chmod(fakeCodex, 0o755)
    const sourceFixture = "script/fixtures/adaptive-policy-benchmark/cases/light-readme-typo/README.md"
    const sourceBefore = await readFile(sourceFixture, "utf8")

    // when
    const processResult = Bun.spawnSync([
      process.execPath, "script/adaptive-policy-benchmark.ts",
      "--variant", "upstream", "--tier", "Light", "--model", "fixture-model",
      "--reasoning-effort", "xhigh",
      "--codex-home-template", template, "--output", output, "--repetitions", "1",
    ], { cwd: process.cwd(), env: { ...process.env, CODEX_BIN: fakeCodex, OPENAI_API_KEY: "sentinel-openai-secret", GITHUB_TOKEN: "sentinel-github-secret" } })

    // then
    expect(processResult.exitCode).toBe(0)
    const runDirectory = join(output, "runs/light-readme-typo/upstream/Light/run-001")
    const summary = JSON.parse(await readFile(join(runDirectory, "summary.json"), "utf8"))
    expect(summary.completion.status).toBe("completed")
    expect(summary.tool_calls.count).toBe(2)
    expect(summary.subagent_count).toBe(1)
    expect(summary.verification_events).toHaveLength(1)
    expect(summary.verification_events[0].status).toBe("passed")
    expect(summary.verification_expectation.satisfied).toBe(true)
    expect(summary.reasoning_setting).toBe("xhigh")
    expect(summary.tier_control.content.length).toBeGreaterThan(0)
    expect(summary.tier_control.source).toEndWith("Light.AGENTS.md")
    expect(summary.template.marker.content.variant).toBe("upstream")
    expect(summary.tool_policy.networkAccess).toBe(false)
    const environment = JSON.parse(await readFile(join(runDirectory, "environment.json"), "utf8"))
    expect(environment.command).toContain('model_reasoning_effort="xhigh"')
    expect(environment.command).toContain('approval_policy="never"')
    expect(environment.command).toContain("sandbox_workspace_write.network_access=false")
    expect(environment.command.at(-1)).toBe(await readFile("script/fixtures/adaptive-policy-benchmark/prompts/light-readme-typo.txt", "utf8"))
    const capturedEnvironment = JSON.parse((await readFile(join(runDirectory, "stderr.txt"), "utf8")).trim())
    expect(capturedEnvironment.agents).toBe(summary.tier_control.content)
    expect(capturedEnvironment.baseline).toMatch(/^[a-f0-9]{40}$/)
    expect(capturedEnvironment.home).not.toBe(process.env.HOME)
    expect(capturedEnvironment.home.startsWith(dirname(capturedEnvironment.cwd))).toBe(true)
    expect(capturedEnvironment.xdgState.startsWith(dirname(capturedEnvironment.cwd))).toBe(true)
    expect(capturedEnvironment.codexHome.startsWith(dirname(capturedEnvironment.cwd))).toBe(true)
    expect(capturedEnvironment.configSource.startsWith(capturedEnvironment.codexHome)).toBe(true)
    expect(capturedEnvironment.configSource).not.toContain(template)
    expect(capturedEnvironment.openai).toBeUndefined()
    expect(capturedEnvironment.github).toBeUndefined()
    const artifactText = await Promise.all(["environment.json", "raw.ndjson", "stderr.txt", "summary.json"].map((name) => readFile(join(runDirectory, name), "utf8")))
    expect((await readFile(join(output, "manifest.json"), "utf8")) + artifactText.join("\n")).not.toContain("sentinel-")
    expect(environment.fixture_baseline_commit).toBe(capturedEnvironment.baseline)
    expect(summary.fixture_baseline_commit).toBe(capturedEnvironment.baseline)
    expect(await readFile(join(runDirectory, "raw.ndjson"), "utf8")).toContain("tool-2")
    expect(await readFile(join(template, "marker.txt"), "utf8")).toBe("template-unchanged\n")
    expect(await readFile(sourceFixture, "utf8")).toBe(sourceBefore)
  })

  test("#given Codex exits unsuccessfully #when a run finishes #then failed raw output and stderr remain artifacts", async () => {
    // given
    const root = await temporaryDirectory("adaptive-benchmark-failure-")
    const template = await createTemplate(root, "adaptive")
    const output = join(root, "output")
    const fakeCodex = join(root, "fake-codex")
    await writeFile(fakeCodex, "#!/usr/bin/env bun\nconsole.log(JSON.stringify({type:'turn.failed'}))\nconsole.error('fixture failure')\nprocess.exit(7)\n")
    await chmod(fakeCodex, 0o755)

    // when
    const processResult = Bun.spawnSync([
      process.execPath, "script/adaptive-policy-benchmark.ts",
      "--variant", "adaptive", "--tier", "Light", "--model", "fixture-model",
      "--codex-home-template", template, "--output", output, "--repetitions", "1",
    ], { cwd: process.cwd(), env: { ...process.env, CODEX_BIN: fakeCodex } })

    // then
    expect(processResult.exitCode).toBe(0)
    const runDirectory = join(output, "runs/light-readme-typo/adaptive/Light/run-001")
    const summary = JSON.parse(await readFile(join(runDirectory, "summary.json"), "utf8"))
    expect(summary.completion.status).toBe("failed")
    expect(await readFile(join(runDirectory, "raw.ndjson"), "utf8")).toContain("turn.failed")
    expect(await readFile(join(runDirectory, "stderr.txt"), "utf8")).toContain("fixture failure")
  })

  test("#given a mismatched template marker #when dry-run starts #then it fails before creating a matrix", async () => {
    const root = await temporaryDirectory("adaptive-benchmark-marker-")
    const template = await createTemplate(root, "upstream")
    const output = join(root, "output")

    const result = Bun.spawnSync([
      process.execPath, "script/adaptive-policy-benchmark.ts", "--variant", "adaptive", "--tier", "Light",
      "--model", "fixture-model", "--codex-home-template", template, "--output", output, "--dry-run",
    ], { cwd: process.cwd() })

    expect(result.exitCode).toBe(1)
    expect(result.stderr.toString()).toContain("template marker variant")
    expect(await Bun.file(join(output, "manifest.json")).exists()).toBe(false)
  })

  test("#given a fixture AGENTS.md #when the corpus case is validated #then tier control refuses to overwrite it", async () => {
    const root = await temporaryDirectory("adaptive-benchmark-agents-")
    await mkdir(join(root, "case"))
    await writeFile(join(root, "prompt.txt"), "fixed prompt\n")
    await writeFile(join(root, "case/result.txt"), "before\n")
    await writeFile(join(root, "case/AGENTS.md"), "fixture-owned\n")
    const corpusCase: CorpusCase = {
      id: "agents-conflict", tier: "Light", promptFile: "prompt.txt", fixtureDirectory: "case",
      completionCriterion: { kind: "file_contains", path: "result.txt", contains: "after" },
      behavioralOracle: null,
      expectedVerificationPatterns: ["git diff --check"], timeoutMs: 1_000,
    }

    await expect(validateCase(root, corpusCase)).rejects.toThrow("AGENTS.md")
  })

  test("#given a hanging Codex process #when the case timeout override expires #then partial stdout and stderr remain timed-out artifacts", async () => {
    const root = await temporaryDirectory("adaptive-benchmark-timeout-")
    const template = await createTemplate(root, "adaptive")
    const output = join(root, "output")
    const fakeCodex = join(root, "fake-codex")
    await writeFile(fakeCodex, "#!/usr/bin/env bun\nconsole.log(JSON.stringify({type:'turn.started'}))\nconsole.error('before timeout')\nsetTimeout(() => process.exit(7), 150)\n")
    await chmod(fakeCodex, 0o755)

    const result = Bun.spawnSync([
      process.execPath, "script/adaptive-policy-benchmark.ts", "--variant", "adaptive", "--tier", "Light",
      "--model", "fixture-model", "--codex-home-template", template, "--output", output,
      "--repetitions", "1", "--timeout-ms", "25",
    ], { cwd: process.cwd(), env: { ...process.env, CODEX_BIN: fakeCodex } })

    expect(result.exitCode).toBe(0)
    const runDirectory = join(output, "runs/light-readme-typo/adaptive/Light/run-001")
    const summary = JSON.parse(await readFile(join(runDirectory, "summary.json"), "utf8"))
    expect(summary.completion.status).toBe("timed_out")
    expect(await readFile(join(runDirectory, "raw.ndjson"), "utf8")).toContain("turn.started")
    expect(await readFile(join(runDirectory, "stderr.txt"), "utf8")).toContain("before timeout")
  })

  test("#given the file criterion passes without expected verification #when Codex exits zero #then completion stays inconclusive", async () => {
    const root = await temporaryDirectory("adaptive-benchmark-verification-")
    const template = await createTemplate(root, "adaptive")
    const output = join(root, "output")
    const fakeCodex = join(root, "fake-codex")
    await writeFile(fakeCodex, "#!/usr/bin/env bun\nawait Bun.write('README.md', 'reproducible benchmark\\n')\n")
    await chmod(fakeCodex, 0o755)

    const result = Bun.spawnSync([
      process.execPath, "script/adaptive-policy-benchmark.ts", "--variant", "adaptive", "--tier", "Light",
      "--model", "fixture-model", "--codex-home-template", template, "--output", output, "--repetitions", "1",
    ], { cwd: process.cwd(), env: { ...process.env, CODEX_BIN: fakeCodex } })

    expect(result.exitCode).toBe(0)
    const summary = JSON.parse(await readFile(join(output, "runs/light-readme-typo/adaptive/Light/run-001/summary.json"), "utf8"))
    expect(summary.completion.observed).toBe(true)
    expect(summary.verification_expectation.satisfied).toBe(false)
    expect(summary.completion.status).toBe("inconclusive")
  })

})
