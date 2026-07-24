# EpisodePackage → Jellyfish Import Mapper v1

Field-by-field mapping performed by the deterministic importer
(`backend/app/crypto_animal_studio/application/import_episode.py`). No LLM, no agents.
See ADR-012 for the design rationale and the contract in `episode-package-v1.md`.

Legend for **Notes**: *reuse* = resolved by normalized name (trim+lowercase) and reused if
an equivalent exists, else created; *warning* = surfaced in `ImportResult.warnings`, never
silently discarded.

## Root

| EpisodePackage field | → Model | → Field | Notes |
|---|---|---|---|
| `episode_id` | `cas_import_ledger` | `episode_id` | Idempotency/traceability; not stored on Chapter. |
| `title` | `Chapter` | `title` | |
| `logline` | `Chapter` | `summary` | |
| (whole package) | `Chapter` | `raw_text` | Deterministic full-script assembly (title + per-shot excerpt + dialogue), **traceability only**; never re-divided. |
| `language` | — | — | Not persisted in v1 (no Chapter/Project language field). *warning-free omission documented here.* |
| `source.*` | — | — | Not persisted in v1 (no target field). Retained in EpisodePackage/ledger payload_hash. |
| `creative_direction.*` | — | — | Not persisted in v1 (no Chapter field for tone/format/style). Reflected only in per-shot mapping where applicable. |
| `shots[]` | `Shot` (+`ShotDetail`,`ShotDialogLine`) | — | One `Shot` per element (see below). `Chapter.storyboard_count = len(shots)`. |
| `characters[]` | `Character` | — | Project-scoped; reuse by name. |
| `assets.*` | `Actor`/`Scene`/`Prop`/`Costume` | — | Global libraries; reuse by name. |
| `metadata.*` | — | — | Not persisted in v1 (kept in payload_hash). |
| `schema_version` | `cas_import_ledger` | `schema_version` | |

## Chapter (per EpisodePackage)

| Source | → `Chapter` field | Notes |
|---|---|---|
| — | `id` | New UUID. |
| request `project_id` | `project_id` | Target series/season Project (must exist → else 404). |
| computed | `index` | `max(existing chapter index in project) + 1`. |
| `title` | `title` | |
| `logline` | `summary` | |
| assembled | `raw_text` | Complete script for traceability. |
| — | `condensed_text` | Left empty (no re-division / no ElementExtractor). |
| `len(shots)` | `storyboard_count` | |
| — | `status` | `ChapterStatus.draft`. |

### Chapter.raw_text assembly (deterministic specification)

`Chapter.raw_text` stores the complete generated script **for traceability only** (it is
never re-divided). Assembly is deterministic and reproducible
(`domain/mapping.py::assemble_raw_text`):

1. First line: `# {title}`. If `logline` is non-empty, append it as the next line.
2. Iterate shots **in ascending `sequence` order**. For each shot, emit a section separated
   by a blank line:
   1. header `[{sequence}] {title}`;
   2. `script_excerpt` verbatim (if non-empty);
   3. `(action) {action}` (if `action` non-empty);
   4. dialogue **in ascending `order`**, one line each: `{character_key or '—'}: {text}`.
3. Join with newlines; strip leading/trailing whitespace.

Only present fields are emitted ("where available"). No text is rewritten or summarized.
Because ordering is by `sequence`/`order` and content is copied verbatim, the same
EpisodePackage always yields byte-identical `raw_text` (covered by
`test_assemble_raw_text_is_deterministic`).

Example (from the sample package):

```
# Champagne Before Confirmation
Bull celebrates a rumored inflow record before anyone has actually confirmed it.

[1] The premature toast
Bull bursts in with the champagne before anyone can react.
(action) Bull kicks the door open, champagne raised over his head.
bull: Record day! We are so back!
bear: Back from what.
```

## Shot (per `shots[]` element)

| Source | → `Shot` field | Notes |
|---|---|---|
| — | `id` | New UUID. |
| Chapter | `chapter_id` | |
| `sequence` | `index` | Unique within chapter (contract-validated). |
| `title` | `title` | |
| `script_excerpt` | `script_excerpt` | |
| — | `status` | `ShotStatus.pending` (never `generating`). |
| — | `skip_extraction` | `True` — CAS storyboard is authoritative; extraction is skipped. |

