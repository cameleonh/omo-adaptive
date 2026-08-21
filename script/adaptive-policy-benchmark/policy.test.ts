import { afterEach, expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createFixtureBaseline, loadTemplateMetadata, revalidateTemplateMetadata } from "./policy"
import { validateAdaptiveCheckout } from "./template-contract"
import { createInstalledTemplate } from "./test-template"

const platformTest = process.platform === "linux" ? test : test.skip

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

platformTest("#given hostile global Git config and hooks #when a fixture baseline is created #then host configuration is isolated", async () => {
  const root = await mkdtemp(join(tmpdir(), "adaptive-benchmark-git-"))
  temporaryDirectories.push(root)
  const fixture = join(root, "fixture")
  const hooks = join(root, "hooks")
  const marker = join(root, "hook-ran")
  const globalConfig = join(root, "global.gitconfig")
  await mkdir(fixture)
  await mkdir(hooks)
  await writeFile(join(fixture, "file.txt"), "fixture\n")
  await writeFile(join(hooks, "pre-commit"), `#!/bin/sh\nprintf ran > ${JSON.stringify(marker)}\n`)
  await chmod(join(hooks, "pre-commit"), 0o755)
  await writeFile(globalConfig, `[init]\n\tdefaultBranch = hostile\n[core]\n\thooksPath = ${hooks}\n`)

  const revision = createFixtureBaseline(fixture, { ...process.env, GIT_CONFIG_GLOBAL: globalConfig })

  expect(revision).toMatch(/^[a-f0-9]{40}$/)
  expect(await Bun.file(marker).exists()).toBe(false)
  expect(Bun.spawnSync(["git", "branch", "--show-current"], { cwd: fixture }).stdout.toString().trim()).toBe("benchmark")
})

platformTest("#given a marker-only directory #when template metadata is loaded #then the uninstalled template is rejected", async () => {
  const root = await mkdtemp(join(tmpdir(), "adaptive-benchmark-marker-only-"))
  temporaryDirectories.push(root)
  await writeFile(
    join(root, "adaptive-policy-benchmark-template.json"),
    '{"variant":"adaptive","sourceRevision":"self-asserted"}\n',
  )

  await expect(loadTemplateMetadata(root, "adaptive")).rejects.toThrow("config.toml")
})

platformTest("#given tracked adaptive policy is dirty #when trusted HEAD bytes are resolved #then working-tree masquerade is rejected", async () => {
  const root = await mkdtemp(join(tmpdir(), "adaptive-benchmark-head-policy-"))
  temporaryDirectories.push(root)
  const rule = join(root, "packages/omo-codex/plugin/components/rules/bundled-rules/hephaestus/gpt-5.6.md")
  const programming = join(root, "packages/shared-skills/skills/programming/SKILL.md")
  await mkdir(join(rule, ".."), { recursive: true })
  await mkdir(join(programming, ".."), { recursive: true })
  await writeFile(rule, "committed rule\n")
  await writeFile(programming, "committed programming\n")
  for (const command of [["init", "-q"], ["add", "."], ["-c", "user.name=Test", "-c", "user.email=test@invalid", "commit", "-qm", "policy"]]) {
    expect(Bun.spawnSync(["git", ...command], { cwd: root }).exitCode).toBe(0)
  }
  expect((await validateAdaptiveCheckout(root)).revision).toMatch(/^[a-f0-9]{40}$/)
  await writeFile(programming, "dirty programming\n")

  await expect(validateAdaptiveCheckout(root)).rejects.toThrow("differs from committed HEAD")
})

platformTest("#given cached and source marketplace layouts #when trusted templates load #then both active plugins are resolved", async () => {
  const cacheRoot = await mkdtemp(join(tmpdir(), "adaptive-benchmark-cache-layout-"))
  const sourceRoot = await mkdtemp(join(tmpdir(), "adaptive-benchmark-source-layout-"))
  temporaryDirectories.push(cacheRoot, sourceRoot)
  const cached = await createInstalledTemplate(cacheRoot, "adaptive", "cache")
  const source = await createInstalledTemplate(sourceRoot, "upstream", "source")

  const [cachedMetadata, sourceMetadata] = await Promise.all([
    loadTemplateMetadata(cached, "adaptive"),
    loadTemplateMetadata(source, "upstream"),
  ])

  expect(cachedMetadata.installation.plugin_manifest.sha256).toMatch(/^[a-f0-9]{64}$/)
  expect(sourceMetadata.installation.plugin_root).toEndWith("plugins/omo")
})

