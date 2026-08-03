import { pathToFileURL } from "node:url"
import { join } from "node:path"

const loaded: unknown = await import(pathToFileURL(join(process.cwd(), "src/report.ts")).href)
if (
  typeof loaded !== "object" || loaded === null || !("reportTotal" in loaded) ||
  typeof loaded.reportTotal !== "function" || loaded.reportTotal({ items: [2, 3, 5] }) !== 10
) {
  console.error("reportTotal must sum every item in a multi-item invoice")
  process.exit(1)
}
