# EpisodePackage v1.1 — Additive Contract Proposal

Status: **Proposed — specification only.** Nothing here is implemented. Decision record:
[ADR-016](../adr/ADR-016-episode-package-v1-1.md).
Canonical inputs: [Bible v1](Crypto_Animal_Bible_v1.md), [ADR-015](../adr/ADR-015-crypto-animal-bible-v1-canon.md),
[gap report](bible-v1-implementation-gap-report.md), [EP001](episodes/EP001-btc-breaks-out-bruno-celebrates-too-early.md).
Derived by read-only inspection of `backend/app/crypto_animal_studio/` at commit `c2b3ea5` plus
the uncommitted Sprint 4 production module.

---

## 1. Executive summary

EP001 cannot be represented by EpisodePackage v1. Five things are missing: a Traditional Chinese
subtitle track, the post-production fact card, an explicit 9:16 / runtime output spec, structured
market-data provenance with a data-lock gate, and canonical reference assets. This proposal adds
**six optional top-level objects** and **five optional shot fields** — no existing field is
renamed, retyped, or reinterpreted, and no v2 redesign is attempted.

The one unavoidable consequence: every v1 model sets `extra="forbid"` and `schema_version` is
validated by strict equality to `"1.0"`, so a **v1.1 document cannot be parsed by unmodified v1
code**. Compatibility therefore runs in one direction — *v1 documents stay permanently valid under
a v1.1 parser*, which is what the existing samples and tests require. §10 states this precisely
rather than claiming symmetric compatibility.

Based on the actual code, **no database migration is required** (§12).

## 2. Current v1 contract inventory

Source of truth: `backend/app/crypto_animal_studio/schemas/episode_package.py` (14 models, all
`ConfigDict(extra="forbid")`) and `domain/episode_package.py` (`SCHEMA_VERSION = "1.0"`).

| Model | Fields |
|---|---|
| `EpisodePackage` (root) | `schema_version`, `episode_id`, `title`, `logline`, `language`, `source`, `creative_direction`, `characters[]`, `assets`, `shots[]`, `metadata` |
| `NewsSource` | `source_type`, `headline`, `summary`, `source_url?`, `published_at?`, `factual_notes` |
| `CreativeDirection` | `format`, `tone`, `target_duration_seconds` (int > 0), `visual_style`, `comedy_style`, `continuity_notes` |
| `CharacterSpec` | `character_key`, `display_name`, `role`, `description`, `actor_key?`, `costume_key?`, `voice_profile?`, `continuity_notes` |
| `AssetLibrary` | `actors[]`, `scenes[]`, `props[]`, `costumes[]` (each `*_key`, `display_name`, `description`) |
| `Shot` | `shot_id`, `sequence` (>0), `title`, `duration_seconds` (float > 0), `script_excerpt`, `camera?`, `action`, `dialogue[]`, `character_keys[]`, `scene_key?`, `prop_keys[]`, `costume_keys[]`, `image_prompt`, `video_prompt`, `negative_prompt`, `continuity_notes`, `metadata` |
| `CameraSpec` | `shot_type?`, `angle?`, `movement?` (CAS-local enums) |
| `DialogueLine` | `order` (>0), `character_key?`, `text`, `line_mode` |
| `EpisodeMetadata` | `created_at?`, `generator`, `model`, `prompt_version`, `tags[]` |

**Observed consumption.** `shots[].duration_seconds` is widely consumed (importer
`round_duration()` → `ShotDetail.duration`; orchestrator; prompt builder). `language` and
`creative_direction.target_duration_seconds` currently have **zero consumers** — they are carried
but unused, so giving runtime a precise home in v1.1 creates no behavioural conflict.

## 3. Confirmed v1 gaps exposed by EP001

| # | Gap | Gap-report ID |
|---|---|---|
| 1 | No subtitle representation (zh-Hant track, cue timing, speaker) | G-05 |
| 2 | No fact card / disclaimer / CTA representation | G-06 |
| 3 | No aspect ratio, width/height, fps, or authoritative runtime | G-04 |
| 4 | No structured market provenance or data-lock gate | §3 of EP001 |
| 5 | No canonical reference assets (Bible version, character/environment/prop refs) | G-09 |
| 6 | No post-production overlay plan (chart labels, notification, fact card) | G-07/G-08 |
| 7 | No shot begin/end state, generation risks, or regeneration fallback | EP001 §5 |

## 4. Design principles

1. **Additive only.** New optional objects and fields; nothing existing changes.
2. **No duplicate truth.** Where a value can be derived, the derived value is authoritative and
   any declared value is a checked assertion (§9.2).
3. **Explicit value semantics.** *missing* ≠ *null* ≠ *empty* ≠ *defaulted* ≠ *invalid* (§6.1).
4. **Provider-neutral.** No provider names, models, endpoints, credentials, or request shapes.
5. **Staged validation.** Design-stage packages may be incomplete; rendering and publishing may
   not (§9).
6. **Post-production owns readable text.** Nothing readable and factual is required from a
   generative model.
7. **Storage-practical.** Pure JSON, no cyclic references, bounded field sizes.

## 5. Proposed additive fields

**Root (all optional):** `output`, `localization`, `fact_card`, `market_data`, `references`,
`post_production`.

**Shot (all optional):** `beginning_state`, `ending_state`, `generation_risks[]`,
`regeneration_fallback`, `overlay_ids[]`.

**Deliberately not added** (already representable in v1): continuity text → `shots[].continuity_notes`;
"exactly one dominant camera movement" → `shots[].camera.movement` (enforced by a *rule*, not a new
field); episode tone/style → `creative_direction`.

### 5.1 Timing units

New timing fields are **integer milliseconds** (`*_ms`) — exact, JSON-safe, no float drift, and
directly usable by subtitle and NLE tooling. Existing `shots[].duration_seconds` (float seconds)
is **unchanged and remains authoritative for shot duration**; conversion is
`round(duration_seconds * 1000)`. Mixing is intentional and one-directional: v1.1 never redefines
the v1 field.

## 6. Field-by-field schema table

Validation-stage column: **D**=design, **L**=pre-render/data-lock, **P**=provider-input,
**T**=post-production, **B**=publish.

### 6.1 Value semantics (applies to every optional field)

| State | Meaning | Treatment |
|---|---|---|
| missing (key absent) | not specified | default applied where one exists; otherwise feature off |
| `null` | explicitly none | same as missing, but records an intentional decision |
| empty (`""`, `[]`, `{}`) | specified as nothing | valid; may fail a *stage* rule (e.g. empty subtitle track at publish) |
| defaulted | value supplied by the parser | recorded in derived output, never written back into the source document |
| invalid | violates type or rule | hard validation error at the stage that owns the rule |

### 6.2 Root

