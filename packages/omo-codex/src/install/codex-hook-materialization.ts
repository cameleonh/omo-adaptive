import { mkdir, readFile } from "node:fs/promises"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import { isPlainRecord } from "./codex-cache-fs"
import { writeFileAtomic } from "./codex-config-atomic-write"
import type { CodexInstallPlatform, PluginManifest } from "./types"

const SUPPORTED_HOOK_EVENTS = ["PreToolUse", "PostToolUse", "SessionStart", "UserPromptSubmit", "Stop"] as const
const MANAGED_MARKER_KEY = "_lazycodexManaged"

type SupportedHookEvent = (typeof SUPPORTED_HOOK_EVENTS)[number]
type HookEntries = Partial<Record<SupportedHookEvent, readonly unknown[]>>

export async function materializeCodexUserHooks(input: {
  readonly codexHome: string
  readonly marketplaceName: string
  readonly platform: CodexInstallPlatform
  readonly pluginName: string
  readonly pluginRoot: string
  readonly manifest: PluginManifest
}): Promise<void> {
  const hooksPath = join(input.codexHome, "hooks.json")
  const pluginData = join(input.codexHome, "plugins", "data", `${input.pluginName}-${input.marketplaceName}`)
  const pluginId = `${input.pluginName}@${input.marketplaceName}`
  const existingDocument = await readJsonObjectOrDefault(hooksPath, { hooks: {} })
  if (!isPlainRecord(existingDocument.hooks)) throw new Error(`${hooksPath} hooks must be a JSON object`)

  const nextManaged = await readPluginHookFragments({
    hookPaths: input.manifest.hooks,
    platform: input.platform,
    pluginData,
    pluginId,
    pluginRoot: input.pluginRoot,
  })
  const nextHooks: Record<string, unknown> = { ...existingDocument.hooks }
  for (const event of SUPPORTED_HOOK_EVENTS) {
    const existingEntries = readHookEventEntries(existingDocument.hooks, event, hooksPath)
    const retainedEntries = existingEntries.filter((entry) => !isManagedHookGroup(entry, pluginId))
    const combined = [...retainedEntries, ...(nextManaged[event] ?? [])]
    if (combined.length === 0) delete nextHooks[event]
    else nextHooks[event] = combined
  }

  await mkdir(pluginData, { recursive: true })
  await mkdir(dirname(hooksPath), { recursive: true })
  await writeFileAtomic(hooksPath, formatJson({ ...existingDocument, hooks: nextHooks }))
}

export async function removeMaterializedCodexUserHooks(input: {
  readonly codexHome: string
  readonly marketplaceName: string
  readonly pluginName: string
}): Promise<void> {
  const hooksPath = join(input.codexHome, "hooks.json")
  const existingDocument = await readJsonObjectOrNull(hooksPath)
  if (existingDocument === null) return
  if (!isPlainRecord(existingDocument.hooks)) throw new Error(`${hooksPath} hooks must be a JSON object`)

  const pluginId = `${input.pluginName}@${input.marketplaceName}`
  const nextHooks: Record<string, unknown> = { ...existingDocument.hooks }
  for (const event of SUPPORTED_HOOK_EVENTS) {
    const existingEntries = readHookEventEntries(existingDocument.hooks, event, hooksPath)
    const retainedEntries = existingEntries.filter((entry) => !isManagedHookGroup(entry, pluginId))
    if (retainedEntries.length === 0) delete nextHooks[event]
    else nextHooks[event] = retainedEntries
  }
  await writeFileAtomic(hooksPath, formatJson({ ...existingDocument, hooks: nextHooks }))
}

async function readPluginHookFragments(input: {
  readonly hookPaths: PluginManifest["hooks"]
  readonly platform: CodexInstallPlatform
  readonly pluginData: string
  readonly pluginId: string
  readonly pluginRoot: string
}): Promise<HookEntries> {
  const merged: Partial<Record<SupportedHookEvent, unknown[]>> = {}
  const paths = typeof input.hookPaths === "string" ? [input.hookPaths] : (input.hookPaths ?? [])
  for (const hookPath of paths) {
    const fragmentPath = resolvePluginHookPath(input.pluginRoot, hookPath)
    const fragment = await readJsonObjectOrDefault(fragmentPath, { hooks: {} })
    if (!isPlainRecord(fragment.hooks)) throw new Error(`${fragmentPath} hooks must be a JSON object`)
    for (const event of SUPPORTED_HOOK_EVENTS) {
      const entries = fragment.hooks[event]
      if (entries === undefined) continue
      if (!Array.isArray(entries)) throw new Error(`${fragmentPath} ${event} hooks must be a JSON array`)
      const materialized = entries.map((entry) =>
        materializeHookGroup(entry, {
          platform: input.platform,
          pluginData: input.pluginData,
          pluginId: input.pluginId,
          pluginRoot: input.pluginRoot,
        }),
      )
      merged[event] = [...(merged[event] ?? []), ...materialized]
    }
  }
  return merged
}

