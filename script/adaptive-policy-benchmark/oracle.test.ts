import { afterEach, describe, expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { main } from "../adaptive-policy-benchmark"
import { createInstalledTemplate } from "./test-template"

const temporaryDirectories: string[] = []

async function setup(variant: "adaptive" | "upstream" = "adaptive"): Promise<{
  readonly root: string
  readonly template: string
  readonly output: string
  readonly fakeCodex: string
}> {
  const root = await mkdtemp(join(tmpdir(), "adaptive-benchmark-oracle-"))
  temporaryDirectories.push(root)
  const template = await createInstalledTemplate(root, variant)
  return { root, template, output: join(root, "output"), fakeCodex: join(root, "fake-codex") }
}

async function runCase(input: {
  readonly tier: "Standard" | "Deep"
  readonly template: string
  readonly output: string
  readonly fakeCodex: string
  readonly timeoutMs?: number
}): Promise<unknown> {
  const previous = process.env.CODEX_BIN
  process.env.CODEX_BIN = input.fakeCodex
  try {
    const timeoutArgs = input.timeoutMs === undefined ? [] : ["--timeout-ms", String(input.timeoutMs)]
    await main([
      "--variant", "adaptive", "--tier", input.tier, "--model", "fixture-model",
      "--codex-home-template", input.template, "--output", input.output, "--repetitions", "1",
      ...timeoutArgs,
    ])
  } finally {
    if (previous === undefined) delete process.env.CODEX_BIN
    else process.env.CODEX_BIN = previous
  }
  const id = input.tier === "Standard" ? "standard-add-regression" : "deep-cross-module-total"
  return JSON.parse(
    await readFile(join(input.output, `runs/${id}/adaptive/${input.tier}/run-001/summary.json`), "utf8"),
  )
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe("adaptive benchmark behavioral completion oracles", () => {
  test("#given a vacuous Standard test name and claimed model verification #when completion is measured #then broken add remains inconclusive", async () => {
    const fixture = await setup()
    await writeFile(fixture.fakeCodex, `#!/usr/bin/env bun
await Bun.write("math.test.ts", "// adds negative operands\\n")
console.log(JSON.stringify({type:"item.completed",item:{id:"verify",type:"command_execution",command:"bun test math.test.ts",status:"completed",exit_code:0}}))
`)
    await chmod(fixture.fakeCodex, 0o755)

    const summary = await runCase({ ...fixture, tier: "Standard" })

    expect(summary).toMatchObject({
      completion: { status: "inconclusive" },
      oracle_results: [{ name: "standard-add-behavior", status: "failed", exit_code: 1 }],
    })
  })

  test("#given correct Standard behavior without the requested test text #when model verification exists #then the behavioral oracle completes", async () => {
    const fixture = await setup()
    await writeFile(fixture.fakeCodex, `#!/usr/bin/env bun
await Bun.write("math.ts", "export function add(left: number, right: number): number { return left + right }\\n")
console.log(JSON.stringify({type:"item.completed",item:{id:"verify",type:"command_execution",command:"bun test math.test.ts",status:"completed",exit_code:0}}))
`)
    await chmod(fixture.fakeCodex, 0o755)

    const summary = await runCase({ ...fixture, tier: "Standard" })

    expect(summary).toMatchObject({
      completion: { status: "completed", criterion_observed: false, observed: true },
      oracle_results: [{ name: "standard-add-behavior", status: "passed", exit_code: 0 }],
    })
  })

  test("#given correct Standard behavior without model-run verification #when the oracle passes #then completion remains inconclusive", async () => {
    const fixture = await setup()
    await writeFile(fixture.fakeCodex, `#!/usr/bin/env bun
await Bun.write("math.ts", "export function add(left: number, right: number): number { return left + right }\\n")
`)
    await chmod(fixture.fakeCodex, 0o755)

    const summary = await runCase({ ...fixture, tier: "Standard" })

    expect(summary).toMatchObject({
      completion: { status: "inconclusive", observed: true },
      oracle_results: [{ name: "standard-add-behavior", status: "passed" }],
      verification_expectation: { satisfied: false },
    })
  })

  test("#given fixed Deep behavior but a type error #when completion is measured #then harness typecheck remains failed", async () => {
    const fixture = await setup()
    await writeFile(fixture.fakeCodex, `#!/usr/bin/env bun
await Bun.write("src/report.ts", 'import type { Invoice } from "./invoice"\\nexport function reportTotal(invoice: Invoice): number { return invoice.items.reduce((sum, item) => sum + item, 0) }\\n')
await Bun.write("src/invoice.ts", 'export type Invoice = { readonly items: readonly number[] }\\nconst invalid: string = 1\\n')
for (const [id, command] of [["test", "bun test src/report.test.ts"], ["typecheck", "bun run typecheck"]]) console.log(JSON.stringify({type:"item.completed",item:{id,type:"command_execution",command,status:"completed",exit_code:0}}))
`)
    await chmod(fixture.fakeCodex, 0o755)

    const summary = await runCase({ ...fixture, tier: "Deep" })

    expect(summary).toMatchObject({
      completion: { status: "inconclusive" },
      oracle_results: [
        { name: "deep-report-behavior", status: "passed", exit_code: 0 },
        { name: "deep-typecheck", status: "failed" },
      ],
    })
  })

  test("#given model code hangs during the behavioral oracle #when the oracle deadline expires #then a terminal timed-out summary is written", async () => {
    const fixture = await setup()
    await writeFile(fixture.fakeCodex, `#!/usr/bin/env bun
await Bun.write("math.ts", "await new Promise(() => {})\\nexport function add(left: number, right: number): number { return left + right }\\n")
console.log(JSON.stringify({type:"item.completed",item:{id:"verify",type:"command_execution",command:"bun test math.test.ts",status:"completed",exit_code:0}}))
`)
    await chmod(fixture.fakeCodex, 0o755)

    const summary = await runCase({ ...fixture, tier: "Standard", timeoutMs: 50 })

    expect(summary).toMatchObject({
      completion: { status: "inconclusive", observed: false },
      oracle_results: [{ name: "standard-add-behavior", status: "timed_out" }],
      oracle_timeout_ms: 50,
    })
  })
})
