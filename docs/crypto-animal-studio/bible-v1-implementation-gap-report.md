# Bible v1 — Implementation Gap Report

Status: **Non-implementation analysis.** This document records the distance between the
current codebase and [Crypto Animal Bible v1](Crypto_Animal_Bible_v1.md), as ratified by
[ADR-015](../adr/ADR-015-crypto-animal-bible-v1-canon.md). It changes no code, schema, tests,
or samples, and proposes no unapproved work.

Baseline at time of writing: Sprint 4 complete (CAS suite **68 passing**), EpisodePackage v1
unchanged, Prompt Builder v0 (deterministic, mock providers only).

## Classification legend

| Class | Meaning |
|---|---|
| **A — Immediate documentation/governance** | Resolved by writing/deciding; no code. |
| **B — Sprint 4A compatibility** | Non-destructive alignment of constants, fixtures, docs. |
| **C — First Real Video requirement** | Must exist before a canonical episode can be produced. |
| **D — Prompt Builder v1 requirement** | Belongs to the scoped prompt rebuild. |
| **E — Future schema proposal** | Needs an approved EpisodePackage v1.1/v2 + ADR. |
| **F — Human quality review** | Judgement-based; not automatable. |

"Blocks Sprint 4A" = would prevent the non-destructive compatibility step from completing.
Sprint 4A is assumed to be: align constants/fixtures/docs to canon **without** deleting legacy
values, changing the schema, or altering pipeline behavior.

---

## G-01 · Launch cast conflict (canonical trio vs legacy six)

- **Class:** B — Sprint 4A compatibility (enforcement lands in C/D)
- **Current state:** `RECURRING_CHARACTER_KEYS = {bull, bear, fox, hammy, monkey, walter}` in
  `backend/app/crypto_animal_studio/domain/episode_package.py`; docs and the demo sample use
  Bull / Bear / Walter.
- **Canonical target:** Bruno Bull, Boris Bear, Milo Cat as the launch trio (Bible §3); legacy
  keys retained as technical compatibility values only (ADR-015 §2.5).
- **Blocks Sprint 4A:** No — the constant is a non-enforcing reference; legacy values stay.
- **Proposed sprint:** 4A (add canonical trio alongside legacy, documented as such); canonical
  enforcement in Prompt Builder v1 / First Real Video.
- **Risk:** Low. Additive only. Risk is *ambiguity* if both sets are listed without labelling
  which is canonical — labelling is mandatory.

## G-02 · "Walter substituted for Milo" hazard

- **Class:** A — Immediate documentation/governance
- **Current state:** No rule prevented reusing Walter as the deadpan closer; the demo sample
  casts Walter in exactly Milo's structural role.
- **Canonical target:** Walter must never be substituted for Milo in new canonical content
  (ADR-015 §2.5).
- **Blocks Sprint 4A:** No.
- **Proposed sprint:** Recorded now (ADR-015); mechanical enforcement with Prompt Builder v1.
- **Risk:** Low technically, high creatively if ignored — it would ship an off-canon character.

## G-03 · Episode runtime (45s fixture vs 15–30s canon)

- **Class:** B (fixture) / C (production rule)
- **Current state:** `samples/cas/demo_episode.json` declares `target_duration_seconds: 45`
  with shots summing to 39s; no runtime validation exists.
- **Canonical target:** 15–30 seconds (Bible header, §13).
- **Blocks Sprint 4A:** No — the sample is a technical fixture for pipeline tests, and Sprint 4
  tests assert pipeline behavior, not runtime canon.
- **Proposed sprint:** 4A may add a *canonical* sample (without deleting the legacy fixture);
  runtime validation belongs to First Real Video / quality gate.
- **Risk:** Medium if the legacy fixture is edited in place — Sprint 4 tests and the ledger
  payload hash depend on its exact content. Prefer adding a new canonical sample.

## G-04 · 9:16 format not represented or enforced

- **Class:** D + E (representation) / C (production)
- **Current state:** `creative_direction.format` is free text (`"short_form_vertical"`); no
  aspect-ratio, fps, or resolution field exists; nothing validates them.
- **Canonical target:** 9:16 designed-in from the start, plus an explicit format block in every
  prompt (Bible §6, §10.1).
- **Blocks Sprint 4A:** No.
- **Proposed sprint:** Prompt Builder v1 can emit format from constants; first-class schema
  fields require an approved v1.1/v2 proposal.
- **Risk:** Low now; medium later if prompts and schema disagree about format authority.

## G-05 · Traditional Chinese subtitles have no schema representation

- **Class:** E — Future schema proposal
- **Current state:** EpisodePackage v1 has a single `language` field; `DialogueLine` carries
  `text` only — no translation/subtitle field.
