import { parseTomlDottedKey } from "./toml-key-parser.mjs";
import {
	findUnquotedAssignment,
	findUnquotedComment,
	isTomlTableHeaderLine,
	parseTomlTableHeader,
	scanTomlMultilineLine,
	stripUnquotedInlineComment,
} from "./toml-lexer.mjs";
import {
	filterTomlSettings,
	findFirstTomlTableStart,
	findRootTomlSetting,
	replaceTomlAssignmentValue,
	tomlPathMatches,
	tomlPathStartsWith,
	tomlTableHeaderMatches,
} from "./toml-structure-editor.mjs";

export function findTomlSection(config, headerLine) {
	const targetHeaderPath = parseTomlTableHeader(headerLine);
	const lines = config.match(/[^\n]*\n?|$/g) ?? [];
	let offset = 0;
	let start = -1;
	let multilineQuote = null;
	for (const line of lines) {
		if (line.length === 0) break;
		const multilineScan = scanTomlMultilineLine(line, multilineQuote);
		multilineQuote = multilineScan.nextQuote;
		if (multilineScan.wasInside) {
			offset += line.length;
			continue;
		}
		if (start === -1) {
			if (tomlTableHeaderMatches(line, targetHeaderPath)) start = offset;
		} else if (isTomlTableHeaderLine(line)) {
			return { start, end: offset, text: config.slice(start, offset) };
		}
		offset += line.length;
	}
	if (start === -1) return null;
	return { start, end: config.length, text: config.slice(start) };
}

export function hasTomlSetting(config, keyPath) {
	const targetPath = parseTomlDottedKey(keyPath);
	if (!targetPath) return false;

	let tablePath = [];
	let multilineQuote = null;
	for (const line of config.split("\n")) {
		const multilineScan = scanTomlMultilineLine(line, multilineQuote);
		multilineQuote = multilineScan.nextQuote;
		if (multilineScan.wasInside) continue;
		const normalizedLine = stripUnquotedInlineComment(line).trim();
		if (normalizedLine.length === 0) continue;

		const headerPath = parseTomlTableHeader(normalizedLine);
		if (headerPath) {
			tablePath = headerPath;
			continue;
		}
		if (isTomlTableHeaderLine(normalizedLine)) {
			tablePath = null;
			continue;
		}
		if (!tablePath) continue;

		const assignmentIndex = findUnquotedAssignment(normalizedLine);
		if (assignmentIndex < 0) continue;
		const settingPath = parseTomlDottedKey(normalizedLine.slice(0, assignmentIndex).trim());
		if (!settingPath) continue;
		const fullPath = [...tablePath, ...settingPath];
		if (fullPath.length !== targetPath.length) continue;
		if (fullPath.every((part, index) => part === targetPath[index])) return true;
	}
	return false;
}

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

export function replaceOrInsertTomlSectionSetting(config, section, keyPath, value) {
	const targetPath = parseTomlDottedKey(keyPath);
	if (!targetPath) return config;
	const lines = section.text.match(/[^\n]*\n?|$/g) ?? [];
	let offset = 0;
	let multilineQuote = null;
	for (const line of lines) {
		if (line.length === 0) break;
		const multilineScan = scanTomlMultilineLine(line, multilineQuote);
		multilineQuote = multilineScan.nextQuote;
		if (multilineScan.wasInside) {
			offset += line.length;
			continue;
		}
		const assignmentIndex = findUnquotedAssignment(line);
		if (assignmentIndex >= 0) {
			const settingPath = parseTomlDottedKey(line.slice(0, assignmentIndex).trim());
			if (settingPath && tomlPathMatches(settingPath, targetPath)) {
				const replacement = replaceTomlAssignmentValue(line, assignmentIndex, value);
				const patched = section.text.slice(0, offset) + replacement + section.text.slice(offset + line.length);
				return config.slice(0, section.start) + patched + config.slice(section.end);
			}
		}
		offset += line.length;
	}
	const headerEnd = section.text.indexOf("\n");
	const insertAt = headerEnd === -1 ? section.text.length : headerEnd + 1;
	const patched = `${section.text.slice(0, insertAt)}${headerEnd === -1 ? "\n" : ""}${keyPath} = ${value}\n${section.text.slice(insertAt)}`;
	return config.slice(0, section.start) + patched + config.slice(section.end);
}

