import { afterEach, describe, expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, rename, rm, stat, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { main } from "../adaptive-policy-benchmark"
import { criterionMet, sha256Directory, validateCase, type CorpusCase } from "./core"
import { claimOutputTarget, prepareOutputTarget, validateOutputTarget } from "./paths"
import { createInstalledTemplate } from "./test-template"

const temporaryDirectories: string[] = []

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "adaptive-benchmark-security-"))
  temporaryDirectories.push(directory)
  return directory
}

async function templateAt(root: string): Promise<string> {
  return createInstalledTemplate(root, "adaptive")
}

function corpusCase(overrides: Partial<CorpusCase> = {}): CorpusCase {
  return {
    id: "security",
    tier: "Light",
    promptFile: "prompt.txt",
    fixtureDirectory: "case",
    completionCriterion: { kind: "file_contains", path: "result.txt", contains: "done" },
    behavioralOracle: null,
    expectedVerificationPatterns: ["git diff --check"],
    timeoutMs: 1_000,
    ...overrides,
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe("adaptive benchmark filesystem boundaries", () => {
  test("#given an existing empty output #when planning starts #then no evidence is overwritten", async () => {
    const root = await temporaryDirectory()
    const template = await templateAt(root)
    const output = join(root, "existing")
    await mkdir(output)

    await expect(
      main([
        "--variant", "adaptive", "--tier", "Light", "--model", "fixture-model",
        "--codex-home-template", template, "--output", output, "--dry-run",
      ]),
    ).rejects.toThrow("already exists")
    expect(await Bun.file(join(output, "manifest.json")).exists()).toBe(false)
  })

  test("#given concurrent planners target one output #when evidence is created #then exactly one claims it", async () => {
    const root = await temporaryDirectory()
    const template = await templateAt(root)
    const output = join(root, "race-output")
    const args = [
      "--variant", "adaptive", "--tier", "Light", "--model", "fixture-model",
      "--codex-home-template", template, "--output", output, "--dry-run",
    ] as const

    const results = await Promise.allSettled([main(args), main(args)])

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1)
    expect(JSON.parse(await Bun.file(join(output, "manifest.json")).text()).model).toBe("fixture-model")
  })

  test("#given output target swaps after mkdir #when exclusive claim detects mismatch #then arbitrary and template directories are untouched", async () => {
    const root = await temporaryDirectory()
    const template = await templateAt(root)
    const safeParent = join(root, "safe-parent")
    const alias = join(root, "parent-alias")
    await mkdir(safeParent)
    await symlink(safeParent, alias, "dir")
    const prepared = await prepareOutputTarget(join(alias, "output"), template, join(root, "real-codex"))
    const templateBefore = await sha256Directory(template)
    await rm(alias)
    await symlink(template, alias, "dir")

    await expect(claimOutputTarget(prepared, async () => {
      await rename(prepared.canonicalCandidate, join(safeParent, "held-output"))
      await symlink(template, prepared.canonicalCandidate, "dir")
    })).rejects.toThrow("changed canonical target")
    expect(await Bun.file(join(template, "output")).exists()).toBe(false)
    expect((await stat(join(safeParent, "held-output"))).isDirectory()).toBe(true)
    expect(await sha256Directory(template)).toBe(templateBefore)
  })

  test("#given claimed output leaf swaps after descriptor anchoring #when artifacts are written #then writes remain in held original inode", async () => {
    const root = await temporaryDirectory()
    const template = await templateAt(root)
    const output = join(root, "output")
    const prepared = await prepareOutputTarget(output, template, join(root, "real-codex"))
    const claimed = await claimOutputTarget(prepared)
    const held = join(root, "held-output")
    await rename(output, held)
    await symlink(template, output, "dir")

    await writeFile(join(claimed.artifactRoot, "manifest.json"), "anchored\n", { flag: "wx" })
    await claimed.handle.close()
    expect(await Bun.file(join(held, "manifest.json")).text()).toBe("anchored\n")
    expect(await Bun.file(join(template, "manifest.json")).exists()).toBe(false)
  })

  test("#given output leaf swaps during a live run #when later artifacts are written #then every artifact remains descriptor-anchored", async () => {
    const root = await temporaryDirectory()
    const template = await templateAt(root)
    const output = join(root, "output")
    const held = join(root, "held-output")
    const fakeCodex = join(root, "fake-codex")
    await writeFile(fakeCodex, `#!/usr/bin/env bun
import { rename, symlink } from "node:fs/promises"
await rename(${JSON.stringify(output)}, ${JSON.stringify(held)})
await symlink(${JSON.stringify(template)}, ${JSON.stringify(output)}, "dir")
await Bun.write("README.md", "This fixture contains a reproducible benchmark.\\n")
console.log(JSON.stringify({type:"item.completed",item:{type:"command_execution",command:"git diff --check",exit_code:0}}))
`)
    await chmod(fakeCodex, 0o755)
    const result = Bun.spawnSync([process.execPath, "script/adaptive-policy-benchmark.ts", "--variant", "adaptive", "--tier", "Light", "--model", "fixture", "--codex-home-template", template, "--output", output, "--repetitions", "1"], { cwd: process.cwd(), env: { ...process.env, CODEX_BIN: fakeCodex } })

    expect(result.exitCode).toBe(0)
    expect(await Bun.file(join(held, "manifest.json")).exists()).toBe(true)
    expect(await Bun.file(join(held, "runs/light-readme-typo/adaptive/Light/run-001/summary.json")).exists()).toBe(true)
    expect(await Bun.file(join(template, "manifest.json")).exists()).toBe(false)
  })

  test("#given output aliases a template descendant #when validated #then canonical overlap is rejected", async () => {
    const root = await temporaryDirectory()
    const template = await templateAt(root)
    const alias = join(root, "template-alias")
    await symlink(template, alias, "dir")

    await expect(validateOutputTarget(join(alias, "evidence"), template, join(root, "real-codex")))
      .rejects.toThrow("template")
    expect(await Bun.file(join(template, "evidence")).exists()).toBe(false)
  })

  test("#given output aliases the real Codex home #when validated #then canonical overlap is rejected", async () => {
    const root = await temporaryDirectory()
    const template = await templateAt(root)
    const realCodex = join(root, "real-codex")
    const alias = join(root, "real-codex-alias")
    await mkdir(realCodex)
    await symlink(realCodex, alias, "dir")

    await expect(validateOutputTarget(join(alias, "evidence"), template, realCodex))
      .rejects.toThrow("real ~/.codex")
  })

  test("#given a template symlink aliases the real Codex home #when validated #then the real template is rejected", async () => {
    const root = await temporaryDirectory()
    const realCodex = join(root, "real-codex")
    const templateAlias = join(root, "template-alias")
    await mkdir(realCodex)
    await symlink(realCodex, templateAlias, "dir")

    await expect(validateOutputTarget(join(root, "output"), templateAlias, realCodex))
      .rejects.toThrow("real ~/.codex as a template")
  })

  test("#given manifest paths use absolute or traversal forms #when validated #then every escaped field is rejected", async () => {
    const root = await temporaryDirectory()
    await mkdir(join(root, "case"))
    await writeFile(join(root, "prompt.txt"), "prompt\n")
    await writeFile(join(root, "case/result.txt"), "result\n")
    const escaped = join(root, "outside.txt")
    await writeFile(escaped, "outside\n")

    await expect(validateCase(root, corpusCase({ fixtureDirectory: "../outside" }))).rejects.toThrow("fixtureDirectory")
    await expect(validateCase(root, corpusCase({ promptFile: escaped }))).rejects.toThrow("promptFile")
    await expect(validateCase(root, corpusCase({ completionCriterion: { kind: "file_contains", path: "../../outside.txt", contains: "outside" } }))).rejects.toThrow("completionCriterion.path")
  })

  test("#given a manifest path or use-boundary target is a symlink escape #when resolved #then access is rejected", async () => {
    const root = await temporaryDirectory()
    const outside = join(root, "outside")
    await mkdir(join(root, "case"))
    await mkdir(outside)
    await writeFile(join(root, "prompt.txt"), "prompt\n")
    await writeFile(join(root, "case/result.txt"), "result\n")
    await writeFile(join(outside, "escaped.txt"), "done\n")
    await symlink(join(outside, "escaped.txt"), join(root, "case/escape.txt"))

    const escaped = corpusCase({ completionCriterion: { kind: "file_contains", path: "escape.txt", contains: "done" } })
    await expect(validateCase(root, escaped)).rejects.toThrow("completionCriterion.path")
    await rm(join(root, "case/result.txt"))
    await symlink(join(outside, "escaped.txt"), join(root, "case/result.txt"))
    await expect(criterionMet(join(root, "case"), corpusCase().completionCriterion)).rejects.toThrow("completionCriterion.path")
  })

  test("#given fixture prompt and oracle symlinks escape the corpus #when validated #then every source boundary is rejected", async () => {
    const root = await temporaryDirectory()
    const outside = join(root, "outside")
    await mkdir(join(root, "corpus/case"), { recursive: true })
    await mkdir(outside)
    await writeFile(join(root, "corpus/prompt.txt"), "prompt\n")
    await writeFile(join(root, "corpus/case/result.txt"), "result\n")
    await writeFile(join(outside, "file.txt"), "outside\n")
    await symlink(outside, join(root, "corpus/fixture-link"), "dir")
    await symlink(join(outside, "file.txt"), join(root, "corpus/prompt-link.txt"))
    await symlink(join(outside, "file.txt"), join(root, "corpus/oracle-link.ts"))

    await expect(validateCase(join(root, "corpus"), corpusCase({ fixtureDirectory: "fixture-link" })))
      .rejects.toThrow("fixtureDirectory")
    await expect(validateCase(join(root, "corpus"), corpusCase({ promptFile: "prompt-link.txt" })))
      .rejects.toThrow("promptFile")
    await expect(validateCase(join(root, "corpus"), corpusCase({
      tier: "Standard",
      behavioralOracle: { name: "escaped", path: "oracle-link.ts" },
    }))).rejects.toThrow("behavioralOracle.path")
  })
})
