import { readFileSync } from "node:fs"
import { dirname, isAbsolute, join } from "node:path"

import {
  appendBlock,
  findTomlSection,
  parseTomlDottedKey,
  replaceOrInsertRootDottedSetting,
  replaceOrInsertSetting,
  scanTomlMultilineLine,
} from "./toml-section-editor"
import { hasTomlRootDottedKeyPrefix, hasTomlSetting } from "./toml-setting-reader"

const CODEX_AGENTS_HEADER = "agents"
const CODEX_SUBAGENT_THREAD_LIMIT = 6
const SUPPORTED_MULTI_AGENT_V2_SETTINGS = new Set([
  "enabled",
  "usage_hint_enabled",
  "usage_hint_text",
  "hide_spawn_agent_metadata",
])

export type CodexMultiAgentVersion = "v1" | "v2" | null

/**
 * Configure Codex 0.120 multi-agent settings and a bounded subagent cap.
 *
 * Whether V2 is active is determined from the model's server-side catalog
 * entry (`ModelInfo.multi_agent_version`). Codex 0.120 accepts either the
 * `[features]` boolean `multi_agent_v2` or a
 * `[features.multi_agent_v2]` table containing only `enabled`,
 * `usage_hint_enabled`, `usage_hint_text`, and `hide_spawn_agent_metadata`.
 * The former `max_concurrent_threads_per_session` setting and every other V2
 * table key are unsupported. V2-preferred models enable V2, while non-V2 and
 * unknown models keep the conservative explicit disable. Every supported path
 * keeps the cap in `[agents].max_threads`, preserving an explicit user value.
 */
export function ensureCodexMultiAgentV2Config(
  config: string,
  options: { readonly multiAgentVersion?: CodexMultiAgentVersion } = {},
): string {
  const v2Preferred = options.multiAgentVersion === "v2"
  const threadLimit = readUnsupportedMultiAgentV2ThreadLimit(config)
  const withoutUnsupportedSettings = removeUnsupportedMultiAgentV2Settings(config)
  const hasSupportedV2Table = hasSupportedMultiAgentV2TableSetting(withoutUnsupportedSettings)
  const featureConfig = hasSupportedV2Table
    ? ensureMultiAgentV2TableEnabled(withoutUnsupportedSettings, v2Preferred)
    : ensureMultiAgentV2FeatureFlag(withoutUnsupportedSettings, v2Preferred)
  return ensureAgentsMaxThreads(featureConfig, threadLimit)
}

/**
 * Resolve the configured root model's multi-agent version from the Codex
 * model catalog cache (`models_cache.json` next to `config.toml`).
 * Mirrors `plugin/scripts/migrate-codex-config/multi-agent-v2-guard.mjs`:
 * catalog wins; a GPT-5.6 family model with no catalog entry counts as V2.
 */
export function resolveCodexMultiAgentVersion(config: string, configPath: string): CodexMultiAgentVersion {
  const model = readRootModel(config)
  if (model === null) return null
  const catalogPath = resolveCatalogPath(readRootModelCatalogPath(config), configPath)
  const catalogVersion = readCatalogMultiAgentVersion(model, catalogPath)
  if (catalogVersion !== null) return catalogVersion
  return /^gpt-5\.6\b/i.test(model) ? "v2" : null
}

function resolveCatalogPath(configuredPath: string | null, configPath: string): string {
  if (configuredPath === null) return join(dirname(configPath), "models_cache.json")
  return isAbsolute(configuredPath) ? configuredPath : join(dirname(configPath), configuredPath)
}

function readCatalogMultiAgentVersion(model: string, cachePath: string): CodexMultiAgentVersion {
  let raw: string
  try {
    raw = readFileSync(cachePath, "utf8")
  } catch {
    return null
  }
  let cache: unknown
  try {
    cache = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(cache) || !Array.isArray(cache.models)) return null
  for (const entry of cache.models) {
    if (!isRecord(entry)) continue
    if (entry.slug !== model && entry.id !== model) continue
    const version = entry.multi_agent_version
    if (version === "v1" || version === "v2") return version
    return null
  }
  return null
}

