/// <reference path="../../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { getActiveCachedLazyCodexVersion } from "@oh-my-opencode/omo-codex/install"
import { getLocalVersion } from "./get-local-version"

async function captureLocalVersionOutput(input: { readonly cachedVersion?: string; readonly codexHome: string; readonly json: boolean }): Promise<{ readonly exitCode: number; readonly output: string }> {
  const output: string[] = []
  const exitCode = await getLocalVersion({
    codexHome: input.codexHome,
    json: input.json,
    output: (line) => output.push(line),
  }, { getCachedVersion: () => input.cachedVersion ?? null })
  return { exitCode, output: output.join("\n") }
}

async function writeActiveCodexPlugin(input: { readonly codexHome: string; readonly stamp: string; readonly pluginManifest: string }): Promise<string> {
  const pluginRoot = join(input.codexHome, "plugins", "cache", "sisyphuslabs", "omo", input.stamp)
  const marketplacePath = join(input.codexHome, "plugins", "cache", "sisyphuslabs", ".agents", "plugins", "marketplace.json")
  await mkdir(join(pluginRoot, ".codex-plugin"), { recursive: true })
  await mkdir(join(input.codexHome, "plugins", "cache", "sisyphuslabs", ".agents", "plugins"), { recursive: true })
  await writeFile(join(pluginRoot, ".codex-plugin", "plugin.json"), input.pluginManifest)
  await writeFile(
    marketplacePath,
    JSON.stringify({ name: "sisyphuslabs", plugins: [{ name: "omo", source: { source: "local", path: `./omo/${input.stamp}` } }] }),
  )
  return pluginRoot
}

describe("getLocalVersion", () => {
  test("#given an active Codex dev cache and stale install metadata #when reporting JSON local version #then uses the cached manifest stamp", async () => {
    // given: this stale distribution snapshot must not control the active plugin version.
    const codexHome = await mkdtemp(join(tmpdir(), "omo-get-local-version-codex-"))
    const stamp = "adaptive-hardening"
    const pluginRoot = await writeActiveCodexPlugin({
      codexHome,
      stamp,
      pluginManifest: JSON.stringify({ name: "omo", version: stamp }),
    })
    await writeFile(join(pluginRoot, "lazycodex-install.json"), JSON.stringify({ packageName: "lazycodex-ai", version: "4.19.4" }))

    try {
      // when
      const result = await captureLocalVersionOutput({ codexHome, json: true })

      // then
      expect(result.exitCode).toBe(0)
      expect(JSON.parse(result.output)).toMatchObject({ currentVersion: stamp, isLocalDev: true, status: "dev" })
    } finally {
      await rm(codexHome, { recursive: true, force: true })
    }
  })

  test("#given an active Codex dev cache #when reporting plain local version #then preserves the dev output", async () => {
    // given
    const codexHome = await mkdtemp(join(tmpdir(), "omo-get-local-version-codex-plain-"))
    const stamp = "adaptive-hardening"
    await writeActiveCodexPlugin({
      codexHome,
      stamp,
      pluginManifest: JSON.stringify({ name: "omo", version: stamp }),
    })

    try {
      // when
      const result = await captureLocalVersionOutput({ codexHome, json: false })

      // then
      expect(result.exitCode).toBe(0)
      expect(result.output).toContain(`Current Version: ${stamp}`)
      expect(result.output).toContain("Running a local dev build")
    } finally {
      await rm(codexHome, { recursive: true, force: true })
    }
  })

  test("#given no active Codex cache #when reporting JSON local version #then returns the injected OpenCode fallback without registry access", async () => {
    // given
    const codexHome = await mkdtemp(join(tmpdir(), "omo-get-local-version-no-codex-cache-"))

    try {
      // when
      const result = await captureLocalVersionOutput({ cachedVersion: "opencode-fallback", codexHome, json: true })

      // then
      expect(result.exitCode).toBe(0)
      expect(JSON.parse(result.output)).toMatchObject({ currentVersion: "opencode-fallback", isLocalDev: true, status: "dev" })
    } finally {
      await rm(codexHome, { recursive: true, force: true })
    }
  })

  test("#given a malformed Codex marketplace manifest #when reporting plain local version #then returns the injected OpenCode fallback without registry access", async () => {
    // given
    const codexHome = await mkdtemp(join(tmpdir(), "omo-get-local-version-malformed-marketplace-"))
    await writeActiveCodexPlugin({
      codexHome,
      stamp: "adaptive-hardening",
      pluginManifest: JSON.stringify({ name: "omo", version: "adaptive-hardening" }),
    })
    await writeFile(join(codexHome, "plugins", "cache", "sisyphuslabs", ".agents", "plugins", "marketplace.json"), "{")

    try {
      // when
      const result = await captureLocalVersionOutput({ cachedVersion: "opencode-malformed-marketplace", codexHome, json: false })

      // then
      expect(result.exitCode).toBe(0)
      expect(result.output).toContain("Current Version: opencode-malformed-marketplace")
      expect(result.output).toContain("Running a local dev build")
    } finally {
      await rm(codexHome, { recursive: true, force: true })
    }
  })

  test("#given an active Codex cache with a malformed plugin manifest #when reporting JSON local version #then returns the injected OpenCode fallback without registry access", async () => {
    // given
    const codexHome = await mkdtemp(join(tmpdir(), "omo-get-local-version-malformed-plugin-"))
    await writeActiveCodexPlugin({ codexHome, stamp: "adaptive-hardening", pluginManifest: "{" })

    try {
      // when
      const result = await captureLocalVersionOutput({ cachedVersion: "opencode-malformed-plugin", codexHome, json: true })

      // then
      expect(result.exitCode).toBe(0)
      expect(JSON.parse(result.output)).toMatchObject({ currentVersion: "opencode-malformed-plugin", isLocalDev: true, status: "dev" })
    } finally {
      await rm(codexHome, { recursive: true, force: true })
    }
  })

  test("#given an active Codex marketplace path containing backslash traversal #when resolving the active cached version #then rejects the path", async () => {
    // given
    const codexHome = await mkdtemp(join(tmpdir(), "omo-get-local-version-backslash-traversal-"))
    const marketplaceRoot = join(codexHome, "plugins", "cache", "sisyphuslabs")
    const pluginRoot = join(marketplaceRoot, "omo")
    const unsafePluginRoot = join(pluginRoot, "..\\outside")
    await mkdir(join(unsafePluginRoot, ".codex-plugin"), { recursive: true })
    await mkdir(join(marketplaceRoot, ".agents", "plugins"), { recursive: true })
    await writeFile(join(unsafePluginRoot, ".codex-plugin", "plugin.json"), JSON.stringify({ name: "omo", version: "unsafe" }))
    await writeFile(
      join(marketplaceRoot, ".agents", "plugins", "marketplace.json"),
      JSON.stringify({ name: "sisyphuslabs", plugins: [{ name: "omo", source: { source: "local", path: "./omo/..\\outside" } }] }),
    )

    try {
      // when / then
      expect(getActiveCachedLazyCodexVersion({ codexHome })).toBeNull()
    } finally {
      await rm(codexHome, { recursive: true, force: true })
    }
  })
})
