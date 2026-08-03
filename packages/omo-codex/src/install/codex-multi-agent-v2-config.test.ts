/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { updateCodexConfig } from "./codex-config-toml"

describe("codex MultiAgentV2 config", () => {
  test("#given legacy boolean flag and supported table #when updating config #then output retains valid V2 table settings", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-mav2-valid-toml-"))
    const configPath = join(root, "config.toml")
    await writeFile(
      configPath,
      [
        "[features]",
        "multi_agent_v2 = true",
        "plugins = false",
        "",
        "[features.multi_agent_v2]",
        "usage_hint_enabled = false",
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
    expect(parseToml(content)).toBeDefined()
    expect(content).not.toMatch(/^\s*multi_agent_v2\s*=/m)
    expect(sectionText(content, "[features.multi_agent_v2]")).toContain("enabled = true")
    expect(sectionText(content, "[features.multi_agent_v2]")).toContain("usage_hint_enabled = false")
    expect(content).not.toContain("max_concurrent_threads_per_session")
  })

  test("#given an inline-commented V2 thread cap #when updating config twice #then migrates the cap and removes unsupported neighbors", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-mav2-explicit-cap-"))
    const configPath = join(root, "config.toml")
    await writeFile(
      configPath,
      [
        "[features.multi_agent_v2]",
        "usage_hint_enabled = false",
        "max_concurrent_threads_per_session = 7 # user cap",
        "show_tool_use = false",
        "",
      ].join("\n"),
    )

    // when
    const updateInput = {
      configPath,
      repoRoot: "/repo/packages/omo-codex",
      marketplaceName: "debug",
      marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex" },
      pluginNames: ["omo"],
    } as const
    await updateCodexConfig(updateInput)
    const firstPass = await readFile(configPath, "utf8")
    const firstV2Section = sectionText(firstPass, "[features.multi_agent_v2]")
    await updateCodexConfig(updateInput)

    // then
    const secondPass = await readFile(configPath, "utf8")
    expect(parseToml(secondPass)).toBeDefined()
    expect(secondPass).toContain("usage_hint_enabled = false")
    expect(secondPass).toContain("[agents]\nmax_threads = 7")
    expect(secondPass).not.toContain("max_concurrent_threads_per_session")
    expect(secondPass).not.toContain("show_tool_use")
    expect(sectionText(secondPass, "[features.multi_agent_v2]")).toBe(firstV2Section)
  })

  for (const fixture of [
    {
      name: "escaped quoted V2 header",
      lines: ['["features"."multi_agent_v\\u0032"]', "max_concurrent_threads_per_session = 7 # user cap"],
      preservedLine: '["features"."multi_agent_v\\u0032"]',
    },
    {
      name: "quoted cap key",
      lines: ["[features.multi_agent_v2]", '"max_concurrent_threads_per_session" = 7 # user cap'],
      preservedLine: '"max_concurrent_threads_per_session" = 7 # user cap',
    },
    {
      name: "escaped quoted cap key",
      lines: ["[features.multi_agent_v2]", '"max_concurrent_threads_per_sessio\\u006e" = 7 # user cap'],
      preservedLine: '"max_concurrent_threads_per_sessio\\u006e" = 7 # user cap',
    },
    {
      name: "dotted cap key",
      lines: ["[features]", "multi_agent_v2.max_concurrent_threads_per_session = 7 # user cap"],
      preservedLine: "multi_agent_v2.max_concurrent_threads_per_session = 7 # user cap",
    },
    {
      name: "root-qualified dotted cap key",
      lines: ["features.multi_agent_v2.max_concurrent_threads_per_session = 7 # user cap"],
      preservedLine: "features.multi_agent_v2.max_concurrent_threads_per_session = 7 # user cap",
    },
  ] as const) {
    test(`#given installer config has a ${fixture.name} #when updating twice #then migrates the semantic cap without duplication`, async () => {
      // given
      const root = await mkdtemp(join(tmpdir(), "omo-codex-mav2-semantic-key-"))
      const configPath = join(root, "config.toml")
      await writeFile(configPath, ['model = "gpt-5.4"', "", ...fixture.lines, ""].join("\n"))
      const updateInput = {
        configPath,
        repoRoot: "/repo/packages/omo-codex",
        marketplaceName: "debug",
        marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex" },
        pluginNames: ["omo"],
      } as const

      // when
      await updateCodexConfig(updateInput)
      const firstPass = await readFile(configPath, "utf8")
      await updateCodexConfig(updateInput)

      // then
      const secondPass = await readFile(configPath, "utf8")
      expect(parseToml(firstPass)).toBeDefined()
      expect(parseToml(secondPass)).toBeDefined()
      expect(secondPass).toContain("[agents]\nmax_threads = 7")
      expect(secondPass).not.toContain(fixture.preservedLine)
      expect(secondPass).not.toContain("max_concurrent_threads_per_session")
      expect(secondPass).toContain("multi_agent_v2 = false")
    })
  }

  test("#given multiline string contains V2 cap lookalikes #when updating config #then writes the absent semantic default", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-mav2-multiline-lookalike-"))
    const configPath = join(root, "config.toml")
    await writeFile(
      configPath,
      [
        'notes = """',
        "[features.multi_agent_v2]",
        "max_concurrent_threads_per_session = 7",
        '"""',
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
    expect(parseToml(content)).toBeDefined()
    expect(content).toContain("max_concurrent_threads_per_session = 7")
    expect(content).toContain("[agents]\nmax_threads = 6")
  })

  test("#given V2 section multiline value contains a cap lookalike #when updating config #then writes the absent default", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-mav2-section-multiline-lookalike-"))
    const configPath = join(root, "config.toml")
    await writeFile(
      configPath,
      [
        "[features.multi_agent_v2]",
        'notes = """',
        "max_concurrent_threads_per_session = 7",
        '"""',
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
    expect(parseToml(content)).toBeDefined()
    expect(content).toContain("multi_agent_v2 = true")
    expect(content).not.toContain("max_concurrent_threads_per_session")
  })

  test("#given root-dotted features and string lookalikes #when updating config #then replaces the semantic flag only", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-mav2-root-feature-integrity-"))
    const configPath = join(root, "config.toml")
    await writeFile(
      configPath,
      [
        'notes = """',
        "features.plugins = false",
        '"""',
        '"features".plugins = false # user flag',
        "features.multi_agent_v2.max_concurrent_threads_per_session = 7",
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
    expect(content).toContain('notes = """\nfeatures.plugins = false\n"""')
    expect(content).toContain('"features".plugins = true # user flag')
    expect(content).not.toContain("[features]")
    expect(content).toContain("features.multi_agent_v2 = true")
    expect(content).not.toContain("features.multi_agent_v2.max_concurrent_threads_per_session")
  })

  test("#given root-dotted plugin flag has a multiline value #when updating config #then replaces the whole semantic assignment", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-mav2-root-feature-multiline-"))
    const configPath = join(root, "config.toml")
    await writeFile(
      configPath,
      [
        '"features".plugins = """',
        "false",
        '"""',
        "features.multi_agent_v2.max_concurrent_threads_per_session = 7",
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
    expect(content).toContain('"features".plugins = true')
    expect(content).not.toContain('\nfalse\n"""')
    expect(parseToml(content)).toBeDefined()
    expect(content).toContain("[agents]\nmax_threads = 7")
    expect(content).not.toContain("max_concurrent_threads_per_session")
  })

  test("#given multiline string closes after an escaped quote #when updating config #then preserves the following explicit cap", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-mav2-overlapping-closer-"))
    const configPath = join(root, "config.toml")
    await writeFile(
      configPath,
      ['notes = """abc\\\""""', "[features.multi_agent_v2]", "max_concurrent_threads_per_session = 7", ""].join(
        "\n",
      ),
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
    expect(parseToml(content)).toBeDefined()
    expect(content).toContain("[agents]\nmax_threads = 7")
    expect(content).not.toContain("[features.multi_agent_v2]")
    expect(content).not.toContain("max_concurrent_threads_per_session")
  })

  test("#given quoted dotted V2 settings in features #when updating config #then retains supported fields without a conflicting scalar", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-mav2-dotted-supported-"))
    const configPath = join(root, "config.toml")
    await writeFile(
      configPath,
      [
        'model = "gpt-5.5"',
        "",
        "[features]",
        '"multi_agent_v2"."usage_hint_enabled" = false # user setting',
        '"multi_agent_v2"."max_concurrent_threads_per_session" = 8 # obsolete cap',
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
    expect(parseToml(content)).toBeDefined()
    expect(content).toContain('"multi_agent_v2"."usage_hint_enabled" = false # user setting')
    expect(content).toContain("multi_agent_v2.enabled = false")
    expect(content).toContain("[agents]\nmax_threads = 8")
    expect(content).not.toContain("max_concurrent_threads_per_session")
    expect(content).not.toMatch(/^\s*multi_agent_v2\s*=/m)
  })

  test("#given root-dotted V2 scalar and supported setting #when updating config #then removes the conflicting scalar", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-mav2-root-dotted-conflict-"))
    const configPath = join(root, "config.toml")
    await writeFile(
      configPath,
      [
        'model = "gpt-5.5"',
        "features.multi_agent_v2 = true",
        "features.multi_agent_v2.usage_hint_enabled = false",
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
    expect(parseToml(content)).toBeDefined()
    expect(content).toContain("features.multi_agent_v2.usage_hint_enabled = false")
    expect(content).toContain("features.multi_agent_v2.enabled = false")
    expect(content).not.toContain("features.multi_agent_v2 = true")
  })

  test("#given disabled boolean shorthand #when updating config #then explicit disable is preserved as a supported flag", async () => {
    // given
    // A pinned v1 model keeps the explicit disable materializing in table form;
    // the stamped v2-preferred default would drop the disable instead.
    const root = await mkdtemp(join(tmpdir(), "omo-codex-mav2-disabled-shorthand-"))
    const configPath = join(root, "config.toml")
    await writeFile(
      configPath,
      [
        'model = "gpt-5.5"',
        "",
        "[features]",
        "multi_agent_v2 = false # user disabled the beta path",
        "plugins = false",
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
    expect(parseToml(content)).toBeDefined()
    expect(content).toContain("multi_agent_v2 = false # user disabled the beta path")
    expect(content).toContain("[agents]\nmax_threads = 6")
    expect(content).not.toContain("[features.multi_agent_v2]")
  })
})

function parseToml(config: string): unknown {
  return Bun.TOML.parse(config)
}

function sectionText(config: string, header: string): string {
  const start = config.indexOf(header)
  if (start < 0) return ""
  const next = config.indexOf("\n[", start + header.length)
  return next < 0 ? config.slice(start) : config.slice(start, next)
}
