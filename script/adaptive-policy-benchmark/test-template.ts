import { cp, mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { Variant } from "./core"

const UPSTREAM_REVISION = "a6dbc0ca0c75d91575d24598d39e244ed5905ced"
function checkoutRevision(): string {
  const result = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: join(import.meta.dir, "../.."), stdout: "pipe" })
  if (result.exitCode !== 0) throw new TypeError("Cannot resolve test checkout revision")
  return result.stdout.toString().trim()
}

export async function createInstalledTemplate(
  root: string,
  variant: Variant,
  layout: "cache" | "source" = "cache",
): Promise<string> {
  const template = join(root, "template")
  const marketplace = join(template, layout === "cache" ? "cache" : "source-marketplace")
  const plugin = join(marketplace, layout === "cache" ? "omo/1.0.0" : "plugins/omo")
  const manifest = layout === "cache"
    ? join(marketplace, ".agents/plugins/marketplace.json")
    : join(marketplace, "marketplace.json")
  await mkdir(join(plugin, ".codex-plugin"), { recursive: true })
  await mkdir(join(plugin, "components/rules/bundled-rules/hephaestus"), { recursive: true })
  await mkdir(join(plugin, "skills/programming"), { recursive: true })
  await mkdir(join(manifest, ".."), { recursive: true })
  const source = layout === "cache" ? { source: "local", path: "./omo/1.0.0" } : "./plugins/omo"
  await writeFile(manifest, `${JSON.stringify({ name: "sisyphuslabs", plugins: [{ name: "omo", source }] })}\n`)
  await writeFile(join(plugin, ".codex-plugin/plugin.json"), '{"name":"omo","version":"1.0.0"}\n')
  const ruleTarget = join(plugin, "components/rules/bundled-rules/hephaestus/gpt-5.6.md")
  const programmingTarget = join(plugin, "skills/programming/SKILL.md")
  if (variant === "adaptive") {
    const canonicalPlugin = join(import.meta.dir, "../../packages/omo-codex/plugin")
    await cp(join(canonicalPlugin, "components/rules/bundled-rules/hephaestus/gpt-5.6.md"), ruleTarget)
    await cp(join(import.meta.dir, "../../packages/shared-skills/skills/programming/SKILL.md"), programmingTarget)
  } else {
    const assets = join(import.meta.dir, "../fixtures/adaptive-policy-benchmark/template-contract/upstream")
    const [rule, programming] = await Promise.all([
      readFile(join(assets, "gpt-5.6.md.gz.b64"), "utf8"),
      readFile(join(assets, "programming.SKILL.md.gz.b64"), "utf8"),
    ])
    await writeFile(ruleTarget, Bun.gunzipSync(Buffer.from(rule.trim(), "base64")))
    await writeFile(programmingTarget, Bun.gunzipSync(Buffer.from(programming.trim(), "base64")))
  }
  await writeFile(
    join(template, "config.toml"),
    `[marketplaces.sisyphuslabs]\nsource_type = "local"\nsource = ${JSON.stringify(marketplace)}\n\n[plugins."omo@sisyphuslabs"]\nenabled = true\n`,
  )
  const sourceRevision = variant === "adaptive" ? checkoutRevision() : UPSTREAM_REVISION
  await writeFile(
    join(template, "adaptive-policy-benchmark-template.json"),
    `${JSON.stringify({ variant, sourceRevision })}\n`,
  )
  return template
}
