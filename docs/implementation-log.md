# Implementation Log

Chronological log of CAS↔Jellyfish integration sprints. Newest first.

---

## Sprint 3 — EpisodePackage Importer v1

Date: 2026-07-24

### Summary
Implemented the deterministic EpisodePackage → Jellyfish importer inside the CAS bounded
module: validate → map → reuse → create → rollback, in exactly one transaction, with
dry-run and **durable idempotency**. Added `POST /api/v1/crypto-animal-studio/import`, a
lightweight import-ledger table (approved) + migration, a full field mapping doc, and unit
+ integration + API tests. No LLM / ScriptDivider / ElementExtractor / Celery / Redis /
providers / frontend.

### Phase 0 — repository discovery (key findings)
- Reusable write primitive: `services/common/create_and_refresh` (`db.add` + `flush` + `refresh`, **no commit**); studio services are thin wrappers over it. **No dedicated chapters/aggregate-import service exists**, so the importer composes writes on the single request session via that shared helper (documented reason for constructing ORM directly).
- Transaction pattern: one `AsyncSession` from `get_db` (commit once on success, rollback on error). Importer only flushes → one transaction, one commit.
- `ShotDetail` shares its PK with `Shot` (1:1). Camera fields are NOT NULL → missing camera is defaulted + warned. `ShotStatus.generating` is deprecated → importer uses `pending`.
- **No durable metadata field** on Chapter/Project for idempotency → lightweight ledger table approved.

### Architecture decisions
- Idempotency persisted in new `cas_import_ledger` (bookkeeping table; unique `(project,key)` and `(project,episode)`); canonical SHA-256 payload hash detects changed payloads. This is durable (survives restarts), not process-memory.
- Reuse-first assets with `trim+lowercase` normalized-name matching; in-transaction cache prevents duplicate assets. Character ≠ Actor (never merged).
- Dry-run builds + flushes (to validate) then rolls back → writes nothing.
- Unmapped optional fields (`language`, `source`, `creative_direction`, `video_prompt`, `negative_prompt`) become warnings, never silently discarded.

### Files created
- `backend/app/crypto_animal_studio/domain/import_ledger.py` (CasImportLedger ORM)
- `backend/app/crypto_animal_studio/domain/mapping.py` (pure mapping helpers)
- `backend/app/crypto_animal_studio/application/hashing.py` (canonical payload hash)
- `backend/app/crypto_animal_studio/application/import_result.py` (ImportResult/ImportCounts)
- `backend/app/crypto_animal_studio/application/import_episode.py` (importer service + exceptions)
- `backend/app/crypto_animal_studio/schemas/import_request.py`, `schemas/import_result.py`
- `backend/app/crypto_animal_studio/api/import_episode.py` (POST /import route)
- `backend/sql/009-add-cas-import-ledger.sql` (migration)
- `backend/tests/test_cas_import_unit.py`, `test_cas_import_episode.py`, `test_cas_import_api.py`
- `docs/crypto-animal-studio/import-mapper-v1.md`

### Files changed
- `backend/app/crypto_animal_studio/api/__init__.py` — register import route.
- `backend/app/core/db.py` — register ledger model in `init_db()` create_all.
- `docs/adr/ADR-012-episode-importer.md` — status Accepted; §10 durable persistence resolved.
- `docs/implementation-log.md` — this entry.

### Tests executed & results
- `pytest test_cas_import_unit.py test_cas_import_episode.py test_cas_import_api.py` → **21 passed** (8 unit + 10 integration + 3 API).
- Full CAS set (schema + health + import) → **47 passed, 0 skipped** (with the sandbox 3.11-name shim so health API tests run; see limitation).
- Integration uses in-memory SQLite (StaticPool) with all models + ledger created via `Base.metadata.create_all`.

### Idempotency status
**Fully durable using the approved `cas_import_ledger` table** (not an existing field, not process memory): same key + same payload → replay; same key + different payload → 409; same episode under another key → 409. Verified by integration tests `test_idempotent_replay_returns_existing`, `test_same_key_different_payload_conflicts`, `test_same_episode_other_key_rejected`.

