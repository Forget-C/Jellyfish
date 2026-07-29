# CAS Production MVP (Sprint 4)

Deterministic, traceable, **mock-only** end-to-end production skeleton that consumes a valid
EpisodePackage and produces artifacts plus a manifest. Design rationale: [ADR-014](adr/ADR-014-cas-production-pipeline.md).

> No real image/video/voice/music providers, no FFmpeg, no LLM, no Celery/Redis in this sprint.
> Execution is synchronous. EpisodePackage v1 and the importer are unchanged.

## Module layout

```
backend/app/crypto_animal_studio/production/
├── enums.py             # JobStatus, Stage, ArtifactType, STAGE_ORDER
├── models.py            # CasProductionJob / CasProductionShot / CasProductionArtifact
├── prompt_builder.py    # deterministic prompts (no LLM)
├── artifact_manager.py  # paths, dirs, checksums, registration, reuse
├── orchestrator.py      # stage pipeline, failure, retry, manifest
├── cli.py               # python -m app.crypto_animal_studio.production.cli run
└── providers/
    ├── base.py          # ImageProvider/VideoProvider/VoiceProvider/Composer + GeneratedArtifact
    └── mock.py          # deterministic mock providers (write real files)
```

## Pipeline

`validate → prompt_build → image_generation → video_generation → audio_generation →
subtitle_generation → composition → finalize`

1. **validate** — re-hash the EpisodePackage and compare with the job's stored hash.
2. **prompt_build** — deterministic prompts per shot; writes `prompt.json`.
3. **image/video/audio** — mock providers write `image.txt` / `video.txt` / `voice.txt`.
4. **subtitle_generation** — writes `subtitle.txt` from the shot's dialogue.
5. **composition** — mock composer writes `final/final_video.txt`.
6. **finalize** — marks shots/job completed and writes `manifest.json`.

## Storage convention

```
storage/cas/productions/{project_id}/{episode_id}/{job_id}/
  manifest.json
  shots/{sequence}-{shot_id}/
    prompt.json
    image/image.txt
    video/video.txt
    voice/voice.txt
    subtitle/subtitle.txt
  final/final_video.txt
```

Paths are produced **only** by `ArtifactManager`; the DB stores relative POSIX paths.
Override the root with the `CAS_STORAGE_ROOT` environment variable.

## Determinism

`PromptBuilder v0` assembles prompts from EpisodePackage fields in a fixed order (visual
style → scene → characters → action → camera → shot prompt); dialogue is ordered by `order`.
No LLM, no randomness, no timestamps in artifact content — the same package always yields
byte-identical prompts and mock artifacts.

## Failure and retry

- On failure: the current shot (if any) and the job are marked `failed`, `current_stage`
  records the failed stage, `error_message` holds an actionable message, and **all successful
  artifacts are preserved**. A manifest is still written for traceability.
- On retry: execution restarts **at the failed stage** and runs it plus all later stages.
  Earlier artifacts are reused when the DB row exists, the file exists, and the checksum
  matches. The package hash is re-validated first, so a changed payload fails instead of
  silently producing a different episode.

## API

Registered under the existing API v1 + CAS mount (no separate FastAPI app):

| Method | Path |
|---|---|
| POST | `/api/v1/crypto-animal-studio/production/jobs` |
| GET | `/api/v1/crypto-animal-studio/production/jobs/{job_id}` |
| GET | `/api/v1/crypto-animal-studio/production/jobs/{job_id}/artifacts` |
| POST | `/api/v1/crypto-animal-studio/production/jobs/{job_id}/retry` |

Request body for create:

```json
{ "project_id": "demo-project", "episode_package": { }, "mode": "mock" }
```

All responses use the standard `ApiResponse` envelope.

## CLI

Windows PowerShell friendly (single line):

```powershell
uv run python -m app.crypto_animal_studio.production.cli run --project-id demo-project --episode-package samples/cas/demo_episode.json --provider-mode mock --create-tables
```

Prints `status`, `job_id`, `manifest` path, and `final_output` path.

## Database

Migration `backend/sql/010-add-cas-production-tables.sql` creates the three tables with
indexes and FKs (`shots`/`artifacts` cascade from the job). `project_id` / `episode_id` /
`source_shot_id` are intentionally **weak references** (no FK) so production stays decoupled
from the creative domain.

## Tests

`backend/tests/test_cas_production.py` (models, determinism, paths, checksums, mock file
creation, full orchestration, failure, retry/reuse, manifest) and
`backend/tests/test_cas_production_api_cli.py` (4 endpoints + CLI).

## Known limitations

- Synchronous execution only; long real generations will need the existing task center.
- Local filesystem storage; S3/RustFS integration is future work.
- Mock artifacts are `.txt` placeholders (`text/plain`).
- `music` and `log` artifact types are defined but not produced yet.
