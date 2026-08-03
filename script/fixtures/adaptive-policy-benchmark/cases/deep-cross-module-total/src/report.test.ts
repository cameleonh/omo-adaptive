import { expect, test } from "bun:test"
import { reportTotal } from "./report"

test("reports a single item", () => {
  expect(reportTotal({ items: [7] })).toBe(7)
})
