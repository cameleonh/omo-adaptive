import { createHash } from "node:crypto"
import { lstat, readlink, readdir, readFile, stat } from "node:fs/promises"
import { join } from "node:path"
import { resolveContainedExisting } from "./paths"

export const TIERS = ["Light", "Standard", "Deep"] as const
export type Tier = (typeof TIERS)[number]
export type Variant = "adaptive" | "upstream"

export type CompletionCriterion = {
  readonly kind: "file_contains"
  readonly path: string
  readonly contains: string
}

export type BehavioralOracle = {
  readonly name: string
  readonly path: string
}

export type CorpusCase = {
  readonly id: string
  readonly tier: Tier
  readonly promptFile: string
  readonly fixtureDirectory: string
  readonly completionCriterion: CompletionCriterion
  readonly behavioralOracle: BehavioralOracle | null
  readonly expectedVerificationPatterns: readonly string[]
  readonly timeoutMs: number
}

export type Corpus = { readonly version: number; readonly cases: readonly CorpusCase[] }

export type CasePaths = {
  readonly fixture: string
  readonly prompt: string
  readonly criterion: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === "string" ? value : null
}

function parseTier(value: unknown): Tier | null {
  return TIERS.find((tier) => tier === value) ?? null
}

function parseCase(value: unknown): CorpusCase | null {
  if (!isRecord(value) || !isRecord(value.completionCriterion)) return null
  const tier = parseTier(value.tier)
  const criterion = value.completionCriterion
  const expectedVerificationPatterns = value.expectedVerificationPatterns
  const behavioralOracle = value.behavioralOracle
  let parsedOracle: BehavioralOracle | null
  if (behavioralOracle === null) parsedOracle = null
  else if (isRecord(behavioralOracle)) {
    const name = readString(behavioralOracle, "name")
    const path = readString(behavioralOracle, "path")
    if (name === null || path === null) return null
    parsedOracle = { name, path }
  } else return null
  if (
    tier === null || typeof value.id !== "string" || typeof value.promptFile !== "string" ||
    typeof value.fixtureDirectory !== "string" || criterion.kind !== "file_contains" ||
    typeof criterion.path !== "string" || typeof criterion.contains !== "string" ||
    !Array.isArray(expectedVerificationPatterns) || expectedVerificationPatterns.length === 0 ||
    !expectedVerificationPatterns.every((pattern) => typeof pattern === "string" && pattern.length > 0) ||
    typeof value.timeoutMs !== "number" || !Number.isInteger(value.timeoutMs) || value.timeoutMs <= 0
  ) return null
  return {
    id: value.id,
    tier,
    promptFile: value.promptFile,
    fixtureDirectory: value.fixtureDirectory,
    completionCriterion: { kind: "file_contains", path: criterion.path, contains: criterion.contains },
    behavioralOracle: parsedOracle,
    expectedVerificationPatterns,
    timeoutMs: value.timeoutMs,
  }
}

export async function loadCorpus(manifestPath: string): Promise<Corpus> {
  const parsed: unknown = JSON.parse(await readFile(manifestPath, "utf8"))
  if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.cases)) {
    throw new TypeError(`Invalid corpus manifest: ${manifestPath}`)
  }
  const cases = parsed.cases.map(parseCase)
  if (cases.some((item) => item === null)) throw new TypeError(`Invalid corpus case in ${manifestPath}`)
  const validCases = cases.filter((item): item is CorpusCase => item !== null)
  if (new Set(validCases.map((item) => item.id)).size !== validCases.length) {
    throw new TypeError(`Duplicate corpus case id in ${manifestPath}`)
  }
  for (const tier of TIERS) {
    if (!validCases.some((item) => item.tier === tier)) throw new TypeError(`Corpus has no ${tier} case`)
  }
  return { version: 1, cases: validCases }
}

export async function resolveCasePaths(corpusRoot: string, corpusCase: CorpusCase): Promise<CasePaths> {
  const fixture = await resolveContainedExisting(corpusRoot, corpusCase.fixtureDirectory, "fixtureDirectory")
  const prompt = await resolveContainedExisting(corpusRoot, corpusCase.promptFile, "promptFile")
  const criterion = await resolveContainedExisting(fixture, corpusCase.completionCriterion.path, "completionCriterion.path")
  if (corpusCase.tier !== "Light" && corpusCase.behavioralOracle === null) {
    throw new TypeError(`${corpusCase.tier} case requires a behavioral oracle`)
  }
  if (corpusCase.behavioralOracle !== null) {
    await resolveContainedExisting(corpusRoot, corpusCase.behavioralOracle.path, "behavioralOracle.path")
  }
  return { fixture, prompt, criterion }
}

export async function validateCase(corpusRoot: string, corpusCase: CorpusCase): Promise<void> {
  const { fixture, prompt, criterion } = await resolveCasePaths(corpusRoot, corpusCase)
  if (!(await stat(fixture)).isDirectory()) throw new TypeError(`Fixture is not a directory: ${fixture}`)
  if (!(await stat(prompt)).isFile()) {
    throw new TypeError(`Prompt is not a file: ${corpusCase.promptFile}`)
  }
  if (!(await stat(criterion)).isFile()) throw new TypeError(`Criterion target is not a file: ${criterion}`)
  if (await Bun.file(join(fixture, "AGENTS.md")).exists()) throw new TypeError(`Fixture must not contain AGENTS.md: ${fixture}`)
}

export async function sha256File(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex")
}

export async function sha256Directory(root: string): Promise<string> {
  const hash = createHash("sha256")
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const path = join(directory, entry.name)
      const relativePath = path.slice(root.length + 1)
      const mode = (await lstat(path)).mode & 0o777
      hash.update(relativePath).update("\0").update(mode.toString(8)).update("\0")
      if (entry.isDirectory()) { hash.update("directory\0"); await visit(path) }
      else if (entry.isSymbolicLink()) hash.update("symlink\0").update(await readlink(path)).update("\0")
      else hash.update("file\0").update(await readFile(path)).update("\0")
    }
  }
  await visit(root)
  return hash.digest("hex")
}

export async function criterionMet(cwd: string, criterion: CompletionCriterion): Promise<boolean> {
  const target = await resolveContainedExisting(cwd, criterion.path, "completionCriterion.path")
  return (await readFile(target, "utf8")).includes(criterion.contains)
}