- **Canonical target:** English dialogue with Traditional Chinese subtitles for publishable
  episodes (Bible §7, ADR-015 §2.3).
- **Blocks Sprint 4A:** No.
- **Proposed sprint:** Approved EpisodePackage **v1.1/v2** proposal with its own ADR. Must not
  be bolted on ad hoc (ADR-015 §2.8).
- **Risk:** Medium — a schema change touches the contract, importer mapping, and the manifest;
  it needs versioning discipline and backward compatibility for v1 packages.

## G-06 · Fact card / CTA beat has no dedicated representation

- **Class:** E — Future schema proposal (short-term workaround possible)
- **Current state:** No field for the closing factual card or the
  "For education and entertainment, not financial advice" caption; it could only live inside a
  shot's free-text fields.
- **Canonical target:** A required 2–4s factual landing beat (Bible §7).
- **Blocks Sprint 4A:** No.
- **Proposed sprint:** Same v1.1/v2 proposal as G-05; interim convention (final shot carries it)
  may be documented without a schema change.
- **Risk:** Low-medium; mainly a traceability gap (the disclaimer should be machine-checkable).

## G-07 · Prompt Builder v0 does not satisfy Bible §10

- **Class:** D — Prompt Builder v1 requirement
- **Current state:** `prompt_builder.py` emits a single flat string
  (`style | scene | characters | action | camera | image_prompt`) and a generic
  `BASE_NEGATIVE_PROMPT`; it injects **display names only**.
- **Canonical target:** 11 explicit blocks (format, world anchor, style anchor, character
  anchor, shot intent, composition, action, camera, lighting, continuity, exclusions), with the
  rule that names alone are insufficient — full locked identities or reference images must be
  injected (Bible §10).
- **Blocks Sprint 4A:** No.
- **Proposed sprint:** **Prompt Builder v1** (separate, scoped; not authorized by ADR-015).
- **Risk:** Low to implement additively (v0 can remain for existing tests); high creative risk
  if real generation runs on v0 prompts.

## G-08 · Negative prompts are generic, not Bible-derived

- **Class:** D — Prompt Builder v1 requirement
- **Current state:** One generic quality-oriented negative string.
- **Canonical target:** Exclusions covering Bible §9 "Never allow": duplicate characters, extra
  limbs/fingers/horns/ears/tails, human hands replacing paws/hooves, clothing changes between
  adjacent shots, eye-colour/marking drift, readable AI-generated financial text as final
  footage, provider logos/watermarks, unintended real-company branding.
- **Blocks Sprint 4A:** No.
- **Proposed sprint:** Prompt Builder v1, plus per-character "approved negative prompt" assets.
- **Risk:** Low technically; directly determines visual defect rate in real generation.

## G-09 · Character reference package incomplete

- **Class:** C — First Real Video requirement
- **Current state:** Jellyfish `AssetViewAngle` supports FRONT/LEFT/RIGHT/BACK/THREE_QUARTER/
  TOP/DETAIL, which covers most required views; there is **no** representation for a
  six-expression sheet, an immutable character description, or an approved negative prompt.
- **Canonical target:** Per-character package: front portrait, L/R three-quarter, full-body
  front+side, six-expression sheet, palette, signature prop, immutable description, approved
  negative prompt (Bible §9).
- **Blocks Sprint 4A:** No.
- **Proposed sprint:** First Real Video preparation (asset production) + Prompt Builder v1
  (consumption). Storage of description/negative-prompt may need the v1.1/v2 proposal.
- **Risk:** Medium — this is the main lever for character consistency; missing references are
  the most likely cause of identity drift.

## G-10 · Style anchors (palette, shape language, lighting) unencoded

- **Class:** D — Prompt Builder v1 requirement
- **Current state:** No constants anywhere for the locked palette (`#0B1220`, `#6F8199`,
  `#16C784`, `#EA3943`, `#18A7A0`, `#F5B942`), shape language, or lighting rules.
- **Canonical target:** Style anchor block injected into every prompt (Bible §5, §10.3).
- **Blocks Sprint 4A:** No.
- **Proposed sprint:** Prompt Builder v1 (CAS-local style constants, mirroring the Bible).
- **Risk:** Low; note the accessibility rule (red/green must not be the sole carrier of meaning)
  must survive into prompts and review.

## G-11 · Camera rules unenforced

- **Class:** D (prompt) + F (review)
- **Current state:** `CameraSpec` carries shot_type/angle/movement enums that map cleanly to
  Jellyfish; nothing enforces "one dominant camera action", safe-area framing, or the
  avoid-list (continuous orbiting, extreme distortion, purposeless shake).
