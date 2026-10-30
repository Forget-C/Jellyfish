# 06 visual review handoff

Implementation complete, integration remains merger-owned. No old ticket/spec or product behavior changed. The public review CLI extends 05's verifier; no saved `visual-result.json` is accepted as an authority.

```bash
node front/scripts/visual-review.mjs \
  --manifest front/tests/visual-baselines/c-794ee4a0-v1/manifest.json \
  --matrix /path/to/matrix.json --run /path/to/visual-run.json \
  --output /path/to/prepared.json
# Copy prepared.reviewTemplate into a separate review.json; actually inspect originals and fill observations.
node front/scripts/visual-review.mjs \
  --manifest front/tests/visual-baselines/c-794ee4a0-v1/manifest.json \
  --matrix /path/to/matrix.json --run /path/to/visual-run.json \
  --review /path/to/review.json --output /path/to/review-result.json
```

No review: exit 1, visual not-reviewed and unverified template. Full valid region declarations: visual passed only if all required regions passed; difference/unverified => incomplete and exit 1. Invalid bindings/coverage/metadata => invalid and exit 1. Behavior/evidence remain independent. Current PNGs/manifest/contract/capture are re-read through evaluateEvidence, including Chrome decoding. This validates a review declaration, not proof a human viewed images.

Review JSON v1: `schemaVersion`, `reviewer`, `reviewedAt`, `source:{runId,sourceRevision,result}`, `baselineVersion`, `manifestSha256`, `contractSha256`, `groups:[{key,images:{target:{role:sha256},actual:{role:sha256}},captureSha256,regions:[{region,status,observation,allowedDifferences:[{difference,basis}]}]}]`. Status values are passed/difference/unverified; every applicable group/region is required exactly once. Every region requires a concrete observation, including why not inspected. Empty allowedDifferences arrays are valid. Paths are relocatable; original hashes and current capture identity remain bound. Missing explanation or basis is invalid.

Changed contract or image bytes invalidate. SHA/run metadata or descriptive manifest metadata alone can use explicit `--reuse-review`, only after all current image/capture/contract/region identities match. `visual.reuse` retains original/current run/revision/manifest and origin review path, explicitly claims no new capture/review. Baseline version change invalidates.

## Independent real inspection

Stable files: `/private/tmp/checks06-review/prepared.json`, `/private/tmp/checks06-review/review-f01.json`, `/private/tmp/checks06-review/review-f01-result.json`. Current main-repository baseline was used to mechanically recheck retained 05 capture, so target paths survive implementer-worktree cleanup. Capture source remains 05's source revision; no fresh product run claimed.

Actually opened six F01 1440x960 original files with view_image original detail: target full and actual page, both editors, target cardWithTitle and actual card. F01 all four applicable regions have observations. Page/context records unresolved neighboring card-title overlap visible around x415/y195 on actual full-page original; other three record observed typography/content/controls with concrete permitted differences. All other groups explicitly unverified. Result is behavior passed/evidence reviewable/visual incomplete, expected exit 1. This demonstrates signoff recording and refusal to approve incomplete/differing evidence, not a visual pass. 07 must inspect full 36 groups and combined states and retain unresolved visual differences rather than converting them to pass.

## Verification

Node v24.22.1, Chrome. Public evidence CLI 35 tests passed; public review CLI 20 tests passed, including full explicit controlled declaration, absent/duplicate groups and regions, reviewer/time/observations, required differences/unverified, image and contract mismatch, original mutation, SHA-only and manifest-only explicit reuse. Test fixtures are synthetic validation declarations, never product signoffs. Shared fixture setup was extracted without changing 05 assertions.

Typecheck passed. Lint check passed, 275 existing/0 new. Logs: `/private/tmp/checks06-cli-tests.log` (54 before final metadata case), `/private/tmp/checks06-review-tests-final.log` (final 20 review cases), `/private/tmp/checks06-typecheck.log`, `/private/tmp/checks06-lint.log`. No backend changes, hook install, push or new workflow platform.