### Known limitations
- Sandbox is Python 3.10; repo targets 3.12 (3.12 toolchain download blocked). Health API tests execute via a `/tmp` sitecustomize shim (`datetime.UTC`, `typing.Self`); on 3.12/CI they run natively. Importer unit/integration/API tests run on 3.10 unshimmed.
- `video_prompt` / `negative_prompt` and `language`/`source`/`creative_direction` have no Jellyfish target field in v1 → surfaced as warnings (documented in the mapper).
- OpenAPI/frontend client not regenerated (out of scope; run `pnpm run openapi:update` before FE use).
- `pylint` not run in sandbox; recommend `uv run pylint app/crypto_animal_studio` on 3.12.

### Rollback instructions
1. Revert changed files: `backend/app/crypto_animal_studio/api/__init__.py`, `backend/app/core/db.py`, `docs/adr/ADR-012-episode-importer.md`, `docs/implementation-log.md`.
2. Delete new files: importer modules, schemas (import_request/result), api/import_episode.py, domain/import_ledger.py + mapping.py, application/hashing.py + import_result.py + import_episode.py, `backend/sql/009-add-cas-import-ledger.sql`, the three import test files, `docs/crypto-animal-studio/import-mapper-v1.md`.
3. If the ledger table was already applied to a database, drop it: `DROP TABLE cas_import_ledger;` (no other tables were altered).

### Hardening addendum (2026-07-24, no new sprint)
- Added **ADR-013 — CAS Import Ledger** (`docs/adr/ADR-013-cas-import-ledger.md`): full table
  schema, FKs/deletion behavior, unique constraints, canonical hashing, replay/conflict,
  transaction boundaries, failed-import behavior, retention/cleanup, rollback migration, and
  why it is not an Episode domain table (incl. `UNIQUE(project_id, episode_id)` as a
  conservative v1 policy pending a separate reimport/update decision). ADR-012 now references it.
- **Transaction verification**: confirmed ledger + Chapter + Shots + ShotDetails + dialogue +
  assets + links all use the one `AsyncSession` in a single transaction. Added
  `test_ledger_insert_failure_rolls_back_entire_episode` (forces the ledger insert to fail →
  asserts every table count is 0).
- **raw_text**: `assemble_raw_text` now also includes shot `action` (ordered by sequence, then
  dialogue by order); fully specified in `import-mapper-v1.md`; determinism test added.
- **Migration review**: `sql/009` aligned to repo conventions (VARCHAR(64) UUID PK, VARCHAR FKs,
  FK indexes via unique-key left prefix + explicit chapter index, `fk_`/`uq_` naming, DATETIME
  defaults incl. `ON UPDATE`); removed a redundant `project_id` index; documented forward-only
  rollback (`DROP TABLE cas_import_ledger;`).
- CAS tests after hardening: **49 passed, 0 skipped** (23 schema + 3 health + 9 import-unit + 11 import-integration + 3 import-api).

---

## Sprint 2.1 — CAS Foundation Hardening

Date: 2026-07-24

### Summary
Hardened the EpisodePackage v1 contract and added approved governance docs. Replaced the
`camera` free-text field with a structured `CameraSpec` object (`shot_type` / `angle` /
`movement`) using **CAS-local** enums that mirror Jellyfish's camera codes — without
importing any ORM model or DB enum. Added `MASTER_PLAN.md` and `docs/architecture-analysis.md`.
No database persistence, importer, Celery, or frontend work (per scope).

### Architecture decisions
- **Structured camera**: `Shot.camera` is now `CameraSpec { shot_type?, angle?, movement? }`.
  Enums (`CasShotType`/`CasCameraAngle`/`CasCameraMovement`) live in `domain/episode_package.py`
  and use identical string codes to Jellyfish `CameraShotType`/`CameraAngle`/`CameraMovement`,
  so the future importer maps 1:1 to `ShotDetail.camera_shot`/`angle`/`movement`. The schema
  does **not** import `app.models` — the module boundary is preserved.
- Governance docs record the 9 approved final decisions (Episode→Chapter, Project=series,
  direct Shot creation, no re-division through `ScriptDividerAgent`, `raw_text` traceability,
  no duplicate systems, provider convergence, synchronous first importer, no new enums).