| Field path | Type | Req. | Default | Stage | Purpose | v1 compatibility |
|---|---|---|---|---|---|---|
| `schema_version` | string | **required** | — | D | `"1.0"` or `"1.1"` | existing field, reused; no new version field |
| `output` | object | optional | see §6.3 | D/L | Format, dimensions, runtime | absent ⇒ v1 defaults applied |
| `localization` | object | optional | `null` | D/L/B | Spoken language + subtitle tracks | absent ⇒ no subtitles |
| `fact_card` | object | optional | `null` | D/L/T/B | Post card, disclaimer, CTA | absent ⇒ no card |
| `market_data` | object | optional | `null` | D/L/B | Provenance + data-lock | absent ⇒ non-market episode |
| `references` | object | optional | `null` | D/P | Bible + reference assets | absent ⇒ unconstrained identity |
| `post_production` | object | optional | `null` | D/T/B | Overlay plan | absent ⇒ no overlays |

### 6.3 `output`

| Field path | Type | Req. | Default | Stage | Purpose | v1 compatibility |
|---|---|---|---|---|---|---|
| `output.aspect_ratio` | string `"W:H"` | optional | `"9:16"` | L | Canonical framing | legacy ⇒ default |
| `output.width` | int > 0 | optional | `1080` | L | Render width | legacy ⇒ default |
| `output.height` | int > 0 | optional | `1920` | L | Render height | legacy ⇒ default |
| `output.fps` | int > 0 | optional | `30` | L | Frame rate | legacy ⇒ default |
| `output.orientation` | enum `vertical\|horizontal\|square` | optional | `"vertical"` | L | Orientation metadata | legacy ⇒ default |
| `output.generated_footage_ms` | int ≥ 0 | optional | derived | L | **Assertion** of Σ shot durations | mismatch ⇒ error (§9.2) |
| `output.total_runtime_ms` | int > 0 | optional | derived | L | **Assertion** of final runtime | mismatch ⇒ error (§9.2) |
| `output.safe_area.subtitle_bottom_pct` | number 0–50 | optional | `18` | T | Subtitle band | legacy ⇒ default |
| `output.safe_area.margin_pct` | number 0–25 | optional | `6` | T | General safe margin | legacy ⇒ default |

`creative_direction.target_duration_seconds` (v1) is **not** reinterpreted: it stays an
author-intent hint. If `output.total_runtime_ms` is present it is the assertion that gets checked;
otherwise the runtime is derived and `target_duration_seconds` is advisory only.

### 6.4 `localization`

| Field path | Type | Req. | Default | Stage | Purpose | v1 compat |
|---|---|---|---|---|---|---|
| `localization.spoken_language` | BCP 47 | optional | falls back to root `language` | L | Dialogue language | root `language` unchanged |
| `localization.required_publish_language_tags[]` | array of BCP 47 | optional | `[]` | T/B | Languages this episode **must** ship subtitles for | absent/empty ⇒ no subtitle requirement |
| `localization.subtitle_tracks[]` | array | optional | `[]` | L/B | Subtitle tracks | absent ⇒ none |
| `…tracks[].language_tag` | BCP 47 (e.g. `zh-Hant`) | **required in track** | — | L | Track language | — |
| `…tracks[].is_primary` | bool | optional | `false` | L | Default track | — |
| `…tracks[].rendering` | enum `post_production\|burned_in\|sidecar` | optional | `"post_production"` | T | Where rendering happens | — |
| `…tracks[].cues[]` | array | **required in track** | — | L/B | Cue list | — |
| `…cues[].cue_id` | string | **required** | — | L | Stable ID | — |
| `…cues[].start_ms` | int ≥ 0 | **required** | — | L | Cue in-point | — |
| `…cues[].end_ms` | int > `start_ms` | **required** | — | L | Cue out-point | — |
| `…cues[].text` | non-empty string | **required** | — | L/B | Translated text | — |
| `…cues[].speaker_character_key` | string | optional | `null` | L | Speaker link | must exist in `characters[]` |
| `…cues[].shot_id` | string | optional | `null` | L | Shot association | must exist in `shots[]` |

Subtitle rendering stays a **post-production concern** by default (`rendering:
"post_production"`); `burned_in` and `sidecar` are declarative only and do not change the contract.

#### 6.4.1 Subtitle requirement policy (finalized)

Subtitles are **conditionally required**, never universally required:

1. **Structurally optional.** `localization` and `subtitle_tracks[]` remain optional for all v1 and
   v1.1 packages. A package with no subtitle track is structurally valid.
2. **Declared requirement creates an obligation.** If an episode declares one or more language tags
   in `localization.required_publish_language_tags[]`, then a subtitle track whose `language_tag`
   matches each declared tag **must exist and be non-empty** at **post-production** and **publish**
   validation.
3. **EP001 specifically** declares `required_publish_language_tags: ["zh-Hant"]`, so EP001 cannot
   pass publish validation without a complete zh-Hant track. This obligation comes from *the
   episode's own declaration*, not from the schema.
4. **zh-Hant is never universally required.** No EpisodePackage is obliged to carry Traditional
   Chinese (or any other language) unless it declares that requirement itself.
5. **Legacy v1 packages never fail for lack of subtitles.** A `"1.0"` document has no
   `localization` object, therefore declares no required language, therefore has no subtitle
   obligation at any stage.
6. **A declared-but-empty track is invalid from post-production onward.** A track present with
   `cues: []`, or a required language whose track exists but has no cue covering any dialogue line,
   passes *design* validation (authoring in progress) but **fails post-production and publish**.
   Declaring a track is a commitment to fill it.
7. **Rendering stays post-production.** Satisfying the requirement means the cue data exists and is
   valid; burning pixels remains a post-production step, and `rendering` never shifts that
   responsibility into generation.

### 6.5 `fact_card`

| Field path | Type | Req. | Default | Stage | Purpose | v1 compat |
|---|---|---|---|---|---|---|
| `fact_card.duration_ms` | int > 0 | **required in object** | — | L | Card length | — |
| `fact_card.placement` | enum `append_after_shots\|overlay_tail` | optional | `"append_after_shots"` | L | Where it sits | — |
| `fact_card.localized[]` | array | **required in object** | — | L/B | Localized copy | — |
| `…localized[].language_tag` | BCP 47 | **required** | — | L | Language | — |
| `…localized[].body[]` | array of non-empty strings | **required** | — | L/B | Educational lines | — |
| `…localized[].disclaimer` | non-empty string | **required** | — | B | "Not financial advice" | — |
| `…localized[].cta` | string | optional | `null` | T | Optional CTA | — |
| `fact_card.readable_text_in_post` | const `true` | optional | `true` | T | Card text is composited | — |

**Rule:** the fact card is **never** a shot. It must not appear in `shots[]`, and shot count is
unaffected — EP001 stays at exactly four generated shots.

### 6.6 `market_data`

