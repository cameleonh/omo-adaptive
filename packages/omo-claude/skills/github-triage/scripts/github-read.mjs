import { spawnSync } from "node:child_process"

import {
  normalizeIssue,
  normalizeListItem,
  normalizePullRequest,
  normalizePullRequestFiles,
} from "./bounded-github-data.mjs"

const GH_OUTPUT_LIMIT_BYTES = 4 * 1024 * 1024
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u

export class GitHubCliError extends Error {
  name = "GitHubCliError"

  constructor(message, status) {
    super(message)
    this.status = status
  }
}

export class GitHubResponseError extends Error {
  name = "GitHubResponseError"
}

function runGitHub(args) {
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    maxBuffer: GH_OUTPUT_LIMIT_BYTES,
    windowsHide: true,
  })
  if (result.error !== undefined) {
    throw new GitHubCliError("could not run the gh executable", null)
  }
  if (result.status !== 0) {
    throw new GitHubCliError(
      `read-only GitHub query failed with exit code ${result.status}`,
      result.status,
    )
  }
  return result.stdout
}

function parseGitHubJson(args) {
  const output = runGitHub(args)
  try {
    return JSON.parse(output)
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new GitHubResponseError("gh returned malformed JSON")
    }
    throw error
  }
}

export function resolveRepository(candidate) {
  const repository = candidate ?? runGitHub([
    "repo",
    "view",
    "--json",
    "nameWithOwner",
    "--jq",
    ".nameWithOwner",
  ]).trim()
  if (!REPOSITORY_PATTERN.test(repository)) {
    throw new GitHubResponseError("resolved repository does not match owner/repo")
  }
  return repository
}

function listKind(repository, kind, limit) {
  const fields = kind === "issue"
    ? "number,title,url,author,labels,createdAt,updatedAt"
    : "number,title,url,author,labels,createdAt,updatedAt,isDraft,baseRefName,headRefName"
  const response = parseGitHubJson([
    kind,
    "list",
    "--repo",
    repository,
    "--state",
    "open",
    "--limit",
    String(limit),
    "--search",
    "sort:updated-desc",
    "--json",
    fields,
  ])
  if (!Array.isArray(response)) {
    throw new GitHubResponseError(`gh returned a non-array ${kind} list`)
  }
  return response.map((item) => normalizeListItem(kind, item))
}

export function listItems(repository, kind, limit) {
  const kinds = kind === "all" ? ["issue", "pr"] : [kind]
  return kinds
    .flatMap((itemKind) => listKind(repository, itemKind, limit))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, limit)
}

export function issueDetail(repository, number, caps) {
  const value = parseGitHubJson([
    "issue",
    "view",
    String(number),
    "--repo",
    repository,
    "--json",
    "number,title,url,author,labels,createdAt,updatedAt,state,body,comments",
  ])
  return normalizeIssue(value, caps)
}

function pullRequestFiles(repository, number, caps) {
  const endpoint = `repos/${repository}/pulls/${number}/files?per_page=${caps.fileCount}&page=1`
  return normalizePullRequestFiles(
    parseGitHubJson(["api", "--method", "GET", endpoint]),
    caps,
  )
}

export function pullRequestDetail(repository, number, caps) {
  const value = parseGitHubJson([
    "pr",
    "view",
    String(number),
    "--repo",
    repository,
    "--json",
    "number,title,url,author,labels,createdAt,updatedAt,state,mergedAt,mergeCommit,body,comments,reviews,isDraft,baseRefName,headRefName,headRefOid,headRepository,headRepositoryOwner,isCrossRepository,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,changedFiles",
  ])
  return normalizePullRequest(
    value,
    caps,
    pullRequestFiles(repository, number, caps),
  )
}

export function pullRequestStateData(repository, number) {
  return parseGitHubJson([
    "pr",
    "view",
    String(number),
    "--repo",
    repository,
    "--json",
    "number,baseRefName,headRefName,headRefOid,headRepository,headRepositoryOwner,isCrossRepository,isDraft,state,mergeable,mergeStateStatus,reviewDecision,mergedAt,mergeCommit,statusCheckRollup",
  ])
}
