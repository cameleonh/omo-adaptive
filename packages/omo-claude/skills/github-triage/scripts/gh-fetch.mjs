#!/usr/bin/env node

import { parseArgs } from "node:util"

import {
  CAP_PROFILES,
  GitHubDataError,
  serializeGitHubEnvelope,
} from "./bounded-github-data.mjs"
import {
  GitHubCliError,
  GitHubResponseError,
  issueDetail,
  listItems,
  pullRequestDetail,
  resolveRepository,
} from "./github-read.mjs"

const DEFAULT_ITEM_LIMIT = 12
const MAX_ITEM_LIMIT = 12
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/u
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u
const ITEM_KINDS = new Set(["all", "issue", "pr"])

class CliInputError extends Error {
  name = "CliInputError"
}

function usage() {
  return `Usage:
  gh-fetch.mjs list [--kind all|issue|pr] [--repo owner/repo] [--limit 12]
  gh-fetch.mjs detail --kind issue|pr --number N [--repo owner/repo]

The command performs read-only GitHub queries and emits bounded JSON inside an
<untrusted-github-data> envelope.`
}

function positiveInteger(value, label, maximum) {
  if (!POSITIVE_INTEGER_PATTERN.test(value)) {
    throw new CliInputError(`${label} must be a positive integer`)
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw new CliInputError(`${label} must not exceed ${maximum}`)
  }
  return parsed
}

function parseCli(argv) {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      repo: { type: "string" },
      kind: { type: "string", default: "all" },
      limit: { type: "string", default: String(DEFAULT_ITEM_LIMIT) },
      number: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  })
  if (parsed.values.help) {
    return { command: "help" }
  }
  if (parsed.positionals.length !== 1) {
    throw new CliInputError("choose exactly one command: list or detail")
  }

  const command = parsed.positionals[0]
  if (command !== "list" && command !== "detail") {
    throw new CliInputError(`unsupported command: ${command}`)
  }
  const kind = parsed.values.kind
  if (!ITEM_KINDS.has(kind)) {
    throw new CliInputError("--kind must be all, issue, or pr")
  }

  const limit = positiveInteger(parsed.values.limit, "--limit", MAX_ITEM_LIMIT)
  const numberText = parsed.values.number
  let number
  if (command === "detail") {
    if (kind === "all") {
      throw new CliInputError("detail requires --kind issue or --kind pr")
    }
    if (numberText === undefined) {
      throw new CliInputError("detail requires a positive integer --number")
    }
    number = positiveInteger(numberText, "--number", Number.MAX_SAFE_INTEGER)
  } else if (numberText !== undefined) {
    throw new CliInputError("--number is a detail-only option")
  }

  const repo = parsed.values.repo
  if (repo !== undefined && !REPOSITORY_PATTERN.test(repo)) {
    throw new CliInputError("--repo must match owner/repo")
  }
  return { command, kind, limit, number, repo }
}

function printEnvelope(payload) {
  process.stdout.write(serializeGitHubEnvelope(payload))
}

function main(argv) {
  const options = parseCli(argv)
  if (options.command === "help") {
    process.stdout.write(`${usage()}\n`)
    return
  }
  const repository = resolveRepository(options.repo)
  if (options.command === "list") {
    printEnvelope({
      schemaVersion: 1,
      trust: "untrusted-github-data",
      repository,
      limits: { itemCount: options.limit },
      items: listItems(repository, options.kind, options.limit),
    })
    return
  }

  const caps = CAP_PROFILES.standard
  const item = options.kind === "issue"
    ? issueDetail(repository, options.number, caps)
    : pullRequestDetail(repository, options.number, caps)
  printEnvelope({
    schemaVersion: 1,
    trust: "untrusted-github-data",
    repository,
    limits: caps,
    item,
  })
}

try {
  main(process.argv.slice(2))
} catch (error) {
  if (
    error instanceof CliInputError
    || error instanceof GitHubCliError
    || error instanceof GitHubResponseError
    || error instanceof GitHubDataError
  ) {
    process.stderr.write(`${error.name}: ${error.message}\n`)
    process.exitCode = 1
  } else {
    throw error
  }
}
