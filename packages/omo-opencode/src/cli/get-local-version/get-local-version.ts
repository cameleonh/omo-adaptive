import {
  findPluginEntry,
  getCachedVersion,
  getLatestVersion,
  getLocalDevVersion,
  isLocalDevMode,
} from "../../hooks/auto-update-checker/checker"
import { getActiveCachedLazyCodexVersion } from "@oh-my-opencode/omo-codex/install"

import type { GetLocalVersionOptions, VersionInfo } from "./types"
import { formatJsonOutput, formatVersionOutput } from "./formatter"

type GetLocalVersionDeps = {
  readonly getActiveCachedCodexVersion?: typeof getActiveCachedLazyCodexVersion
  readonly getCachedVersion?: () => string | null
}

export async function getLocalVersion(
  options: GetLocalVersionOptions = {},
  deps: GetLocalVersionDeps = {},
): Promise<number> {
  const directory = options.directory ?? process.cwd()
  const readActiveCachedCodexVersion = deps.getActiveCachedCodexVersion ?? getActiveCachedLazyCodexVersion
  const readCachedVersion = deps.getCachedVersion ?? getCachedVersion

  try {
    if (isLocalDevMode(directory)) {
      const currentVersion = getLocalDevVersion(directory) ?? readCachedVersion()
      const info: VersionInfo = {
        currentVersion,
        latestVersion: null,
        isUpToDate: false,
        isLocalDev: true,
        isPinned: false,
        pinnedVersion: null,
        status: "local-dev",
      }

      outputVersionInfo(options, info)
      return 0
    }

    const pluginInfo = findPluginEntry(directory)
    if (pluginInfo?.isPinned) {
      const actualVersion = readCachedVersion()
      const isMismatch = actualVersion !== null && actualVersion !== pluginInfo.pinnedVersion
      const info: VersionInfo = {
        currentVersion: isMismatch ? actualVersion : pluginInfo.pinnedVersion,
        latestVersion: null,
        isUpToDate: false,
        isLocalDev: false,
        isPinned: true,
        pinnedVersion: pluginInfo.pinnedVersion,
        status: isMismatch ? "pinned-mismatch" : "pinned",
      }

      outputVersionInfo(options, info)
      return 0
    }

    const codexHome = options.codexHome?.trim() || process.env.CODEX_HOME?.trim()
    const codexVersion = codexHome === undefined
      ? readActiveCachedCodexVersion()
      : readActiveCachedCodexVersion({ codexHome })
    const currentVersion = codexVersion ?? readCachedVersion()
    if (!currentVersion) {
      const info: VersionInfo = {
        currentVersion: null,
        latestVersion: null,
        isUpToDate: false,
        isLocalDev: false,
        isPinned: false,
        pinnedVersion: null,
        status: "unknown",
      }

      outputVersionInfo(options, info)
      return 1
    }

    if (!/^\d+\.\d+\.\d+/.test(currentVersion)) {
      const info: VersionInfo = {
        currentVersion,
        latestVersion: null,
        isUpToDate: false,
        isLocalDev: true,
        isPinned: false,
        pinnedVersion: null,
        status: "dev",
      }

      outputVersionInfo(options, info)
      return 0
    }

    const { extractChannel } = await import("../../hooks/auto-update-checker/index")
    const channel = extractChannel(pluginInfo?.pinnedVersion ?? currentVersion)
    const latestVersion = await getLatestVersion(channel)

    if (!latestVersion) {
      const info: VersionInfo = {
        currentVersion,
        latestVersion: null,
        isUpToDate: false,
        isLocalDev: false,
        isPinned: false,
        pinnedVersion: null,
        status: "error",
      }

      outputVersionInfo(options, info)
      return 0
    }

    const isUpToDate = currentVersion === latestVersion
    const info: VersionInfo = {
      currentVersion,
      latestVersion,
      isUpToDate,
      isLocalDev: false,
      isPinned: false,
      pinnedVersion: null,
      status: isUpToDate ? "up-to-date" : "outdated",
    }

    outputVersionInfo(options, info)
    return 0
  } catch (error) { // no-excuse-ok: catch -- CLI output boundary reports every resolution failure uniformly.
    const info: VersionInfo = {
      currentVersion: null,
      latestVersion: null,
      isUpToDate: false,
      isLocalDev: false,
      isPinned: false,
      pinnedVersion: null,
      status: "error",
    }

    outputVersionInfo(options, info)
    return 1
  }
}

function outputVersionInfo(options: GetLocalVersionOptions, info: VersionInfo): void {
  const output = options.json ? formatJsonOutput(info) : formatVersionOutput(info)
  if (options.output !== undefined) {
    options.output(output)
    return
  }
  console.log(output)
}
