import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { updateCodexConfig } from "./codex-config-toml"

describe("codex MultiAgentV2 release blockers", () => {
  test("#given a V2-preferred model #when updating config #then writes the Codex 0.120 feature flag and agents cap", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-v2-0120-"))
    const configPath = join(root, "config.toml")
    await writeFile(configPath, ['model = "gpt-5.6-sol"', ""].join("\n"))
    await writeFile(
      join(root, "models_cache.json"),
      JSON.stringify({ models: [{ slug: "gpt-5.6-sol", multi_agent_version: "v2" }] }),
    )

    // when
    await updateCodexConfig({
      configPath,
      repoRoot: "/repo/packages/omo-codex",
      marketplaceName: "debug",
      marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex" },
      pluginNames: ["omo"],
    })

    // then
    const content = await readFile(configPath, "utf8")
    expect(content).toContain("codex_hooks = true")
    expect(content).toContain("multi_agent_v2 = true")
    expect(content).toContain("[agents]\nmax_threads = 6")
    expect(content).not.toContain("plugin_hooks")
    expect(content).not.toContain("[features.multi_agent_v2]")
    expect(content).not.toContain("max_concurrent_threads_per_session")
  })

  test("#given a V2 table with supported user settings #when updating config #then preserves them while moving only the unsupported cap", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-v2-0120-supported-table-"))
    const configPath = join(root, "config.toml")
    await writeFile(
      configPath,
      [
        'model = "gpt-5.6-sol"',
        "",
        "[features.multi_agent_v2]",
        "enabled = false",
        "usage_hint_enabled = false",
        'usage_hint_text = "user hint"',
        "hide_spawn_agent_metadata = true",
        "max_concurrent_threads_per_session = 7",
        "",
      ].join("\n"),
    )
    await writeFile(
      join(root, "models_cache.json"),
      JSON.stringify({ models: [{ slug: "gpt-5.6-sol", multi_agent_version: "v2" }] }),
    )

    // when
    await updateCodexConfig({
      configPath,
      repoRoot: "/repo/packages/omo-codex",
      marketplaceName: "debug",
      marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex" },
      pluginNames: ["omo"],
    })

    // then
    const content = await readFile(configPath, "utf8")
    expect(Bun.TOML.parse(content)).toBeDefined()
    expect(content).toContain("[features.multi_agent_v2]")
    expect(sectionText(content, "[features.multi_agent_v2]")).toContain("enabled = true")
    expect(sectionText(content, "[features.multi_agent_v2]")).toContain("usage_hint_enabled = false")
    expect(sectionText(content, "[features.multi_agent_v2]")).toContain('usage_hint_text = "user hint"')
    expect(sectionText(content, "[features.multi_agent_v2]")).toContain("hide_spawn_agent_metadata = true")
    expect(content).toContain("[agents]\nmax_threads = 7")
    expect(content).not.toContain("max_concurrent_threads_per_session")
    expect(content).not.toMatch(/^multi_agent_v2\s*=/m)
  })

  test("#given a V2 table with an unsupported neighbor #when updating config #then retains only Codex 0.120 fields", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-v2-0120-unknown-table-field-"))
    const configPath = join(root, "config.toml")
    await writeFile(
      configPath,
      [
        'model = "gpt-5.6-sol"',
        "",
        "[features.multi_agent_v2]",
        "usage_hint_enabled = false",
        "show_tool_use = false",
        "max_concurrent_threads_per_session = 8",
        "# user table comment",
        "",
      ].join("\n"),
    )

    // when
    await updateCodexConfig({
      configPath,
      repoRoot: "/repo/packages/omo-codex",
      marketplaceName: "debug",
      marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex" },
      pluginNames: ["omo"],
    })

    // then
    const content = await readFile(configPath, "utf8")
    expect(Bun.TOML.parse(content)).toBeDefined()
    expect(sectionText(content, "[features.multi_agent_v2]")).toContain("usage_hint_enabled = false")
    expect(sectionText(content, "[features.multi_agent_v2]")).toContain("enabled = true")
    expect(content).toContain("[agents]\nmax_threads = 8")
    expect(content).not.toContain("show_tool_use")
    expect(content).not.toContain("max_concurrent_threads_per_session")
    expect(content).toContain("# user table comment")
  })

  test("#given gpt-5.6 v2 catalog and existing table disable #when updating config #then enables the retained table", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-v2-table-disable-"))
    const configPath = join(root, "config.toml")
    await writeFile(
      configPath,
      [
        'model = "gpt-5.6-sol"',
        "",
        "[features.multi_agent_v2]",
        "enabled = false",
        "max_concurrent_threads_per_session = 6",
        "",
        "[agents]",
        "max_threads = 16",
        "max_depth = 4",
        "",
      ].join("\n"),
    )
    await writeFile(
      join(root, "models_cache.json"),
      JSON.stringify({ models: [{ slug: "gpt-5.6-sol", multi_agent_version: "v2" }] }),
    )

    // when
    await updateCodexConfig({
      configPath,
      repoRoot: "/repo/packages/omo-codex",
      marketplaceName: "debug",
      marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex" },
      pluginNames: ["omo"],
    })

    // then
    const content = await readFile(configPath, "utf8")
    expect(sectionText(content, "[features.multi_agent_v2]")).toContain("enabled = true")
    expect(sectionText(content, "[features.multi_agent_v2]")).not.toContain("max_concurrent_threads_per_session")
    expect(content).toContain("max_threads = 16")
    expect(content).toContain("max_depth = 4")
  })

  test("#given relative model_catalog_json declares gpt-5.6 model as v1 #when updating config #then resolves catalog beside config", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-v2-relative-catalog-"))
    const configPath = join(root, "config.toml")
    await writeFile(configPath, ['model = "gpt-5.6-sol"', 'model_catalog_json = "custom-catalog.json"', ""].join("\n"))
    await writeFile(
      join(root, "custom-catalog.json"),
      JSON.stringify({ models: [{ slug: "gpt-5.6-sol", multi_agent_version: "v1" }] }),
    )

    // when
    await updateCodexConfig({
      configPath,
      repoRoot: "/repo/packages/omo-codex",
      marketplaceName: "debug",
      marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex" },
      pluginNames: ["omo"],
    })

    // then
    const content = await readFile(configPath, "utf8")
    expect(content).toContain("multi_agent_v2 = false")
    expect(content).toContain("max_threads = 6")
    expect(content).not.toContain("max_concurrent_threads_per_session")
  })

  test("#given root gpt-5.6 model without catalog #when updating config #then enables the retained V2 table", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-v2-root-gpt56-"))
    const configPath = join(root, "config.toml")
    await writeFile(
      configPath,
      [
        'model = "gpt-5.6-terra"',
        "",
        "[features.multi_agent_v2]",
        "enabled = false",
        "max_concurrent_threads_per_session = 6",
        "",
        "[agents]",
        "max_threads = 16",
        "",
      ].join("\n"),
    )

    // when
    await updateCodexConfig({
      configPath,
      repoRoot: "/repo/packages/omo-codex",
      marketplaceName: "debug",
      marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex" },
      pluginNames: ["omo"],
    })

    // then
    const content = await readFile(configPath, "utf8")
    expect(sectionText(content, "[features.multi_agent_v2]")).toContain("enabled = true")
    expect(sectionText(content, "[features.multi_agent_v2]")).not.toContain("max_concurrent_threads_per_session")
    expect(content).toContain("max_threads = 16")
  })
})

function sectionText(config: string, header: string): string {
  const start = config.indexOf(header)
  if (start === -1) return ""
  const rest = config.slice(start)
  const nextSection = rest.slice(header.length).search(/\n\[/)
  return nextSection === -1 ? rest : rest.slice(0, header.length + nextSection + 1)
}