### Files created
- `MASTER_PLAN.md`
- `docs/architecture-analysis.md`

### Files changed
- `backend/app/crypto_animal_studio/domain/episode_package.py` — add `CasShotType` / `CasCameraAngle` / `CasCameraMovement`.
- `backend/app/crypto_animal_studio/domain/__init__.py` — export the new enums.
- `backend/app/crypto_animal_studio/schemas/episode_package.py` — add `CameraSpec`; `Shot.camera` now `Optional[CameraSpec]`.
- `backend/app/crypto_animal_studio/schemas/__init__.py` — export `CameraSpec`.
- `backend/tests/test_cas_episode_package_schema.py` — add 5 camera tests (parse, optional, invalid shot_type, invalid movement, unknown camera field).
- `docs/crypto-animal-studio/samples/sample-episode-package-v1.json` — camera as structured objects.
- `docs/crypto-animal-studio/episode-package-v1.md` — CameraSpec reference + camera→ShotDetail mapping + updated deviation note.
- `docs/implementation-log.md` — this entry.

### Tests executed
- `pytest backend/tests/test_cas_episode_package_schema.py` (schema) and
  `backend/tests/test_cas_health_api.py` (health API).
- Isolated endpoint verification harness; `py_compile` on changed files; sample JSON re-validated.

### Test results
- **Schema tests: 23 passed** (18 prior + 5 new camera tests).
- **Health API tests**: see "Known limitations" — they run and pass under Python 3.12
  (repo target); in this sandbox (Python 3.10 only, 3.12 download blocked) they are skipped
  by the repo's own `conftest` guard. Endpoint re-verified working via the isolated harness.

### Known limitations
- The repo targets Python 3.12; this sandbox only has 3.10 and cannot download a 3.12
  toolchain (GitHub release host not reachable). The 3 health API tests therefore **skip**
  here via the repo's `conftest` (`app=None`), not due to any code fault. Run
  `uv run pytest` on 3.12 to execute them with zero skips.
