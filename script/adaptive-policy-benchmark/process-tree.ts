import { spawn, type ChildProcess } from "node:child_process"
import { readdir, readFile } from "node:fs/promises"
import { platform } from "node:os"

export type ProcessResult = {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number | null
  readonly timedOut: boolean
}

export type CommandProcess = {
  readonly command: readonly string[]
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
  readonly timeoutMs: number
  readonly processSnapshot?: () => Promise<readonly ProcessIdentity[]>
}

export type ProcessIdentity = { readonly pid: number; readonly ppid: number; readonly start: string }

function waitForClose(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve, reject) => {
    child.once("error", reject)
    child.once("close", resolve)
  })
}

function signalProcessGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return
  try {
    process.kill(-child.pid, signal)
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") throw error
  }
}

function signalPid(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal)
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") throw error
  }
}

function parseProcStat(content: string): Omit<ProcessIdentity, "pid"> {
  const fields = content.slice(content.lastIndexOf(")") + 2).trim().split(/\s+/u)
  const ppid = Number(fields[1])
  const start = fields[19]
  if (!Number.isInteger(ppid) || start === undefined) throw new TypeError("Invalid /proc stat identity")
  return { ppid, start }
}

async function linuxSnapshot(): Promise<readonly ProcessIdentity[]> {
  const entries = await readdir("/proc", { withFileTypes: true })
  const identities = await Promise.all(entries.filter((entry) => entry.isDirectory() && /^\d+$/u.test(entry.name)).map(async (entry) => {
    try { return { pid: Number(entry.name), ...parseProcStat(await readFile(`/proc/${entry.name}/stat`, "utf8")) } } catch { return null }
  }))
  return identities.filter((identity): identity is ProcessIdentity => identity !== null)
}

async function psSnapshot(): Promise<readonly ProcessIdentity[]> {
  const ps = spawn("ps", ["-axo", "pid=,ppid=,lstart=,command="], { stdio: ["ignore", "pipe", "ignore"] })
  let output = ""
  ps.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString() })
  if (await waitForClose(ps) !== 0) throw new TypeError("Process identity enumeration failed")
  const identities: ProcessIdentity[] = []
  for (const line of output.split("\n")) {
    const [pidText, parentText, ...identity] = line.trim().split(/\s+/u)
    const pid = Number(pidText)
    const ppid = Number(parentText)
    if (Number.isInteger(pid) && Number.isInteger(ppid) && identity.length >= 5) identities.push({ pid, ppid, start: identity.slice(0, 5).join(" ") })
  }
  return identities
}

export function readProcessSnapshot(): Promise<readonly ProcessIdentity[]> {
  return platform() === "linux" ? linuxSnapshot() : psSnapshot()
}

function descendants(snapshot: readonly ProcessIdentity[], rootPid: number): readonly ProcessIdentity[] {
  const children = new Map<number, ProcessIdentity[]>()
  for (const identity of snapshot) children.set(identity.ppid, [...(children.get(identity.ppid) ?? []), identity])
  const found: ProcessIdentity[] = []
  const pending = [...(children.get(rootPid) ?? [])]
  while (pending.length > 0) {
    const identity = pending.pop()
    if (identity === undefined) continue
    found.push(identity)
    pending.push(...(children.get(identity.pid) ?? []))
  }
  return found
}

async function identityStillMatches(identity: ProcessIdentity): Promise<boolean> {
  try {
    if (platform() === "linux") {
      const current = parseProcStat(await readFile(`/proc/${identity.pid}/stat`, "utf8"))
      return current.start === identity.start
    }
    return (await psSnapshot()).some((candidate) => candidate.pid === identity.pid && candidate.start === identity.start)
  } catch { return false }
}

async function killTracked(tracked: Iterable<ProcessIdentity>): Promise<void> {
  for (const identity of tracked) {
    if (await identityStillMatches(identity)) signalPid(identity.pid, "SIGKILL")
  }
}

async function waitForTaskkill(pid: number): Promise<void> {
  const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
    stdio: "ignore",
    windowsHide: true,
  })
  await waitForClose(killer)
}

async function terminateTree(
  child: ChildProcess,
  tracked: Map<string, ProcessIdentity>,
  snapshot: () => Promise<readonly ProcessIdentity[]>,
): Promise<void> {
  if (child.pid === undefined) return
  if (platform() === "win32") {
    await waitForTaskkill(child.pid)
    return
  }
  signalProcessGroup(child, "SIGSTOP")
  await killTracked(tracked.values())
  try {
    for (const identity of descendants(await snapshot(), child.pid)) tracked.set(`${identity.pid}:${identity.start}`, identity)
  } catch {}
  signalProcessGroup(child, "SIGKILL")
  await killTracked(tracked.values())
}

export async function runCommandWithTimeout(input: CommandProcess): Promise<ProcessResult> {
  const snapshot = input.processSnapshot ?? readProcessSnapshot
  if (platform() !== "win32") await snapshot()
  const child = spawn(input.command[0] ?? "codex", input.command.slice(1), {
    cwd: input.cwd,
    env: input.env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: platform() !== "win32",
    windowsHide: true,
  })
  let stdout = ""
  let stderr = ""
  child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString() })
  child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString() })
  const tracked = new Map<string, ProcessIdentity>()
  let tracking: Promise<void> = Promise.resolve()
  let polling = false
  const poll = (): void => {
    if (child.pid === undefined || polling) return
    polling = true
    tracking = snapshot().then((items) => {
      for (const identity of descendants(items, child.pid!)) tracked.set(`${identity.pid}:${identity.start}`, identity)
    }).catch(() => {}).finally(() => { polling = false })
  }
  poll()
  const tracker = setInterval(poll, 10)
  const closed = waitForClose(child)
  let timer: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<"timed_out">((resolveTimeout) => {
    timer = setTimeout(() => resolveTimeout("timed_out"), input.timeoutMs)
  })
  const outcome = await Promise.race([closed, timeout]).finally(() => {
    if (timer !== null) clearTimeout(timer)
    clearInterval(tracker)
  })
  await tracking
  if (outcome === "timed_out") {
    await terminateTree(child, tracked, snapshot)
    const exitCode = await closed
    return { stdout, stderr, exitCode, timedOut: true }
  }
  await killTracked(tracked.values())
  return { stdout, stderr, exitCode: outcome, timedOut: false }
}
