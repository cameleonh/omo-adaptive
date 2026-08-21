import { afterEach, expect, spyOn, test } from "bun:test"
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readProcessSnapshot, runCommandWithTimeout } from "./process-tree"
import { createInstalledTemplate } from "./test-template"

const platformTest = process.platform === "linux" ? test : test.skip

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

platformTest("#given Codex launches a detached setsid descendant #when timeout expires #then explicit descendant cleanup prevents later writes", async () => {
  const root = await mkdtemp(join(tmpdir(), "adaptive-benchmark-tree-"))
  temporaryDirectories.push(root)
  const template = await createInstalledTemplate(root, "adaptive")
  const output = join(root, "output")
  const marker = join(root, "grandchild-wrote")
  const fakeCodex = join(root, "fake-codex")
  await writeFile(fakeCodex, `#!/usr/bin/env bun
Bun.spawn([process.execPath, "-e", ${JSON.stringify(`setTimeout(async () => { await Bun.write(${JSON.stringify(marker)}, "survived") }, 75); setInterval(() => {}, 1000)`) }], { stdin: "ignore", stdout: "ignore", stderr: "ignore", detached: true })
console.log(JSON.stringify({type:"turn.started"}))
setInterval(() => {}, 1000)
`)
  await chmod(fakeCodex, 0o755)

  const result = Bun.spawnSync([
    process.execPath, "script/adaptive-policy-benchmark.ts",
    "--variant", "adaptive", "--tier", "Light", "--model", "fixture-model",
    "--codex-home-template", template, "--output", output, "--repetitions", "1", "--timeout-ms", "20",
  ], { cwd: process.cwd(), env: { ...process.env, CODEX_BIN: fakeCodex } })
  await Bun.sleep(150)

  expect(result.exitCode).toBe(0)
  expect(await Bun.file(marker).exists()).toBe(false)
})

platformTest("#given process spawn fails #when the error rejects #then its timeout resource is cleared", async () => {
  const root = await mkdtemp(join(tmpdir(), "adaptive-benchmark-spawn-error-"))
  temporaryDirectories.push(root)
  const timersBefore = process.getActiveResourcesInfo().filter((resource) => resource === "Timeout").length
  const clearTimer = spyOn(globalThis, "clearTimeout")

  try {
    await expect(runCommandWithTimeout({
      command: [join(root, "missing-command")],
      cwd: root,
      env: process.env,
      timeoutMs: 500,
    })).rejects.toThrow()
    expect(clearTimer).toHaveBeenCalled()
  } finally {
    clearTimer.mockRestore()
  }

  const timersAfter = process.getActiveResourcesInfo().filter((resource) => resource === "Timeout").length
  expect(timersAfter).toBe(timersBefore)
})

platformTest("#given identity enumeration fails after a detached descendant is tracked #when timeout cleans up #then stable identity prevents escape", async () => {
  const root = await mkdtemp(join(tmpdir(), "adaptive-benchmark-tracker-failure-"))
  temporaryDirectories.push(root)
  const marker = join(root, "escaped")
  const command = join(root, "command")
  await writeFile(command, `#!/usr/bin/env bun
Bun.spawn([process.execPath,"-e",${JSON.stringify(`setTimeout(async()=>Bun.write(${JSON.stringify(marker)},"escaped"),180);setInterval(()=>{},1000)`) }],{detached:true,stdin:"ignore",stdout:"ignore",stderr:"ignore"})
setInterval(()=>{},1000)
`)
  await chmod(command, 0o755)
  let calls = 0
  const result = await runCommandWithTimeout({
    command: [command], cwd: root, env: process.env, timeoutMs: 100,
    processSnapshot: async () => ++calls <= 6 ? readProcessSnapshot() : Promise.reject(new Error("enumeration failed")),
  })
  await Bun.sleep(220)

  expect(result.timedOut).toBe(true)
  expect(calls).toBeGreaterThan(6)
  expect(await Bun.file(marker).exists()).toBe(false)
})

platformTest("#given a successful command leaves a detached descendant #when root closes #then tracked background work is cleaned", async () => {
  const root = await mkdtemp(join(tmpdir(), "adaptive-benchmark-normal-cleanup-"))
  temporaryDirectories.push(root)
  const marker = join(root, "left-behind")
  const command = join(root, "command")
  await writeFile(command, `#!/usr/bin/env bun
const child=Bun.spawn([process.execPath,"-e",${JSON.stringify(`setTimeout(async()=>Bun.write(${JSON.stringify(marker)},"escaped"),150);setInterval(()=>{},1000)`) }],{detached:true,stdin:"ignore",stdout:"ignore",stderr:"ignore"})
child.unref()
await Bun.sleep(40)
`)
  await chmod(command, 0o755)

  expect((await runCommandWithTimeout({ command: [command], cwd: root, env: process.env, timeoutMs: 500 })).timedOut).toBe(false)
  await Bun.sleep(180)
  expect(await Bun.file(marker).exists()).toBe(false)
})
