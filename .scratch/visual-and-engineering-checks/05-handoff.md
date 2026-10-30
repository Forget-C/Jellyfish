# 05 implementation handoff

Implementation complete; integration is owned by the merger. Public seams were already confirmed. No old 01–60/previous environment-check ticket or spec was edited; no production interface, model provider, hook installation or push was introduced.

## Public evidence command and schema (v1)

```bash
node front/scripts/visual-evidence.mjs --behavior passed
node front/scripts/visual-evidence.mjs \
  --manifest front/tests/visual-baselines/c-794ee4a0-v1/manifest.json \
  --matrix /path/to/run/matrix.json --run /path/to/run/visual-run.json \
  --output /path/to/run/visual-result.json
```

The first command reports behavior `passed`, evidence `not-checked`, visual `not-reviewed`. Evidence mode requires all three input files. It returns zero only if behavior passed and evidence is reviewable. Failure reports a concrete group/role/reason; no visual approval is inferred.

Top level: `schemaVersion:1`, `behavior:{status}`, `evidence:{status,errors}`, `visual:{status:'not-reviewed'}`, `baselineVersion`, `manifest:{path,sha256}`, `contract:{path,sha256}`, `run`, `groups`.

Each group: `key` (`F01-text-default-1440x960`), `id`, `kind`, `state`, `viewport:{width,height}`, `zoom`, `regions`, `target:{full,editor,card?,cardWithTitle?}`, `actual:{page,editor,card}`, `capture`, `captureSha256`, `differences` (actual file, intrinsic media dimensions, text, selected model, parameters, adopted structured references and output identity, as applicable), `cardOmission`.

Each image: `{path,relativePath,sha256,width,height}`. `path` is absolute convenience; `relativePath` resolves against the result JSON directory. All target PNG hashes/dimensions must match the authoritative supplied manifest. Matrix-embedded historical `target` is ignored. Rechecking a relocated artifact refreshes absolute links. PNG framing/checksums and real Chrome decode are both required; browser decode alone tolerates truncated PNGs.

Capture state: `{viewport,zoom,card,outputs,media,images:{page,editor,card}}`, where each image binding is `{file,sha256}`. Page/editor identities are recorded immediately after capture; card identities are recorded after the existing paired card capture, before verification. `card` and `outputs` come from existing public HTTP. `media` records rendered image source/intrinsic dimensions. The CLI checks kind/input/output/selected-model semantics, exact viewport/zoom, full-page dimensions, unchanged default/expanded content/file/adoption/output and per-image capture binding. Matrix order is irrelevant.

Run: `{schemaVersion:1,runId,capturedAt,sourceRevision,fixtureRevision,fixtureFiles,sourceChanges,environment:{node,browser,platform},behavior,states:'visual-states.json'}`. Revisions are real Git revisions; fixtureFiles contain actual content hashes and sourceChanges reports dirty-worktree information. Baseline and contract identity are content-based, so later review must bind these and image hashes, not just a commit SHA.

`regions` are explicit by kind/state: page/context; card/title; editor/body; editor/actions; model kinds additionally editor/inputs + editor/parameters; empty states additionally empty-state. Contract descriptions include common surface/title/icon/weak status, whitespace and image/text proportions, labels/actions, units, single material/current-model submission, empty state, focus and obstruction. 06 may record detailed observations under those applicable regions. The contract hash must match its manifest identity. A 390px target-card omission is constrained to the documented prototype limitation and does not waive actual card evidence.

## Real page result available for 06

Public run (Chrome 156.0.8078.48, Node v24.22.1, darwin/arm64):

```bash
C60_PROTOTYPE_MANIFEST=/private/tmp/jellyfish-checks-05/front/tests/visual-baselines/c-794ee4a0-v1/manifest.json \
PLAYWRIGHT_CHANNEL=chrome pnpm --dir front run test:browser generation-canvas-four-card-acceptance --output /private/tmp/checks05-four-card
```

The command used Node 24 first in PATH. It passed preflight and the full existing real-page/HTTP/fake-worker behavior assertions in 111.5s, including all 36 groups and edge interactions. Evidence root: `/private/tmp/checks05-four-card`; case directory: `/private/tmp/checks05-four-card/generation-canvas-four-card-acceptance`.

- `visual-run.json`: capture source and fixture revision `031ed26077e57a19d9d6d3b47ce63391734b5e36`, actual fixture hashes and environment. Dirty files at capture were only this ticket's README and CLI tests.
- `visual-result.json`: original capture-time verifier result.
- `visual-result-rechecked.json`: final verifier/contract recheck of the same 36 captured originals; **use this for 06**. This is explicit evidence reuse, not a new page run or visual review. Final contract SHA-256 `71a9bf7c9963bedcb141075fa41a022e4e1ef261217698c14afdbe42db44c49f`.
- Final independent conclusions: behavior `passed`; evidence `reviewable` with zero errors and 36 groups; visual `not-reviewed`.
- `visual-index.md`, `matrix.json`, `visual-states.json`, original screenshots, backend logs, media and original runner `results.json` are retained under the existing output layout.

Final recheck command:

```bash
node front/scripts/visual-evidence.mjs \
  --manifest front/tests/visual-baselines/c-794ee4a0-v1/manifest.json \
  --matrix /private/tmp/checks05-four-card/generation-canvas-four-card-acceptance/matrix.json \
  --run /private/tmp/checks05-four-card/generation-canvas-four-card-acceptance/visual-run.json \
  --output /private/tmp/checks05-four-card/generation-canvas-four-card-acceptance/visual-result-rechecked.json
```

Actual original-image inspection in 05 was limited to six images: F01 1440 target editor + actual editor; target title-inclusive card + actual card; F04 390 target editor + actual editor. Those showed real text/title differences, controlled 320×180 image content and explicit stacked mobile actions. This is sample inspection only. No whole-page sample was opened here; no 36-group visual signoff was performed. 06 must independently open originals for its demonstrated signoff; 07 owns complete 36-group review.

## Validation and scope

- TDD through public CLI only: 35 tests passed (ordinary classification, complete matrix incl reordered input, missing target/group/file, duplicate/wrong kind/state/viewport, source/version/environment, PNG corruption/truncation, target/contract identity, capture file binding, selected/input/output semantics, paired-content changes, behavior failure).
- `pnpm --dir front run typecheck`: passed.
- `pnpm --dir front run lint:check`: passed, 275 existing entries and zero new findings.
- Updated verifier successfully rechecked the real captured 36 groups after its order-independent pairing refinement and final initial-contract wording/anchor refinement. Capture code and originals were reused explicitly.
- No backend application change; no Pylint/OpenAPI regeneration required. TypeScript application code is unchanged.

Merger should retain both 04's shared capture/failure helpers and 05's one capture-state recording call, final three-conclusion summary and original-error-preserving failed summary. The worktree has already merged integration `84ab2fa3` and resolved those limited overlaps.