## ShotDetail (per shot; shares PK with Shot)

| Source | → `ShotDetail` field | Notes |
|---|---|---|
| `shot.id` | `id` | 1:1 shared primary key. |
| `camera.shot_type` | `camera_shot` | Defaults to `MS` + *warning* if missing. |
| `camera.angle` | `angle` | Defaults to `EYE_LEVEL` + *warning* if missing. |
| `camera.movement` | `movement` | Defaults to `STATIC` + *warning* if missing. |
| `duration_seconds` | `duration` | `round()` to int, min 1. |
| `action` | `description` | |
| `image_prompt` | `key_frame_prompt` | |
| `video_prompt` | — | No ShotDetail field → *warning* (not discarded). |
| `negative_prompt` | — | No ShotDetail field → *warning* (not discarded). |
| resolved `scene_key` | `scene_id` | Via reused/created `Scene` (nullable). |

## ShotDialogLine (per `shot.dialogue[]`)

| Source | → `ShotDialogLine` field | Notes |
|---|---|---|
| `order` | `index` | Positive, unique within shot (contract-validated). |
| `text` | `text` | Never rewritten. |
| `line_mode` | `line_mode` | Validated against DIALOGUE/VOICE_OVER/OFF_SCREEN/PHONE; invalid → `DIALOGUE` + *warning*. |
| `character_key` | `speaker_character_id` | Resolved to the imported `Character.id` (nullable). |
| `character_key` → display_name | `speaker_name` | Backfilled from `characters[]`. |

## Character (per `characters[]`) — Character ≠ Actor (never merged)

| Source | → `Character` field | Notes |
|---|---|---|
| — | `id` | New UUID (or reused). |
| request `project_id` | `project_id` | Project-scoped. |
| `display_name` | `name` | Reuse by normalized name within project. |
| `description` | `description` | |
| Project | `style`, `visual_style` | Inherited from the target Project (no new enum values). |
| resolved `actor_key` | `actor_id` | Via reused/created `Actor`; if no `actor_key` → left unset + *warning*. |
| resolved `costume_key` | `costume_id` | Via reused/created `Costume` (nullable). |

## Assets → global libraries (reuse-first, by normalized name)

| Source | → Model | → Fields | Notes |
|---|---|---|---|
| `assets.actors[]` | `Actor` | `name`←display_name/key, `description`, `style`/`visual_style`←Project | Reuse by name; linked to Character via `actor_id`. |
| `assets.scenes[]` (via `shot.scene_key`) | `Scene` | same shape | Linked to shot via `ShotDetail.scene_id` **and** `ProjectSceneLink(project,chapter,shot,scene)`. |
| `assets.props[]` (via `shot.prop_keys`) | `Prop` | same shape | Linked via `ProjectPropLink(project,chapter,shot,prop)`. |
| `assets.costumes[]` (via `shot.costume_keys`/character) | `Costume` | same shape | Linked via `ProjectCostumeLink(...)` and/or `Character.costume_id`. |
| `shot.character_keys[]` | `ShotCharacterLink` | `shot_id`,`character_id`,`index` | Ordered shot cast. |

## Normalization & reuse

- Key comparison uses `trim` → `lowercase` (`normalize_key`).
- Within one import transaction, a given normalized key resolves to exactly one entity
  (in-transaction cache) — **no duplicate assets in one transaction**.
- Reuse queries match existing rows case-insensitively by name (`func.lower(name)`).

## Transaction, dry-run, idempotency (summary)

- **One transaction**, one commit (owned by the request session `get_db`); any failure → full rollback, no partial Chapter/Shots.
- **Dry-run** performs validation + mapping + reuse lookup + warnings, then rolls back (writes nothing).
- **Idempotency** via `cas_import_ledger` (durable): same `(project, key)` + same `payload_hash` → replay existing chapter; same key + different payload → 409; same `(project, episode)` under another key → 409. Ledger design: see **ADR-013**. The ledger row is written on the **same session/transaction** as all imported rows; a ledger insert failure rolls back the entire episode.
