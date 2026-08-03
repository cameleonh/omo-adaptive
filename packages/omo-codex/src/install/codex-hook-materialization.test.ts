/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { cleanupCodexLight } from "./codex-cleanup"
import { materializeCodexUserHooks } from "./codex-hook-materialization"
import { runCodexInstaller } from "./install-codex"
import { createRepoWithBuiltComponentBins } from "./install-codex-test-fixtures"

const skipAstGrepInstall = async () => ({ kind: "skipped" as const, reason: "test" })

describe("Codex user-layer hook materialization", () => {
  test("#given user hooks and plugin hook fragments #when installing and updating OMO #then preserves user hooks and replaces supported managed hooks", async () => {
    // given
    const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-hook-home-"))
    const binDir = await mkdtemp(join(tmpdir(), "omo-codex-hook-bin-"))
    const repoRoot = await createHookFixtureRepo()
    const hooksPath = join(codexHome, "hooks.json")
    const userSessionHook = { matcher: "^resume$", hooks: [{ type: "command", command: "user-session-hook" }] }
    const userPostCompactHook = { hooks: [{ type: "command", command: "user-post-compact-hook" }] }
    await writeFile(
      hooksPath,
      JSON.stringify({ hooks: { SessionStart: [userSessionHook], PostCompact: [userPostCompactHook] } }),
    )

    // when
    const first = await runCodexInstaller({
      codexHome,
      binDir,
      repoRoot,
      astGrepInstaller: skipAstGrepInstall,
      runCommand: async () => undefined,
    })
    await writeFile(join(repoRoot, "package.json"), JSON.stringify({ name: "oh-my-openagent", version: "4.7.6" }))
    const second = await runCodexInstaller({
      codexHome,
      binDir,
      repoRoot,
      astGrepInstaller: skipAstGrepInstall,
      runCommand: async () => undefined,
    })
    await runCodexInstaller({
      codexHome,
      binDir,
      repoRoot,
      astGrepInstaller: skipAstGrepInstall,
      runCommand: async () => undefined,
    })

    // then
    const materialized = JSON.parse(await readFile(hooksPath, "utf8")) as {
      readonly hooks: Record<string, ReadonlyArray<{ readonly hooks: ReadonlyArray<{ readonly command: string; readonly commandWindows?: string }> }>>
    }
    expect(materialized.hooks.SessionStart?.[0]).toEqual(userSessionHook)
    expect(materialized.hooks.PostCompact).toEqual([userPostCompactHook])
    expect(materialized.hooks.SubagentStop).toBeUndefined()
    expect(materialized.hooks.SessionStart).toHaveLength(2)
    expect(materialized.hooks.PostToolUse).toHaveLength(1)

    const managedCommands = Object.entries(materialized.hooks)
      .filter(([event]) => event !== "PostCompact")
      .flatMap(([, groups]) => groups.flatMap((group) => group.hooks.map((hook) => hook.command)))
      .filter((command) => command !== "user-session-hook")
    expect(managedCommands.every((command) => command.includes(second.installed[0]?.path ?? "missing"))).toBe(true)
    expect(managedCommands.every((command) => !command.includes(first.installed[0]?.path ?? "missing"))).toBe(true)
    expect(managedCommands.every((command) => command.includes("PLUGIN_ROOT=") && command.includes("PLUGIN_DATA="))).toBe(true)
    expect(managedCommands.every((command) => !command.includes("${PLUGIN_ROOT}") && !command.includes("${PLUGIN_DATA}"))).toBe(true)

    const windowsCommand = materialized.hooks.SessionStart?.[1]?.hooks[0]?.commandWindows
    expect(windowsCommand?.startsWith("powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ")).toBe(true)
    const encodedCommand = windowsCommand?.split(" ").at(-1) ?? ""
    const decodedCommand = Buffer.from(encodedCommand, "base64").toString("utf16le")
    expect(decodedCommand).toContain("$env:PLUGIN_ROOT")
    expect(decodedCommand).toContain("$env:PLUGIN_DATA")
    expect(decodedCommand).toContain(second.installed[0]?.path ?? "missing")
    expect(decodedCommand).not.toContain("${PLUGIN_ROOT}")
    expect(decodedCommand).not.toContain("${PLUGIN_DATA}")
  }, { timeout: 30_000 })

  test("#given installed OMO hooks and unrelated user hooks #when uninstalling #then removes only managed hook entries", async () => {
    // given
    const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-hook-cleanup-home-"))
    const binDir = await mkdtemp(join(tmpdir(), "omo-codex-hook-cleanup-bin-"))
    const repoRoot = await createHookFixtureRepo()
    const hooksPath = join(codexHome, "hooks.json")
    const userHook = { hooks: [{ type: "command", command: "keep-user-hook" }] }
    await mkdir(codexHome, { recursive: true })
    await writeFile(hooksPath, JSON.stringify({ hooks: { Stop: [userHook] } }))
    await runCodexInstaller({
      codexHome,
      binDir,
      repoRoot,
      astGrepInstaller: skipAstGrepInstall,
      runCommand: async () => undefined,
    })

    // when
    await cleanupCodexLight({ codexHome, projectDirectory: codexHome })

    // then
    const cleaned = JSON.parse(await readFile(hooksPath, "utf8")) as { readonly hooks: Record<string, readonly unknown[]> }
    expect(cleaned.hooks.Stop).toEqual([userHook])
    expect(cleaned.hooks.SessionStart).toBeUndefined()
    expect(cleaned.hooks.PostToolUse).toBeUndefined()
  }, { timeout: 30_000 })

  test("#given a Windows install #when materializing a command hook #then the official command field sets both plugin environment variables", async () => {
    // given
    const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-hook-windows-home-"))
    const repoRoot = await createHookFixtureRepo()
    const pluginRoot = join(repoRoot, "packages", "omo-codex", "plugin")

    // when
    await materializeCodexUserHooks({
      codexHome,
      marketplaceName: "sisyphuslabs",
      platform: "win32",
      pluginName: "omo",
      pluginRoot,
      manifest: {
        name: "omo",
        hooks: "./hooks/session.json",
      },
    })

    // then
    const materialized = JSON.parse(await readFile(join(codexHome, "hooks.json"), "utf8")) as {
      readonly hooks: { readonly SessionStart: ReadonlyArray<{ readonly hooks: ReadonlyArray<{ readonly command: string }> }> }
    }
    const command = materialized.hooks.SessionStart[0]?.hooks[0]?.command ?? ""
    expect(command.startsWith("powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ")).toBe(true)
    const decodedCommand = Buffer.from(command.split(" ").at(-1) ?? "", "base64").toString("utf16le")
    expect(decodedCommand).toContain(`$env:PLUGIN_ROOT = '${pluginRoot}'`)
    expect(decodedCommand).toContain(`$env:PLUGIN_DATA = '${join(codexHome, "plugins", "data", "omo-sisyphuslabs")}'`)
    expect(decodedCommand).not.toContain("${PLUGIN_ROOT}")
    expect(decodedCommand).not.toContain("${PLUGIN_DATA}")
  })

  test("#given malformed user hooks #when materialization fails #then the original bytes remain unchanged", async () => {
    // given
    const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-hook-malformed-home-"))
    const repoRoot = await createHookFixtureRepo()
    const pluginRoot = join(repoRoot, "packages", "omo-codex", "plugin")
    const hooksPath = join(codexHome, "hooks.json")
    const malformed = "{not-json\n"
    await writeFile(hooksPath, malformed)

    // when
    const materialization = materializeCodexUserHooks({
      codexHome,
      marketplaceName: "sisyphuslabs",
      platform: "linux",
      pluginName: "omo",
      pluginRoot,
      manifest: { name: "omo", hooks: "./hooks/session.json" },
    })

    // then
    await expect(materialization).rejects.toThrow()
    expect(await readFile(hooksPath, "utf8")).toBe(malformed)
  })

  test("#given malformed user hooks #when uninstalling #then preserves the file and continues managed cleanup", async () => {
    // given
    const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-hook-malformed-cleanup-"))
    const hooksPath = join(codexHome, "hooks.json")
    const cachePath = join(codexHome, "plugins", "cache", "sisyphuslabs", "omo", "4.7.5", "package.json")
    const malformed = "{still-not-json\n"
    await mkdir(join(cachePath, ".."), { recursive: true })
    await writeFile(cachePath, "{}\n")
    await writeFile(hooksPath, malformed)

    // when
    const result = await cleanupCodexLight({ codexHome, projectDirectory: codexHome })

    // then
    expect(await readFile(hooksPath, "utf8")).toBe(malformed)
    expect(result.removedPaths).toContain(join(codexHome, "plugins", "cache", "sisyphuslabs"))
  })

  test("#given hooks.json is a symlink #when materializing hooks #then updates the target without replacing the link", async () => {
    // given
    const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-hook-symlink-home-"))
    const targetRoot = await mkdtemp(join(tmpdir(), "omo-codex-hook-symlink-target-"))
    const repoRoot = await createHookFixtureRepo()
    const pluginRoot = join(repoRoot, "packages", "omo-codex", "plugin")
    const hooksPath = join(codexHome, "hooks.json")
    const targetPath = join(targetRoot, "hooks.json")
    await writeFile(targetPath, JSON.stringify({ hooks: {} }))
    await symlink(targetPath, hooksPath)

    // when
    await materializeCodexUserHooks({
      codexHome,
      marketplaceName: "sisyphuslabs",
      platform: "linux",
      pluginName: "omo",
      pluginRoot,
      manifest: { name: "omo", hooks: "./hooks/session.json" },
    })

    // then
    expect(await readFile(hooksPath, "utf8")).toBe(await readFile(targetPath, "utf8"))
    const materialized = JSON.parse(await readFile(targetPath, "utf8")) as { readonly hooks: { readonly SessionStart: readonly unknown[] } }
    expect(materialized.hooks.SessionStart).toHaveLength(1)
  })
})

