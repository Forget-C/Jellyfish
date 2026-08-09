# ADR-016 — EpisodePackage v1.1 (Additive Contract Extension)

- Status: **Accepted**
- Date: 2026-07-26
- Deciders: Product Owner (approval), Architect/CTO (review), Engineer (record)
- Specification: [`EpisodePackage-v1.1-proposal.md`](../crypto-animal-studio/EpisodePackage-v1.1-proposal.md)
- Related: [ADR-012](ADR-012-episode-importer.md), [ADR-013](ADR-013-cas-import-ledger.md),
  [ADR-014](ADR-014-cas-production-pipeline.md), [ADR-015](ADR-015-crypto-animal-bible-v1-canon.md)
- Canon inputs: [Bible v1](../crypto-animal-studio/Crypto_Animal_Bible_v1.md),
  [gap report](../crypto-animal-studio/bible-v1-implementation-gap-report.md),
  [EP001](../crypto-animal-studio/episodes/EP001-btc-breaks-out-bruno-celebrates-too-early.md)
- Scope: **specification decision only.** No code, schema, test, sample, or migration is changed by
  this ADR.

---

## 1. Context

ADR-015 made Crypto Animal Bible v1 canon and required that any schema evolution be a separately
approved v1.1/v2 proposal. EP001 is the first canonical episode, and designing it confirmed the
gap report's findings: EpisodePackage v1 cannot represent a Traditional Chinese subtitle track
(G-05), the post-production fact card and disclaimer (G-06), the 9:16 / runtime output spec
(G-04), structured market-data provenance with a pre-render data lock, or canonical reference
assets (G-09).

Two properties of the current implementation constrain any solution. Every one of the 14 v1 models
sets `ConfigDict(extra="forbid")`, and `schema_version` is validated by **strict equality** to
`"1.0"`. Unknown fields and unknown versions are therefore hard errors — deliberate strictness that
has caught real contract drift.

EpisodePackage is also **not column-mapped** in the database: the import ledger persists only a
SHA-256 `payload_hash` and `schema_version VARCHAR(16)`, and the production tables persist derived
prompts and artifact rows. This materially affects the migration question.

## 2. Decision

Adopt a **minimal, additive EpisodePackage v1.1**:

1. **Version identification reuses the existing `schema_version` field.** No new version field is
   introduced. v1.1 documents carry `"1.1"`. Parsers accept `{"1.0", "1.1"}`; anything else —
   including an absent value, which remains a required-field error as in v1 — is rejected with a
   typed `UnsupportedSchemaVersionError` surfaced as HTTP 422.
2. **Six optional root objects** are added: `output`, `localization`, `fact_card`, `market_data`,
   `references`, `post_production`.
3. **Five optional shot fields** are added: `beginning_state`, `ending_state`,
   `generation_risks[]`, `regeneration_fallback`, `overlay_ids[]`.
4. **No existing field changes** name, type, or semantics. In particular
   `creative_direction.target_duration_seconds` is **not** reinterpreted as authoritative runtime,
   and `shots[].duration_seconds` remains the authoritative shot duration.
5. **New timing fields are integer milliseconds** (`*_ms`); existing second-based fields are
   untouched.
6. **Derived timing is authoritative.** Declared `output.*_ms` values are assertions checked
   against the derived sums with a ±50 ms tolerance; mismatch is a pre-render error.
7. **The fact card is never a shot.** It is a post-production element and must not appear in
   `shots[]`; EP001 remains exactly four generated shots.
8. **All readable financial text is post-production.** Generated imagery is never required to
   contain legible financial text.
9. **Five validation stages** are formalised: design, pre-render/data-lock, provider-input,
   post-production, publish.
10. **The package stays provider-neutral.** No provider names, models, endpoints, credentials, or
    request payloads may appear in it.
11. **Subtitles are conditionally required, never universally required.** Tracks stay structurally
    optional; an episode creates its own obligation by declaring
    `localization.required_publish_language_tags[]`. EP001 declares `["zh-Hant"]`. Legacy v1
    packages declare nothing and therefore never fail for missing subtitles. A declared-but-empty
    track is invalid from post-production onward. Rendering remains post-production.
