import { constants } from "node:fs"
import { lstat, mkdir, open, realpath, stat, type FileHandle } from "node:fs/promises"
import { dirname, isAbsolute, relative, resolve } from "node:path"

export class UnsafePathError extends Error {
  readonly name = "UnsafePathError"
  constructor(readonly field: string, readonly value: string, reason: string) {
    super(`${field} ${reason}: ${value}`)
  }
}

export type PreparedOutput = {
  readonly requested: string
  readonly canonicalCandidate: string
  readonly canonicalTemplate: string
}

export type ClaimedOutput = {
  readonly canonicalPath: string
  readonly artifactRoot: string
  readonly handle: FileHandle
}

function isContained(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate)
  return fromRoot === "" || (!fromRoot.startsWith("..") && !isAbsolute(fromRoot))
}

export async function resolveContainedPath(
  root: string,
  candidate: string,
  field: string,
): Promise<string> {
  const [canonicalRoot, canonical] = await Promise.all([realpath(root), realpath(candidate)])
  if (!isContained(canonicalRoot, canonical)) {
    throw new UnsafePathError(field, candidate, "resolves outside its declared root")
  }
  return canonical
}

function manifestCandidate(root: string, value: string, field: string): string {
  if (isAbsolute(value) || value.split(/[\\/]/u).includes("..")) {
    throw new UnsafePathError(field, value, "must be a contained relative path")
  }
  const candidate = resolve(root, value)
  if (!isContained(resolve(root), candidate)) {
    throw new UnsafePathError(field, value, "escapes its declared root")
  }
  return candidate
}

export async function resolveContainedExisting(
  root: string,
  value: string,
  field: string,
): Promise<string> {
  const canonicalRoot = await realpath(root)
  const candidate = manifestCandidate(canonicalRoot, value, field)
  const canonical = await realpath(candidate)
  if (!isContained(canonicalRoot, canonical)) {
    throw new UnsafePathError(field, value, "resolves through a symlink outside its declared root")
  }
  return canonical
}

async function canonicalCandidate(path: string): Promise<string> {
  const missing: string[] = []
  let current = resolve(path)
  while (true) {
    try {
      const canonical = await realpath(current)
      return resolve(canonical, ...missing.reverse())
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error
      const parent = dirname(current)
      if (parent === current) throw error
      missing.push(current.slice(parent.length + 1))
      current = parent
    }
  }
}

export async function prepareOutputTarget(
  output: string,
  template: string,
  realCodexHome: string,
): Promise<PreparedOutput> {
  try {
    await lstat(output)
    throw new UnsafePathError("--output", output, "already exists")
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error
  }
  const [candidate, canonicalTemplate, canonicalRealHome] = await Promise.all([
    canonicalCandidate(output),
    canonicalCandidate(template),
    canonicalCandidate(realCodexHome),
  ])
  if (isContained(canonicalRealHome, canonicalTemplate)) {
    throw new UnsafePathError("--codex-home-template", template, "refuses the real ~/.codex as a template")
  }
  if (isContained(canonicalTemplate, candidate)) {
    throw new UnsafePathError("--output", output, "must not equal or be beneath the template")
  }
  if (isContained(canonicalRealHome, candidate)) {
    throw new UnsafePathError("--output", output, "must not equal or be beneath the real ~/.codex")
  }
  return { requested: output, canonicalCandidate: candidate, canonicalTemplate }
}

export async function claimOutputTarget(
  prepared: PreparedOutput,
  afterMkdir: () => Promise<void> = async () => {},
  afterOpen: () => Promise<void> = async () => {},
): Promise<ClaimedOutput> {
  const canonicalParent = dirname(prepared.canonicalCandidate)
  await mkdir(canonicalParent, { recursive: true })
  if (await realpath(canonicalParent) !== canonicalParent) {
    throw new UnsafePathError("--output", prepared.requested, "changed canonical parent before exclusive claim")
  }
  await mkdir(prepared.canonicalCandidate)
  await afterMkdir()
  const claimed = await realpath(prepared.canonicalCandidate)
  if (claimed !== prepared.canonicalCandidate) {
    throw new UnsafePathError("--output", prepared.requested, "changed canonical target before exclusive claim")
  }
  try {
    if (await realpath(prepared.requested) !== claimed) throw new Error("alias changed")
  } catch {
    throw new UnsafePathError("--output", prepared.requested, "changed requested alias before exclusive claim")
  }
  const directoryFlag = constants.O_DIRECTORY
  const noFollowFlag = constants.O_NOFOLLOW
  if (directoryFlag === undefined || noFollowFlag === undefined) {
    throw new UnsafePathError("--output", prepared.requested, "platform has no safe directory-open flags")
  }
  const handle = await open(claimed, constants.O_RDONLY | directoryFlag | noFollowFlag)
  try {
    await afterOpen()
    const opened = await handle.stat()
    const named = await stat(claimed)
    if (opened.dev !== named.dev || opened.ino !== named.ino) throw new Error("inode changed")
    for (const prefix of ["/proc/self/fd", "/dev/fd"]) {
      const artifactRoot = `${prefix}/${handle.fd}`
      try {
        const anchored = await stat(artifactRoot)
        if (anchored.dev === opened.dev && anchored.ino === opened.ino) return { canonicalPath: claimed, artifactRoot, handle }
      } catch {}
    }
    throw new UnsafePathError("--output", prepared.requested, "platform has no fd-backed artifact path")
  } catch (error) {
    await handle.close()
    if (error instanceof UnsafePathError) throw error
    throw new UnsafePathError("--output", prepared.requested, "changed inode while anchoring output")
  }
}

export async function validateOutputTarget(
  output: string,
  template: string,
  realCodexHome: string,
): Promise<void> {
  await prepareOutputTarget(output, template, realCodexHome)
}
