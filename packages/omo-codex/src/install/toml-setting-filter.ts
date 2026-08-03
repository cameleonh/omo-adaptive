import {
  findUnquotedAssignment,
  isTomlTableHeaderLine,
  parseTomlDottedKey,
  parseTomlTableHeader,
  scanTomlMultilineLine,
  type TomlMultilineQuote,
} from "./toml-section-editor"

export function removeTomlSetting(config: string, keyPath: string): string {
  const targetPath = parseTomlDottedKey(keyPath)
  if (!targetPath) return config

  const retained: string[] = []
  let tablePath: readonly string[] | null = []
  let multilineQuote: TomlMultilineQuote | null = null
  let retainMultilineValue = true

  for (const line of config.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    const multilineScan = scanTomlMultilineLine(line, multilineQuote)
    multilineQuote = multilineScan.nextQuote
    if (multilineScan.wasInside) {
      if (retainMultilineValue) retained.push(line)
      continue
    }

    const nextTablePath = parseTomlTableHeader(line)
    if (nextTablePath || isTomlTableHeaderLine(line)) {
      tablePath = nextTablePath
      retained.push(line)
      continue
    }
    if (!tablePath) {
      retained.push(line)
      continue
    }

    const assignmentIndex = findUnquotedAssignment(line)
    const settingPath = assignmentIndex < 0 ? null : parseTomlDottedKey(line.slice(0, assignmentIndex).trim())
    const fullPath = settingPath ? [...tablePath, ...settingPath] : []
    retainMultilineValue = !pathsMatch(fullPath, targetPath)
    if (retainMultilineValue) retained.push(line)
  }

  return retained.join("")
}

function pathsMatch(candidate: readonly string[], target: readonly string[]): boolean {
  return candidate.length === target.length && candidate.every((part, index) => part === target[index])
}
