/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { updateCodexConfig } from "./codex-config-toml"

const ALWAYS_ON_FEATURES = ["plugins", "codex_hooks", "multi_agent"] as const
const AUTONOMOUS_PERMISSION_FEATURES = ["unified_exec", "goals"] as const

describe("codex-config autonomous features", () => {
  test("#given autonomous permissions requested #when updating config #then enables Codex autonomy feature flags", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-config-autonomous-features-"))
    const configPath = join(root, "config.toml")
    await writeFile(
      configPath,
      [
        'network_access = "disabled"',
        "",
        "[features]",
        "multi_agent = false",
        "unified_exec = false",
        "goals = false",
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
      autonomousPermissions: true,
    })

    // then
    const content = await readFile(configPath, "utf8")
    expect(content).toContain('network_access = "enabled"')
    for (const featureName of ALWAYS_ON_FEATURES) {
      expect(content).toContain(`${featureName} = true`)
    }
    for (const featureName of AUTONOMOUS_PERMISSION_FEATURES) {
      expect(content).toContain(`${featureName} = true`)
    }
  })

  test("#given autonomous permissions disabled #when updating config #then keeps native Codex feature flags enabled", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-config-autonomous-features-disabled-"))
    const configPath = join(root, "config.toml")
    await writeFile(
      configPath,
      [
        'network_access = "disabled"',
        "",
        "[features]",
        "multi_agent = false",
        "unified_exec = false",
        "goals = false",
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
      autonomousPermissions: false,
    })

    // then
    const content = await readFile(configPath, "utf8")
    expect(content).toContain('network_access = "disabled"')
    for (const featureName of ALWAYS_ON_FEATURES) {
      expect(content).toContain(`${featureName} = true`)
    }
    for (const featureName of AUTONOMOUS_PERMISSION_FEATURES) {
      expect(content).toContain(`${featureName} = false`)
    }
  })

  test("#given existing child_agents_md setting #when updating config #then preserves it without stamping unsupported values", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-config-child-agents-preserve-"))
    const configPath = join(root, "config.toml")
    await writeFile(configPath, ["[features]", "child_agents_md = false", ""].join("\n"))

    // when
    await updateCodexConfig({
      configPath,
      repoRoot: "/repo/packages/omo-codex",
      marketplaceName: "debug",
      marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex" },
      pluginNames: ["omo"],
      autonomousPermissions: true,
    })

    // then
    const content = await readFile(configPath, "utf8")
    expect(content).toContain("child_agents_md = false")
    expect(content).not.toContain("child_agents_md = true")
  })

  test("#given config without child_agents_md #when updating config #then does not add unsupported feature key", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-config-child-agents-absent-"))
    const configPath = join(root, "config.toml")

    // when
    await updateCodexConfig({
      configPath,
      repoRoot: "/repo/packages/omo-codex",
      marketplaceName: "debug",
      marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex" },
      pluginNames: ["omo"],
      autonomousPermissions: true,
    })

    // then
    const content = await readFile(configPath, "utf8")
    expect(content).not.toContain("child_agents_md")
  })

  test("#given a legacy plugin_hooks feature table setting #when updating config #then replaces it with Codex 0.120 codex_hooks without touching user neighbors", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-config-legacy-plugin-hooks-table-"))
    const configPath = join(root, "config.toml")
    await writeFile(
      configPath,
      [
        '["features"] # migration note contains ]',
        "# plugin_hooks was enabled by an earlier OMO release",
        "plugin_hooks = true # obsolete Codex key",
        "plugin_hooks_note = false",
        "child_agents_md = false",
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
    const afterFirstUpdate = await readFile(configPath, "utf8")
    await updateCodexConfig({
      configPath,
      repoRoot: "/repo/packages/omo-codex",
      marketplaceName: "debug",
      marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex" },
      pluginNames: ["omo"],
    })
    const afterSecondUpdate = await readFile(configPath, "utf8")
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
    expect(content).not.toMatch(/^\s*(?:"plugin_hooks"|plugin_hooks)\s*=/m)
    expect(content).toContain("# plugin_hooks was enabled by an earlier OMO release")
    expect(content).toContain("plugin_hooks_note = false")
    expect(content).toContain("child_agents_md = false")
    expect(afterFirstUpdate).not.toMatch(/^\s*(?:"plugin_hooks"|plugin_hooks)\s*=/m)
    expect(content).toBe(afterSecondUpdate)
  })

  test("#given a root dotted legacy plugin_hooks setting #when updating config #then removes only that exact feature path", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-config-legacy-plugin-hooks-dotted-"))
    const configPath = join(root, "config.toml")
    await writeFile(
      configPath,
      [
        'features."plugin_hooks" = true',
        'plugin_hooks_note = "preserve this root value"',
        "# features.plugin_hooks = true belongs to an old OMO release",
        "",
        "[[user.hook_history]]",
        "plugin_hooks = true",
        'label = "user-owned array-table field"',
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
    expect(content).toContain("codex_hooks = true")
    expect(content).not.toMatch(/^\s*features\s*\.\s*(?:"plugin_hooks"|plugin_hooks)\s*=/m)
    expect(content).toContain('plugin_hooks_note = "preserve this root value"')
    expect(content).toContain("# features.plugin_hooks = true belongs to an old OMO release")
    expect(content).toContain('[[user.hook_history]]\nplugin_hooks = true\nlabel = "user-owned array-table field"')
  })

  test("#given a multiline legacy plugin_hooks value #when updating config #then removes the whole obsolete assignment and keeps following settings", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-config-legacy-plugin-hooks-multiline-"))
    const configPath = join(root, "config.toml")
    await writeFile(
      configPath,
      [
        "[features]",
        'plugin_hooks = """',
        "obsolete",
        '"""',
        "plugins = false",
        "plugin_hooks_note = false",
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
    expect(content).not.toContain("obsolete")
    expect(content).not.toMatch(/^\s*plugin_hooks\s*=/m)
    expect(content).toContain("plugins = true")
    expect(content).toContain("plugin_hooks_note = false")
  })
})
