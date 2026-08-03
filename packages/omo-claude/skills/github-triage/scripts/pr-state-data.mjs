const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u
const SHA_PATTERN = /^[0-9a-f]{40}$/iu
const REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,239}$/u

const PR_STATES = new Set(["OPEN", "CLOSED", "MERGED"])
const MERGEABLE_STATES = new Set(["MERGEABLE", "CONFLICTING", "UNKNOWN"])
const MERGE_STATE_STATUSES = new Set([
  "BEHIND",
  "BLOCKED",
  "CLEAN",
  "DIRTY",
  "DRAFT",
  "HAS_HOOKS",
  "UNKNOWN",
  "UNSTABLE",
])
const REVIEW_DECISIONS = new Set(["", "APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED"])
const PASSING_CHECK_STATES = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"])
const PENDING_CHECK_STATES = new Set([
  "EXPECTED",
  "IN_PROGRESS",
  "PENDING",
  "QUEUED",
  "REQUESTED",
  "WAITING",
])

export class PullRequestStateError extends Error {
  name = "PullRequestStateError"
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function validatedRepository(value, label = "repository") {
  if (typeof value !== "string" || !REPOSITORY_PATTERN.test(value)) {
    throw new PullRequestStateError(`invalid ${label}`)
  }
  return value
}

function validatedRef(value, label) {
  const invalidSegment = typeof value === "string"
    && value.split("/").some((segment) => (
      segment === ""
      || segment === "."
      || segment === ".."
      || segment.startsWith(".")
      || segment.endsWith(".lock")
    ))
  if (
    typeof value !== "string"
    || !REF_PATTERN.test(value)
    || invalidSegment
    || value.includes("..")
    || value.includes("@{")
    || value.endsWith(".")
    || value.endsWith("/")
  ) {
    throw new PullRequestStateError(`invalid ${label} ref`)
  }
  return value
}

function validatedSha(value, label) {
  if (typeof value !== "string" || !SHA_PATTERN.test(value)) {
    throw new PullRequestStateError(`invalid ${label} SHA`)
  }
  return value.toLowerCase()
}

function enumValue(value, allowed, label, emptyAllowed = false) {
  const normalized = (value === null || value === undefined) && emptyAllowed ? "" : value
  if (typeof normalized !== "string" || !allowed.has(normalized)) {
    throw new PullRequestStateError(`invalid ${label}`)
  }
  return normalized
}

function optionalTimestamp(value) {
  if (value === null || value === undefined || value === "") {
    return ""
  }
  if (typeof value !== "string" || value.length > 40 || Number.isNaN(Date.parse(value))) {
    throw new PullRequestStateError("invalid merged timestamp")
  }
  return value
}

function mergeCommitSha(value) {
  if (value === null || value === undefined) {
    return ""
  }
  if (!isRecord(value)) {
    throw new PullRequestStateError("invalid merge commit")
  }
  return validatedSha(value.oid, "merge commit")
}

function headRepository(value, owner) {
  if (!isRecord(value) || !isRecord(owner)) {
    throw new PullRequestStateError("invalid head repository")
  }
  const ownerLogin = typeof owner.login === "string" ? owner.login : ""
  const repositoryName = typeof value.name === "string" ? value.name : ""
  return validatedRepository(`${ownerLogin}/${repositoryName}`, "head repository")
}

function checkSummary(value) {
  if (!Array.isArray(value) || value.length > 500) {
    throw new PullRequestStateError("invalid check rollup")
  }
  const summary = { total: value.length, passed: 0, pending: 0, failed: 0 }
  for (const check of value) {
    if (!isRecord(check)) {
      throw new PullRequestStateError("invalid check entry")
    }
    const state = check.conclusion ?? check.state ?? check.status ?? "UNKNOWN"
    if (typeof state !== "string") {
      throw new PullRequestStateError("invalid check state")
    }
    if (PASSING_CHECK_STATES.has(state)) {
      summary.passed += 1
    } else if (PENDING_CHECK_STATES.has(state)) {
      summary.pending += 1
    } else {
      summary.failed += 1
    }
  }
  return { ...summary, allPassing: summary.pending === 0 && summary.failed === 0 }
}

export function normalizePullRequestState(repository, expectedNumber, value) {
  const normalizedRepository = validatedRepository(repository)
  if (!Number.isSafeInteger(expectedNumber) || expectedNumber < 1) {
    throw new PullRequestStateError("invalid expected PR number")
  }
  if (!isRecord(value) || value.number !== expectedNumber) {
    throw new PullRequestStateError("GitHub returned a mismatched PR number")
  }
  if (typeof value.isCrossRepository !== "boolean" || typeof value.isDraft !== "boolean") {
    throw new PullRequestStateError("invalid PR boolean state")
  }

  return {
    schemaVersion: 1,
    repository: normalizedRepository,
    number: expectedNumber,
    baseRef: validatedRef(value.baseRefName, "base"),
    headRepository: headRepository(value.headRepository, value.headRepositoryOwner),
    headRef: validatedRef(value.headRefName, "head"),
    headSha: validatedSha(value.headRefOid, "head"),
    isCrossRepository: value.isCrossRepository,
    isDraft: value.isDraft,
    state: enumValue(value.state, PR_STATES, "PR state"),
    mergeable: enumValue(value.mergeable, MERGEABLE_STATES, "mergeable state"),
    mergeStateStatus: enumValue(
      value.mergeStateStatus,
      MERGE_STATE_STATUSES,
      "merge state status",
    ),
    reviewDecision: enumValue(
      value.reviewDecision,
      REVIEW_DECISIONS,
      "review decision",
      true,
    ),
    mergedAt: optionalTimestamp(value.mergedAt),
    mergeCommitSha: mergeCommitSha(value.mergeCommit),
    checks: checkSummary(value.statusCheckRollup),
  }
}
