export type ToolCall = {
  readonly sequence: number
  readonly id: string | null
  readonly kind: string
  readonly name: string
  readonly status: string | null
  readonly exitCode: number | null
}

export type VerificationEvent = {
  readonly sequence: number
  readonly source: string
  readonly status: "passed" | "failed" | "unknown"
}

export type DerivedEvents = {
  readonly toolCalls: readonly ToolCall[]
  readonly subagentCount: number
  readonly verificationEvents: readonly VerificationEvent[]
  readonly invalidLineCount: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === "string" ? value : null
}

function eventItem(event: Record<string, unknown>): Record<string, unknown> | null {
  return isRecord(event.item) ? event.item : event
}

function toolName(item: Record<string, unknown>): string {
  return readString(item, "tool") ?? readString(item, "name") ?? readString(item, "command") ?? "unknown"
}

export function deriveEvents(rawNdjson: string): DerivedEvents {
  const toolCalls: ToolCall[] = []
  const toolIndexes = new Map<string, number>()
  let invalidLineCount = 0
  for (const line of rawNdjson.split(/\r?\n/u).filter(Boolean)) {
    let parsed: unknown
    try { parsed = JSON.parse(line) } catch { invalidLineCount += 1; continue }
    if (!isRecord(parsed)) continue
    const item = eventItem(parsed)
    if (item === null) continue
    const kind = readString(item, "type") ?? "unknown"
    if (!/(command_execution|mcp_tool_call|function_call|tool_call)/u.test(kind)) continue
    const id = readString(item, "id")
    const name = toolName(item)
    const status = readString(item, "status")
    const exitCode = typeof item.exit_code === "number" ? item.exit_code : null
    const existingIndex = id === null ? undefined : toolIndexes.get(id)
    if (existingIndex === undefined) {
      const sequence = toolCalls.length + 1
      toolCalls.push({ sequence, id, kind, name, status, exitCode })
      if (id !== null) toolIndexes.set(id, toolCalls.length - 1)
    } else {
      const previous = toolCalls[existingIndex]
      if (previous !== undefined) toolCalls[existingIndex] = { sequence: previous.sequence, id, kind, name, status, exitCode }
    }
  }
  const verificationEvents = toolCalls.filter((call) => /(test|typecheck|lint|check|verify|build)/iu.test(call.name)).map((call) => ({
    sequence: call.sequence,
    source: call.name,
    status: call.exitCode !== null ? call.exitCode === 0 ? "passed" : "failed" : call.status === "failed" ? "failed" : "unknown",
  } satisfies VerificationEvent))
  const subagentCount = toolCalls.filter((call) => /(^|[/:.])spawn_agent$/iu.test(call.name) || /collaboration.*spawn/iu.test(call.name)).length
  return { toolCalls, subagentCount, verificationEvents, invalidLineCount }
}

export function evaluateVerificationExpectation(patterns: readonly string[], events: readonly VerificationEvent[]): {
  readonly patterns: readonly string[]
  readonly matched: readonly VerificationEvent[]
  readonly satisfied: boolean
} {
  const matched = patterns.flatMap((pattern) => events.filter((event) => event.status === "passed" && event.source.toLowerCase().includes(pattern.toLowerCase())))
  return { patterns, matched, satisfied: patterns.every((pattern) => matched.some((event) => event.source.toLowerCase().includes(pattern.toLowerCase()))) }
}
