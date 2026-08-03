import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { updateCodexConfig } from "./install-dist/install-local.mjs";

const ALWAYS_ON_FEATURES = ["plugins", "codex_hooks", "multi_agent"];
const AUTONOMOUS_PERMISSION_FEATURES = ["unified_exec", "goals"];

test("#given autonomous permissions requested #when script installer updates config #then enables Codex autonomy feature flags", async () => {
	// given
	const root = await mkdtemp(join(tmpdir(), "omo-codex-script-config-autonomous-features-"));
	const configPath = join(root, "config.toml");
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
	);

	// when
	await updateCodexConfig({
		configPath,
		repoRoot: "/repo/packages/omo-codex",
		marketplaceName: "debug",
		marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex" },
		pluginNames: ["omo"],
		autonomousPermissions: true,
	});

	// then
	const content = await readFile(configPath, "utf8");
	assert.match(content, /network_access = "enabled"/);
	for (const featureName of ALWAYS_ON_FEATURES) {
		assert.match(content, new RegExp(`${featureName} = true`));
	}
	for (const featureName of AUTONOMOUS_PERMISSION_FEATURES) {
		assert.match(content, new RegExp(`${featureName} = true`));
	}
});

test("#given autonomous permissions disabled #when script installer updates config #then keeps native Codex feature flags enabled", async () => {
	// given
	const root = await mkdtemp(join(tmpdir(), "omo-codex-script-config-autonomous-features-disabled-"));
	const configPath = join(root, "config.toml");
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
	);

	// when
	await updateCodexConfig({
		configPath,
		repoRoot: "/repo/packages/omo-codex",
		marketplaceName: "debug",
		marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex" },
		pluginNames: ["omo"],
		autonomousPermissions: false,
	});

	// then
	const content = await readFile(configPath, "utf8");
	assert.match(content, /network_access = "disabled"/);
	for (const featureName of ALWAYS_ON_FEATURES) {
		assert.match(content, new RegExp(`${featureName} = true`));
	}
	for (const featureName of AUTONOMOUS_PERMISSION_FEATURES) {
		assert.match(content, new RegExp(`${featureName} = false`));
	}
});

test("#given existing child_agents_md setting #when script installer updates config #then preserves it without stamping unsupported values", async () => {
	// given
	const root = await mkdtemp(join(tmpdir(), "omo-codex-script-config-child-agents-preserve-"));
	const configPath = join(root, "config.toml");
	await writeFile(configPath, ["[features]", "child_agents_md = false", ""].join("\n"));

	// when
	await updateCodexConfig({
		configPath,
		repoRoot: "/repo/packages/omo-codex",
		marketplaceName: "debug",
		marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex" },
		pluginNames: ["omo"],
		autonomousPermissions: true,
	});

	// then
	const content = await readFile(configPath, "utf8");
	assert.match(content, /child_agents_md = false/);
	assert.doesNotMatch(content, /child_agents_md = true/);
});

test("#given config without child_agents_md #when script installer updates config #then does not add unsupported feature key", async () => {
	// given
	const root = await mkdtemp(join(tmpdir(), "omo-codex-script-config-child-agents-absent-"));
	const configPath = join(root, "config.toml");

	// when
	await updateCodexConfig({
		configPath,
		repoRoot: "/repo/packages/omo-codex",
		marketplaceName: "debug",
		marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex" },
		pluginNames: ["omo"],
		autonomousPermissions: true,
	});

	// then
	const content = await readFile(configPath, "utf8");
	assert.doesNotMatch(content, /child_agents_md/);
});

test("#given a legacy plugin_hooks feature table setting #when script installer updates config #then replaces it with Codex 0.120 codex_hooks without touching user neighbors", async () => {
	// given
	const root = await mkdtemp(join(tmpdir(), "omo-codex-script-config-legacy-plugin-hooks-table-"));
	const configPath = join(root, "config.toml");
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
	);

	// when
	const updateInput = {
		configPath,
		repoRoot: "/repo/packages/omo-codex",
		marketplaceName: "debug",
		marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex" },
		pluginNames: ["omo"],
	};
	await updateCodexConfig(updateInput);
	await updateCodexConfig(updateInput);
	const afterSecondUpdate = await readFile(configPath, "utf8");
	await updateCodexConfig(updateInput);

	// then
	const content = await readFile(configPath, "utf8");
	assert.match(content, /codex_hooks = true/);
	assert.doesNotMatch(content, /^\s*(?:"plugin_hooks"|plugin_hooks)\s*=/m);
	assert.match(content, /# plugin_hooks was enabled by an earlier OMO release/);
	assert.match(content, /plugin_hooks_note = false/);
	assert.match(content, /child_agents_md = false/);
	assert.doesNotMatch(afterSecondUpdate, /^\s*(?:"plugin_hooks"|plugin_hooks)\s*=/m);
	assert.equal(content, afterSecondUpdate);
});

test("#given a root dotted legacy plugin_hooks setting #when script installer updates config #then removes only that exact feature path", async () => {
	// given
	const root = await mkdtemp(join(tmpdir(), "omo-codex-script-config-legacy-plugin-hooks-dotted-"));
	const configPath = join(root, "config.toml");
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
	);

	// when
	await updateCodexConfig({
		configPath,
		repoRoot: "/repo/packages/omo-codex",
		marketplaceName: "debug",
		marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex" },
		pluginNames: ["omo"],
	});

	// then
	const content = await readFile(configPath, "utf8");
	assert.match(content, /codex_hooks = true/);
	assert.doesNotMatch(content, /^\s*features\s*\.\s*(?:"plugin_hooks"|plugin_hooks)\s*=/m);
	assert.match(content, /plugin_hooks_note = "preserve this root value"/);
	assert.match(content, /# features.plugin_hooks = true belongs to an old OMO release/);
	assert.match(content, /\[\[user\.hook_history\]\]\nplugin_hooks = true\nlabel = "user-owned array-table field"/);
});

test("#given a multiline legacy plugin_hooks value #when script installer updates config #then removes the whole obsolete assignment and keeps following settings", async () => {
	// given
	const root = await mkdtemp(join(tmpdir(), "omo-codex-script-config-legacy-plugin-hooks-multiline-"));
	const configPath = join(root, "config.toml");
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
	);

	// when
	await updateCodexConfig({
		configPath,
		repoRoot: "/repo/packages/omo-codex",
		marketplaceName: "debug",
		marketplaceSource: { sourceType: "local", source: "/repo/packages/omo-codex" },
		pluginNames: ["omo"],
	});

	// then
	const content = await readFile(configPath, "utf8");
	assert.doesNotMatch(content, /obsolete/);
	assert.doesNotMatch(content, /^\s*plugin_hooks\s*=/m);
	assert.match(content, /plugins = true/);
	assert.match(content, /plugin_hooks_note = false/);
});
