import { pathToFileURL } from "node:url"
import { join } from "node:path"

const loaded: unknown = await import(pathToFileURL(join(process.cwd(), "math.ts")).href)
if (
  typeof loaded !== "object" || loaded === null || !("add" in loaded) ||
  typeof loaded.add !== "function" || loaded.add(-2, 3) !== 1
) {
  console.error("add(-2, 3) must equal 1")
  process.exit(1)
}
