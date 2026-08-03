import { isPlainRecord } from "./codex-cache-fs"
import { readFileSync, realpathSync } from "node:fs"
import { readdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { isAbsolute, join, relative } from "node:path"

export interface DistributionManifest {
  readonly name: string
  readonly version: string
}

const MARKETPLACE_NAME = "sisyphuslabs"
const PLUGIN_NAME = "omo"

export function getActiveCachedLazyCodexVersion(input: { readonly codexHome?: string; readonly homeDir?: string } = {}): string | null {
  const codexHome = input.codexHome ?? process.env.CODEX_HOME ?? join(input.homeDir ?? homedir(), ".codex")
  const canonicalCodexHome = canonicalPath(codexHome)
  if (canonicalCodexHome === null) return null
  const canonicalCacheRoot = canonicalPathWithin(join(canonicalCodexHome, "plugins", "cache"), canonicalCodexHome)
  if (canonicalCacheRoot === null) return null
  const canonicalMarketplaceRoot = canonicalPathWithin(join(canonicalCacheRoot, MARKETPLACE_NAME), canonicalCacheRoot)
  if (canonicalMarketplaceRoot === null) return null
  const canonicalPluginRoot = canonicalPathWithin(join(canonicalMarketplaceRoot, PLUGIN_NAME), canonicalMarketplaceRoot)
  if (canonicalPluginRoot === null) return null
  const activePluginRoot = readActivePluginRoot(canonicalMarketplaceRoot, canonicalPluginRoot)
  return activePluginRoot === null ? null : readCachedPluginManifestVersion(activePluginRoot)
}

export async function readDistributionManifest(repoRoot: string): Promise<DistributionManifest | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8"))
    if (!isPlainRecord(parsed) || typeof parsed.version !== "string" || parsed.version.trim().length === 0) return undefined
    return {
      name: typeof parsed.name === "string" && parsed.name.trim().length > 0 ? parsed.name.trim() : "lazycodex-ai",
      version: parsed.version.trim(),
    }
  } catch (error) {
    if (error instanceof Error) return undefined
    throw error
  }
}

function readActivePluginRoot(marketplaceRoot: string, pluginRoot: string): string | null {
  const marketplaceManifestPath = canonicalPathWithin(join(marketplaceRoot, ".agents", "plugins", "marketplace.json"), marketplaceRoot)
  if (marketplaceManifestPath === null) return null
  try {
    const parsed: unknown = JSON.parse(readFileSync(marketplaceManifestPath, "utf8"))
    if (!isPlainRecord(parsed) || !Array.isArray(parsed.plugins)) return null
    const plugin = parsed.plugins.find((entry) => isPlainRecord(entry) && entry.name === PLUGIN_NAME)
    if (!isPlainRecord(plugin) || !isPlainRecord(plugin.source) || plugin.source.source !== "local" || typeof plugin.source.path !== "string") return null
    const version = cachedPluginVersionFromMarketplacePath(plugin.source.path)
    return version === null ? null : canonicalPathWithin(join(pluginRoot, version), pluginRoot)
  } catch (error) {
    if (error instanceof Error) return null
    throw error
  }
}

function cachedPluginVersionFromMarketplacePath(path: string): string | null {
  const parts = path.split(/[\\/]/)
  if (parts.length !== 3 || parts[0] !== "." || parts[1] !== PLUGIN_NAME) return null
  const version = parts[2]
  return version === undefined || !isSafeCacheSegment(version) ? null : version
}

function isSafeCacheSegment(value: string): boolean {
  return value.length > 0 && value.trim() === value && value !== "." && value !== ".." && !/[\\/\0]/.test(value)
}

function readCachedPluginManifestVersion(pluginRoot: string): string | null {
  const manifestPath = canonicalPathWithin(join(pluginRoot, ".codex-plugin", "plugin.json"), pluginRoot)
  if (manifestPath === null) return null
  try {
    const parsed: unknown = JSON.parse(readFileSync(manifestPath, "utf8"))
    if (!isPlainRecord(parsed) || parsed.name !== PLUGIN_NAME || typeof parsed.version !== "string") return null
    const version = parsed.version.trim()
    return version.length === 0 ? null : version
  } catch (error) {
    if (error instanceof Error) return null
    throw error
  }
}

function canonicalPath(path: string): string | null {
  try {
    return realpathSync(path)
  } catch (error) {
    if (error instanceof Error) return null
    throw error
  }
}

function canonicalPathWithin(candidatePath: string, canonicalRoot: string): string | null {
  const canonicalCandidate = canonicalPath(candidatePath)
  return canonicalCandidate !== null && isPathInside(canonicalCandidate, canonicalRoot) ? canonicalCandidate : null
}

