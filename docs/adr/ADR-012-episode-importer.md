# ADR-012 — EpisodePackage Importer Design

- Status: **Accepted** (authoritative design for the EpisodePackage importer; implemented
  in Sprint 3 — importer, ledger, API, tests).
- Date: 2026-07-24
- Deciders: CAS × Jellyfish integration
- Module: `backend/app/crypto_animal_studio/`
- Related: `MASTER_PLAN.md`, `docs/architecture-analysis.md` (Final Architecture Decisions),
  `docs/crypto-animal-studio/episode-package-v1.md` (EpisodePackage v1 contract).

---

## 1. Context

**Why EpisodePackage is the official interchange format.**
Creative OS (CAS) and Jellyfish are two systems with different internal models. CAS
reasons about comedy: beats, escalation, punchline ownership, character voice. Jellyfish
reasons about production: chapters, shots, assets, generation tasks. A stable, versioned,
strictly-validated contract is required at the seam so neither side leaks its internal
representation into the other. **EpisodePackage v1** (see the contract doc) is that
contract: a single JSON document that fully describes one episode — script, storyboard
shots, dialogue, characters, and asset references — with strict Pydantic validation and
cross-reference integrity. Making it the *only* supported import format keeps the
integration surface small, testable, and independent of how CAS was generated.

**Why import directly instead of reconstructing via AI agents.**
Jellyfish natively ingests a raw script and uses `ScriptDividerAgent` to cut it into
shots and `ElementExtractorAgent` to infer characters/scenes/props. That is correct for
*unstructured* input. But a CAS EpisodePackage is **already a finished storyboard**: its
shot boundaries, timing, dialogue-to-shot alignment, and comedy beats are deliberate
authored decisions. Re-running those decisions through non-deterministic AI agents would:

- re-cut shots and destroy intended comedy beats and pacing;
- re-time or re-order dialogue, breaking punchline placement;
- re-infer entities, producing drift from the CAS-authored cast;
- make the same input produce different Jellyfish output on each run.

Therefore the importer is a **deterministic, mechanical mapper**, not an inference step.
It transcribes an already-decided structure into Jellyfish's data model.

## 2. Decision

1. **EpisodePackage is the only supported import contract.** No other CAS→Jellyfish
   import path is supported.
2. **A CAS Episode maps directly to one Jellyfish Chapter.**
3. **A Jellyfish Project represents a production, season, or series** and may contain
   multiple CAS Chapters/Episodes.
4. **EpisodePackage Shots are imported directly** into Jellyfish `Shot` / `ShotDetail` /
   `ShotDialogLine`.
5. **`ScriptDividerAgent` is NOT invoked** by the importer.
6. **`ElementExtractorAgent` is NOT invoked** by the importer.
7. **`Chapter.raw_text` stores the original complete script** (the CAS-generated episode
   script), for traceability only — it is never re-divided.
8. **The importer is deterministic**: identical input always yields identical Jellyfish
   state.
9. **The importer never invokes LLMs.**
10. **The importer never modifies script content** (no rewriting of dialogue, prompts, or
    narrative text).

## 3. Architecture

```
Creative OS
     │  (authors a complete episode)
     ▼
EpisodePackage (v1 JSON contract)
     │
     ▼
Validation  ── EpisodePackage Pydantic model (strict, extra="forbid",
     │          cross-reference checks). Invalid → reject, nothing written.
     ▼
CAS Importer  ── deterministic mapper (application layer, bounded module).
     │           No LLM, no agents, no providers, no Celery/Redis.
     ▼
Jellyfish Services  ── existing services/studio/* (chapters, shots, shot_details,
     │                  shot_dialogs, entities). Reuse, do not duplicate.
     ▼
Database  ── single transaction: Chapter + Shots + ShotDetail + ShotDialogLine
             + Character/asset links. All-or-nothing.
```

The importer lives in `backend/app/crypto_animal_studio/application/` and calls existing
Jellyfish studio services; the API entry is a thin route in
`backend/app/crypto_animal_studio/api/`. No parallel systems are introduced.

