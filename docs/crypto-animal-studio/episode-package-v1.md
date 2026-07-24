# EpisodePackage v1

Status: Sprint 2 (CAS Foundation). Contract version: **1.0**.
Module: `backend/app/crypto_animal_studio/`.

---

## 1. Purpose

EpisodePackage is the **strict, versioned contract** between Creative OS (Crypto
Animal Studio, "CAS") and Jellyfish. CAS produces a fully-formed episode — script,
storyboard, dialogue, characters, and asset references — and hands it to Jellyfish
as a single validated JSON document. v1 establishes that contract only; it does not
persist anything or create Jellyfish records yet.

## 2. Architecture role

CAS sits **upstream** of Jellyfish's production pipeline. Jellyfish natively ingests
a raw script and divides it into shots; CAS instead delivers an **already-completed
storyboard**. EpisodePackage is the hand-off boundary:

```
Creative OS (CAS)                         Jellyfish
news/premise → episode + storyboard  ──▶  EpisodePackage (this contract)
 + dialogue + characters + assets     ──▶  (future) sync import → Chapter + Shots
```

The contract lives in a **bounded module** so CAS logic never scatters across
Jellyfish:

```
backend/app/crypto_animal_studio/
├── api/          # thin routes (health now; import later) → ApiResponse
├── application/  # (future) use cases: validate → sync import service
├── domain/       # constants/enums/helpers (SCHEMA_VERSION, SourceType, recurring keys)
├── schemas/      # the ONLY Pydantic models for EpisodePackage (transport/validation)
├── agents/       # (future) CAS-specific agents, if any
└── integrations/ # (future) bridge to Jellyfish Provider/Model/ModelSettings
```

Responsibility split (no duplicated models): **schemas** hold every Pydantic model;
**domain** holds only constants/enums/helpers and never imports FastAPI.

## 3. Why an Episode maps to a Jellyfish Chapter

Jellyfish has no `Episode` entity. Its hierarchy is `Project → Chapter → Shot`.
A CAS **Episode maps to one Jellyfish Chapter**: a Chapter already is the
chapter-level container that owns a script (`raw_text`) plus its shots and status.
A Jellyfish **Project** represents a **series / production / season** and may contain
multiple CAS Chapters/Episodes. (See the final architecture decisions in the
architecture analysis.)

## 4. Why shots are imported directly (not re-divided)

CAS delivers a finished storyboard whose comedy beats, timing, dialogue alignment,
and shot structure are intentional. Therefore the future importer maps
`shots[]` **directly** onto Jellyfish `Shot / ShotDetail / ShotDialogLine` and
**must not** feed the assembled script back through `ScriptDividerAgent`, which
would re-cut the episode and destroy those decisions. `Chapter.raw_text` still stores
the complete generated script for traceability, but Shots are created from the
EpisodePackage, not by re-dividing `raw_text`.

## 5. Field reference

Root: `EpisodePackage`

| Field | Type | Notes |
|---|---|---|
| `schema_version` | str | Must equal `"1.0"`. |
| `episode_id` | str | Non-empty; maps to a Chapter later. |
| `title` | str | Non-empty. |
| `logline` | str | Optional one-line premise. |
| `language` | str | Non-empty (e.g. `en`, `zh`). |
| `source` | NewsSource | Factual/trigger context. |
| `creative_direction` | CreativeDirection | Format, tone, duration target, styles. |
| `characters[]` | CharacterSpec | Narrative characters; keys unique. |
| `assets` | AssetLibrary | actors / scenes / props / costumes. |
| `shots[]` | Shot | ≥ 1; storyboard shots. |
| `metadata` | EpisodeMetadata | Generation trace. |

`NewsSource`: `source_type` (news|original|fictional|generic), `headline`, `summary`,
`source_url?`, `published_at?`, `factual_notes`.

`CreativeDirection`: `format`, `tone`, `target_duration_seconds` (>0), `visual_style`,
`comedy_style`, `continuity_notes`.

`CharacterSpec`: `character_key` (unique, non-empty), `display_name` (non-empty),
`role`, `description`, `actor_key?`, `costume_key?`, `voice_profile?`, `continuity_notes`.

`AssetLibrary`: `actors[]` (`actor_key`…), `scenes[]` (`scene_key`…),
`props[]` (`prop_key`…), `costumes[]` (`costume_key`…). Keys unique within each category.

`Shot`: `shot_id` (unique, non-empty), `sequence` (>0, unique), `title`,
`duration_seconds` (>0), `script_excerpt`, `camera?` (CameraSpec), `action`, `dialogue[]`,
`character_keys[]`, `scene_key?`, `prop_keys[]`, `costume_keys[]`, `image_prompt`,
`video_prompt`, `negative_prompt`, `continuity_notes`, `metadata`.

