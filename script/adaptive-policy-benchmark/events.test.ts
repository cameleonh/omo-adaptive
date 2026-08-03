import { describe, expect, test } from "bun:test"
import { deriveEvents, evaluateVerificationExpectation } from "./events"

describe("adaptive benchmark verification events", () => {
  test("#given a completed verification command with nonzero exit #when events are derived #then expectation remains unsatisfied", () => {
    const events = deriveEvents(JSON.stringify({ type: "item.completed", item: { id: "verify", type: "command_execution", command: "bun test", status: "completed", exit_code: 1 } }))
    const expectation = evaluateVerificationExpectation(["bun test"], events.verificationEvents)
    expect(events.verificationEvents[0]?.status).toBe("failed")
    expect(expectation.satisfied).toBe(false)
  })

  test("#given a completed verification command without an exit code #when events are derived #then its result is unknown", () => {
    const events = deriveEvents(JSON.stringify({ type: "item.completed", item: { id: "verify", type: "command_execution", command: "bun test", status: "completed" } }))
    const expectation = evaluateVerificationExpectation(["bun test"], events.verificationEvents)
    expect(events.verificationEvents[0]?.status).toBe("unknown")
    expect(expectation.satisfied).toBe(false)
  })
})