| Field path | Type | Req. | Default | Stage | Purpose |
|---|---|---|---|---|---|
| `market_data.instrument` | string (e.g. `BTC-USD`) | **required in object** | — | L | Symbol |
| `market_data.timeframe` | string (e.g. `4h`) | **required in object** | — | L | Confirmation timeframe |
| `market_data.resistance_level` | string¹ | optional | `null` | L | Level being cleared |
| `market_data.price` | string¹ | optional | `null` | L | Price at the event |
| `market_data.price_move_pct` | string¹ | optional | `null` | L | Period move |
| `market_data.pullback_pct` | string¹ | optional | `null` | L | Escalation dip |
| `market_data.event_timestamp_utc` | ISO-8601 string¹ | optional | `null` | L | Observed move |
| `market_data.candle_close_timestamp_utc` | ISO-8601 string¹ | optional | `null` | L | Confirmation close |
| `market_data.as_of_utc` | ISO-8601 string¹ | **required at L** | — | L | Data "as of" |
| `market_data.source_name` | string | **required at L** | — | L/B | Source |
| `market_data.source_url` | string | optional | `null` | L | Source link |
| `market_data.factual_note` | string | **required at L** | — | L/B | Human-checked note |
| `market_data.ath_context` | string¹ | optional | `null` | L | Optional prior-high context |
| `market_data.data_lock.status` | enum `unresolved\|locked` | optional | `"unresolved"` | L/B | Lock state |
| `market_data.data_lock.locked_at_utc` | ISO-8601 | optional | `null` | L | When locked |

¹ **Placeholder-capable**: during design these may hold `{{TOKEN}}` strings. Numeric values are
typed as strings precisely so a design-stage document stays schema-valid while unresolved; the
data-lock rule (§9.3) is what forces real values before rendering.

#### 6.6.1 Market-fact value representation (finalized)

v1.1 **retains the placeholder-capable string representation** for market facts. The policy:

1. **Design stage may hold explicit placeholders** such as `{{RESISTANCE_LEVEL}}` or
   `{{CANDLE_CLOSE_TIME_UTC}}`. This is legal and expected while an episode is being authored.
2. **Data-lock validation rejects every unresolved placeholder.** Any value matching the template
   pattern `{{…}}` anywhere in `market_data`, `fact_card`, or overlay copy is a hard error at
   pre-render.
3. **Once `data_lock.status = "locked"`, required numeric market facts must parse** according to
   their declared semantic type or validation rule — e.g. `price` / `resistance_level` must parse
   as a finite decimal number (an optional currency symbol, thousands separators, and surrounding
   whitespace are stripped first); `price_move_pct` / `pullback_pct` must parse as a finite
   decimal percentage (an optional trailing `%` is stripped); `*_utc` fields must parse as
   ISO-8601 instants.
4. **Explicitly invalid at data lock:** empty strings; whitespace-only strings; `null` where the
   field is not explicitly nullable; NaN-like strings (`"NaN"`, `"nan"`, `"inf"`, `"-inf"`,
   `"None"`, `"null"`, `"undefined"`, `"TBD"`, `"?"`); and any unresolved template.
5. **Publish validation repeats the unresolved-placeholder check** — data lock is not trusted as a
   permanent guarantee, because copy can be edited after locking.
6. **This is a deliberate minimal-v1.1 compromise**, not a claim that strings are the ideal
   long-term representation for market data. It is chosen because it keeps v1.1 additive and lets a
   design-stage document remain schema-valid while unresolved.
7. **Typed numeric facts plus a separate `placeholders{}` map remain a possible v2 improvement**
   and are explicitly **not** part of this proposal or its implementation.

#### 6.6.2 `source_url` is provenance, not an execution endpoint (finalized)

`market_data.source_url` records **where a human or auditor can verify the claim**. It is evidence
metadata. It is never fetched as part of generation, never used to call a vendor, and carries no
authentication.

**Allowed in an EpisodePackage:**

- a public market-data **provenance URL** in `market_data` source metadata (e.g. a publicly
  viewable exchange or data-provider page documenting the observed move);
- a stable **repository-relative asset path** (`references.*.path`) or a canonical opaque
  **asset ID** (`references.*.asset_id`).

**Forbidden in an EpisodePackage, at every version:**

- provider **API endpoints** (generation or market-data APIs);
- **signed URLs**;
- **temporary / expiring download URLs**;
- **account-specific URLs** (tenant, workspace, or user-scoped);
- **credentials, API keys, authorization headers, or tokens** in any field;
- **provider-native generation request payloads** (model names, sampler settings, vendor request
  bodies).

Provider adapters resolve `asset_id` and construct their own vendor payloads at call time; that
derived data lives in the production layer, never in the canonical package (§10 of ADR-016).

**Non-advisory rule.** `market_data` records observations and criteria only. No field may express
a prediction or an assurance, and the fact card copy must not state that confirmation guarantees
future performance. A prohibited-phrase scan applies to `factual_note` and all `fact_card` copy.

### 6.7 `references`

| Field path | Type | Req. | Default | Stage | Purpose |
|---|---|---|---|---|---|
| `references.bible_version` | string (e.g. `"1.0"`) | optional | `null` | D/P | Canon version |
| `references.canon_decision` | string (e.g. `"ADR-015"`) | optional | `null` | D | Governing decision |
| `references.characters[]` | array | optional | `[]` | P | Character refs |
| `…characters[].character_key` | string | **required** | — | P | Must exist in `characters[]` |
| `…characters[].asset_id` | string | **required** | — | P | Stable asset ID |
| `…characters[].kind` | enum `identity\|episode` | optional | `"identity"` | P | Immutable identity vs episode-specific |
| `…characters[].view` | string (e.g. `front`, `three_quarter_left`) | optional | `null` | P | View hint |
| `…characters[].path` | repo-relative string | optional | `null` | P | Location, **never a provider URL** |
| `references.environments[]` | same shape keyed by `scene_key` | optional | `[]` | P | Environment refs |
| `references.props[]` | same shape keyed by `prop_key` | optional | `[]` | P | Prop refs |

`asset_id` is opaque and stable; `path` is repo-relative. Provider-hosted URLs, buckets, and
credentials are prohibited (§10).

### 6.8 `post_production`

| Field path | Type | Req. | Default | Stage | Purpose |
|---|---|---|---|---|---|
| `post_production.overlays[]` | array | optional | `[]` | T/B | Overlay plan |
| `…overlays[].overlay_id` | string | **required** | — | T | Stable ID, referenced by `shots[].overlay_ids` |
| `…overlays[].type` | enum `chart_label\|subtitle\|notification\|fact_card\|disclaimer\|cta\|other` | **required** | — | T | Overlay kind |
| `…overlays[].shot_id` | string | optional | `null` | T | Target shot (null ⇒ episode-level) |
| `…overlays[].start_ms` / `end_ms` | int | optional | `null` | T | Timing within final runtime |
| `…overlays[].required` | bool | optional | `true` | B | Optional overlays may be dropped |
| `…overlays[].anchor` | enum `lower_safe\|upper_safe\|centre\|prop_local` | optional | `"lower_safe"` | T | Safe-area anchor |
| `…overlays[].localized[]` | array of `{language_tag, text}` | optional | `[]` | T | Copy |