12. **One timing coordinate system: episode-absolute integer milliseconds**, with time zero at the
    first frame of generated footage, the appended fact card occupying
    `derived_generated_ms → derived_total_ms`, and the bound
    `0 ≤ start_ms < end_ms ≤ derived_total_ms`. Subtitle cues use the identical system. `shot_id`
    is an association only and must never introduce shot-relative offsets.
13. **Market facts keep the placeholder-capable string representation** as a deliberate minimal-v1.1
    compromise: placeholders are legal at design, rejected at data lock, required to parse per their
    declared semantic rule once locked, and re-checked at publish. Typed facts plus a separate
    `placeholders{}` map are a possible **v2** improvement and are out of scope.
14. **One rounding strategy — `round_half_up`** — applied via an explicit helper everywhere
    seconds are converted to milliseconds; implementations must not rely on Python's banker's
    `round()`.
15. **API ingestion accepts both versions through the existing request models.** No new route is
    added. `CreateProductionJobRequest`, `RetryProductionJobRequest`, and `ImportEpisodeRequest`
    declare `episode_package: AnyEpisodePackage` with `union_mode="left_to_right"` — the union tries
    `EpisodePackageV11` first, then `EpisodePackage`. Version selection remains owned solely by each
    model's `allowed_schema_versions`, so no dispatch logic is duplicated. `left_to_right` is
    required because the default smart union could match the V11 payload against its parent class
    and silently drop v1.1 fields. Missing `schema_version` still yields the existing `missing`
    error, unknown versions yield an explicit 422, and payloads are never mutated or upgraded.
    OpenAPI represents the field as an `anyOf` of both schemas.
16. **Reference-asset validation is split by layer.** Canonical package validation owns key
    consistency, required-reference presence **for characters actually used by shots**, path/asset-ID
    shape, and rejection of unsafe or provider-specific references. Existence checking against an
    asset registry or the repository, and resolution into provider-ready input, belong to the
    **provider-input / orchestration preflight**. **Schema parsing performs no filesystem, registry,
    or network I/O.** No registry abstraction exists yet; existence checking is deferred to
    provider integration.
17. **Re-timing belongs to post-production assembly.** Changing shot order or duration invalidates
    absolute subtitle and overlay timing; the post-production assembly stage recomputes them, and
    the package must then be **revalidated from `pre_render_data_lock` through `publish`**.
    Automatic re-timing is not implemented in v1.1 — validation fails on stale timing so the fix is
    explicit.

## 3. Detailed compatibility policy

- **v1 documents remain permanently valid.** Every added field is optional; a `"1.0"` document
  parses unchanged under a v1.1 parser, and its canonical payload hash is byte-identical, so the
  existing sample, the ledger rows, and the 68 CAS tests are unaffected.
- **Version parsing rules.** `schema_version` remains the sole discriminator; v1 keeps `"1.0"` with
  its existing semantics; v1.1 declares `"1.1"`; the upgraded parser accepts an explicit
  `SUPPORTED_SCHEMA_VERSIONS = {"1.0", "1.1"}` membership set (never a range or prefix match).
  A **missing** `schema_version` follows the behaviour already in the implementation — it is a
  required field, so absence is a missing-field validation error; no fallback or default version is
  invented. **Unknown versions fail explicitly** with a typed `UnsupportedSchemaVersionError`
  (HTTP 422) and are never coerced to the newest version. **No version is silently upgraded during
  parsing**, and **existing v1 payload hashes are never rewritten or recomputed** merely because a
  v1.1-capable parser read the document.
- **Compatibility is backward, not forward.** Because of `extra="forbid"` and strict version
  equality, a v1.1 document **cannot** be parsed by unmodified v1 code — with or without new
  fields present. This is accepted deliberately and stated plainly rather than concealed.
- **No silent reinterpretation.** No existing field acquires new meaning. Where v1 already has a
  suitable field (`shots[].continuity_notes`, `shots[].camera.movement`) v1.1 adds a *rule*, not a
  duplicate field.