function readRootModel(config: string): string | null {
  const double = config.match(/^\s*model\s*=\s*"([^"]+)"/m)
  if (double !== null) return double[1] ?? null
  const single = config.match(/^\s*model\s*=\s*'([^']+)'/m)
  return single?.[1] ?? null
}

function readRootModelCatalogPath(config: string): string | null {
  const double = config.match(/^\s*model_catalog_json\s*=\s*"([^"]+)"/m)
  if (double !== null) return double[1] ?? null
  const single = config.match(/^\s*model_catalog_json\s*=\s*'([^']+)'/m)
  return single?.[1] ?? null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function ensureAgentsMaxThreads(config: string, migratedThreadLimit: string | null): string {
  const maxThreadsValue = migratedThreadLimit ?? CODEX_SUBAGENT_THREAD_LIMIT.toString()
  const section = findTomlSection(config, CODEX_AGENTS_HEADER)
  if (!section) {
    return appendBlock(config, `[${CODEX_AGENTS_HEADER}]\nmax_threads = ${maxThreadsValue}\n`)
  }
  if (hasTomlSetting(config, `${CODEX_AGENTS_HEADER}.max_threads`)) return config
  return replaceOrInsertSetting(config, section, "max_threads", maxThreadsValue)
}

function ensureMultiAgentV2FeatureFlag(config: string, enabled: boolean): string {
  const section = findTomlSection(config, "features")
  if (section) return replaceOrInsertSetting(config, section, "multi_agent_v2", enabled.toString())
  if (hasTomlRootDottedKeyPrefix(config, "features")) {
    return replaceOrInsertRootDottedSetting(config, "features.multi_agent_v2", enabled.toString())
  }
  return appendBlock(config, `[features]\nmulti_agent_v2 = ${enabled}\n`)
}

function removeUnsupportedMultiAgentV2Settings(config: string): string {
  const filtered = filterMultiAgentV2Settings(
    config,
    (path) => isMultiAgentV2Setting(path) && !isSupportedMultiAgentV2Setting(path),
  )
  if (hasSupportedMultiAgentV2TableSetting(filtered)) return filtered
  return removeMultiAgentV2TableSections(filtered)
}

function hasSupportedMultiAgentV2TableSetting(config: string): boolean {
  return ["enabled", "usage_hint_enabled", "usage_hint_text", "hide_spawn_agent_metadata"].some((setting) =>
    hasTomlSetting(config, `features.multi_agent_v2.${setting}`),
  )
}

function ensureMultiAgentV2TableEnabled(config: string, enabled: boolean): string {
  const withoutFeatureFlag = removeMultiAgentV2FeatureFlag(config)
  const section = findTomlSection(withoutFeatureFlag, "features.multi_agent_v2")
  if (section) return replaceOrInsertSetting(withoutFeatureFlag, section, "enabled", enabled.toString())
  const features = findTomlSection(withoutFeatureFlag, "features")
  if (features) return replaceOrInsertSetting(withoutFeatureFlag, features, "multi_agent_v2.enabled", enabled.toString())
  return replaceOrInsertRootDottedSetting(withoutFeatureFlag, "features.multi_agent_v2.enabled", enabled.toString())
}

function removeMultiAgentV2FeatureFlag(config: string): string {
  return filterMultiAgentV2Settings(
    config,
    (path) => path.length === 2 && path[0] === "features" && path[1] === "multi_agent_v2",
  )
}

function readUnsupportedMultiAgentV2ThreadLimit(config: string): string | null {
  let threadLimit: string | null = null
  filterMultiAgentV2Settings(config, (path, value) => {
    if (!isUnsupportedMultiAgentV2ThreadLimit(path) || threadLimit !== null) return false
    const match = /^\s*(\d+)\b/.exec(value)
    if (!match) return false
    threadLimit = match[1] ?? null
    return false
  })
  return threadLimit
}

