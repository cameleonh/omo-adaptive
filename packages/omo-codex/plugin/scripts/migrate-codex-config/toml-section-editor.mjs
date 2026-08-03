import { parseTomlDottedKey } from "./toml-key-parser.mjs";

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

function tomlTableHeaderMatches(line, targetHeaderPath) {
	if (!targetHeaderPath) return false;
	const candidateHeaderPath = parseTomlTableHeader(line);
	if (!candidateHeaderPath || candidateHeaderPath.length !== targetHeaderPath.length) return false;
	return candidateHeaderPath.every((part, index) => part === targetHeaderPath[index]);
}

function isTomlTableHeaderLine(line) {
	const normalizedLine = stripUnquotedInlineComment(line).trim();
	return normalizedLine.startsWith("[") && normalizedLine.endsWith("]");
}

function scanTomlMultilineLine(line, currentQuote) {
	if (currentQuote) {
		return {
			wasInside: true,
			nextQuote: findTomlMultilineDelimiter(line, currentQuote, 0) === -1 ? currentQuote : null,
		};
	}

	let quote = null;
	let index = 0;
	while (index < line.length) {
		const char = line[index];
		if (quote === '"') {
			if (char === "\\") {
				index += 2;
				continue;
			}
			if (char === '"') quote = null;
			index += 1;
			continue;
		}
		if (quote === "'") {
			if (char === "'") quote = null;
			index += 1;
			continue;
		}
		if (char === "#") break;
		const delimiter = line.startsWith('"""', index) ? '"""' : line.startsWith("'''", index) ? "'''" : null;
		if (delimiter) {
			const closingIndex = findTomlMultilineDelimiter(line, delimiter, index + delimiter.length);
			return {
				wasInside: false,
				nextQuote: closingIndex === -1 ? delimiter : null,
			};
		}
		if (char === '"' || char === "'") quote = char;
		index += 1;
	}
	return { wasInside: false, nextQuote: null };
}

function findTomlMultilineDelimiter(line, delimiter, startIndex) {
	let index = line.indexOf(delimiter, startIndex);
	while (index !== -1) {
		if (delimiter === "'''" || countPrecedingBackslashes(line, index) % 2 === 0) return index;
		index = line.indexOf(delimiter, index + 1);
	}
	return -1;
}

function countPrecedingBackslashes(line, index) {
	let count = 0;
	let cursor = index - 1;
	while (cursor >= 0 && line[cursor] === "\\") {
		count += 1;
		cursor -= 1;
	}
	return count;
}

function findRootTomlSetting(config, targetPath) {
	const lines = config.match(/[^\n]*\n?|$/g) ?? [];
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
		if (isTomlTableHeaderLine(line)) break;
		const assignmentIndex = findUnquotedAssignment(line);
		if (assignmentIndex >= 0) {
			const settingPath = parseTomlDottedKey(line.slice(0, assignmentIndex).trim());
			if (settingPath && tomlPathMatches(settingPath, targetPath)) {
				const newline = line.endsWith("\n") ? "\n" : "";
				return {
					line,
					lineBody: newline ? line.slice(0, -1) : line,
					newline,
					offset,
					assignmentIndex,
				};
			}
		}
		offset += line.length;
	}
	return null;
}

function findFirstTomlTableStart(config) {
	const lines = config.match(/[^\n]*\n?|$/g) ?? [];
	let offset = 0;
	let multilineQuote = null;
	for (const line of lines) {
		if (line.length === 0) break;
		const multilineScan = scanTomlMultilineLine(line, multilineQuote);
		multilineQuote = multilineScan.nextQuote;
		if (!multilineScan.wasInside && isTomlTableHeaderLine(line)) return offset;
		offset += line.length;
	}
	return config.length;
}

function findUnquotedComment(line, startIndex) {
	let quote = null;
	let index = startIndex;
	while (index < line.length) {
		const char = line[index];
		if (quote === '"') {
			if (char === "\\") {
				index += 2;
				continue;
			}
			if (char === '"') quote = null;
			index += 1;
			continue;
		}
		if (quote === "'") {
			if (char === "'") quote = null;
			index += 1;
			continue;
		}
		if (char === '"' || char === "'") quote = char;
		else if (char === "#") return index;
		index += 1;
	}
	return -1;
}

function tomlPathMatches(candidate, target) {
	return candidate.length === target.length && candidate.every((part, index) => part === target[index]);
}

function tomlPathStartsWith(candidate, prefix) {
	return candidate.length >= prefix.length && prefix.every((part, index) => part === candidate[index]);
}

function filterTomlSettings(config, section, shouldKeep, hasHeader = true) {
	const lines = section.text.match(/[^\n]*\n?|$/g) ?? [];
	let output = "";
	let multilineQuote = null;
	let keepMultilineValue = true;
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		if (line.length === 0) break;
		if (hasHeader && index === 0) {
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
			keepMultilineValue = settingPath === null || shouldKeep(settingPath);
			if (keepMultilineValue) output += line;
			continue;
		}
		keepMultilineValue = true;
		output += line;
	}
	return config.slice(0, section.start) + output + config.slice(section.end);
}

function replaceTomlAssignmentValue(line, assignmentIndex, value) {
	const newline = line.endsWith("\n") ? "\n" : "";
	const lineBody = newline ? line.slice(0, -1) : line;
	const commentIndex = findUnquotedComment(lineBody, assignmentIndex + 1);
	const comment = commentIndex === -1 ? "" : ` ${lineBody.slice(commentIndex).trimStart()}`;
	return `${lineBody.slice(0, assignmentIndex + 1)} ${value}${comment}${newline}`;
}

function parseTomlTableHeader(line) {
	const normalizedLine = stripUnquotedInlineComment(line).trim();
	if (!normalizedLine.startsWith("[") || !normalizedLine.endsWith("]") || normalizedLine.startsWith("[[")) {
		return null;
	}
	return parseTomlDottedKey(normalizedLine.slice(1, -1).trim());
}

function stripUnquotedInlineComment(line) {
	let quote = null;
	let index = 0;
	while (index < line.length) {
		const char = line[index];
		if (quote === '"') {
			if (char === "\\") {
				index += 2;
				continue;
			}
			if (char === '"') quote = null;
			index += 1;
			continue;
		}
		if (quote === "'") {
			if (char === "'") quote = null;
			index += 1;
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
			index += 1;
			continue;
		}
		if (char === "#") return line.slice(0, index);
		index += 1;
	}
	return line;
}

function findUnquotedAssignment(line) {
	let quote = null;
	let index = 0;
	while (index < line.length) {
		const char = line[index];
		if (quote === '"') {
			if (char === "\\") {
				index += 2;
				continue;
			}
			if (char === '"') quote = null;
			index += 1;
			continue;
		}
		if (quote === "'") {
			if (char === "'") quote = null;
			index += 1;
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
			index += 1;
			continue;
		}
		if (char === "=") return index;
		index += 1;
	}
	return -1;
}
