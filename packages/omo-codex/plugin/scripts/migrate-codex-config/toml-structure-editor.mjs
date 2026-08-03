import { parseTomlDottedKey } from "./toml-key-parser.mjs";
import {
	findUnquotedAssignment,
	findUnquotedComment,
	isTomlTableHeaderLine,
	parseTomlTableHeader,
	scanTomlMultilineLine,
} from "./toml-lexer.mjs";

export function tomlTableHeaderMatches(line, targetHeaderPath) {
	if (!targetHeaderPath) return false;
	const candidateHeaderPath = parseTomlTableHeader(line);
	if (!candidateHeaderPath || candidateHeaderPath.length !== targetHeaderPath.length) return false;
	return candidateHeaderPath.every((part, index) => part === targetHeaderPath[index]);
}

export function findRootTomlSetting(config, targetPath) {
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

export function findFirstTomlTableStart(config) {
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

export function tomlPathMatches(candidate, target) {
	return candidate.length === target.length && candidate.every((part, index) => part === target[index]);
}

export function tomlPathStartsWith(candidate, prefix) {
	return candidate.length >= prefix.length && prefix.every((part, index) => part === candidate[index]);
}

export function filterTomlSettings(config, section, shouldKeep, hasHeader = true) {
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

export function replaceTomlAssignmentValue(line, assignmentIndex, value) {
	const newline = line.endsWith("\n") ? "\n" : "";
	const lineBody = newline ? line.slice(0, -1) : line;
	const commentIndex = findUnquotedComment(lineBody, assignmentIndex + 1);
	const comment = commentIndex === -1 ? "" : ` ${lineBody.slice(commentIndex).trimStart()}`;
	return `${lineBody.slice(0, assignmentIndex + 1)} ${value}${comment}${newline}`;
}