- **Defaults are derived, never written back.** When `output` is absent, defaults (9:16,
  1080×1920, 30 fps, vertical) apply to the derived view only; the source document is never
  mutated.
- **Value semantics are explicit.** *missing*, `null`, *empty*, *defaulted*, and *invalid* are
  distinguished, so "not specified" and "specified as nothing" never collapse together.
- **The legacy demo sample is immutable.** `samples/cas/demo_episode.json` must not be edited; a
  canonical v1.1 sample is **added** alongside it, because Sprint 4 tests and the ledger payload
  hash depend on the legacy file's exact bytes.

## 4. Alternatives considered

| Alternative | Verdict |
|---|---|
| Full **v2** redesign | Rejected — violates the minimal-change mandate and breaks importer, hashes, and tests with no EP001 benefit. |
| Relax models to `extra="ignore"` for forward compatibility | Rejected — would silently absorb typos and contract drift, destroying the strictness that gives the contract its value. |
| Carry subtitles/fact card inside the free-form `shots[].metadata` dict | Rejected — an untyped shadow contract; cue-level timing rules could not be validated. |
| Reinterpret `target_duration_seconds` as authoritative runtime | Rejected — a silent semantic change to an existing field, and an int cannot carry millisecond precision. |
| Add a second `package_version` field | Rejected — duplicate source of truth for versioning. |
| Store subtitles as an SRT/VTT blob | Rejected — not validatable or queryable at cue level. |
| Make the fact card a fifth generated shot | Rejected — would push readable financial text into AI-generated imagery and break the four-shot canon. |
| Embed provider URLs/credentials for reference assets | Rejected — security and provider-neutrality violation; adapters resolve `asset_id` themselves. |

## 5. Consequences

**Positive.** EP001 becomes representable end to end (9:16, 24.0 s, four shots + 3.0 s card,
zh-Hant subtitles, Milo's final line, optional notification overlay, provenance with a data lock,
reference assets, disclaimer). Placeholder-bearing designs are legal while rendering and publishing
are gated. No database migration. Existing behaviour and tests are untouched.

**Trade-offs.** Two schema versions must be supported in parsing and tests. v1.1 documents are
unreadable by unmodified v1 code. Seconds (existing) and milliseconds (new) coexist, requiring a
documented conversion. The contract grows meaningfully in surface area, and validation logic splits
into five stages that must each be tested.

**Risks.** Mis-specified subtitle cues could reach rendering if stage rules are skipped; the ±50 ms
timing tolerance needs to be honoured consistently; `market_data` placeholder-capable strings rely
on the data-lock rule rather than on types.

## 6. Migration strategy

Approve → implement the parser (`SUPPORTED_SCHEMA_VERSIONS`, optional models, typed unsupported-
version error) → implement the five validators as separate callables → **add** a canonical v1.1
sample without touching the legacy one → let the importer and production pipeline read new fields
opportunistically → hand `beginning_state`/`ending_state`/`references`/`generation_risks` to Prompt
Builder v1 in its own sprint.

No data migration and no backfill: stored ledger rows keep `schema_version = "1.0"` and remain
correct, and no existing artifact or hash changes.

## 7. Validation-stage decision

Validation is explicitly **staged rather than monolithic**:

| Stage | Placeholders | Gate |
|---|---|---|
| Design | allowed | structural and referential integrity |
| Pre-render / data-lock | **forbidden** | facts resolved and parseable per their semantic rule, `data_lock.status = "locked"`, timing assertions within ±50 ms, format resolved, subtitle cue rules |
| Provider-input | n/a | required generation inputs and references present; no forbidden URL or credential anywhere |
| Post-production | n/a | required overlays placeable; **every declared required publish language has a non-empty subtitle track**; overlay bounds inside `[0, derived_total_ms]` |
| Publish | **forbidden** | required subtitle tracks complete, disclaimer present, prohibited-phrase scan passes, runtime in the 15–30 s canonical range, **placeholder check repeated** |

