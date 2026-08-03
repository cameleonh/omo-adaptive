const STANDARD_PROFILE = {
  bodyCharacters: 6_000,
  commentCount: 8,
  commentCharacters: 1_000,
  checkCount: 30,
  fileCount: 30,
  patchCharacters: 2_000,
}

export const CAP_PROFILES = Object.freeze({
  standard: Object.freeze(STANDARD_PROFILE),
})

export const MAX_GITHUB_ENVELOPE_CHARACTERS = 250_000

const UNTRUSTED_DATA_OPEN = "<untrusted-github-data>"
const UNTRUSTED_DATA_CLOSE = "</untrusted-github-data>"

export class GitHubDataError extends Error {
  name = "GitHubDataError"
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function safeText(value, maximumCharacters) {
  if (typeof value !== "string") {
    return ""
  }
  return value.slice(0, maximumCharacters).replaceAll("<", "‹")
}

export function serializeGitHubEnvelope(payload) {
  const envelope = `${UNTRUSTED_DATA_OPEN}\n${JSON.stringify(payload, null, 2)}\n${UNTRUSTED_DATA_CLOSE}\n`
  if (envelope.length > MAX_GITHUB_ENVELOPE_CHARACTERS) {
    throw new GitHubDataError(
      `bounded GitHub response exceeds the hard character cap of ${MAX_GITHUB_ENVELOPE_CHARACTERS}`,
    )
  }
  return envelope
}

export function createGitHubEnvelopeBudget(maximumCharacters = MAX_GITHUB_ENVELOPE_CHARACTERS) {
  if (!Number.isSafeInteger(maximumCharacters) || maximumCharacters < 1) {
    throw new GitHubDataError("session output budget must be a positive integer")
  }
  let emittedCharacters = 0
  return (payload) => {
    const envelope = serializeGitHubEnvelope(payload)
    if (emittedCharacters + envelope.length > maximumCharacters) {
      throw new GitHubDataError(
        `bounded GitHub response exceeds the session output budget of ${maximumCharacters}`,
      )
    }
    emittedCharacters += envelope.length
    return envelope
  }
}

function textIsTruncated(value, maximumCharacters) {
  return typeof value === "string" && value.length > maximumCharacters
}

function safeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function safeAuthor(value) {
  if (!isRecord(value)) {
    return "unknown"
  }
  return safeText(value.login, 100) || "unknown"
}

function safeHeadRepository(repository, owner) {
  if (!isRecord(repository) || !isRecord(owner)) {
    return ""
  }
  const ownerLogin = safeText(owner.login, 100)
  const repositoryName = safeText(repository.name, 100)
  return ownerLogin && repositoryName ? `${ownerLogin}/${repositoryName}` : ""
}

function safeCommitOid(value) {
  return isRecord(value) ? safeText(value.oid, 40) : ""
}

function safeLabels(value) {
  if (!Array.isArray(value)) {
    return []
  }
  return value.slice(0, 20).map((label) => {
    if (!isRecord(label)) {
      return ""
    }
    return safeText(label.name, 100)
  }).filter(Boolean)
}

export function normalizeListItem(kind, value) {
  if (!isRecord(value)) {
    throw new GitHubDataError(`gh returned a malformed ${kind} list item`)
  }
  return {
    kind,
    number: safeNumber(value.number),
    title: safeText(value.title, 240),
    titleTruncated: textIsTruncated(value.title, 240),
    url: safeText(value.url, 500),
    author: safeAuthor(value.author),
    labels: safeLabels(value.labels),
    createdAt: safeText(value.createdAt, 40),
    updatedAt: safeText(value.updatedAt, 40),
    ...(kind === "pr" ? {
      isDraft: value.isDraft === true,
      baseRefName: safeText(value.baseRefName, 240),
      headRefName: safeText(value.headRefName, 240),
    } : {}),
  }
}

function normalizeComments(value, caps) {
  if (!Array.isArray(value)) {
    return []
  }
  return value.slice(0, caps.commentCount).map((comment) => {
    if (!isRecord(comment)) {
      throw new GitHubDataError("gh returned a malformed comment or review")
    }
    return {
      author: safeAuthor(comment.author),
      body: safeText(comment.body, caps.commentCharacters),
      url: safeText(comment.url, 500),
      createdAt: safeText(comment.createdAt ?? comment.submittedAt, 40),
      state: safeText(comment.state, 40),
    }
  })
}

export function normalizeIssue(value, caps) {
  if (!isRecord(value)) {
    throw new GitHubDataError("gh returned a malformed issue")
  }
  return {
    kind: "issue",
    number: safeNumber(value.number),
    title: safeText(value.title, 240),
    url: safeText(value.url, 500),
    author: safeAuthor(value.author),
    labels: safeLabels(value.labels),
    createdAt: safeText(value.createdAt, 40),
    updatedAt: safeText(value.updatedAt, 40),
    state: safeText(value.state, 40),
    body: safeText(value.body, caps.bodyCharacters),
    bodyTruncated: textIsTruncated(value.body, caps.bodyCharacters),
    comments: normalizeComments(value.comments, caps),
    commentCount: Array.isArray(value.comments) ? value.comments.length : 0,
    commentsTruncated: Array.isArray(value.comments)
      && value.comments.length > caps.commentCount,
  }
}

function normalizeChecks(value, caps) {
  if (!Array.isArray(value)) {
    return []
  }
  return value.slice(0, caps.checkCount).map((check) => {
    if (!isRecord(check)) {
      return { name: "unknown", state: "unknown", url: "" }
    }
    return {
      name: safeText(check.name ?? check.context, 200),
      state: safeText(check.conclusion ?? check.state ?? check.status, 80),
      url: safeText(check.detailsUrl ?? check.targetUrl, 500),
    }
  })
}

export function normalizePullRequest(value, caps, files) {
  if (!isRecord(value)) {
    throw new GitHubDataError("gh returned a malformed pull request")
  }
  return {
    kind: "pr",
    number: safeNumber(value.number),
    title: safeText(value.title, 240),
    url: safeText(value.url, 500),
    author: safeAuthor(value.author),
    labels: safeLabels(value.labels),
    createdAt: safeText(value.createdAt, 40),
    updatedAt: safeText(value.updatedAt, 40),
    state: safeText(value.state, 40),
    mergedAt: safeText(value.mergedAt, 40),
    mergeCommitOid: safeCommitOid(value.mergeCommit),
    body: safeText(value.body, caps.bodyCharacters),
    bodyTruncated: textIsTruncated(value.body, caps.bodyCharacters),
    comments: normalizeComments(value.comments, caps),
    commentCount: Array.isArray(value.comments) ? value.comments.length : 0,
    commentsTruncated: Array.isArray(value.comments)
      && value.comments.length > caps.commentCount,
    reviews: normalizeComments(value.reviews, caps),
    reviewCount: Array.isArray(value.reviews) ? value.reviews.length : 0,
    reviewsTruncated: Array.isArray(value.reviews)
      && value.reviews.length > caps.commentCount,
    isDraft: value.isDraft === true,
    baseRefName: safeText(value.baseRefName, 240),
    headRefName: safeText(value.headRefName, 240),
    headRefOid: safeText(value.headRefOid, 40),
    headRepository: safeHeadRepository(
      value.headRepository,
      value.headRepositoryOwner,
    ),
    isCrossRepository: value.isCrossRepository === true,
    mergeable: safeText(value.mergeable, 80),
    mergeStateStatus: safeText(value.mergeStateStatus, 80),
    reviewDecision: safeText(value.reviewDecision, 80),
    checks: normalizeChecks(value.statusCheckRollup, caps),
    checkCount: Array.isArray(value.statusCheckRollup)
      ? value.statusCheckRollup.length
      : 0,
    checksTruncated: Array.isArray(value.statusCheckRollup)
      && value.statusCheckRollup.length > caps.checkCount,
    changedFileCount: safeNumber(value.changedFiles),
    filesTruncated: safeNumber(value.changedFiles) > files.length,
    files,
  }
}

export function normalizePullRequestFiles(value, caps) {
  if (!Array.isArray(value)) {
    throw new GitHubDataError("gh returned a malformed PR file list")
  }
  return value.slice(0, caps.fileCount).map((file) => {
    if (!isRecord(file)) {
      throw new GitHubDataError("gh returned a malformed PR file entry")
    }
    return {
      filename: safeText(file.filename, 500),
      status: safeText(file.status, 40),
      additions: safeNumber(file.additions),
      deletions: safeNumber(file.deletions),
      changes: safeNumber(file.changes),
      blobUrl: safeText(file.blob_url, 500),
      patch: safeText(file.patch, caps.patchCharacters),
    }
  })
}
