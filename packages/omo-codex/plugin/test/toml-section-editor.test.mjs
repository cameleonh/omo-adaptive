import assert from "node:assert/strict";
import test from "node:test";

import * as editor from "../scripts/migrate-codex-config/toml-section-editor.mjs";

test("#given the runtime TOML editor facade #when imported #then it exposes exactly the 12 named operations", () => {
	assert.deepEqual(Object.keys(editor).sort(), [
		"findTomlSection",
		"hasTomlSetting",
		"readRootTomlSettingValue",
		"readTomlSectionSettingValue",
		"removeRootTomlSetting",
		"removeTomlSection",
		"removeTomlSectionSetting",
		"removeUnsupportedRootTomlDottedSettings",
		"removeUnsupportedTomlSectionDottedSettings",
		"removeUnsupportedTomlSectionSettings",
		"replaceOrInsertRootTomlSetting",
		"replaceOrInsertTomlSectionSetting",
	].sort());
	assert.equal(Object.hasOwn(editor, "default"), false);
});

test("#given equivalent quoted and spaced table headers plus a multiline lookalike #when finding the section #then only the semantic table is returned", () => {
	for (const header of [
		'["features"."multi_agent_v2"]',
		"[ features . multi_agent_v2 ]",
		'["features"."multi_agent_v\\u0032"]',
	]) {
		const config = ['notes = """', "[features.multi_agent_v2]", '"""', header, "enabled = true", "", "[agents]", "max_threads = 6", ""].join("\n");

		const section = editor.findTomlSection(config, "[features.multi_agent_v2]");

		assert.ok(section);
		assert.equal(section.start, config.indexOf(header));
		assert.equal(section.text, `${header}\nenabled = true\n\n`);
	}
});

test("#given root table dotted quoted and assignment-like keys #when checking semantic settings #then each valid path is found and malformed paths are false", () => {
	const config = [
		"root_value = 1",
		'"root.quoted" = 2',
		'"a=b" = "value # literal"',
		"features.multi_agent_v2.enabled = true",
		"",
		"[agents]",
		'"max_threads" = 6',
		"",
	].join("\n");

	assert.equal(editor.hasTomlSetting(config, "root_value"), true);
	assert.equal(editor.hasTomlSetting(config, '"root.quoted"'), true);
	assert.equal(editor.hasTomlSetting(config, '"a=b"'), true);
	assert.equal(editor.hasTomlSetting(config, "features.multi_agent_v2.enabled"), true);
	assert.equal(editor.hasTomlSetting(config, "agents.max_threads"), true);
	assert.equal(editor.hasTomlSetting(config, '"unterminated'), false);
	assert.equal(editor.hasTomlSetting(config, '"invalid\\q"'), false);
});