## 4. Importer Responsibilities

**The importer may:**

- **validate** — parse and strictly validate the EpisodePackage (contract rules).
- **map** — translate contract fields to Jellyfish model fields (deterministic).
- **reuse** — resolve existing Jellyfish assets/entities by normalized key before creating.
- **create** — create the Chapter, Shots, ShotDetail, ShotDialogLine, and required
  entities/links that do not already exist.
- **rollback** — abort the whole operation and leave the database unchanged on any failure.

**The importer must never:**

- rewrite prompts
- rewrite dialogue
- generate assets
- call providers
- invoke Celery
- invoke Redis
- invoke `ScriptDividerAgent`
- invoke `ElementExtractorAgent`

## 5. Mapping Strategy

Deterministic field mapping (contract → Jellyfish). Existing services own the writes.

```
EpisodePackage            →  Jellyfish Chapter
  episode_id                 →  chapter identity / traceable id
  title                      →  Chapter.title
  (assembled full script)    →  Chapter.raw_text            (traceability only)
  logline / source / notes   →  Chapter.summary (as appropriate)

EpisodePackage.shots[]     →  Jellyfish Shot (+ ShotDetail, +ShotDialogLine)
  shot_id / sequence         →  Shot identity / Shot.index (章节内唯一)
  title                      →  Shot.title
  script_excerpt             →  Shot.script_excerpt
  duration_seconds           →  ShotDetail.duration
  action / action beats      →  ShotDetail.description / action_beats
  image/video/negative prompt→  ShotDetail frame/video prompt fields
  camera (CameraSpec)        →  ShotDetail.camera_shot / angle / movement
  dialogue[]                 →  ShotDialogLine[] (index, text, line_mode, speaker/target)
  scene_key                  →  ShotDetail.scene_id (via reused Scene)
  character_keys / prop_keys / costume_keys → shot-level entity links

EpisodePackage.characters[]→  Jellyfish Character (project-scoped)
  character_key              →  stable resolution key
  display_name               →  Character.name
  description                →  Character.description
  actor_key                  →  Character.actor_id (via Actor below)
  costume_key                →  Character.costume_id (via reused Costume)

EpisodePackage.assets.actors[] →  Jellyfish Actor (reusable visual identity)
  actor_key                  →  stable resolution key
  display_name / description →  Actor.name / Actor.description

CameraSpec                 →  ShotDetail camera fields
  shot_type                  →  ShotDetail.camera_shot   (CameraShotType code)
  angle                      →  ShotDetail.angle         (CameraAngle code)
  movement                   →  ShotDetail.movement      (CameraMovement code)
```

CameraSpec codes are already identical strings to Jellyfish's camera enums (see ADR of
the contract), so the mapping is 1:1 with no translation. Enum decomposition and any
unmappable optional detail follow the Warning Policy (§8).

## 6. Asset Reuse Policy

- **Reuse first.** Before creating any Actor / Scene / Prop / Costume / Character, resolve
  whether an equivalent already exists (using Jellyfish's existing entity-existence
  service semantics) and reuse it.
- **Create only when necessary** — i.e. only when no existing entity matches.
- **Normalization for key comparison**: `trim` → `lowercase` → compare on the resulting
  **stable key**. The same normalization is applied to incoming keys and to existing
  entity identifiers used for matching.
- **Never duplicate assets inside one transaction**: within a single import, a given
  normalized key resolves to exactly one entity; repeated references reuse it rather than
  creating duplicates.

Reuse operates within the target Project scope (Characters are project-scoped; Actors/
Scenes/Props/Costumes are reusable libraries linked into the Project).

## 7. Transaction Policy

- The importer performs **exactly one database transaction**.
- **Failure anywhere → full rollback.** The database is left exactly as before the import.
- **No partial Chapters**: a Chapter is either fully imported (with all its Shots and
  links) or not at all.
- **Dry-run never commits.** A dry-run performs validation and mapping and reports what
  *would* be created/reused, then rolls back without writing.

## 8. Warning Policy