platformTest("#given adaptive policy is mislabeled upstream #when trusted provenance loads #then same-policy variant spoofing is rejected", async () => {
  const root = await mkdtemp(join(tmpdir(), "adaptive-benchmark-mislabeled-"))
  temporaryDirectories.push(root)
  const template = await createInstalledTemplate(root, "adaptive")
  await writeFile(
    join(template, "adaptive-policy-benchmark-template.json"),
    '{"variant":"upstream","sourceRevision":"a6dbc0ca0c75d91575d24598d39e244ed5905ced"}\n',
  )

  await expect(loadTemplateMetadata(template, "upstream")).rejects.toThrow("trusted upstream contract")
})

platformTest("#given active cache manifest or policy artifacts are missing #when trusted templates load #then each incomplete install is rejected", async () => {
  const manifestRoot = await mkdtemp(join(tmpdir(), "adaptive-benchmark-missing-manifest-"))
  const artifactRoot = await mkdtemp(join(tmpdir(), "adaptive-benchmark-missing-artifact-"))
  temporaryDirectories.push(manifestRoot, artifactRoot)
  const missingManifest = await createInstalledTemplate(manifestRoot, "adaptive")
  const missingArtifact = await createInstalledTemplate(artifactRoot, "adaptive")
  await rm(join(missingManifest, "cache/.agents/plugins/marketplace.json"))
  await rm(join(missingArtifact, "cache/omo/1.0.0/skills/programming/SKILL.md"))

  await expect(loadTemplateMetadata(missingManifest, "adaptive")).rejects.toThrow("marketplace.json")
  await expect(loadTemplateMetadata(missingArtifact, "adaptive")).rejects.toThrow("SKILL.md")
})

platformTest("#given template target swaps after trusted metadata #when use boundary revalidates #then credential-tree substitution is rejected", async () => {
  const root = await mkdtemp(join(tmpdir(), "adaptive-benchmark-template-swap-"))
  temporaryDirectories.push(root)
  const template = await createInstalledTemplate(root, "adaptive")
  const metadata = await loadTemplateMetadata(template, "adaptive")
  const replacement = join(root, "replacement-home")
  await rename(template, join(root, "held-template"))
  await mkdir(replacement)
  await writeFile(join(replacement, "credentials.json"), "secret\n")
  await symlink(replacement, template, "dir")

  await expect(revalidateTemplateMetadata(metadata, "adaptive")).rejects.toThrow()
})

platformTest("#given only a template executable mode changes #when use boundary revalidates #then full snapshot drift is rejected", async () => {
  const root = await mkdtemp(join(tmpdir(), "adaptive-benchmark-mode-drift-"))
  temporaryDirectories.push(root)
  const template = await createInstalledTemplate(root, "adaptive")
  const metadata = await loadTemplateMetadata(template, "adaptive")
  await chmod(join(template, "config.toml"), 0o755)

  await expect(revalidateTemplateMetadata(metadata, "adaptive")).rejects.toThrow("Template changed")
})

platformTest("#given an installed runtime contains any symlink #when template metadata loads #then the non-snapshot template is rejected", async () => {
  const root = await mkdtemp(join(tmpdir(), "adaptive-benchmark-external-link-"))
  temporaryDirectories.push(root)
  const template = await createInstalledTemplate(root, "adaptive")
  const runtime = join(root, "runtime")
  await mkdir(runtime)
  await writeFile(join(runtime, "entry.js"), "export const version = 1\n")
  await symlink(runtime, join(template, "runtime-link"), "dir")
  await expect(loadTemplateMetadata(template, "adaptive")).rejects.toThrow("symlink-free snapshot")
})

platformTest("#given snapshot package metadata refers to an absolute checkout #when template loads #then inert file dependency is rejected", async () => {
  const root = await mkdtemp(join(tmpdir(), "adaptive-benchmark-file-dependency-"))
  temporaryDirectories.push(root)
  const template = await createInstalledTemplate(root, "adaptive")
  await writeFile(join(template, "package.json"), '{"dependencies":{"workspace":"file:/tmp/checkout/package"}}\n')

  await expect(loadTemplateMetadata(template, "adaptive")).rejects.toThrow("absolute file dependency")
})