async function createHookFixtureRepo(): Promise<string> {
  const repoRoot = await createRepoWithBuiltComponentBins()
  const pluginRoot = join(repoRoot, "packages", "omo-codex", "plugin")
  const manifestPath = join(pluginRoot, ".codex-plugin", "plugin.json")
  await mkdir(join(pluginRoot, "hooks"), { recursive: true })
  await mkdir(join(pluginRoot, "components", "bootstrap", "scripts"), { recursive: true })
  await writeFile(join(pluginRoot, "components", "bootstrap", "scripts", "bootstrap.ps1"), "exit 0\n")
  await writeFile(
    manifestPath,
    JSON.stringify({
      name: "omo",
      version: "0.1.0",
      hooks: ["./hooks/session.json", "./hooks/post-tool.json", "./hooks/unsupported.json"],
    }),
  )
  await writeFile(
    join(pluginRoot, "hooks", "session.json"),
    JSON.stringify({
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                type: "command",
                command: "node \"${PLUGIN_ROOT}/components/rules/dist/cli.js\" --data \"${PLUGIN_DATA}/rules\"",
                commandWindows: "powershell -File \"${PLUGIN_ROOT}\\components\\bootstrap\\scripts\\bootstrap.ps1\"",
              },
            ],
          },
        ],
      },
    }),
  )
  await writeFile(
    join(pluginRoot, "hooks", "post-tool.json"),
    JSON.stringify({
      hooks: {
        PostToolUse: [
          {
            matcher: "^apply_patch$",
            hooks: [{ type: "command", command: "node \"${PLUGIN_ROOT}/components/rules/dist/cli.js\"" }],
          },
        ],
      },
    }),
  )
  await writeFile(
    join(pluginRoot, "hooks", "unsupported.json"),
    JSON.stringify({
      hooks: {
        PostCompact: [{ hooks: [{ type: "command", command: "unsupported-post-compact" }] }],
        SubagentStop: [{ hooks: [{ type: "command", command: "unsupported-subagent-stop" }] }],
      },
    }),
  )
  return repoRoot
}
