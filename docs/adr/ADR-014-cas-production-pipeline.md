# ADR-014 — CAS Production Pipeline (MVP Skeleton)

- Status: **Accepted** (implemented in Sprint 4 as a mock-only, deterministic skeleton).
- Date: 2026-07-24
- Related: [ADR-012](ADR-012-episode-importer.md) (EpisodePackage importer),
  [ADR-013](ADR-013-cas-import-ledger.md) (import ledger),
  [`docs/cas-production-mvp.md`](../cas-production-mvp.md),
  contract: [`docs/crypto-animal-studio/episode-package-v1.md`](../crypto-animal-studio/episode-package-v1.md).
- Scope: new tables `cas_production_jobs` / `cas_production_shots` / `cas_production_artifacts`
  (migration `backend/sql/010`), provider boundaries + mock providers, deterministic prompt
  builder, ArtifactManager, orchestrator, manifest, API, CLI.

---

## 1. Context

The importer (ADR-012) turns an EpisodePackage into Jellyfish creative records
(Chapter/Shot/…). Producing an actual video is a **different concern**: it is long-running,
retryable, failure-prone, provider-dependent, and produces files. Sprint 4 builds the
smallest end-to-end, deterministic, traceable production skeleton — with **mock providers
only** — so that real image/video/voice integration in a later sprint has a stable frame to
plug into.

## 2. Decision

### 2.1 Production state is separate from creative domain models

Production state lives in dedicated tables (`cas_production_*`) and **never** mutates or
duplicates Jellyfish creative entities (Project, Chapter, Shot, Asset, Character, Actor,
Task, Provider). Reasons:

- **Different lifecycle.** A creative Shot is authored once and is stable; a production run
  is attempted, fails, and is retried many times. Mixing run state into `Shot` would pollute
  a stable creative record with volatile execution data.
- **Many runs per shot.** One creative Shot can be produced repeatedly (new job each run).
  A 1:1 field on `Shot` cannot represent N runs.
- **Boundary rule.** The project forbids parallel creative systems; `CasProductionShot`
  therefore stores only production status/prompts/errors plus `source_shot_id` as a **weak
  reference**, not a replacement Shot.

### 2.2 Artifact First

Every stage output is registered as an **Artifact** row (type, stage, provider, model, path,
mime, checksum, metadata) pointing at a real file. Rationale:

- **Traceability**: the manifest can reconstruct exactly what was produced, by whom, with
  which model, and verify it via checksum.
- **Retry correctness**: "has this already been produced successfully?" becomes a concrete,
  verifiable question (DB row + file exists + checksum matches) rather than a guess.
- **Provider independence**: artifacts are the contract between stages, so swapping a mock
  provider for a real one changes nothing downstream.

### 2.3 Providers are adapters

`ImageProvider` / `VideoProvider` / `VoiceProvider` / `Composer` are abstract boundaries
returning a common `GeneratedArtifact`. Core orchestration contains **no** provider model
names, SDKs, or API details, and providers **never invent filesystem paths** (paths come from
ArtifactManager). This keeps the orchestrator stable while providers churn.

### 2.4 Mock providers before real providers

Implementing mocks first lets us prove the *pipeline* — staging, persistence, artifacts,
failure, retry, manifest — deterministically, offline, with no API keys, cost, latency, or
flakiness. Mocks write **real files** (not in-memory success) so filesystem/DB consistency and
checksums are genuinely exercised. Real providers in Sprint 5 then swap in behind the same
interfaces.

### 2.5 Retry semantics

- A failed job records the **failed stage** in `current_stage` and an actionable
  `error_message`; the failing shot is marked failed.
- Retry **restarts from the failed stage** and reruns that stage and all later stages.
- Earlier artifacts are **reused** when the DB row exists, the file exists, and the checksum
  matches; they are not regenerated.
- The package hash is **always re-validated** before resuming (even when starting at a later
  stage) so a retry cannot silently produce a different episode.
- All successful artifacts are preserved on failure — nothing is deleted or rolled back on
  the filesystem.

### 2.6 Filesystem ownership

ArtifactManager is the **only** component that constructs paths and creates directories:

```
storage/cas/productions/{project_id}/{episode_id}/{job_id}/
  manifest.json
  shots/{sequence}-{shot_id}/{prompt.json,image/,video/,voice/,subtitle/}
  final/final_video.txt
```

Path segments are sanitized (no traversal), stored in the DB as **relative POSIX paths**
(portable across Windows/Linux), and the storage root is overridable via `CAS_STORAGE_ROOT`.

### 2.7 Exclusions for this sprint

Explicitly **not** in Sprint 4: real image/video/voice/music providers, FFmpeg, Celery,
Redis, S3 upload, LLM calls (prompt building is pure string assembly), frontend UI, changes
to EpisodePackage v1, and changes to the importer contract. Execution is synchronous.

## 3. Consequences

**Positive.** Deterministic and offline-testable; DB state provably matches the filesystem;
retry is cheap and safe; providers can be replaced without touching orchestration; creative
records remain untouched.

**Trade-offs.** Synchronous execution will not scale to real long-running generation — Sprint
5+ must move execution onto Jellyfish's existing task center (never a second task system).
Local filesystem storage will need to migrate to the existing S3/RustFS storage layer.
Mock artifacts are `.txt` placeholders, so mime types are provisional until real providers
land.