function filterMultiAgentV2Settings(
  config: string,
  shouldRemove: (path: readonly string[], value: string) => boolean,
): string {
  const lines = config.match(/[^\n]*\n|[^\n]+$/g) ?? []
  const retained: string[] = []
  let tablePath: readonly string[] = []
  let multilineQuote: '"""' | "'''" | null = null
  let retainMultilineValue = true

  for (const line of lines) {
    const multilineScan = scanTomlMultilineLine(line, multilineQuote)
    if (multilineScan.wasInside) {
      if (retainMultilineValue) retained.push(line)
      multilineQuote = multilineScan.nextQuote
      continue
    }

    const nextTablePath = parseTablePath(line)
    if (nextTablePath) {
      tablePath = nextTablePath
      retained.push(line)
      multilineQuote = multilineScan.nextQuote
      continue
    }

    const assignmentIndex = findUnquotedAssignment(line)
    if (assignmentIndex === -1) {
      retained.push(line)
      multilineQuote = multilineScan.nextQuote
      continue
    }
    const settingPath = parseTomlDottedKey(line.slice(0, assignmentIndex).trim())
    if (!settingPath) {
      retained.push(line)
      multilineQuote = multilineScan.nextQuote
      continue
    }
    const fullPath = [...tablePath, ...settingPath]
    const value = line.slice(assignmentIndex + 1)
    const remove = shouldRemove(fullPath, value)
    retainMultilineValue = !remove
    if (!remove) retained.push(line)
    multilineQuote = multilineScan.nextQuote
  }
  return retained.join("")
}

function isMultiAgentV2Setting(path: readonly string[]): boolean {
  return path.length >= 3 && path[0] === "features" && path[1] === "multi_agent_v2"
}

function isMultiAgentV2TablePath(path: readonly string[]): boolean {
  return path.length === 2 && path[0] === "features" && path[1] === "multi_agent_v2"
}

function isUnsupportedMultiAgentV2ThreadLimit(path: readonly string[]): boolean {
  return isMultiAgentV2Setting(path) && path[2] === "max_concurrent_threads_per_session"
}

function isSupportedMultiAgentV2Setting(path: readonly string[]): boolean {
  return isMultiAgentV2Setting(path) && path.length === 3 && SUPPORTED_MULTI_AGENT_V2_SETTINGS.has(path[2] ?? "")
}

function parseTablePath(line: string): readonly string[] | null {
  const trimmed = line.trim()
  const end = trimmed.lastIndexOf("]")
  if (!trimmed.startsWith("[") || end <= 0 || trimmed.startsWith("[[")) return null
  return parseTomlDottedKey(trimmed.slice(1, end).trim())
}

function removeMultiAgentV2TableSections(config: string): string {
  const lines = config.match(/[^\n]*\n|[^\n]+$/g) ?? []
  const retained: string[] = []
  let multilineQuote: '"""' | "'''" | null = null
  let removeCurrentSection = false

  for (const line of lines) {
    const multilineScan = scanTomlMultilineLine(line, multilineQuote)
    if (multilineScan.wasInside) {
      if (!removeCurrentSection) retained.push(line)
      multilineQuote = multilineScan.nextQuote
      continue
    }
    const tablePath = parseTablePath(line)
    if (tablePath) {
      removeCurrentSection = isMultiAgentV2TablePath(tablePath)
      if (!removeCurrentSection) retained.push(line)
      multilineQuote = multilineScan.nextQuote
      continue
    }
    if (!removeCurrentSection) retained.push(line)
    multilineQuote = multilineScan.nextQuote
  }
  return retained.join("").replace(/\n{3,}/g, "\n\n")
}

function findUnquotedAssignment(line: string): number {
  let quote: "'" | '"' | null = null
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (quote === '"') {
      if (char === "\\") {
        index += 1
        continue
      }
      if (char === '"') quote = null
      continue
    }
    if (quote === "'") {
      if (char === "'") quote = null
      continue
    }
    if (char === "#") return -1
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === "=") return index
  }
  return -1
}
