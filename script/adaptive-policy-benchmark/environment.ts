import { delimiter } from "node:path"

const INHERITED_KEYS = ["LANG", "LC_ALL", "LC_CTYPE", "TZ", "TERM", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT"] as const

export function sandboxEnvironment(paths: {
  readonly home: string
  readonly codexHome: string
  readonly xdgConfig: string
  readonly xdgCache: string
  readonly xdgData: string
  readonly xdgState: string
  readonly temporary: string
  readonly toolchainBin: string
}): NodeJS.ProcessEnv {
  const inherited = Object.fromEntries(
    INHERITED_KEYS.flatMap((key) => process.env[key] === undefined ? [] : [[key, process.env[key]]]),
  )
  return {
    ...inherited,
    HOME: paths.home,
    CODEX_HOME: paths.codexHome,
    XDG_CONFIG_HOME: paths.xdgConfig,
    XDG_CACHE_HOME: paths.xdgCache,
    XDG_DATA_HOME: paths.xdgData,
    XDG_STATE_HOME: paths.xdgState,
    PATH: `${paths.toolchainBin}${delimiter}${process.env.PATH ?? ""}`,
    TMPDIR: paths.temporary,
    TMP: paths.temporary,
    TEMP: paths.temporary,
  }
}