function materializeHookGroup(
  value: unknown,
  input: {
    readonly platform: CodexInstallPlatform
    readonly pluginData: string
    readonly pluginId: string
    readonly pluginRoot: string
  },
): Record<string, unknown> {
  if (!isPlainRecord(value)) throw new Error("plugin hook groups must be JSON objects")
  return {
    ...materializeHookObject(value, input),
    [MANAGED_MARKER_KEY]: { pluginId: input.pluginId },
  }
}

function materializeHookValue(
  value: unknown,
  input: { readonly platform: CodexInstallPlatform; readonly pluginData: string; readonly pluginRoot: string },
): unknown {
  if (Array.isArray(value)) return value.map((item) => materializeHookValue(item, input))
  if (!isPlainRecord(value)) return value
  return materializeHookObject(value, input)
}

function materializeHookObject(
  value: Record<string, unknown>,
  input: { readonly platform: CodexInstallPlatform; readonly pluginData: string; readonly pluginRoot: string },
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const command = typeof value.command === "string" ? value.command : null
  const commandWindows = typeof value.commandWindows === "string" ? value.commandWindows : null
  for (const [key, item] of Object.entries(value)) {
    if (key === "command" || key === "commandWindows") continue
    result[key] = materializeHookValue(item, input)
  }
  if (command !== null) {
    result.command = input.platform === "win32"
      ? materializeWindowsCommand(commandWindows ?? command, input.pluginRoot, input.pluginData)
      : materializePosixCommand(command, input.pluginRoot, input.pluginData)
    if (commandWindows !== null) {
      result.commandWindows = materializeWindowsCommand(commandWindows, input.pluginRoot, input.pluginData)
    }
  }
  return result
}

function isManagedHookGroup(value: unknown, pluginId: string): boolean {
  if (!isPlainRecord(value) || !isPlainRecord(value[MANAGED_MARKER_KEY])) return false
  return value[MANAGED_MARKER_KEY].pluginId === pluginId
}

function readHookEventEntries(hooks: Record<string, unknown>, event: SupportedHookEvent, path: string): readonly unknown[] {
  const entries = hooks[event]
  if (entries === undefined) return []
  if (!Array.isArray(entries)) throw new Error(`${path} ${event} hooks must be a JSON array`)
  return entries
}

function resolvePluginHookPath(pluginRoot: string, hookPath: string): string {
  const resolvedRoot = resolve(pluginRoot)
  const resolvedPath = resolve(resolvedRoot, hookPath)
  const relativePath = relative(resolvedRoot, resolvedPath)
  if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`plugin hook path must stay within the plugin root: ${hookPath}`)
  }
  return resolvedPath
}

function materializePosixCommand(command: string, pluginRoot: string, pluginData: string): string {
  const rewritten = replaceQuotedTokens(command, pluginRoot, pluginData, shellQuote)
    .replaceAll("${PLUGIN_ROOT}", shellQuote(pluginRoot))
    .replaceAll("${PLUGIN_DATA}", shellQuote(pluginData))
  return `PLUGIN_ROOT=${shellQuote(pluginRoot)} PLUGIN_DATA=${shellQuote(pluginData)} ${rewritten}`
}

function materializeWindowsCommand(command: string, pluginRoot: string, pluginData: string): string {
  const rewritten = replaceQuotedTokens(command, pluginRoot, pluginData, powershellQuote)
    .replaceAll("${PLUGIN_ROOT}", powershellQuote(pluginRoot))
    .replaceAll("${PLUGIN_DATA}", powershellQuote(pluginData))
  const script = `$env:PLUGIN_ROOT = ${powershellQuote(pluginRoot)}\n$env:PLUGIN_DATA = ${powershellQuote(pluginData)}\n${rewritten}`
  return `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${Buffer.from(script, "utf16le").toString("base64")}`
}

function replaceQuotedTokens(
  command: string,
  pluginRoot: string,
  pluginData: string,
  quote: (value: string) => string,
): string {
  return command.replace(/"([^"]*)"/g, (quoted, content: string) => {
    if (!content.includes("${PLUGIN_ROOT}") && !content.includes("${PLUGIN_DATA}")) return quoted
    return quote(content.replaceAll("${PLUGIN_ROOT}", pluginRoot).replaceAll("${PLUGIN_DATA}", pluginData))
  })
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

function powershellQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

async function readJsonObjectOrDefault(path: string, fallback: Record<string, unknown>): Promise<Record<string, unknown>> {
  return (await readJsonObjectOrNull(path)) ?? fallback
}

async function readJsonObjectOrNull(path: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"))
    if (!isPlainRecord(parsed)) throw new Error(`${path} must contain a JSON object`)
    return parsed
  } catch (error) {
    if (nodeErrorCode(error) === "ENOENT") return null
    throw error
  }
}

function nodeErrorCode(error: unknown): string | null {
  if (!(error instanceof Error) || !("code" in error)) return null
  return typeof error.code === "string" ? error.code : null
}

function formatJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}
