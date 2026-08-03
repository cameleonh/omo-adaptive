import { createHash } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { resolveContainedExisting, resolveContainedPath } from "./paths"
import { sha256File, type Variant } from "./core"

const UPSTREAM_REVISION = "a6dbc0ca0c75d91575d24598d39e244ed5905ced"
const UPSTREAM_RULE_SHA256 = "e273e84d2f9d45e362aaacc0446655d2cc40a994fab60be866382467cfad89f9"
const UPSTREAM_PROGRAMMING_SHA256 = "29e3a97cb4036f257e0785f7bd66644df4cb657f143cc184bda715dd09659eec"
const RULE_PATH = "components/rules/bundled-rules/hephaestus/gpt-5.6.md"
const PROGRAMMING_PATH = "skills/programming/SKILL.md"
const ADAPTIVE_RULE_PATH = `packages/omo-codex/plugin/${RULE_PATH}`
const ADAPTIVE_PROGRAMMING_PATH = "packages/shared-skills/skills/programming/SKILL.md"

type ArtifactMetadata = {
  readonly path: string
  readonly source: string
  readonly sha256: string
}

export type InstallationMetadata = {
  readonly config: ArtifactMetadata
  readonly marketplace: ArtifactMetadata
  readonly plugin_manifest: ArtifactMetadata
  readonly gpt56_rule: ArtifactMetadata
  readonly programming_skill: ArtifactMetadata
  readonly plugin_root: string
  readonly marketplace_root: string
  readonly policy_sha256: string
  readonly expected_policy_sha256: string
  readonly provenance_revision: string
  readonly external_symlinks: readonly []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  return value
}

function configSection(content: string, header: string): string {
  const lines = content.split(/\r?\n/u)
  const start = lines.findIndex((line) => line.trim() === `[${header}]`)
  if (start < 0) throw new TypeError(`config.toml is missing [${header}]`)
  const following = lines.slice(start + 1)
  const end = following.findIndex((line) => line.trim().startsWith("["))
  return following.slice(0, end < 0 ? undefined : end).join("\n")
}

function configString(section: string, field: string): string {
  const match = section.match(new RegExp(`^${field}\\s*=\\s*("(?:[^"\\\\]|\\\\.)+")\\s*$`, "mu"))
  if (match?.[1] === undefined) throw new TypeError(`config.toml is missing ${field}`)
  const parsed: unknown = JSON.parse(match[1])
  if (typeof parsed !== "string") throw new TypeError(`config.toml ${field} is not a string`)
  return parsed
}

function frontmatterDescription(content: string, label: string): string {
  const match = content.match(/^description:\s*(?:"([^"]+)"|(.+))$/mu)
  const value = match?.[1] ?? match?.[2]
  if (value === undefined) throw new TypeError(`${label} has no frontmatter description`)
  return value.trim()
}

function validatePolicyContent(rule: string, programming: string): void {
  const paragraph = rule.split(/\r?\n\r?\n/u).find((part) => part.startsWith("You are Hephaestus"))
  const ruleParagraph = paragraph?.trim()
  if (ruleParagraph === undefined || !ruleParagraph.includes("GPT-5.6")) {
    throw new TypeError("GPT-5.6 bundled rule has no Hephaestus policy paragraph")
  }
  frontmatterDescription(rule, "GPT-5.6 bundled rule")
  frontmatterDescription(programming, "programming SKILL.md")
}

function combinedPolicyHash(ruleSha256: string, programmingSha256: string): string {
  return createHash("sha256").update(`${ruleSha256}:${programmingSha256}`).digest("hex")
}

async function artifact(root: string, path: string): Promise<ArtifactMetadata> {
  const source = await resolveContainedExisting(root, path, path)
  return { path, source, sha256: await sha256File(source) }
}

async function rejectSymlinks(root: string): Promise<void> {
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else if (entry.isSymbolicLink()) throw new TypeError(`Template must be a symlink-free snapshot: ${path}`)
    }
  }
  await visit(root)
}

async function rejectAbsoluteFileDependencies(root: string): Promise<void> {
  const sections = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else if (entry.name === "package.json") {
        const parsed = record(JSON.parse(await readFile(path, "utf8")), path)
        for (const section of sections) {
          const dependencies = parsed[section]
          if (!isRecord(dependencies)) continue
          for (const value of Object.values(dependencies)) {
            if (typeof value === "string" && /^file:(?:\/|[A-Za-z]:[\\/])/u.test(value)) {
              throw new TypeError(`Template package metadata has absolute file dependency: ${path}`)
            }
          }
        }
      }
    }
  }
  await visit(root)
}

function gitOutput(repo: string, args: readonly string[]): Buffer {
  const result = Bun.spawnSync(["git", ...args], { cwd: repo, stdout: "pipe", stderr: "pipe" })
  if (result.exitCode !== 0) throw new TypeError("Cannot resolve adaptive checkout revision")
  return Buffer.from(result.stdout)
}