- **Canonical target:** Bible §6 shot vocabulary and rules.
- **Blocks Sprint 4A:** No.
- **Proposed sprint:** Prompt Builder v1 for prompt-side constraints; human review for the rest.
- **Risk:** Low. The existing enum surface is already Bible-compatible.

## G-12 · Financial-integrity language rules unchecked

- **Class:** F (review) with an automatable subset
- **Current state:** No lint for prohibited phrasing; the importer/pipeline never inspects
  dialogue for "guaranteed", "risk-free", or buy/sell commands.
- **Canonical target:** Bible §7 financial integrity; predictions labelled as opinion/scenario/
  belief; source+timestamp in metadata, not spoken dialogue.
- **Blocks Sprint 4A:** No.
- **Proposed sprint:** A deterministic phrase check is feasible alongside the quality gate;
  nuance (is this framed as opinion?) stays human.
- **Risk:** Low technically, high compliance risk if unaddressed before publishing.

## G-13 · Quality gate: automated vs human split undefined

- **Class:** F — Human quality review (+ partial automation)
- **Current state:** Bible §11 lists 10 pass/fail criteria; none are implemented, and the split
  is undefined.
- **Canonical target:** Every criterion labelled as an automated check or a human review check
  (ADR-015 §2.10). Plausibly automatable: text-added-in-post, market claim vs source package,
  camera-action count, frame legibility proxies. Human: character recognizability, comedic
  function, spatial/emotional continuity, defect distraction.
- **Blocks Sprint 4A:** No.
- **Proposed sprint:** Quality-gate design, after Prompt Builder v1.
- **Risk:** Reputational if "quality gate implemented" is claimed without the distinction.

## G-14 · Production output is mock-only (`.txt`, no real 9:16 video)

- **Class:** C — First Real Video requirement
- **Current state:** Sprint 4 mock providers write deterministic `.txt` placeholders; no real
  image/video/voice provider, no FFmpeg, synchronous execution, local filesystem storage.
- **Canonical target:** Real 9:16 video with the canonical trio, subtitles, and a fact card.
- **Blocks Sprint 4A:** No — mock-only is Sprint 4's accepted design (ADR-014).
- **Proposed sprint:** Sprint 5 (real providers behind the existing adapter interfaces),
  then task-center execution and S3/RustFS storage.
- **Risk:** Medium — must reuse Jellyfish `Provider`/`Model`/`ModelSettings` and the existing
  task system; a second provider or task system is prohibited.

## G-15 · Bible location vs referenced path

- **Class:** A — Immediate documentation/governance
- **Current state:** The Bible lives at `docs/crypto-animal-studio/Crypto_Animal_Bible_v1.md`;
  it has been referenced in conversation as `docs/cas/...`.
- **Canonical target:** One agreed path, referenced consistently by ADRs and docs.
- **Blocks Sprint 4A:** No.
- **Proposed sprint:** Decide now; ADR-015 currently cites the actual path.
- **Risk:** Low, but broken references are a recurring documentation defect.

## G-16 · Governance record for canon

- **Class:** A — Immediate documentation/governance
- **Current state:** Resolved — [ADR-015](../adr/ADR-015-crypto-animal-bible-v1-canon.md)
  records Bible v1 as canon, the launch trio, runtime/format, and the legacy compatibility
  policy.
- **Canonical target:** Same.
- **Blocks Sprint 4A:** No.
- **Proposed sprint:** Complete.
- **Risk:** None.

---

## Summary by class

| Class | Items |
|---|---|
| A — Immediate documentation/governance | G-02, G-15, G-16 |
| B — Sprint 4A compatibility | G-01, G-03 (fixture aspect) |
| C — First Real Video requirement | G-03 (rule), G-04 (production), G-09, G-14 |
| D — Prompt Builder v1 requirement | G-04 (emit), G-07, G-08, G-10, G-11 |
| E — Future schema proposal | G-05, G-06 |
| F — Human quality review | G-11 (review side), G-12, G-13 |

## Blocking analysis

**Blocks the first real canonical video:** G-01 (canonical trio actually cast), G-03 (15–30s),
G-04 (9:16), G-05 (Traditional Chinese subtitles, for a *publishable* episode), G-07 + G-08 +
G-10 (Bible-conformant prompts with full identities and exclusions), G-09 (character reference
assets), G-14 (real providers).

**Does not block Sprint 4A:** every item above. Sprint 4A is a non-destructive alignment of
constants, fixtures, and documentation; it neither produces video nor changes the schema, so no
gap in this report prevents it from completing. The only real Sprint 4A hazard is **editing the
existing demo fixture in place** (G-03), which would perturb Sprint 4 tests and the ledger
payload hash — add a canonical sample instead.