A design document containing `{{PLACEHOLDER}}` tokens is **valid at design stage and invalid at
pre-render and publish**. This is the mechanism that prevents unresolved factual placeholders from
reaching rendering or publishing.

## 8. Provider-neutrality decision

The canonical package describes **what the episode is**, never **how a vendor is called**.

**Allowed:**

- a **public market-data provenance URL** in `market_data.source_url`;
- a stable **repository-relative asset path** (`references.*.path`) or canonical opaque
  **asset ID** (`references.*.asset_id`).

**Forbidden at every version:**

- provider **API endpoints**;
- **signed URLs**;
- **temporary / expiring download URLs**;
- **account-specific URLs**;
- **credentials, API keys, authorization headers, or tokens**;
- **provider-native generation request payloads**.

**`source_url` is evidence/provenance metadata, not a provider execution endpoint.** It exists so a
human or auditor can verify a market claim; it is never fetched to drive generation and carries no
authentication. Provider adapters resolve `asset_id` and construct their own vendor payloads at call
time. Provider-specific derived data belongs to the production layer
(`cas_production_artifacts.provider`, `provider_model`, `metadata_json`), which already records it —
keeping canonical contract fields and derived provider payload fields separate.

## 9. Rollback strategy

Because the change is additive and unreleased, rollback is cheap and requires no data work:

1. Revert `SUPPORTED_SCHEMA_VERSIONS` to strict `"1.0"` equality and remove the optional models
   from `schemas/episode_package.py`.
2. Delete the added v1.1 sample and its tests. The legacy `demo_episode.json` was never modified.
3. No database change to undo (no migration was introduced); ledger rows and payload hashes are
   unaffected.
4. Any v1.1 documents already authored become unparseable — acceptable while the feature is
   unreleased, and the reason production adoption should follow, not precede, acceptance.

## 10. Conditions required before status changes from Proposed to Accepted

This ADR **remains `Proposed`** until every condition below is demonstrably satisfied. Specification
approval alone does not move it to `Accepted`; the implementation must exist and be verified.

**Implementation conditions**

1. **Schema implementation complete** — the six optional root objects and five optional shot fields
   exist in `schemas/episode_package.py` exactly as specified, with
   `SUPPORTED_SCHEMA_VERSIONS = {"1.0", "1.1"}` and the typed `UnsupportedSchemaVersionError`.
2. **Lifecycle validators implemented** — design, pre-render/data-lock, provider-input,
   post-production, and publish exist as **separate callables**, so a design-stage document is never
   blocked by data-lock rules.
3. **EP001-shaped fixture validates** — a fixture matching the §8 example passes design validation
   while holding placeholders, and **fails** pre-render and publish until data-locked; the
   data-locked variant passes both.

**Regression conditions**

4. **Legacy v1 sample unchanged** — `samples/cas/demo_episode.json` is byte-identical, and its
   canonical payload hash is unchanged.
5. **All existing v1 tests pass** — the CAS baseline (68) stays green with no modifications to
   existing tests.
6. **New v1.1 tests pass** — covering version handling, subtitle cue rules, the conditional
   subtitle-requirement policy, overlay absolute-timing bounds, timing assertions and rounding,
   data-lock placeholder rejection, and provider-neutrality (forbidden URL/credential) rejection.

**Confirmation conditions**

7. **No database migration** — confirmed against the code that EpisodePackage remains non-column-
   mapped, `cas_import_ledger.schema_version VARCHAR(16)` already accommodates `"1.1"`, and no
   table changes.
8. **Documentation and implementation field paths match exactly** — every field path in this ADR and
   in the proposal resolves to a real implemented path, with no drift in names, nesting, or types.

**Governance conditions**

9. Product Owner approves the additive field set and the EP001 acceptance scenarios.
10. Architect/CTO confirms the backward-only compatibility policy.
11. The two remaining open questions in the proposal (§15) are answered or explicitly deferred with
    an owner.
12. An implementation sprint is scoped and authorized; Prompt Builder v1 is confirmed as a separate
    sprint that consumes — but does not define — this contract.