function isPathInside(candidatePath: string, rootPath: string): boolean {
  const pathFromRoot = relative(rootPath, candidatePath)
  return pathFromRoot === "" || (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot))
}

export function resolveLazyCodexPluginVersion(input: {
  readonly manifestVersion?: string
  readonly marketplaceName: string
  readonly pluginName: string
  readonly distributionManifest?: DistributionManifest
  readonly versionOverride?: string
}): string {
  const override = input.versionOverride?.trim()
  if (override !== undefined && override.length > 0) {
    return override
  }
  if (input.marketplaceName === "sisyphuslabs" && input.pluginName === "omo" && input.distributionManifest !== undefined) {
    return input.distributionManifest.version
  }
  return input.manifestVersion ?? "local"
}

export async function stampLazyCodexPluginVersion(input: { readonly pluginRoot: string; readonly version: string }): Promise<void> {
  const manifestPath = join(input.pluginRoot, ".codex-plugin", "plugin.json")
  const hookPaths = await readPluginHookPaths(manifestPath)
  await stampJsonVersion(manifestPath, input.version)
  await stampJsonVersion(join(input.pluginRoot, "package.json"), input.version)
  for (const hookPath of hookPaths) {
    await stampHookStatusMessages(join(input.pluginRoot, hookPath), input.version)
  }
  await stampComponentVersions(input)
}

export async function writeLazyCodexInstallSnapshot(input: {
  readonly pluginRoot: string
  readonly distributionManifest?: DistributionManifest
}): Promise<void> {
  if (input.distributionManifest === undefined) return
  await writeFile(
    join(input.pluginRoot, "lazycodex-install.json"),
    `${JSON.stringify(
      {
        packageName: input.distributionManifest.name,
        version: input.distributionManifest.version,
      },
      null,
      "\t",
    )}\n`,
  )
}

async function stampJsonVersion(path: string, version: string): Promise<void> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"))
    if (!isPlainRecord(parsed)) return
    parsed.version = version
    await writeFile(path, `${JSON.stringify(parsed, null, "\t")}\n`)
  } catch (error) {
    if (error instanceof Error) return
    throw error
  }
}

async function readPluginHookPaths(manifestPath: string): Promise<readonly string[]> {
  try {
    const parsed: unknown = JSON.parse(await readFile(manifestPath, "utf8"))
    if (!isPlainRecord(parsed)) return []
    if (typeof parsed.hooks === "string" && parsed.hooks.trim().length > 0) return [stripDotSlash(parsed.hooks)]
    if (Array.isArray(parsed.hooks)) {
      return parsed.hooks
        .filter((hookPath) => typeof hookPath === "string" && hookPath.trim().length > 0)
        .map(stripDotSlash)
    }
    return []
  } catch (error) {
    if (error instanceof Error) return []
    throw error
  }
}

function stripDotSlash(path: string): string {
  return path.startsWith("./") ? path.slice(2) : path
}

async function stampHookStatusMessages(path: string, version: string): Promise<void> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"))
    if (!isPlainRecord(parsed)) return
    stampHookGroups(parsed.hooks, version)
    await writeFile(path, `${JSON.stringify(parsed, null, "\t")}\n`)
  } catch (error) {
    if (error instanceof Error) return
    throw error
  }
}

async function stampComponentVersions(input: { readonly pluginRoot: string; readonly version: string }): Promise<void> {
  let entries: readonly string[]
  try {
    entries = await readdir(join(input.pluginRoot, "components"))
  } catch (error) {
    if (error instanceof Error) return
    throw error
  }
  for (const entry of entries) {
    const componentRoot = join(input.pluginRoot, "components", entry)
    await stampJsonVersion(join(componentRoot, "package.json"), input.version)
    await stampHookStatusMessages(join(componentRoot, "hooks", "hooks.json"), input.version)
  }
}

function stampHookGroups(hooks: unknown, version: string): void {
  if (!isPlainRecord(hooks)) return
  for (const groups of Object.values(hooks)) {
    if (!Array.isArray(groups)) continue
    for (const group of groups) {
      if (!isPlainRecord(group) || !Array.isArray(group.hooks)) continue
      for (const hook of group.hooks) {
        stampHookStatusMessage(hook, version)
      }
    }
  }
}

function stampHookStatusMessage(hook: unknown, version: string): void {
  if (!isPlainRecord(hook) || typeof hook.statusMessage !== "string") return
  hook.statusMessage = hook.statusMessage.replace(
    /^(?:LazyCodex\([^)]+\):|\(OmO(?:\s+[^)]+)?\))\s*/,
    `(OmO ${normalizeHookStatusVersion(version)}) `,
  )
}

function normalizeHookStatusVersion(version: string): string {
  const normalized = version.trim()
  return normalized.length === 0 ? "local" : normalized
}
