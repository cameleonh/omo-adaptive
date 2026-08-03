import { afterEach, expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { evaluateCompletionOracles } from "./oracles"
import type { CorpusCase } from "./core"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

test("#given Deep typecheck never exits #when the oracle deadline expires #then typecheck is recorded timed out", async () => {
  const root = await mkdtemp(join(tmpdir(), "adaptive-benchmark-typecheck-timeout-"))
  temporaryDirectories.push(root)
  const cwd = join(root, "workspace")
  const toolchain = join(root, "bin")
  await mkdir(join(cwd, "src"), { recursive: true })
  await mkdir(toolchain)
  await writeFile(
    join(cwd, "src/report.ts"),
    'export function reportTotal(invoice: { readonly items: readonly number[] }): number { return invoice.items.reduce((sum, item) => sum + item, 0) }\n',
  )
  await writeFile(join(toolchain, "tsgo"), "#!/usr/bin/env bun\nsetInterval(() => {}, 1000)\n")
  await chmod(join(toolchain, "tsgo"), 0o755)
  const corpusCase: CorpusCase = {
    id: "deep-timeout",
    tier: "Deep",
    promptFile: "prompts/deep-cross-module-total.txt",
    fixtureDirectory: "cases/deep-cross-module-total",
    completionCriterion: { kind: "file_contains", path: "src/report.ts", contains: "reportTotal" },
    behavioralOracle: { name: "deep-report-behavior", path: "oracles/deep-report-total.ts" },
    expectedVerificationPatterns: ["typecheck"],
    timeoutMs: 50,
  }

  const results = await evaluateCompletionOracles({
    corpusRoot: join(import.meta.dir, "../fixtures/adaptive-policy-benchmark"),
    corpusCase,
    cwd,
    env: process.env,
    toolchainBin: toolchain,
    timeoutMs: 50,
  })

  expect(results).toMatchObject([
    { name: "deep-report-behavior", status: "passed" },
    { name: "deep-typecheck", status: "timed_out" },
  ])
})