`CameraSpec` (structured; all fields optional): `shot_type?`, `angle?`, `movement?`.
Values are CAS-local enums that **mirror** Jellyfish's `CameraShotType` / `CameraAngle` /
`CameraMovement` string codes so the future importer maps them cleanly onto
`ShotDetail.camera_shot` / `angle` / `movement`. Allowed codes:

- `shot_type`: `ECU`, `CU`, `MCU`, `MS`, `MLS`, `LS`, `ELS`
- `angle`: `EYE_LEVEL`, `HIGH_ANGLE`, `LOW_ANGLE`, `BIRD_EYE`, `DUTCH`, `OVER_SHOULDER`
- `movement`: `STATIC`, `PAN`, `TILT`, `DOLLY_IN`, `DOLLY_OUT`, `TRACK`, `CRANE`, `HANDHELD`, `STEADICAM`, `ZOOM_IN`, `ZOOM_OUT`

The CAS enums are declared inside the bounded module (`domain/episode_package.py`);
the schema does **not** import Jellyfish ORM models or DB enums, preserving the
module boundary.

`DialogueLine`: `order` (>0, unique within shot), `character_key?`, `text` (non-empty),
`line_mode`.

`EpisodeMetadata`: `created_at?`, `generator`, `model`, `prompt_version`, `tags[]`.

### Documented deviations from the proposed structure

- **`camera`** is a structured `CameraSpec` object with `shot_type` / `angle` /
  `movement` (Sprint 2.1 hardening; replaces the earlier free-text field). Values are
  CAS-local enums mirroring Jellyfish's camera codes; the schema does not import ORM
  enums. All three sub-fields are optional.
- **`duration_seconds`** is a float (`> 0`) to allow fractional seconds.
- Asset key fields are category-specific (`actor_key`, `scene_key`, `prop_key`,
  `costume_key`) for unambiguous cross-references.

### Camera mapping to Jellyfish (for the future importer)

| EpisodePackage `CameraSpec` | Jellyfish `ShotDetail` | Jellyfish enum |
|---|---|---|
| `camera.shot_type` | `camera_shot` | `CameraShotType` |
| `camera.angle` | `angle` | `CameraAngle` |
| `camera.movement` | `movement` | `CameraMovement` |

Codes are identical strings, so the importer maps 1:1 with no translation. This is a
documentation-only mapping in Sprint 2.1; no importer is implemented.

## 6. Validation rules

All models set `extra="forbid"` (unknown fields rejected). Enforced:

1. `schema_version == "1.0"`.
2. `episode_id` non-empty. 3. `title` non-empty. 4. `language` non-empty.
5. `creative_direction.target_duration_seconds > 0`.
6. `shots` has ≥ 1 shot.
7. shot `sequence` positive and unique.
8. `shot_id` unique.
9. shot `duration_seconds > 0`.
10. `dialogue.order` positive and unique within a shot.
11. shot `character_keys` (and `dialogue.character_key` when present) exist in `characters`.
12. character `actor_key` exists in `assets.actors` when provided.
13. shot `scene_key` exists in `assets.scenes` when provided.
14. shot `prop_keys` exist in `assets.props`.
15. shot `costume_keys` (and character `costume_key` when provided) exist in `assets.costumes`.
16. `character_key` values unique.
17. asset keys unique within each category.
18. unknown fields rejected (root and nested).

Field-level rules use `Field` constraints; cross-reference rules use a root
`model_validator(mode="after")` that collects all violations into one error.

## 7. Example data flow

```
docs/crypto-animal-studio/samples/sample-episode-package-v1.json
  → EpisodePackage.model_validate(...)      # strict validation (this sprint)
  → (future) application/import service      # synchronous, no Celery
      → Project (series/season)
      → Chapter (raw_text = full script)
      → Shot / ShotDetail / ShotDialogLine  (directly from shots[])
      → Character & asset links
  → Chapter and Shots visible in Jellyfish
```

## 8. Versioning policy

`schema_version` is the single source of truth (constant `SCHEMA_VERSION` in
`domain/episode_package.py`). v1 accepts exactly `"1.0"`. A breaking change bumps the
major version (`"2.0"`) and adds a parallel schema module; additive, backward-compatible
changes may extend within the same major with clear documentation.

## 9. Backward compatibility rules

- Never repurpose or remove an existing field's meaning within a major version.
- Additive fields must be optional with safe defaults.
- Tightening a constraint or removing a field is a breaking change → new major version.
- Consumers must reject unknown `schema_version` values rather than best-effort parse.

## 10. Known non-goals (v1)

Explicitly **out of scope** for this sprint:

- No database persistence.
- No Chapter/Shot record creation.
- No Celery task.
- No LLM invocation.
- No Creative OS agent migration.
- No frontend UI.
- No new Jellyfish enum values (`ProjectStyle` / `ProjectVisualStyle`).
- No second Provider configuration system.
