#!/usr/bin/env node

import { parseArgs } from "node:util"

import {
  GitHubCliError,
  GitHubResponseError,
  pullRequestStateData,
  resolveRepository,
} from "./github-read.mjs"
import {
  normalizePullRequestState,
  PullRequestStateError,
} from "./pr-state-data.mjs"

const MAX_OUTPUT_CHARACTERS = 8_192
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/u
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u

class CliInputError extends Error {
  name = "CliInputError"
}

function usage() {
  return `Usage:
  pr-state.mjs --number N [--repo owner/repo]

Emits only validated, non-prose PR identity and state fields for mutation gates.`
}

function parseCli(argv) {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: false,
    strict: true,
    options: {
      repo: { type: "string" },
      number: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  })
  if (parsed.values.help) {
    return { help: true }
  }
  const numberText = parsed.values.number
  if (numberText === undefined || !POSITIVE_INTEGER_PATTERN.test(numberText)) {
    throw new CliInputError("--number must be a positive integer")
  }
  const number = Number(numberText)
  if (!Number.isSafeInteger(number)) {
    throw new CliInputError("--number is outside the safe integer range")
  }
  const repo = parsed.values.repo
  if (repo !== undefined && !REPOSITORY_PATTERN.test(repo)) {
    throw new CliInputError("--repo must match owner/repo")
  }
  return { help: false, number, repo }
}

function main(argv) {
  const options = parseCli(argv)
  if (options.help) {
    process.stdout.write(`${usage()}\n`)
    return
  }
  const repository = resolveRepository(options.repo)
  const state = normalizePullRequestState(
    repository,
    options.number,
    pullRequestStateData(repository, options.number),
  )
  const output = `${JSON.stringify(state)}\n`
  if (output.length > MAX_OUTPUT_CHARACTERS) {
    throw new PullRequestStateError("validated PR state exceeds its output cap")
  }
  process.stdout.write(output)
}

try {
  main(process.argv.slice(2))
} catch (error) {
  if (
    error instanceof CliInputError
    || error instanceof GitHubCliError
    || error instanceof GitHubResponseError
    || error instanceof PullRequestStateError
  ) {
    process.stderr.write(`${error.name}: ${error.message}\n`)
    process.exitCode = 1
  } else {
    throw error
  }
}