export async function validateAdaptiveCheckout(repo: string): Promise<{
  readonly revision: string; readonly ruleSha256: string; readonly programmingSha256: string
}> {
  const revision = gitOutput(repo, ["rev-parse", "HEAD"]).toString().trim()
  const pairs = await Promise.all([ADAPTIVE_RULE_PATH, ADAPTIVE_PROGRAMMING_PATH].map(async (path) => {
    const working = await readFile(join(repo, path))
    const committed = gitOutput(repo, ["show", `HEAD:${path}`])
    const workingHash = createHash("sha256").update(working).digest("hex")
    const committedHash = createHash("sha256").update(committed).digest("hex")
    if (workingHash !== committedHash) throw new TypeError(`Adaptive policy differs from committed HEAD: ${path}`)
    return workingHash
  }))
  return { revision, ruleSha256: pairs[0]!, programmingSha256: pairs[1]! }
}

async function expectedPolicy(variant: Variant): Promise<{
  readonly revision: string
  readonly ruleSha256: string
  readonly programmingSha256: string
}> {
  if (variant === "upstream") {
    return { revision: UPSTREAM_REVISION, ruleSha256: UPSTREAM_RULE_SHA256, programmingSha256: UPSTREAM_PROGRAMMING_SHA256 }
  }
  return validateAdaptiveCheckout(join(import.meta.dir, "../.."))
}

export async function validateInstalledTemplate(
  template: string,
  variant: Variant,
  markerRevision: string,
): Promise<InstallationMetadata> {
  await rejectSymlinks(template)
  await rejectAbsoluteFileDependencies(template)
  const config = await artifact(template, "config.toml")
  const configText = await readFile(config.source, "utf8")
  const pluginSection = configSection(configText, 'plugins."omo@sisyphuslabs"')
  if (!/^enabled\s*=\s*true\s*$/mu.test(pluginSection)) throw new TypeError("omo@sisyphuslabs is not enabled")
  const marketplaceSection = configSection(configText, "marketplaces.sisyphuslabs")
  const marketplaceValue = configString(marketplaceSection, "source")
  const marketplaceRoot = await resolveContainedPath(
    template,
    resolve(dirname(config.source), marketplaceValue),
    "marketplaces.sisyphuslabs.source",
  )
  const cachedManifest = join(marketplaceRoot, ".agents", "plugins", "marketplace.json")
  const sourceManifest = join(marketplaceRoot, "marketplace.json")
  const manifestSource = await Bun.file(cachedManifest).exists() ? cachedManifest : sourceManifest
  const marketplace = await resolveContainedPath(template, manifestSource, "marketplace manifest")
  const parsed = record(JSON.parse(await readFile(marketplace, "utf8")), "marketplace manifest")
  if (parsed.name !== "sisyphuslabs" || !Array.isArray(parsed.plugins)) throw new TypeError("Invalid sisyphuslabs marketplace manifest")
  const omo = parsed.plugins.find((entry) => record(entry, "marketplace plugin").name === "omo")
  const source = record(omo, "omo marketplace plugin").source
  const pluginRelative = typeof source === "string" ? source : record(source, "omo source").path
  if (typeof pluginRelative !== "string") throw new TypeError("omo marketplace source has no path")
  const pluginRoot = await resolveContainedExisting(marketplaceRoot, pluginRelative, "omo marketplace source")
  const [pluginManifest, gpt56Rule, programmingSkill] = await Promise.all([
    artifact(pluginRoot, ".codex-plugin/plugin.json"),
    artifact(pluginRoot, RULE_PATH),
    artifact(pluginRoot, PROGRAMMING_PATH),
  ])
  const pluginJson = record(JSON.parse(await readFile(pluginManifest.source, "utf8")), "plugin.json")
  if (pluginJson.name !== "omo") throw new TypeError("Active plugin manifest is not omo")
  validatePolicyContent(await readFile(gpt56Rule.source, "utf8"), await readFile(programmingSkill.source, "utf8"))
  const expected = await expectedPolicy(variant)
  const policySha256 = combinedPolicyHash(gpt56Rule.sha256, programmingSkill.sha256)
  const expectedPolicySha256 = combinedPolicyHash(expected.ruleSha256, expected.programmingSha256)
  if (markerRevision !== expected.revision) throw new TypeError(`Template provenance revision does not match trusted ${variant} contract`)
  if (gpt56Rule.sha256 !== expected.ruleSha256 || programmingSkill.sha256 !== expected.programmingSha256) {
    throw new TypeError(`Template policy does not match trusted ${variant} contract`)
  }
  return {
    config, marketplace: { path: manifestSource.slice(template.length + 1), source: marketplace, sha256: await sha256File(marketplace) },
    plugin_manifest: pluginManifest, gpt56_rule: gpt56Rule, programming_skill: programmingSkill,
    plugin_root: pluginRoot, marketplace_root: marketplaceRoot,
    policy_sha256: policySha256, expected_policy_sha256: expectedPolicySha256,
    provenance_revision: expected.revision,
    external_symlinks: [],
  }
}