test("#given a section with an inline comment and an absent setting #when replacing and inserting twice #then comments remain and the second pass is byte-identical", () => {
	const config = ["[features.multi_agent_v2]", "enabled = true # tuned by me", "", "[agents]", "max_threads = 6", ""].join("\n");
	const section = editor.findTomlSection(config, "[features.multi_agent_v2]");
	assert.ok(section);

	const replaced = editor.replaceOrInsertTomlSectionSetting(config, section, "enabled", "false");
	const replacedSection = editor.findTomlSection(replaced, "[features.multi_agent_v2]");
	assert.ok(replacedSection);
	const inserted = editor.replaceOrInsertTomlSectionSetting(replaced, replacedSection, "usage_hint_enabled", "false");
	const insertedSection = editor.findTomlSection(inserted, "[features.multi_agent_v2]");
	assert.ok(insertedSection);
	const secondPass = editor.replaceOrInsertTomlSectionSetting(inserted, insertedSection, "usage_hint_enabled", "false");

	assert.match(inserted, /^enabled = false # tuned by me$/m);
	assert.equal(secondPass, inserted);
	assert.equal(editor.replaceOrInsertTomlSectionSetting(config, section, '"invalid\\q"', "false"), config);
});

test("#given a section setting and expected values #when reading or removing it #then only an exact expected value removes the line", () => {
	const config = ["[agents]", "max_threads = 6 # user cap", "max_depth = 4", ""].join("\n");
	const section = editor.findTomlSection(config, "[agents]");
	assert.ok(section);

	assert.equal(editor.readTomlSectionSettingValue(section, "max_threads"), "6");
	assert.equal(editor.readTomlSectionSettingValue(section, '"unterminated'), null);
	assert.equal(editor.removeTomlSectionSetting(config, section, "max_threads", "7"), config);
	assert.equal(editor.removeTomlSectionSetting(config, section, '"invalid\\q"', "6"), config);
	assert.equal(editor.removeTomlSectionSetting(config, section, "max_threads", "6"), "[agents]\nmax_depth = 4\n");
});

test("#given allowed settings comments and a rejected multiline assignment #when filtering the section #then the whole rejected value is removed and surrounding content remains", () => {
	const config = [
		"[features.multi_agent_v2]",
		"# keep this comment",
		"enabled = true",
		'obsolete = """',
		"[agents]",
		"max_threads = 99",
		'"""',
		"# keep the trailing comment",
		"usage_hint_enabled = false",
		"",
	].join("\n");
	const section = editor.findTomlSection(config, "[features.multi_agent_v2]");
	assert.ok(section);

	const filtered = editor.removeUnsupportedTomlSectionSettings(config, section, ["enabled", "usage_hint_enabled"]);

	assert.equal(filtered, ["[features.multi_agent_v2]", "# keep this comment", "enabled = true", "# keep the trailing comment", "usage_hint_enabled = false", ""].join("\n"));
	assert.equal(editor.removeUnsupportedTomlSectionSettings(config, section, ['"invalid\\q"']), ["[features.multi_agent_v2]", "# keep this comment", "# keep the trailing comment", ""].join("\n"));
});

test("#given root and table settings with comments #when reading replacing and removing the root key #then edits stop at the first table boundary", () => {
	const config = ["max_threads = 4 # root cap", "", "[agents]", "max_threads = 9 # table cap", ""].join("\n");

	assert.equal(editor.readRootTomlSettingValue(config, "max_threads"), "4");
	assert.equal(editor.readRootTomlSettingValue(config, '"unterminated'), null);
	const replaced = editor.replaceOrInsertRootTomlSetting(config, "max_threads", "6");
	assert.equal(replaced, ["max_threads = 6 # root cap", "", "[agents]", "max_threads = 9 # table cap", ""].join("\n"));
	assert.equal(editor.replaceOrInsertRootTomlSetting(replaced, "max_threads", "6"), replaced);
	assert.equal(editor.replaceOrInsertRootTomlSetting(config, '"invalid\\q"', "6"), config);
	assert.equal(editor.removeRootTomlSetting(replaced, "max_threads", "7"), replaced);
	assert.equal(editor.removeRootTomlSetting(replaced, "max_threads", "6"), ["", "[agents]", "max_threads = 9 # table cap", ""].join("\n"));
});

test("#given dotted root and section settings #when filtering twice #then only allowed leaves remain and the second pass is byte-identical", () => {
	const config = [
		'features.multi_agent_v2.enabled = true # keep root',
		"features.multi_agent_v2.show_tool_use = false",
		"root_other = true",
		"",
		"[features]",
		'multi_agent_v2.usage_hint_text = "keep # literal"',
		"multi_agent_v2.show_tool_use = false",
		"plugins = true",
		"",
	].join("\n");

	const rootFiltered = editor.removeUnsupportedRootTomlDottedSettings(config, "features.multi_agent_v2", ["enabled"]);
	const section = editor.findTomlSection(rootFiltered, "[features]");
	assert.ok(section);
	const filtered = editor.removeUnsupportedTomlSectionDottedSettings(rootFiltered, section, "multi_agent_v2", ["usage_hint_text"]);
	const secondSection = editor.findTomlSection(filtered, "[features]");
	assert.ok(secondSection);
	const secondPass = editor.removeUnsupportedTomlSectionDottedSettings(
		editor.removeUnsupportedRootTomlDottedSettings(filtered, "features.multi_agent_v2", ["enabled"]),
		secondSection,
		"multi_agent_v2",
		["usage_hint_text"],
	);

	assert.match(filtered, /^features\.multi_agent_v2\.enabled = true # keep root$/m);
	assert.doesNotMatch(filtered, /show_tool_use/);
	assert.match(filtered, /^root_other = true$/m);
	assert.match(filtered, /^multi_agent_v2\.usage_hint_text = "keep # literal"$/m);
	assert.match(filtered, /^plugins = true$/m);
	assert.equal(secondPass, filtered);
	assert.equal(editor.removeUnsupportedRootTomlDottedSettings(config, '"invalid\\q"', []), config);
	assert.equal(editor.removeUnsupportedTomlSectionDottedSettings(config, editor.findTomlSection(config, "[features]"), '"invalid\\q"', []), config);
});