export function removeTomlSectionSetting(config, section, keyPath, expectedValue) {
	const targetPath = parseTomlDottedKey(keyPath);
	if (!targetPath) return config;
	const lines = section.text.match(/[^\n]*\n?|$/g) ?? [];
	let offset = 0;
	let multilineQuote = null;
	for (const line of lines) {
		if (line.length === 0) break;
		const multilineScan = scanTomlMultilineLine(line, multilineQuote);
		multilineQuote = multilineScan.nextQuote;
		if (multilineScan.wasInside) {
			offset += line.length;
			continue;
		}
		const assignmentIndex = findUnquotedAssignment(line);
		if (assignmentIndex >= 0) {
			const settingPath = parseTomlDottedKey(line.slice(0, assignmentIndex).trim());
			if (settingPath && tomlPathMatches(settingPath, targetPath)) {
				const lineBody = line.endsWith("\n") ? line.slice(0, -1) : line;
				const commentIndex = findUnquotedComment(lineBody, assignmentIndex + 1);
				const valueEnd = commentIndex === -1 ? lineBody.length : commentIndex;
				if (lineBody.slice(assignmentIndex + 1, valueEnd).trim() !== expectedValue) return config;
				const patched = section.text.slice(0, offset) + section.text.slice(offset + line.length);
				return config.slice(0, section.start) + patched + config.slice(section.end);
			}
		}
		offset += line.length;
	}
	return config;
}

export function readTomlSectionSettingValue(section, keyPath) {
	const targetPath = parseTomlDottedKey(keyPath);
	if (!targetPath) return null;
	const lines = section.text.match(/[^\n]*\n?|$/g) ?? [];
	let multilineQuote = null;
	for (const line of lines) {
		if (line.length === 0) break;
		const multilineScan = scanTomlMultilineLine(line, multilineQuote);
		multilineQuote = multilineScan.nextQuote;
		if (multilineScan.wasInside) continue;
		const assignmentIndex = findUnquotedAssignment(line);
		if (assignmentIndex < 0) continue;
		const settingPath = parseTomlDottedKey(line.slice(0, assignmentIndex).trim());
		if (!settingPath || !tomlPathMatches(settingPath, targetPath)) continue;
		const lineBody = line.endsWith("\n") ? line.slice(0, -1) : line;
		const commentIndex = findUnquotedComment(lineBody, assignmentIndex + 1);
		const valueEnd = commentIndex === -1 ? lineBody.length : commentIndex;
		return lineBody.slice(assignmentIndex + 1, valueEnd).trim();
	}
	return null;
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

export function removeTomlSection(config, section) {
	return `${config.slice(0, section.start)}${config.slice(section.end).replace(/^\n+/, "")}`;
}

export function removeUnsupportedTomlSectionSettings(config, section, allowedKeyPaths) {
	const allowedPaths = allowedKeyPaths.map(parseTomlDottedKey).filter((path) => path !== null);
	const lines = section.text.match(/[^\n]*\n?|$/g) ?? [];
	let output = "";
	let multilineQuote = null;
	let keepMultilineValue = true;
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		if (line.length === 0) break;
		if (index === 0) {
			output += line;
			continue;
		}
		const multilineScan = scanTomlMultilineLine(line, multilineQuote);
		multilineQuote = multilineScan.nextQuote;
		if (multilineScan.wasInside) {
			if (keepMultilineValue) output += line;
			continue;
		}
		const assignmentIndex = findUnquotedAssignment(line);
		if (assignmentIndex >= 0) {
			const settingPath = parseTomlDottedKey(line.slice(0, assignmentIndex).trim());
			keepMultilineValue = settingPath !== null && allowedPaths.some((allowed) => tomlPathMatches(settingPath, allowed));
			if (keepMultilineValue) output += line;
			continue;
		}
		keepMultilineValue = true;
		output += line;
	}
	return config.slice(0, section.start) + output + config.slice(section.end);
}

export function removeUnsupportedTomlSectionDottedSettings(config, section, namespaceKeyPath, allowedLeafKeyPaths) {
	const namespacePath = parseTomlDottedKey(namespaceKeyPath);
	if (!namespacePath) return config;
	return filterTomlSettings(config, section, (settingPath) => {
		if (!tomlPathStartsWith(settingPath, namespacePath)) return true;
		const leafPath = settingPath.slice(namespacePath.length);
		return allowedLeafKeyPaths.some((keyPath) => {
			const allowedPath = parseTomlDottedKey(keyPath);
			return allowedPath !== null && tomlPathMatches(leafPath, allowedPath);
		});
	});
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