**Rule:** all readable financial text is an overlay. No generated image or video is required to
contain legible financial text.

#### 6.8.1 Overlay timing coordinate system (finalized)

There is exactly **one** timing coordinate system in v1.1:

1. **All overlay `start_ms` / `end_ms` values are episode-absolute integer milliseconds.**
2. **Time zero is the first frame of generated footage** (the start of the shot with
   `sequence = 1`).
3. **The appended fact card begins at `derived_generated_ms`** and ends at `derived_total_ms`
   (EP001: 21 000 → 24 000 ms).
4. **Overlay timing may address either interval** — a moment inside generated footage, or a moment
   inside the appended fact-card interval. Both are expressed in the same absolute scale.
5. **Bounds:** an overlay must satisfy `0 ≤ start_ms < end_ms ≤ derived_total_ms`. Starting before
   0 or ending after `derived_total_ms` is a hard error at post-production validation.
6. **`shot_id` is an association, not a clock.** A shot-specific overlay may carry `shot_id` for
   grouping, diagnostics, and regeneration bookkeeping, but its **absolute timing remains
   authoritative**. When both are present, absolute timing wins and the pair is cross-checked: the
   overlay's window must fall inside that shot's absolute window (±150 ms tolerance), otherwise the
   document is inconsistent and fails validation.
7. **`shot_id` must never introduce shot-relative offsets.** There is no `offset_ms`,
   `relative_start_ms`, or equivalent field, and none may be added in v1.1.
8. **Subtitle cues use the identical system.** `localization.subtitle_tracks[].cues[].start_ms` /
   `end_ms` are episode-absolute milliseconds with the same zero point and the same bounds rule, so
   cues and overlays are directly comparable without conversion.

**Why shot-relative timing was rejected for v1.1.** (a) It would create a *second* source of truth —
a cue would be defined by both a shot and an offset, and any shot re-time would silently move it,
which is exactly the duplicate-truth failure mode this proposal is built to avoid. (b) The fact card
is deliberately **not** a shot, so shot-relative timing has no way to address the 21 000–24 000 ms
interval without inventing a pseudo-shot. (c) Composition, subtitle formats (SRT/VTT), and NLE
tooling are all absolute-timeline based; emitting them from shot-relative data requires a
resolution step that can silently drift. (d) Validating "no overlap" and "within runtime" is trivial
in absolute time and awkward across shot boundaries. The cost is that re-timing a shot requires
recomputing dependent cue times — an explicit, testable operation, which is preferable to an
implicit one.

### 6.9 Shot extensions

| Field path | Type | Req. | Default | Stage | Purpose | v1 compat |
|---|---|---|---|---|---|---|
| `shots[].beginning_state` | string | optional | `""` | D/P | Start state for generation | new |
| `shots[].ending_state` | string | optional | `""` | D/P | End state for generation | new |
| `shots[].generation_risks[]` | array of strings | optional | `[]` | D/P | Known defect risks | new |
| `shots[].regeneration_fallback` | object | optional | `null` | P | Recovery-only alternative | new |
| `…regeneration_fallback.camera_movement` | CAS movement enum | optional | `null` | P | Fallback movement | reuses existing enum |
| `…regeneration_fallback.note` | string | optional | `""` | P | Why/when it applies | — |
| `shots[].overlay_ids[]` | array of strings | optional | `[]` | T | Links to `post_production.overlays[]` | new |

**Camera rule, not a field.** "Exactly one dominant camera movement" is enforced at pre-render as a
*rule* on the existing `shots[].camera.movement` (must be present and single-valued for canonical
episodes). `regeneration_fallback` is explicitly **recovery-only** and never an equal option.

## 7. Proposed JSON structure

```
EpisodePackage (v1.1)
├── (all v1 fields, unchanged)
├── output              { aspect_ratio, width, height, fps, orientation,
│                         generated_footage_ms, total_runtime_ms, safe_area{…} }
├── localization        { spoken_language, required_publish_language_tags[],
│                         subtitle_tracks[ { language_tag, is_primary,
│                         rendering, cues[ {cue_id,start_ms,end_ms,text,
│                         speaker_character_key?,shot_id?} ] } ] }
├── fact_card           { duration_ms, placement, readable_text_in_post,
│                         localized[ {language_tag, body[], disclaimer, cta?} ] }
├── market_data         { instrument, timeframe, …facts…, source_name, source_url,
│                         factual_note, data_lock{status, locked_at_utc} }
├── references          { bible_version, canon_decision, characters[], environments[], props[] }
├── post_production     { overlays[ {overlay_id,type,shot_id?,start_ms?,end_ms?,
│                         required,anchor,localized[]} ] }
└── shots[]             + beginning_state, ending_state, generation_risks[],
                          regeneration_fallback?, overlay_ids[]
```

## 8. Illustrative EP001-shaped example

> **Design-stage example only — not production-ready and not publishable.** It intentionally
> retains `{{PLACEHOLDER}}` tokens and `data_lock.status = "unresolved"`, which by design **fail**
> pre-render and publish validation (§9). Shots are abbreviated; the full creative detail lives in
> the EP001 document.

