import { parseTomlDottedKey } from "./toml-key-parser.mjs";
import {
	findUnquotedComment,
} from "./toml-lexer.mjs";
import {
	filterTomlSettings,
	findFirstTomlTableStart,
	findRootTomlSetting,
	tomlPathMatches,
	tomlPathStartsWith,
} from "./toml-structure-editor.mjs";

export {
	findTomlSection,
	hasTomlSetting,
	readTomlSectionSettingValue,
	removeTomlSection,
	removeTomlSectionSetting,
	removeUnsupportedTomlSectionDottedSettings,
	removeUnsupportedTomlSectionSettings,
	replaceOrInsertTomlSectionSetting,
} from "./toml-section-operations.mjs";

export function replaceOrInsertRootTomlSetting(config, keyPath, value) {
	const targetPath = parseTomlDottedKey(keyPath);
	if (!targetPath) return config;
	const match = findRootTomlSetting(config, targetPath);
	if (match) {
		const commentIndex = findUnquotedComment(match.lineBody, match.assignmentIndex + 1);
		const comment = commentIndex === -1 ? "" : ` ${match.lineBody.slice(commentIndex).trimStart()}`;
		const replacement = `${match.lineBody.slice(0, match.assignmentIndex + 1)} ${value}${comment}${match.newline}`;
		return config.slice(0, match.offset) + replacement + config.slice(match.offset + match.line.length);
	}
	const firstTable = findFirstTomlTableStart(config);
	const root = config.slice(0, firstTable).trimEnd();
	const suffix = config.slice(firstTable);
	const replacement = `${root}${root.length > 0 ? "\n" : ""}${keyPath} = ${value}\n`;
	if (suffix.length === 0) return replacement;
	return `${replacement.trimEnd()}\n\n${suffix.trimStart()}`;
}

export function readRootTomlSettingValue(config, keyPath) {
	const targetPath = parseTomlDottedKey(keyPath);
	if (!targetPath) return null;
	const match = findRootTomlSetting(config, targetPath);
	if (!match) return null;
	const commentIndex = findUnquotedComment(match.lineBody, match.assignmentIndex + 1);
	const valueEnd = commentIndex === -1 ? match.lineBody.length : commentIndex;
	return match.lineBody.slice(match.assignmentIndex + 1, valueEnd).trim();
}

export function removeUnsupportedRootTomlDottedSettings(config, namespaceKeyPath, allowedLeafKeyPaths) {
	const rootEnd = findFirstTomlTableStart(config);
	const rootSection = {
		start: 0,
		end: rootEnd,
		text: config.slice(0, rootEnd),
	};
	return filterTomlSettings(
		config,
		rootSection,
		(settingPath) => {
			const namespacePath = parseTomlDottedKey(namespaceKeyPath);
			if (!namespacePath || !tomlPathStartsWith(settingPath, namespacePath)) return true;
			const leafPath = settingPath.slice(namespacePath.length);
			return allowedLeafKeyPaths.some((keyPath) => {
				const allowedPath = parseTomlDottedKey(keyPath);
				return allowedPath !== null && tomlPathMatches(leafPath, allowedPath);
			});
		},
		false,
	);
}

export function removeRootTomlSetting(config, keyPath, expectedValue) {
	const targetPath = parseTomlDottedKey(keyPath);
	if (!targetPath) return config;
	const match = findRootTomlSetting(config, targetPath);
	if (!match) return config;
	const commentIndex = findUnquotedComment(match.lineBody, match.assignmentIndex + 1);
	const valueEnd = commentIndex === -1 ? match.lineBody.length : commentIndex;
	if (match.lineBody.slice(match.assignmentIndex + 1, valueEnd).trim() !== expectedValue) return config;
	return config.slice(0, match.offset) + config.slice(match.offset + match.line.length);
}
