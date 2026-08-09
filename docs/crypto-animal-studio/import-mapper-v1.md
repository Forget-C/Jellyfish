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

---

## v1.1 additions (Step 5)

| EpisodePackage v1.1 field | Jellyfish target | Note |
|---|---|---|
| `output.*` (aspect_ratio, fps, safe_area) | *(not persisted)* | Render-time spec; consumed by the CAS production pipeline, not by Jellyfish entities. |
| `localization.spoken_language` | *(not persisted)* | Dialogue language; `ShotDialogLine.text` holds the spoken (English) line. |
| `localization.subtitle_tracks[].cues[]` | *(not persisted — by decision)* | Jellyfish has no subtitle/language column. Cues stay in the package, in `Chapter.raw_text` traceability and in the CAS `ArtifactType.subtitle` artifact. Covered by the canonical payload hash. |
| `fact_card`, `market_data`, `references`, `post_production` | *(not persisted)* | Post-production and provenance metadata; no Jellyfish entity models them. |
| `shots[].beginning_state` / `ending_state` / `generation_risks[]` / `regeneration_fallback` / `overlay_ids[]` | *(not persisted)* | Generation guidance consumed by the prompt builder. |

**QA gate.** `import_episode()` runs `validate_episode_package(stage=pre_render_data_lock)` before
any entity is constructed. Failure raises `CasValidationError` → HTTP 422 with **zero** rows written.

**Async path.** `POST /import/async` registers a `cas_import_episode_package` task
(relation type `cas_episode_import`, entity key = SHA-256 of `project_id:episode_id`, 64 chars to fit
`relation_entity_id VARCHAR(64)`). No migration is required.

---

## Step 5.1 — subtitle artifact, worker, client contract

### zh-Hant WebVTT artifact

| v1.1 field | WebVTT / Jellyfish target |
|---|---|
| `subtitle_tracks[].language_tag` | `Language:` header line + `FileItem.tags` + `file_usages.source_ref` |
| `cues[].cue_id` | WebVTT cue identifier line |
| cue order | block order (declared order preserved, never re-sorted) |
| `cues[].start_ms` / `end_ms` | `HH:MM:SS.mmm --> HH:MM:SS.mmm` |
| `cues[].text` | cue payload, byte-for-byte |
| `cues[].shot_id` | `NOTE shot=<id>` before the cue |
| `cues[].speaker_character_key` | `NOTE speaker=<key>` before the cue |

Storage key is deterministic: `cas/subtitles/{project_id}/{episode_id}/{language_tag}.vtt`.
Association uses the existing file-linking mechanism — `FileItem` (`type=subtitle`) plus
`FileUsage(project_id, chapter_id, usage_kind=subtitle, source_ref="cas:{episode_id}:{lang}")`,
whose `UNIQUE(file_id, usage_kind, source_ref)` gives per-slot idempotency.

**Limitation.** Subtitle cues are **preserved and downloadable** through the existing files
endpoint, but they are **not editable as native Jellyfish entities** — there is no subtitle table
or column, by the accepted no-migration decision. Editing requires re-importing a corrected
Episode Package.

### Consistency (no atomicity claimed)

Object storage does not participate in the DB transaction. The strategy is deterministic key +
compensating cleanup: object written first, DB rows second; on failure the newly created objects
are deleted (reused objects from a previous successful import are never deleted). A hard process
kill can leave one orphan at a deterministic key, which the next successful import overwrites and
which no DB row references.

### Worker

`task_kind="cas_import_episode_package"` is registered in `app/services/worker/task_registry.py`
with `AbstractAsyncDelegatingExecutor` (timeout 300 s) and enqueued through the existing
`enqueue_task_execution` → Celery `task.execute` path. No separate queue or task system.

### Client contract

`front/openapi.json` and `front/src/services/openapi.ts` are checked-in generated artifacts and were
**not** regenerated (pnpm + `openapi-typescript-codegen` are unavailable offline). Regenerate with:

```bash
cd front && pnpm run openapi:update   # requires the backend running on :8000
```

New/changed contract surface to expect: `POST /api/v1/crypto-animal-studio/import/async`
(request `ImportEpisodeRequest`, response `ApiResponse<CasImportTaskAccepted>`), the
`subtitle_artifacts[]` field on `ImportResult`, and the widened `FileTypeEnum` (`image|video|subtitle`).
