import { join } from "node:path"
import { resolveContainedExisting } from "./paths"
import type { CorpusCase } from "./core"
import { runCommandWithTimeout } from "./process-tree"

export type OracleResult = {
  readonly name: string
  readonly status: "passed" | "failed" | "unknown" | "timed_out"
  readonly exit_code: number | null
  readonly stdout: string
  readonly stderr: string
}

type OracleCommand = {
  readonly name: string
  readonly command: readonly string[]
}

async function runOracle(
  cwd: string,
  oracle: OracleCommand,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<OracleResult> {
  try {
    const result = await runCommandWithTimeout({ command: oracle.command, cwd, env, timeoutMs })
    const status = result.timedOut ? "timed_out" : result.exitCode === 0 ? "passed" : result.exitCode === null ? "unknown" : "failed"
    return { name: oracle.name, status, exit_code: result.exitCode, stdout: result.stdout, stderr: result.stderr }
  } catch (error) {
    return {
      name: oracle.name,
      status: "unknown",
      exit_code: null,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function evaluateCompletionOracles(input: {
  readonly corpusRoot: string
  readonly corpusCase: CorpusCase
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
  readonly toolchainBin: string
  readonly timeoutMs: number
}): Promise<readonly OracleResult[]> {
  const commands: OracleCommand[] = []
  if (input.corpusCase.behavioralOracle !== null) {
    const path = await resolveContainedExisting(
      input.corpusRoot,
      input.corpusCase.behavioralOracle.path,
      "behavioralOracle.path",
    )
    commands.push({
      name: input.corpusCase.behavioralOracle.name,
      command: [process.execPath, path],
    })
  }
  if (input.corpusCase.tier === "Deep") {
    commands.push({
      name: "deep-typecheck",
      command: [join(input.toolchainBin, "tsgo"), "--noEmit", "-p", "tsconfig.json"],
    })
  }
  return Promise.all(commands.map((command) => runOracle(input.cwd, command, input.env, input.timeoutMs)))
}
