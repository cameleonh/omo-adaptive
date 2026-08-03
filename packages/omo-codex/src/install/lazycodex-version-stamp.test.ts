/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { getActiveCachedLazyCodexVersion } from "./lazycodex-version-stamp"

type CacheFixture = {
  readonly cacheRoot: string
  readonly codexHome: string
  readonly marketplaceRoot: string
  readonly pluginRoot: string
  readonly root: string
  readonly versionRoot: string
}

async function createCacheFixture(input: { readonly marketplacePath?: string; readonly version?: string } = {}): Promise<CacheFixture> {
  const root = await mkdtemp(join(tmpdir(), "omo-lazycodex-version-stamp-"))
  const codexHome = join(root, "codex-home")
  const cacheRoot = join(codexHome, "plugins", "cache")
  const marketplaceRoot = join(cacheRoot, "sisyphuslabs")
  const pluginRoot = join(marketplaceRoot, "omo")
  const version = input.version ?? "adaptive-hardening"
  const versionRoot = join(pluginRoot, version)
  await writePluginManifest(versionRoot, version)
  await writeMarketplaceManifest(marketplaceRoot, input.marketplacePath ?? `./omo/${version}`)
  return { cacheRoot, codexHome, marketplaceRoot, pluginRoot, root, versionRoot }
}

async function writeMarketplaceManifest(marketplaceRoot: string, pluginPath: string): Promise<void> {
  const manifestPath = join(marketplaceRoot, ".agents", "plugins", "marketplace.json")
  await mkdir(join(marketplaceRoot, ".agents", "plugins"), { recursive: true })
  await writeFile(
    manifestPath,
    JSON.stringify({ name: "sisyphuslabs", plugins: [{ name: "omo", source: { source: "local", path: pluginPath } }] }),
  )
}

async function writePluginManifest(pluginRoot: string, version: string): Promise<void> {
  await mkdir(join(pluginRoot, ".codex-plugin"), { recursive: true })
  await writeFile(join(pluginRoot, ".codex-plugin", "plugin.json"), JSON.stringify({ name: "omo", version }))
}

describe("getActiveCachedLazyCodexVersion", () => {
  test("#given POSIX marketplace paths #when resolving the active cache #then reads the cached plugin manifest", async () => {
    // given
    const fixture = await createCacheFixture()

    try {
      // when / then
      expect(getActiveCachedLazyCodexVersion({ codexHome: fixture.codexHome })).toBe("adaptive-hardening")
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  })

  test("#given Windows marketplace separators #when resolving the active cache #then reads the cached plugin manifest", async () => {
    // given
    const fixture = await createCacheFixture({ marketplacePath: ".\\omo\\adaptive-hardening" })

    try {
      // when / then
      expect(getActiveCachedLazyCodexVersion({ codexHome: fixture.codexHome })).toBe("adaptive-hardening")
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  })

  test("#given a marketplace symlink outside CODEX_HOME #when resolving the active cache #then rejects it", async () => {
    // given
    const fixture = await createCacheFixture()
    const outsideMarketplace = join(fixture.root, "outside-marketplace")
    await writePluginManifest(join(outsideMarketplace, "omo", "adaptive-hardening"), "marketplace-escape")
    await writeMarketplaceManifest(outsideMarketplace, "./omo/adaptive-hardening")
    await rm(fixture.marketplaceRoot, { recursive: true, force: true })
    await symlink(outsideMarketplace, fixture.marketplaceRoot, "junction")

    try {
      // when / then
      expect(getActiveCachedLazyCodexVersion({ codexHome: fixture.codexHome })).toBeNull()
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  })

  test("#given an omo plugin symlink outside the marketplace root #when resolving the active cache #then rejects it", async () => {
    // given
    const fixture = await createCacheFixture()
    const outsidePlugin = join(fixture.root, "outside-plugin")
    await writePluginManifest(join(outsidePlugin, "adaptive-hardening"), "plugin-escape")
    await rm(fixture.pluginRoot, { recursive: true, force: true })
    await symlink(outsidePlugin, fixture.pluginRoot, "junction")

    try {
      // when / then
      expect(getActiveCachedLazyCodexVersion({ codexHome: fixture.codexHome })).toBeNull()
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  })

  test("#given a version symlink outside the plugin root #when resolving the active cache #then rejects it", async () => {
    // given
    const fixture = await createCacheFixture()
    const outsideVersion = join(fixture.root, "outside-version")
    await writePluginManifest(outsideVersion, "version-escape")
    await rm(fixture.versionRoot, { recursive: true, force: true })
    await symlink(outsideVersion, fixture.versionRoot, "junction")

    try {
      // when / then
      expect(getActiveCachedLazyCodexVersion({ codexHome: fixture.codexHome })).toBeNull()
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  })

  test("#given a plugin manifest symlink outside the version root #when resolving the active cache #then rejects it", async () => {
    // given
    const fixture = await createCacheFixture()
    const outsideManifest = join(fixture.root, "outside-plugin.json")
    await writeFile(outsideManifest, JSON.stringify({ name: "omo", version: "manifest-escape" }))
    await rm(join(fixture.versionRoot, ".codex-plugin", "plugin.json"))
    await symlink(outsideManifest, join(fixture.versionRoot, ".codex-plugin", "plugin.json"), "file")

    try {
      // when / then
      expect(getActiveCachedLazyCodexVersion({ codexHome: fixture.codexHome })).toBeNull()
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  })
})