```json
{
  "schema_version": "1.1",
  "episode_id": "CAS-EP001",
  "title": "BTC Breaks Out — Bruno Celebrates Too Early",
  "logline": "Bitcoin pushes above resistance, Bruno throws a party on the signal alone.",
  "language": "en",
  "source": {
    "source_type": "news",
    "headline": "BTC moves above {{RESISTANCE_LEVEL}}",
    "summary": "Price moved above a prior resistance area; confirmation still outstanding.",
    "source_url": null,
    "published_at": "{{BREAKOUT_TIMESTAMP_UTC}}",
    "factual_notes": "Initial breakout signal only. Not a confirmed breakout."
  },
  "creative_direction": {
    "format": "short_form_vertical",
    "tone": "deadpan",
    "target_duration_seconds": 24,
    "visual_style": "premium stylized 3D",
    "comedy_style": "personality collision",
    "continuity_notes": "Bible v1 locked identities; The Burrow layout fixed."
  },
  "characters": [
    { "character_key": "bruno_bull", "display_name": "Bruno Bull", "role": "momentum trader",
      "description": "Anthropomorphic bull; chestnut-brown fur; forest-green rolled-sleeve shirt; mustard tie; black smartwatch on left wrist.",
      "actor_key": "actor_bruno", "costume_key": "costume_bruno_office",
      "voice_profile": "warm baritone, energetic", "continuity_notes": "Tallest. No jacket, hat, or glasses." },
    { "character_key": "boris_bear", "display_name": "Boris Bear", "role": "risk manager",
      "description": "Anthropomorphic bear; charcoal-brown fur; burgundy knit vest over pale blue shirt; rectangular black reading glasses.",
      "actor_key": "actor_boris", "costume_key": "costume_boris_office",
      "voice_profile": "low, controlled", "continuity_notes": "Wider than Milo; red notebook and pen." },
    { "character_key": "milo_cat", "display_name": "Milo Cat", "role": "strategist",
      "description": "Anthropomorphic burnt-orange tabby; three forehead stripes; dark teal turtleneck; silver Bitcoin pin on left chest.",
      "actor_key": "actor_milo", "costume_key": "costume_milo_office",
      "voice_profile": "smooth, understated", "continuity_notes": "Shortest. Matte black mug." }
  ],
  "assets": {
    "actors": [ { "actor_key": "actor_bruno", "display_name": "Bruno", "description": "Bull identity plate." },
                { "actor_key": "actor_boris", "display_name": "Boris", "description": "Bear identity plate." },
                { "actor_key": "actor_milo", "display_name": "Milo", "description": "Cat identity plate." } ],
    "scenes":  [ { "scene_key": "the_burrow", "display_name": "The Burrow", "description": "Trading studio: curved desk, wall BTC chart, coffee station, glass wall." } ],
    "props":   [ { "prop_key": "wall_btc_chart", "display_name": "Wall BTC chart", "description": "Abstract, textless chart plate." },
                 { "prop_key": "milo_phone", "display_name": "Phone", "description": "Supporting screen prop; glow only, no legible text." } ],
    "costumes":[ { "costume_key": "costume_bruno_office", "display_name": "Bruno office", "description": "Forest-green shirt, mustard tie." },
                 { "costume_key": "costume_boris_office", "display_name": "Boris office", "description": "Burgundy vest, pale blue shirt." },
                 { "costume_key": "costume_milo_office", "display_name": "Milo office", "description": "Dark teal turtleneck." } ]
  },
  "shots": [
    { "shot_id": "SC01", "sequence": 1, "title": "The premature toast", "duration_seconds": 3.0,
      "script_excerpt": "Bruno bursts in as the alert flares.",
      "camera": { "shot_type": "MS", "angle": "EYE_LEVEL", "movement": "DOLLY_IN" },
      "action": "Bruno shoulders through the doorway, arms rising.",
      "dialogue": [ { "order": 1, "character_key": "bruno_bull", "text": "Breakout! We are so back!", "line_mode": "DIALOGUE" } ],
      "character_keys": ["bruno_bull", "boris_bear"], "scene_key": "the_burrow",
      "prop_keys": ["wall_btc_chart"], "costume_keys": ["costume_bruno_office"],
      "image_prompt": "", "video_prompt": "", "negative_prompt": "",
      "continuity_notes": "Forest-green shirt; watch on left wrist; horns symmetrical.",
      "metadata": { "beat": "hook" },
      "beginning_state": "Door half-open; chart line crossing the level.",
      "ending_state": "Bruno fully in frame, arms up; green accent lit.",
      "generation_risks": ["extra or asymmetric horns", "jacket appearing", "legible chart text"],
      "overlay_ids": ["ov_chart_label_01"] },
    { "shot_id": "SC02", "sequence": 2, "title": "Confirmation, please", "duration_seconds": 7.0,
      "script_excerpt": "Boris blocks the celebration.",
      "camera": { "shot_type": "MCU", "angle": "EYE_LEVEL", "movement": "STATIC" },
      "action": "Boris raises a flat paw, clutching the red notebook.",
      "dialogue": [ { "order": 1, "character_key": "boris_bear", "text": "The candle hasn't closed yet.", "line_mode": "DIALOGUE" } ],
      "character_keys": ["boris_bear", "bruno_bull"], "scene_key": "the_burrow",
      "prop_keys": [], "costume_keys": ["costume_boris_office"],
      "image_prompt": "", "video_prompt": "", "negative_prompt": "",
      "continuity_notes": "Glasses present; vest burgundy; ears small and rounded.",
      "metadata": { "beat": "conflict" },
      "beginning_state": "Boris mid-turn from his monitor.",
      "ending_state": "Paw up, notebook chest-high.",
      "generation_risks": ["glasses disappearing", "vest colour drift"],
      "overlay_ids": [] },
    { "shot_id": "SC03", "sequence": 3, "title": "The dip", "duration_seconds": 6.5,
      "script_excerpt": "The chart dips; Bruno freezes.",
      "camera": { "shot_type": "MLS", "angle": "EYE_LEVEL", "movement": "HANDHELD" },
      "action": "Bruno freezes mid-celebration; papers hang in the air.",
      "dialogue": [ { "order": 1, "character_key": "bruno_bull", "text": "It's still green… right?", "line_mode": "DIALOGUE" } ],
      "character_keys": ["bruno_bull", "boris_bear"], "scene_key": "the_burrow",
      "prop_keys": ["wall_btc_chart"], "costume_keys": [],
      "image_prompt": "", "video_prompt": "", "negative_prompt": "",
      "continuity_notes": "Resistance line at the same screen height as SC01.",
      "metadata": { "beat": "escalation" },
      "beginning_state": "Celebration at maximum; chart at local high.",
      "ending_state": "Bruno statue-still; chart lower by {{PULLBACK_PCT}}.",
      "generation_risks": ["duplicate characters", "full-frame red wash", "wardrobe change"],
      "overlay_ids": ["ov_chart_label_02"] },
    { "shot_id": "SC04", "sequence": 4, "title": "Before the close", "duration_seconds": 4.5,
      "script_excerpt": "Milo lowers his mug and reveals the delivery.",
      "camera": { "shot_type": "CU", "angle": "EYE_LEVEL", "movement": "PAN" },
      "action": "Milo lowers the mug, glances at his phone, slow blink.",
      "dialogue": [ { "order": 1, "character_key": "milo_cat", "text": "Your confetti arrives before candle close.", "line_mode": "DIALOGUE" } ],
      "character_keys": ["milo_cat", "bruno_bull", "boris_bear"], "scene_key": "the_burrow",
      "prop_keys": ["milo_phone"], "costume_keys": ["costume_milo_office"],
      "image_prompt": "", "video_prompt": "", "negative_prompt": "",
      "continuity_notes": "Teal turtleneck; pin on left chest; phone glow only.",
      "metadata": { "beat": "punchline" },
      "beginning_state": "Mug at lips; phone face-up, screen glow only.",
      "ending_state": "Mug at chest height; gaze level; tail settled.",
      "generation_risks": ["legible phone text", "stripe or eye-colour drift", "glasses on Milo"],
      "regeneration_fallback": { "camera_movement": "STATIC", "note": "Recovery only if identity drifts during the pan. Not an equal option." },
      "overlay_ids": ["ov_phone_notification"] }
  ],
  "metadata": { "created_at": null, "generator": "cas-design", "model": "", "prompt_version": "ep001-design-v1.1", "tags": ["ep001", "design-stage"] },

  "output": {
    "aspect_ratio": "9:16", "width": 1080, "height": 1920, "fps": 30, "orientation": "vertical",
    "generated_footage_ms": 21000, "total_runtime_ms": 24000,
    "safe_area": { "subtitle_bottom_pct": 18, "margin_pct": 6 }
  },
  "localization": {
    "spoken_language": "en",
    "required_publish_language_tags": ["zh-Hant"],
    "subtitle_tracks": [
      { "language_tag": "zh-Hant", "is_primary": true, "rendering": "post_production",
        "cues": [
          { "cue_id": "c1", "start_ms": 400,   "end_ms": 2000,  "text": "突破了！我們回來了！",       "speaker_character_key": "bruno_bull", "shot_id": "SC01" },
          { "cue_id": "c2", "start_ms": 3400,  "end_ms": 5400,  "text": "這根K棒還沒收。",           "speaker_character_key": "boris_bear", "shot_id": "SC02" },
          { "cue_id": "c3", "start_ms": 11000, "end_ms": 12800, "text": "還是綠的……對吧？",         "speaker_character_key": "bruno_bull", "shot_id": "SC03" },
          { "cue_id": "c4", "start_ms": 17200, "end_ms": 19600, "text": "你的彩帶會比收盤先到。",     "speaker_character_key": "milo_cat",   "shot_id": "SC04" }
        ] }
    ]
  },
  "fact_card": {
    "duration_ms": 3000, "placement": "append_after_shots", "readable_text_in_post": true,
    "localized": [
      { "language_tag": "en",
        "body": [
          "Moving above {{RESISTANCE_LEVEL}} is the initial breakout signal — not a confirmed breakout.",
          "Some traders wait for the {{TIMEFRAME}} candle to close above it and follow through.",
          "Confirmation criteria don't guarantee future performance."
        ],
        "disclaimer": "For education and entertainment, not financial advice.",
        "cta": null },
      { "language_tag": "zh-Hant",
        "body": [
          "價格站上 {{RESISTANCE_LEVEL}} 只是初步突破訊號，不等於已確認突破。",
          "部分交易者會等 {{TIMEFRAME}} K棒收在其上並延續。",
          "確認條件並不保證未來表現。"
        ],
        "disclaimer": "僅供教育與娛樂，非投資建議。",
        "cta": null }
    ]
  },
  "market_data": {
    "instrument": "BTC-USD", "timeframe": "{{TIMEFRAME}}",
    "resistance_level": "{{RESISTANCE_LEVEL}}", "price": "{{BTC_PRICE}}",
    "price_move_pct": "{{PRICE_MOVE_PCT}}", "pullback_pct": "{{PULLBACK_PCT}}",
    "event_timestamp_utc": "{{BREAKOUT_TIMESTAMP_UTC}}",
    "candle_close_timestamp_utc": "{{CANDLE_CLOSE_TIME_UTC}}",
    "as_of_utc": "{{AS_OF_UTC}}",
    "source_name": "{{DATA_SOURCE}}", "source_url": null,
    "factual_note": "Price moved above the level; confirmation outstanding at capture time.",
    "ath_context": null,
    "data_lock": { "status": "unresolved", "locked_at_utc": null }
  },
  "references": {
    "bible_version": "1.0", "canon_decision": "ADR-015",
    "characters": [
      { "character_key": "bruno_bull", "asset_id": "cas/bruno/identity/front", "kind": "identity", "view": "front", "path": null },
      { "character_key": "boris_bear", "asset_id": "cas/boris/identity/front", "kind": "identity", "view": "front", "path": null },
      { "character_key": "milo_cat",   "asset_id": "cas/milo/identity/front",  "kind": "identity", "view": "front", "path": null }
    ],
    "environments": [ { "scene_key": "the_burrow", "asset_id": "cas/env/the_burrow/master_wide", "kind": "identity", "view": null, "path": null } ],
    "props": [ { "prop_key": "wall_btc_chart", "asset_id": "cas/prop/wall_chart/textless", "kind": "identity", "view": null, "path": null } ]
  },
  "post_production": {
    "overlays": [
      { "overlay_id": "ov_chart_label_01", "type": "chart_label", "shot_id": "SC01", "start_ms": 600, "end_ms": 3000, "required": false, "anchor": "upper_safe",
        "localized": [ { "language_tag": "en", "text": "{{RESISTANCE_LEVEL}}" } ] },
      { "overlay_id": "ov_chart_label_02", "type": "chart_label", "shot_id": "SC03", "start_ms": 10200, "end_ms": 13000, "required": false, "anchor": "upper_safe",
        "localized": [ { "language_tag": "en", "text": "-{{PULLBACK_PCT}}" } ] },
      { "overlay_id": "ov_phone_notification", "type": "notification", "shot_id": "SC04", "start_ms": 17000, "end_ms": 19000, "required": false, "anchor": "prop_local",
        "localized": [ { "language_tag": "en", "text": "Delivery arriving" }, { "language_tag": "zh-Hant", "text": "外送即將送達" } ] },
      { "overlay_id": "ov_fact_card", "type": "fact_card", "shot_id": null, "start_ms": 21000, "end_ms": 24000, "required": true, "anchor": "centre", "localized": [] },
      { "overlay_id": "ov_disclaimer", "type": "disclaimer", "shot_id": null, "start_ms": 21000, "end_ms": 24000, "required": true, "anchor": "lower_safe", "localized": [] }
    ]
  }
}
```