- OpenAPI/frontend generated client not regenerated (out of sprint scope; no route shape
  change beyond Sprint 2's already-registered health route).

### Rollback instructions
1. Revert the changed module/test/doc files listed above to their Sprint 2 state.
2. Delete `MASTER_PLAN.md` and `docs/architecture-analysis.md` if the governance docs
   are not wanted: `rm -f MASTER_PLAN.md docs/architecture-analysis.md`.
3. No DB/migration/ORM/enum/provider changes were made — no data or schema rollback needed.
4. Via VCS: `git restore <changed files>` and `git clean -f MASTER_PLAN.md docs/architecture-analysis.md`.

---

## Sprint 2 — CAS Foundation (EpisodePackage v1)

Date: 2026-07-24

### Summary
Established the bounded Crypto Animal Studio (CAS) backend module and the strict,
versioned **EpisodePackage v1** contract between Creative OS and Jellyfish. Added a
lightweight CAS health endpoint, schema + API tests, a valid sample package, and
contract documentation. **No** database persistence, episode import, Celery, LLM,
or frontend work was done (per sprint scope).

### Architecture decisions
- **Bounded module** `backend/app/crypto_animal_studio/` (`api/domain/schemas/application/agents/integrations`) so CAS logic never scatters across Jellyfish.
- **Responsibility split**: `schemas/` is the single source of Pydantic transport/validation models; `domain/` holds only constants/enums/helpers (`SCHEMA_VERSION`, `SourceType`, recurring character keys) and does **not** import FastAPI.
- **Contract shape** follows the sprint spec; documented deviations: `camera` is a single free-text field (not a nested object) in v1; `duration_seconds` is a float `>0`; asset key fields are category-specific (`actor_key`/`scene_key`/`prop_key`/`costume_key`).
- **Validation**: field-level constraints via `Field`; all cross-reference checks via one root `model_validator(mode="after")`; every model `extra="forbid"`.
- **Health route** reuses Jellyfish `ApiResponse`, registered through the existing `app/api/v1` aggregation (no independent FastAPI app), at `GET /api/v1/crypto-animal-studio/health`.
- Reaffirmed final decisions in docs: Episode→Chapter, Project=series/season, shots imported directly (never re-sent through `ScriptDividerAgent`), `raw_text` kept for traceability.

### Files created
- `backend/app/crypto_animal_studio/__init__.py`
- `backend/app/crypto_animal_studio/api/__init__.py`
- `backend/app/crypto_animal_studio/api/health.py`
- `backend/app/crypto_animal_studio/domain/__init__.py`
- `backend/app/crypto_animal_studio/domain/episode_package.py`
- `backend/app/crypto_animal_studio/schemas/__init__.py`
- `backend/app/crypto_animal_studio/schemas/episode_package.py`
- `backend/app/crypto_animal_studio/application/__init__.py`
- `backend/app/crypto_animal_studio/agents/__init__.py`
- `backend/app/crypto_animal_studio/integrations/__init__.py`
- `backend/tests/test_cas_episode_package_schema.py`
- `backend/tests/test_cas_health_api.py`
- `docs/crypto-animal-studio/samples/sample-episode-package-v1.json`
- `docs/crypto-animal-studio/episode-package-v1.md`
- `docs/implementation-log.md` (this file)

### Files changed
- `backend/app/api/v1/__init__.py` — register CAS router under `/crypto-animal-studio` (only existing file modified).

### Tests executed
- `pytest backend/tests/test_cas_episode_package_schema.py backend/tests/test_cas_health_api.py`
- Isolated endpoint verification harness (minimal FastAPI app mounting only the CAS router).
- `python -m py_compile` on all new/changed Python files.

### Test results
- **Schema tests: 18 passed** (valid sample + version, empty-field, duration, empty-shots, duplicate sequence/shot_id/dialogue-order, unknown character/actor/scene/prop/costume refs, duplicate character/asset keys, unknown field at root + nested).
- **Health API tests: 3 skipped** in the sandbox. Reason: the repo's own `tests/conftest.py` guard sets `app=None` when `app.main` cannot import; the sandbox runs Python 3.10 while the repo targets 3.12 and uses 3.11+ names (`datetime.UTC`, `typing.Self`). This is an **environment limitation, not a code fault** — on CI / Python 3.12 the app imports and these 3 tests run.
- **Endpoint proven working** via an isolated harness: `GET /api/v1/crypto-animal-studio/health` → `200`, `ApiResponse` envelope, `data = {"service":"crypto-animal-studio","status":"ok","schema_version":"1.0"}`.
- `py_compile`: OK for all new/changed files. Sample JSON: well-formed and passes `EpisodePackage` validation.

### Known limitations
- Health API tests could not execute in this sandbox (Python 3.10; repo needs 3.11+). They should pass under `uv run pytest` on 3.12.
- OpenAPI/frontend generated client **not** regenerated (`pnpm run openapi:update`): sprint forbids touching generated clients and no server/frontend was run here. Follow-up before merge if the new route must appear in the FE client.
- Full backend suite not run end-to-end here (full-app import is slow/blocked on 3.10); only targeted CAS tests + compile checks were run.
- `pylint` not run in-sandbox (repo DoD expects it); recommend `uv run pylint app/crypto_animal_studio` on a 3.12 dev env.

### Rollback instructions
1. Revert the one modified file: restore `backend/app/api/v1/__init__.py` (remove the `crypto_animal_studio` import and its `include_router(...)` block).
2. Delete the new module and artifacts:
   - `rm -rf backend/app/crypto_animal_studio`
   - `rm -f backend/tests/test_cas_episode_package_schema.py backend/tests/test_cas_health_api.py`
   - `rm -rf docs/crypto-animal-studio`
   - `rm -f docs/implementation-log.md`
3. No DB/migration/ORM/enum/provider changes were made, so no data or schema rollback is required.
4. Equivalent via VCS: `git restore backend/app/api/v1/__init__.py` and `git clean -fd backend/app/crypto_animal_studio backend/tests/test_cas_*.py docs/crypto-animal-studio docs/implementation-log.md`.
