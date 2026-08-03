import { expect, test } from "bun:test"
import { add } from "./math"

test("adds positive operands", () => {
  expect(add(2, 3)).toBe(5)
})