## 9. Validation rules by lifecycle stage

### 9.1 Stages

| Stage | When | Placeholders allowed? | Purpose |
|---|---|---|---|
| **Design** | authoring | **yes** | Structure and references are coherent |
| **Pre-render / data-lock** | before any generation | **no** | Facts resolved, timing consistent, format fixed |
| **Provider-input** | per provider call | n/a | Required prompt/reference inputs exist |
| **Post-production** | before compositing | n/a | Overlays, subtitles, card are placeable |
| **Publish** | before release | **no** | Legal/brand gates satisfied |

### 9.2 Timing model and mismatch rules (authoritative)

**Authoritative formulas (implementation rule).**

```
derived_generated_ms = sum( round_half_up(shots[i].duration_seconds * 1000) )   # for all shots
derived_total_ms     = derived_generated_ms
                       + fact_card.duration_ms   # only when placement == "append_after_shots"
```

- **Derived values are authoritative.** They define the episode's real timing.
- `output.generated_footage_ms` and `output.total_runtime_ms` are **optional assertions only**.
  They **never** override shot or fact-card timing; they exist to catch authoring mistakes.
- **A mismatch greater than 50 ms between an assertion and its derived value is a hard error at
  pre-render.** Within ±50 ms the assertion is accepted and the derived value is still used.
