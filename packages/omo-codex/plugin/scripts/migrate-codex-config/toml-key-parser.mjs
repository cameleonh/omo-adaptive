export function parseTomlDottedKey(input) {
	const parts = [];
	let index = 0;
	while (index < input.length) {
		index = skipWhitespace(input, index);
		const parsedKey = parseTomlKeyPart(input, index);
		if (!parsedKey) return null;
		parts.push(parsedKey.value);
		index = skipWhitespace(input, parsedKey.nextIndex);
		if (index === input.length) return parts;
		if (input[index] !== ".") return null;
		index += 1;
	}
	return parts.length > 0 ? parts : null;
}

function parseTomlKeyPart(input, startIndex) {
	const quote = input[startIndex];
	if (quote === "'") return parseLiteralTomlString(input, startIndex);
	if (quote === '"') return parseBasicTomlString(input, startIndex);
	return parseBareTomlKey(input, startIndex);
}

function parseLiteralTomlString(input, startIndex) {
	let index = startIndex + 1;
	let value = "";
	while (index < input.length) {
		const char = input[index];
		if (char === "'") return { value, nextIndex: index + 1 };
		value += char;
		index += 1;
	}
	return null;
}

function parseBasicTomlString(input, startIndex) {
	let index = startIndex + 1;
	let value = "";
	while (index < input.length) {
		const char = input[index];
		if (char === '"') return { value, nextIndex: index + 1 };
		if (char !== "\\") {
			value += char;
			index += 1;
			continue;
		}
		const escaped = parseBasicTomlEscape(input, index);
		if (!escaped) return null;
		value += escaped.value;
		index = escaped.nextIndex;
	}
	return null;
}

function parseBasicTomlEscape(input, backslashIndex) {
	const escape = input[backslashIndex + 1];
	if (escape === undefined) return null;
	if (escape === "b") return { value: "\b", nextIndex: backslashIndex + 2 };
	if (escape === "t") return { value: "\t", nextIndex: backslashIndex + 2 };
	if (escape === "n") return { value: "\n", nextIndex: backslashIndex + 2 };
	if (escape === "f") return { value: "\f", nextIndex: backslashIndex + 2 };
	if (escape === "r") return { value: "\r", nextIndex: backslashIndex + 2 };
	if (escape === '"') return { value: '"', nextIndex: backslashIndex + 2 };
	if (escape === "\\") return { value: "\\", nextIndex: backslashIndex + 2 };
	if (escape === "u") return parseUnicodeEscape(input, backslashIndex + 2, 4);
	if (escape === "U") return parseUnicodeEscape(input, backslashIndex + 2, 8);
	return null;
}

function parseUnicodeEscape(input, digitsStart, digitCount) {
	const digits = input.slice(digitsStart, digitsStart + digitCount);
	if (digits.length !== digitCount || !/^[0-9A-Fa-f]+$/.test(digits)) return null;
	const codePoint = Number.parseInt(digits, 16);
	if (codePoint > 0x10ffff) return null;
	return {
		value: String.fromCodePoint(codePoint),
		nextIndex: digitsStart + digitCount,
	};
}

function parseBareTomlKey(input, startIndex) {
	let index = startIndex;
	while (index < input.length && /[A-Za-z0-9_-]/.test(input[index])) index += 1;
	if (index === startIndex) return null;
	return { value: input.slice(startIndex, index), nextIndex: index };
}

function skipWhitespace(input, startIndex) {
	let index = startIndex;
	while (index < input.length && /\s/.test(input[index])) index += 1;
	return index;
}
