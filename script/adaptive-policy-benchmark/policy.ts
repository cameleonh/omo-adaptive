import { readFile, writeFile } from "node:fs/promises"
import { platform } from "node:os"
import { join } from "node:path"
import { sha256Directory, sha256File, type Tier, type Variant } from "./core"
import { validateInstalledTemplate, type InstallationMetadata } from "./template-contract"

export const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number]

export const TOOL_POLICY = {
  sandbox: "workspace-write",
  approvalPolicy: "never",
  networkAccess: false,
} as const

export const TEMPLATE_MARKER_NAME = "adaptive-policy-benchmark-template.json"

type MarkerContent = { readonly variant: Variant; readonly sourceRevision: string }

export type TemplateMetadata = {
  readonly directory_path: string
  readonly directory_sha256: string
  readonly marker: {
    readonly path: string
    readonly source: string
    readonly sha256: string
    readonly content: MarkerContent
  }
  readonly installation: InstallationMetadata
}

export type TierControl = {
  readonly source: string
  readonly path: "AGENTS.md"
  readonly sha256: string
  readonly content: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export async function loadTemplateMetadata(template: string, variant: Variant): Promise<TemplateMetadata> {
  const markerPath = join(template, TEMPLATE_MARKER_NAME)
  const parsed: unknown = JSON.parse(await readFile(markerPath, "utf8"))
  if (!isRecord(parsed) || (parsed.variant !== "adaptive" && parsed.variant !== "upstream") || typeof parsed.sourceRevision !== "string" || parsed.sourceRevision.length === 0) {
    throw new TypeError(`Invalid ${TEMPLATE_MARKER_NAME}`)
  }
  if (parsed.variant !== variant) throw new TypeError(`Codex-home template marker variant ${parsed.variant} does not match --variant ${variant}`)
  const installation = await validateInstalledTemplate(template, variant, parsed.sourceRevision)
  return {
    directory_path: template,
    directory_sha256: await sha256Directory(template),
    marker: {
      path: TEMPLATE_MARKER_NAME,
      source: markerPath,
      sha256: await sha256File(markerPath),
      content: { variant: parsed.variant, sourceRevision: parsed.sourceRevision },
    },
    installation,
  }
}

export async function loadTierControl(tier: Tier): Promise<TierControl> {
  const relativeSource = `script/fixtures/adaptive-policy-benchmark/tier-controls/${tier}.AGENTS.md`
  const source = join(import.meta.dir, "..", "fixtures", "adaptive-policy-benchmark", "tier-controls", `${tier}.AGENTS.md`)
  return { source: relativeSource, path: "AGENTS.md", sha256: await sha256File(source), content: await readFile(source, "utf8") }
}

export async function relocateTemplateConfig(
  copiedTemplate: string,
  originalTemplate: TemplateMetadata,
): Promise<void> {
  const configPath = join(copiedTemplate, "config.toml")
  const content = await readFile(configPath, "utf8")
  const marketplaceRelative = originalTemplate.installation.marketplace_root.slice(
    originalTemplate.directory_path.length + 1,
  )
  const copiedMarketplace = join(copiedTemplate, marketplaceRelative)
  const relocated = content.replace(
    `source = ${JSON.stringify(originalTemplate.installation.marketplace_root)}`,
    `source = ${JSON.stringify(copiedMarketplace)}`,
  )
  if (relocated === content) throw new TypeError("Template config marketplace source could not be relocated")
  await writeFile(configPath, relocated)
}

export async function revalidateTemplateMetadata(
  metadata: TemplateMetadata,
  variant: Variant,
): Promise<void> {
  const current = await loadTemplateMetadata(metadata.directory_path, variant)
  if (
    current.directory_sha256 !== metadata.directory_sha256 ||
    current.installation.policy_sha256 !== metadata.installation.policy_sha256 ||
    JSON.stringify(current.installation.external_symlinks) !== JSON.stringify(metadata.installation.external_symlinks)
  ) {
    throw new TypeError("Template changed after validation")
  }
}

export function buildCodexCommand(input: {
  readonly binary: string
  readonly model: string
  readonly reasoningEffort: ReasoningEffort
  readonly prompt: string
}): readonly string[] {
  return [
    input.binary, "exec", "--json", "--ephemeral", "--skip-git-repo-check",
    "--sandbox", TOOL_POLICY.sandbox,
    "-c", `approval_policy="${TOOL_POLICY.approvalPolicy}"`,
    "-c", `sandbox_workspace_write.network_access=${TOOL_POLICY.networkAccess}`,
    "--model", input.model,
    "-c", `model_reasoning_effort="${input.reasoningEffort}"`,
    input.prompt,
  ]
}

export function createFixtureBaseline(cwd: string, inheritedEnvironment: NodeJS.ProcessEnv = process.env): string {
  const nullDevice = platform() === "win32" ? "NUL" : "/dev/null"
  const gitEnvironment = {
    ...inheritedEnvironment,
    GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
    GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
    GIT_CONFIG_GLOBAL: nullDevice,
    GIT_CONFIG_SYSTEM: nullDevice,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_ATTR_NOSYSTEM: "1",
    GIT_CONFIG_COUNT: "0",
  }
  const fixedConfig = ["-c", `core.hooksPath=${nullDevice}`, "-c", "commit.gpgSign=false"] as const
  const commands = [
    ["git", ...fixedConfig, "init", "--quiet", "--initial-branch=benchmark"],
    ["git", ...fixedConfig, "add", "--all"],
    ["git", ...fixedConfig, "-c", "user.name=OMO Benchmark", "-c", "user.email=benchmark@invalid", "commit", "--quiet", "-m", "fixture-baseline"],
  ] as const
  for (const command of commands) {
    const result = Bun.spawnSync([...command], { cwd, env: gitEnvironment, stdout: "pipe", stderr: "pipe" })
    if (result.exitCode !== 0) throw new TypeError(`Failed to create fixture Git baseline: ${result.stderr.toString().trim()}`)
  }
  const revision = Bun.spawnSync(["git", ...fixedConfig, "rev-parse", "HEAD"], { cwd, env: gitEnvironment, stdout: "pipe", stderr: "pipe" })
  if (revision.exitCode !== 0) throw new TypeError(`Failed to read fixture Git baseline: ${revision.stderr.toString().trim()}`)
  return revision.stdout.toString().trim()
}