- Unsupported or unmappable **optional** content becomes a **warning**, not a failure.
- Warnings are collected and returned with the import result.
- **Data is never silently discarded**: anything not mapped is surfaced as an explicit
  warning so the caller knows what was skipped and why.

## 9. Error Policy

- **Errors occur only when the import cannot safely continue** — e.g. contract validation
  failure, a required reference that cannot be resolved, or a constraint that would break
  Jellyfish integrity.
- **Unsupported optional fields must not become errors** — they are warnings (§8).
- On error, the single transaction rolls back (§7); no partial state remains.

## 10. Idempotency

- A repeated import request with the same **Project**, **Episode**, and **IdempotencyKey**
  must **not** create duplicate Chapters — the operation is a safe no-op (or returns the
  previously-imported result).
- A request that reuses the **same IdempotencyKey** but carries a **changed payload** must
  **fail** (conflict), rather than silently creating a divergent or duplicate Chapter.
- Idempotency is keyed on `(Project, Episode, IdempotencyKey)` plus a payload fingerprint
  (a canonical SHA-256 of the validated EpisodePackage) to detect changed payloads under a
  reused key.

**Status of this policy vs. its persistence mechanism:**

- **Idempotency policy — approved** (the three rules above).
- **Persistence mechanism — resolved & approved (Sprint 3).** Repository discovery found
  **no** semantically appropriate durable metadata/extension field (`Chapter` has no JSON
  column; `Project.stats` is purpose-specific aggregate statistics). Per the approved
  decision, a **lightweight import-ledger table** is introduced:
  - Model: `app/crypto_animal_studio/domain/import_ledger.py` → `CasImportLedger`.
  - Migration: `backend/sql/009-add-cas-import-ledger.sql` (dev `create_all` also registers it).
  - Columns: `id, project_id, episode_id, idempotency_key, payload_hash, chapter_id, status, schema_version, created_at, updated_at`.
  - Unique constraints: `(project_id, idempotency_key)` and `(project_id, episode_id)`.
  - It is a **bookkeeping** table only — not a parallel Project/Shot/Asset system.
- The ledger's full design (schema, foreign keys/deletion behavior, unique constraints,
  hashing, replay/conflict, transaction boundaries, failed-import behavior, retention,
  rollback migration, and why it is not an Episode domain table) is documented in
  **ADR-013 — CAS Import Ledger** (`docs/adr/ADR-013-cas-import-ledger.md`).

## 11. Explicit Non-Goals

The importer will **never**:

- invoke LLMs
- invoke Creative OS
- invoke providers
- invoke Celery
- invoke Redis
- invoke `ScriptDividerAgent`
- invoke `ElementExtractorAgent`
- create parallel Project / Episode / Shot systems
- create a second Provider configuration system

## 12. Consequences

**Positive.**
- **CAS stays isolated**: all CAS-specific logic remains in the bounded module; Jellyfish
  core models, services, agents, and providers are untouched.
- **Maximum reuse**: the importer writes exclusively through existing Jellyfish studio
  services and reuses existing assets/entities, avoiding duplicate systems and data.
- **Deterministic and testable**: because there is no LLM/agent involvement, the importer
  is unit-testable with fixtures and produces identical output for identical input.
- **Safe**: single-transaction, all-or-nothing writes plus dry-run mean no partial
  Chapters and no destructive surprises; idempotency prevents duplicate imports.
- **Faithful**: authored comedy beats, timing, dialogue alignment, and shot structure are
  preserved exactly, because the storyboard is transcribed, not re-inferred.

**Trade-offs / costs.**
- The importer depends on EpisodePackage being complete and correct; malformed packages
  are rejected rather than "repaired" (by design).
- Camera/enum or other optional details that Jellyfish cannot represent surface as
  warnings, requiring the caller to review them rather than relying on silent best-effort.
- Idempotency and reuse add resolution logic (normalization, fingerprinting) that must be
  carefully tested to avoid false matches.

These trade-offs are accepted: they are the price of keeping CAS isolated while reusing
the maximum of existing Jellyfish architecture, per the approved final decisions.
