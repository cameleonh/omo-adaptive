---
name: publish
description: "Safely publish an OMO release through the repository's approved workflow. Requires exact repository, ref, target version, release surfaces, and full source SHA confirmation before any push or publish trigger."
argument-hint: "<patch|minor|major|exact-version>"
disable-model-invocation: true
---

# Publish

Publishing is an external, difficult-to-reverse operation. Start with read-only preflight and do not treat a generic release request, a bump word, or previous approval as confirmation of the exact release state.

Use the repository's approved release workflow. Never run a local package publish command and never repair code during a publish attempt.

## Phase 1: Read-only preflight

Before any push, workflow dispatch, release edit, or notification:

1. Read repository release instructions and the actual workflow file.
2. Resolve the repository owner/name, workflow filename, target remote, target branch and full ref, current package version, requested bump or exact version, calculated target version, and distribution tags.
3. Record the full 40-character local `HEAD` SHA, current branch, upstream, and `git status --short`.
4. Query the remote branch SHA without changing local refs. Confirm whether the exact local SHA is already reachable from the intended remote ref.
5. Enumerate every release surface the workflow will mutate, including package registries, package names, platform packages, GitHub tag and release, marketplace repositories, and plugin metadata.
6. Check authentication and workflow availability read-only. Do not expose credentials in output.
7. Stop if the tree is dirty, the version cannot be calculated unambiguously, the workflow targets are unclear, required checks are failing, or the local and remote histories diverge.

Do not auto-commit, pull, rebase, merge, or push to make preflight pass.

## Optional exact push gate

If the approved source SHA is not on the target remote ref, publishing remains blocked. Show the commits that would be pushed and ask for this separate confirmation:

```text
CONFIRM PUSH
Repository: OWNER/REPO
Remote: REMOTE_NAME and URL
Destination ref: refs/heads/BRANCH
Source SHA: FULL_40_CHARACTER_SHA
Force: no
```

The user must confirm those exact values. Immediately before pushing, re-check the clean worktree, branch, full SHA, remote URL, and destination ref. Any change invalidates approval. Push the explicit SHA to the explicit ref without force, then verify the remote ref points to that SHA.

A publish request does not implicitly authorize this push.

## Exact publish approval gate

Once the source SHA is present on the intended remote ref, present:

```text
CONFIRM PUBLISH
Repository: OWNER/REPO
Workflow: WORKFLOW_FILE
Source ref: refs/heads/BRANCH
Source SHA: FULL_40_CHARACTER_SHA
Source-binding input: ACTUAL_WORKFLOW_INPUT=FULL_40_CHARACTER_SHA
Workflow inputs: KEY=VALUE
Current version: X.Y.Z
Target version: X.Y.Z
Registry targets: PACKAGE@VERSION with DIST_TAG, one per line
GitHub target: TAG and release repository
Marketplace targets: exact repository and plugin version, one per line
Release-note mutation: yes or no
External notifications: no
```

Ask the user to confirm the repository, workflow, source ref, full source SHA,
the actual workflow-defined source-binding input, exact target version, and
every listed target. Do not dispatch until that exact confirmation arrives.

Before dispatch, inspect the actual workflow and identify its real source-binding
input rather than inventing a generic name. The dispatched workflow must validate
that its server-side run SHA and checked-out commit (`git rev-parse HEAD`) both
equal the approved input, and that validation must complete before any
credentialed publish action (registry login, token use, tag/release mutation, or
marketplace write). If the workflow does not enforce this gate, block the
publish; approval never waives it. A mutable branch may not be dispatched
without a workflow-defined SHA binding and server-side gate.

For this repository's current `.github/workflows/publish.yml`, the binding input
is `prepared_release_sha`, not `expected_sha`. However, the `preflight-trust` job
obtains and exchanges an OIDC token before the later release-state step checks
that input, and that later check does not also verify the checked-out
`git rev-parse HEAD`. Therefore neither the initial source-preparation run nor
the prepared second run currently satisfies this skill's provenance gate. Block
every dispatch until the workflow validates
`prepared_release_sha == github.sha == git rev-parse HEAD` in an earlier job and
every credential- or token-bearing job depends on that validation. Do not
silently substitute a different input or broaden authorization.

The workflow itself must verify the approved source SHA before any publish
action; a caller-side check or user approval is not a substitute for this
server-side verification.

Immediately before dispatch, repeat the read-only preflight. If the local SHA, remote ref SHA, target version, workflow, inputs, check state, or release surfaces changed, invalidate the approval and present a new gate.

## Phase 2: Dispatch and monitor

After exact approval:

1. Only after re-inspection proves the workflow now satisfies the gate above, dispatch the approved workflow against the approved immutable prepared ref with the approved inputs, including the actual source-binding input (currently `prepared_release_sha=FULL_40_CHARACTER_SHA` for this repository). The current workflow must be reported as blocked, not dispatched.
2. Capture the run ID that corresponds to the approved workflow, ref, and source SHA. Do not select a run merely because it is the newest one.
3. Before treating the run as authorized to publish, query its `headSha` and require `headSha` to equal the approved source SHA (`FULL_40_CHARACTER_SHA`). If it differs, stop immediately and cancel the run when cancellation is safe; do not continue to, or claim, any publish action. This post-dispatch check does not replace the mandatory in-workflow source gate.
4. Monitor the run to a terminal state and report stage transitions.
5. If the workflow fails, collect the failed job names and logs, report them, and stop. Do not edit the tree, rerun with different inputs, or trigger repair work inside this skill.
6. If the workflow succeeds, verify each approved release surface independently: tag and release, package versions and distribution tags, platform packages, marketplace metadata, and any repository sync.
7. Verify the released tag or package provenance against the workflow output and report both the approved source SHA and resulting release SHA when the workflow creates a release commit.

Do not modify the local working tree merely to verify a release. Prefer read-only GitHub and registry queries.

## Release notes

If release-note mutation was included in the exact publish approval, preserve the existing release body byte-for-byte and prepend only the approved summary. If it was not included, draft the summary locally for the user but do not edit the release.

Release notes must describe user impact from the actual diff. Keep internal adapter exclusions and attribution requirements from the repository instructions.

## Separate external-notification gate

Publishing never authorizes Discord, Slack, email, social media, webhooks, or other external messages. After the release is verified, a notification may be drafted and shown to the user. Send it only after a separate confirmation containing:

```text
CONFIRM NOTIFY
Service: SERVICE
Destination: EXACT_CHANNEL_OR_RECIPIENT
Version: X.Y.Z
Release URL: URL
Message: exact approved text or approved draft identifier
```

Re-check the service and destination before sending. A declined or absent notification approval does not undo a successful package release; report it as `not sent`.

## Completion report

Report:

- repository, workflow, source ref, approved full source SHA, and resulting release SHA
- old and new versions
- workflow run URL and conclusion
- every registry, package, tag, release, and marketplace verification
- whether a push occurred and the exact ref it changed
- whether release notes were edited
- each external notification as sent, failed, declined, or not authorized
- any unresolved propagation or provenance issue

Do not claim completion while an approved release surface remains unverified.