- `creative_direction.target_duration_seconds` remains **non-authoritative author intent**. A
  difference from `derived_total_ms` produces a **warning only**, never an error, and never
  participates in any calculation.
- **One rounding strategy, used everywhere: `round_half_up`** — multiply by 1000, then round half
  away from zero to an integer millisecond (e.g. `3.0005 s → 3001 ms`, `2.9995 s → 3000 ms`).
  Implementations must apply it via an explicit helper and **must not** rely on Python's built-in
  `round()`, which uses banker's rounding and would produce different results on exact `.5` cases.
  The same helper is used for shot durations, assertion comparison, and any derived cue arithmetic.
- When `placement == "overlay_tail"` the fact card is composited over the tail of existing footage
  and contributes **no** additional time: `derived_total_ms == derived_generated_ms`.
- Publish requires `15000 ≤ derived_total_ms ≤ 30000` for canonical episodes (Bible / ADR-015).
- EP001: derived_generated = 21 000 ms, fact card 3 000 ms, derived_total = **24 000 ms** ✓.

### 9.3 Stage rules

**Design (D).** `schema_version ∈ {"1.0","1.1"}`; all v1 rules; every `overlay_ids` entry resolves
to an overlay; `speaker_character_key` / `shot_id` in cues resolve; `references.*` keys resolve to
declared characters/scenes/props; fact card is not present in `shots[]`.

**Pre-render / data-lock (L).** All of D, plus: **no `{{…}}` token anywhere** in `market_data`,
`fact_card`, or overlay copy; `market_data.data_lock.status == "locked"` with `locked_at_utc`;
`as_of_utc`, `source_name`, `factual_note` present and non-empty; **locked market facts parse per
§6.6.1** (no empty/whitespace-only/NaN-like/`null`-where-not-allowed values); timing assertions
match (§9.2); `output` resolved (explicitly or by default); for canonical episodes every shot has
exactly one `camera.movement`; subtitle cue rules (episode-absolute ms per §6.8.1): `start_ms ≥ 0`,
`end_ms > start_ms` (no zero/negative duration), cues sorted and **non-overlapping within a track**,
`end_ms ≤ derived_total_ms`, and if `shot_id` is set the cue lies within that shot's absolute window
(±150 ms lead-in tolerance).

**Provider-input (P).** Each shot has `beginning_state`/`ending_state` (or documented absence) and
resolvable `references` for every character it uses; **no forbidden URL or credential of any kind
appears anywhere in the package (§6.6.2)** — a public provenance `source_url` is permitted.

**Post-production (T).** Every `required: true` overlay has a placement and, where copy is needed,
localized text; **every tag in `localization.required_publish_language_tags[]` has a matching,
non-empty subtitle track (§6.4.1)**; a declared-but-empty track is invalid from this stage onward;
fact card copy present for the publish languages; overlay bounds satisfy
`0 ≤ start_ms < end_ms ≤ derived_total_ms` and any `shot_id` cross-check passes; overlays fit their
safe-area anchor.

**Publish (B).** All of L and T, plus: every required publish language has a complete subtitle
track (one cue per dialogue line); `fact_card.localized[].disclaimer` non-empty for every published
language; prohibited-phrase scan passes on dialogue, `factual_note`, and all overlay/card copy;
runtime in range; **the unresolved-placeholder check is repeated** (data lock is not trusted as a
permanent guarantee, since copy can change after locking).

*Legacy note:* a `"1.0"` document declares no required publish language, so stages T and B impose
no subtitle obligation on it.

## 10. Backward-compatibility matrix

### 10.1 Version parsing policy (finalized)

1. **`schema_version` remains the existing version discriminator.** No second version field is
   introduced at any layer.
2. **A v1 package keeps its existing version value and semantics** — `"1.0"`, meaning exactly what
   it means today.
3. **A v1.1 package declares `"1.1"`.**
4. **The v1.1-capable parser explicitly accepts a known set** — `SUPPORTED_SCHEMA_VERSIONS =
   {"1.0", "1.1"}` — by explicit membership test, never by range, prefix, or "greater-or-equal"
   comparison.
5. **Missing `schema_version` follows the existing v1 behaviour discovered in the implementation:**
   it is a **required field**, so an absent value is a Pydantic missing-field validation error. No
   fallback, no default, and no inferred version is introduced — this proposal invents nothing here.
6. **Unknown versions fail explicitly** with a typed `UnsupportedSchemaVersionError` (surfaced as
   HTTP 422). They are never coerced, clamped, or treated as the newest supported version.
7. **No version is silently upgraded during parsing.** Reading a `"1.0"` document never rewrites its
   `schema_version`, never injects the new optional objects into the source document, and never
   re-serializes it as `"1.1"`. Defaults exist only in the derived in-memory view (§6.1).
8. **Existing v1 payload hashes are never rewritten or recomputed** merely because a v1.1-capable
   parser read the package. `canonical_payload_hash` hashes the fields actually present, so a
   `"1.0"` document keeps a byte-identical hash and existing `cas_import_ledger` rows stay valid.
9. **Definition of backward compatibility used here:** v1 documents remain accepted by the upgraded
   implementation. It does **not** mean v1.1 documents are accepted by unmodified v1 code — they
   are not, and cannot be (§10.2).

### 10.2 Matrix

| Scenario | Result | Notes |
|---|---|---|
| v1 document → v1 parser | ✅ valid | unchanged |
| v1 document → v1.1 parser | ✅ valid | all new fields optional; defaults applied in the derived view only |
| v1.1 document **without** new fields → v1 parser | ❌ rejected | `schema_version == "1.1"` fails the strict equality check |
| v1.1 document **with** new fields → v1 parser | ❌ rejected | `extra="forbid"` on every model |
| v1.1 document → v1.1 parser | ✅ valid | — |
| Existing v1 sample & 68 CAS tests after implementation | ✅ unaffected | sample stays `"1.0"`; its payload hash is unchanged |

