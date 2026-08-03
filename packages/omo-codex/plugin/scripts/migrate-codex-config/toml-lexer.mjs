import { parseTomlDottedKey } from "./toml-key-parser.mjs";

export function isTomlTableHeaderLine(line) {
	const normalizedLine = stripUnquotedInlineComment(line).trim();
	return normalizedLine.startsWith("[") && normalizedLine.endsWith("]");
}

export function scanTomlMultilineLine(line, currentQuote) {
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

export function findUnquotedComment(line, startIndex) {
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

export function parseTomlTableHeader(line) {
	const normalizedLine = stripUnquotedInlineComment(line).trim();
	if (!normalizedLine.startsWith("[") || !normalizedLine.endsWith("]") || normalizedLine.startsWith("[[")) {
		return null;
	}
	return parseTomlDottedKey(normalizedLine.slice(1, -1).trim());
}

export function stripUnquotedInlineComment(line) {
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

export function findUnquotedAssignment(line) {
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
