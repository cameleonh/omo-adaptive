#!/usr/bin/env bun
import { cp, lstat, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { basename, dirname, isAbsolute, join, relative } from "node:path"
import { TEMPLATE_MARKER_NAME } from "./policy"
import type { Variant } from "./core"

const DEPENDENCY_SECTIONS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const

function option(args: readonly string[], name: string): string {
  const index = args.indexOf(name)
  const value = args[index + 1]
  if (index < 0 || value === undefined) throw new TypeError(`Missing ${name}`)
  return value
}

function relocateStrings(value: unknown, source: string, target: string): unknown {
  if (typeof value === "string" && (value === source || value.startsWith(`${source}/`))) return join(target, relative(source, value))
  if (Array.isArray(value)) return value.map((item) => relocateStrings(item, source, target))
  if (typeof value === "object" && value !== null) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, relocateStrings(item, source, target)]))
  return value
}

async function sanitizePackage(path: string): Promise<void> {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"))
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new TypeError(`Invalid package.json: ${path}`)
  const manifest = parsed as Record<string, unknown>
  let changed = false
  for (const section of DEPENDENCY_SECTIONS) {
    const value = manifest[section]
    if (typeof value !== "object" || value === null || Array.isArray(value)) continue
    for (const [name, specifier] of Object.entries(value)) {
      if (typeof specifier !== "string" || !specifier.startsWith("file:")) continue
      const target = specifier.slice(5)
      if (!isAbsolute(target) && !/^[A-Za-z]:[\\/]/u.test(target)) continue
      ;(value as Record<string, unknown>)[name] = "0.0.0-materialized"
      changed = true
    }
  }
  if (changed) await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`)
}

async function sanitizeTree(root: string): Promise<void> {
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink()) throw new TypeError(`Materialized snapshot retained symlink: ${path}`)
      if (entry.isDirectory()) await visit(path)
      else if (entry.name === "package-lock.json" || entry.name === ".package-lock.json") await rm(path)
      else if (entry.name === "package.json") await sanitizePackage(path)
    }
  }
  await visit(root)
}

async function rejectSourceReferences(root: string, forbidden: readonly string[]): Promise<void> {
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else {
        const content = await readFile(path)
        for (const value of forbidden) if (content.includes(Buffer.from(value))) throw new TypeError(`Snapshot retains source reference: ${path}`)
      }
    }
  }
  await visit(root)
}

export async function materializeTemplateSnapshot(input: {
  readonly source: string; readonly target: string; readonly checkout: string
  readonly variant: Variant; readonly revision: string
}): Promise<void> {
  const source = await realpath(input.source)
  const checkout = await realpath(input.checkout)
  const target = join(await realpath(dirname(input.target)), basename(input.target))
  try { await lstat(target); throw new TypeError(`Snapshot target exists: ${target}`) } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error
  }
  await cp(source, target, { recursive: true, dereference: true, errorOnExist: true })
  await rm(join(target, ".tmp"), { recursive: true, force: true })
  await sanitizeTree(target)
  const configPath = join(target, "config.toml")
  const config = await readFile(configPath, "utf8")
  const encoded = config.match(/^source = ("(?:[^"\\]|\\.)+")$/mu)?.[1]
  if (encoded === undefined) throw new TypeError("Marketplace source was not found")
  const marketplace = JSON.parse(encoded)
  if (typeof marketplace !== "string") throw new TypeError("Marketplace source is not a string")
  const relocated = join(target, relative(source, marketplace))
  await writeFile(configPath, config.replace(encoded, JSON.stringify(relocated)))
  const mcpPath = join(target, "plugins/cache/sisyphuslabs/omo/4.19.4/.mcp.json")
  if (await Bun.file(mcpPath).exists()) {
    const mcp: unknown = JSON.parse(await readFile(mcpPath, "utf8"))
    await writeFile(mcpPath, `${JSON.stringify(relocateStrings(mcp, source, target), null, 2)}\n`)
  }
  await writeFile(join(target, TEMPLATE_MARKER_NAME), `${JSON.stringify({ variant: input.variant, sourceRevision: input.revision }, null, 2)}\n`)
  await rejectSourceReferences(target, [source, checkout])
}

if (import.meta.main) {
  const variant = option(Bun.argv, "--variant")
  if (variant !== "adaptive" && variant !== "upstream") throw new TypeError("Invalid --variant")
  await materializeTemplateSnapshot({
    source: option(Bun.argv, "--source"), target: option(Bun.argv, "--target"),
    checkout: option(Bun.argv, "--checkout-root"), variant, revision: option(Bun.argv, "--revision"),
  })
}