**Honest statement of direction.** Compatibility is **backward, not forward**: old documents keep
working under new code; new documents do not work under old code. This is inherent to
`extra="forbid"` + strict version equality and is accepted deliberately (see ADR-016, "Alternatives
considered") rather than worked around by loosening `extra`, which would silently swallow typos.

## 11. Migration and rollout plan

1. **R0 — approval.** ADR-016 moves Proposed → Accepted.
2. **R1 — parser.** Accept `{"1.0","1.1"}`; add optional models; keep `SCHEMA_VERSION = "1.0"` as
   the *minimum* and add `SUPPORTED_SCHEMA_VERSIONS`; raise a typed
   `UnsupportedSchemaVersionError` (mapped to HTTP 422) for anything else.
3. **R2 — validators.** Implement the five stages as separate callables so design-stage documents
   are never blocked by data-lock rules.
4. **R3 — canonical sample.** **Add** `samples/cas/ep001_episode.json` (v1.1). **Do not edit**
   `samples/cas/demo_episode.json` — Sprint 4 tests and the ledger payload hash depend on its
   exact bytes.
5. **R4 — consumers.** Importer and production orchestrator read the new fields *opportunistically*
   (absent ⇒ current behaviour). No behavioural change for v1 packages.
6. **R5 — Prompt Builder v1** consumes `beginning_state`, `ending_state`, `references`, and
   `generation_risks` (separate scoped sprint; not part of this proposal).

No data migration and no backfill: existing stored ledger rows keep `schema_version = "1.0"` and
remain correct.

## 12. Implementation impact by component

| Component | Impact | Notes |
|---|---|---|
| `schemas/episode_package.py` | **Additive** | six optional root models + five optional shot fields |
| `domain/episode_package.py` | Small | add `SUPPORTED_SCHEMA_VERSIONS`; keep `SCHEMA_VERSION` |
| `application/hashing.py` | **None** | canonical hash already covers whatever fields exist |
| `application/import_episode.py` | Optional | may map subtitles/overlays later; v1 path unchanged |
| `domain/import_ledger.py` + `sql/009` | **None** | `schema_version VARCHAR(16)` already fits `"1.1"` |
| `production/*` (Sprint 4) | Optional | orchestrator may read `output`/`fact_card` later |
| `api/`, `schemas/production.py` | Minor | request models accept v1.1 packages once the parser does |
| CLI | **None** | file-driven |
| **Database** | **No migration required** | see below |

**Why no DB migration.** Inspection shows EpisodePackage is **never column-mapped**: the ledger
stores only `payload_hash` (SHA-256) and `schema_version VARCHAR(16)`; production stores *derived*
prompts and artifact rows. Adding optional JSON fields therefore changes no table. A migration
would only become necessary if a future sprint decided to persist the raw package or index new
fields — which this proposal does not do.

## 13. Testing strategy

- **Compatibility:** the existing v1 sample validates unchanged under the v1.1 parser; its
  canonical payload hash is byte-identical; all 68 CAS tests stay green.
- **Version handling:** `"1.0"` accepted; `"1.1"` accepted; `"2.0"`/`""`/absent rejected with the
  typed error.
- **Subtitles:** negative/zero-duration cue rejected; overlapping cues in one track rejected;
  overlapping cues across *different* tracks accepted; cue beyond runtime rejected; unknown
  `speaker_character_key` or `shot_id` rejected.
- **Timing:** declared/derived mismatch > 50 ms rejected at pre-render; `target_duration_seconds`
  discrepancy warns only; EP001 sums to exactly 24 000 ms.
- **Fact card:** card never counted as a shot; four shots remain four; missing disclaimer fails
  publish, not design.
- **Data lock:** placeholder-bearing document passes design and **fails** pre-render and publish;
  same document with values and `status = "locked"` passes.
- **Provider neutrality:** a package containing a URL/credential-shaped provider field is rejected.
- **Golden:** EP001 v1.1 example round-trips (parse → dump → parse) byte-stably.

## 14. Rejected alternatives

| Alternative | Why rejected |
|---|---|
| Full **v2** redesign | Violates the minimal-change instruction; breaks the importer, ledger hashes, and 68 tests for no EP001 benefit. |
| Relax `extra="ignore"` for forward compatibility | Would silently swallow typos and contract drift — the opposite of the strictness that has caught real errors. |
| Reuse `shots[].metadata` (free dict) for subtitles/fact card | Untyped, unvalidatable, and creates a shadow contract; timing errors would reach rendering. |
| Reinterpret `creative_direction.target_duration_seconds` as authoritative runtime | Silent semantic change to an existing field; also an int, so it cannot express 24.0 s + ms precision. |
| Add a **new** `package_version` field beside `schema_version` | Duplicate source of truth for versioning. |
| Store subtitles as one blob (SRT/VTT string) | Not queryable or validatable; cue-level rules become impossible. |
| Make the fact card a fifth shot | Explicitly forbidden: it would enter generation and put readable financial text into AI imagery. |
| Embed provider URLs/credentials for references | Security and neutrality violation; adapters resolve `asset_id` themselves. |

## 15. Open questions and explicit non-goals

**Resolved in this clarification pass.**

1. ~~Subtitle requirement scope~~ → **Resolved (§6.4.1).** Conditionally required via
   `localization.required_publish_language_tags[]`; never universally required; legacy v1 exempt.
2. ~~Market-fact representation~~ → **Resolved (§6.6.1).** Placeholder-capable strings retained as
   a deliberate minimal-v1.1 compromise; typed facts + `placeholders{}` map deferred to a possible
   v2 and explicitly out of scope.
3. ~~Overlay/cue coordinate system~~ → **Resolved (§6.8.1).** Episode-absolute integer
   milliseconds, zero at the first frame of generated footage; shot-relative timing rejected.
4. ~~`source_url` vs provider URL~~ → **Resolved (§6.6.2).** `source_url` is provenance evidence,
   never an execution endpoint; explicit allowed/forbidden lists.
5. ~~Rounding strategy~~ → **Resolved (§9.2).** One documented `round_half_up` helper everywhere.

**Resolved in Step 4.6 (governance closure).**

6. **Reference-asset validation responsibility — split by layer.**
   - *Canonical package validation owns:* reference **key consistency** (every
     `references.*` key resolves to a declared character/scene/prop), **required reference presence
     for assets actually used by generation inputs** (a character used by a shot must have a
     reference when `references` is declared), **shape** of a stable repository-relative `path` or
     canonical `asset_id`, and **rejection of provider-specific or unsafe references** (§6.6.2).
   - *Provider-input / orchestration preflight owns:* checking that the referenced asset **actually
     exists** in the configured asset registry or repository, and **resolving** it into
     provider-ready input.
   - **Schema parsing performs no filesystem, registry, or network I/O** — ever.
   - No asset-registry abstraction exists in the repository today, so existence checking is
     recorded as a **later provider-integration preflight requirement**. No registry is invented
     here.
7. **Re-timing responsibility — post-production assembly owns it.** Any change to shot order or
   duration invalidates downstream *absolute* subtitle and overlay timing. The **post-production
   assembly stage** owns recomputing cues and overlays. After re-timing, the package **must be
   revalidated from `pre_render_data_lock` through `publish`** before it can be published.
   Automatic re-timing is **not** implemented in v1.1; validation deliberately fails on stale
   timing so the correction is explicit and testable.

**Non-goals.** No v2; no changes to v1 field names/types/semantics; no typed market-data redesign;
no Prompt Builder v1; no real providers; no EP001 production JSON; no DB schema change; no frontend
work; no change to the importer contract or the Sprint 4 production pipeline behaviour.
