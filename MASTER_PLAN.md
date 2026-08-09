# MASTER PLAN — Crypto Animal Studio × Jellyfish

Governance document for integrating **Crypto Animal Studio (CAS / Creative OS)** into
**Jellyfish** as the production platform. This file is the single high-level source of
truth for scope, approach, and the approved architectural decisions. Detailed current
architecture lives in `docs/architecture-analysis.md`; the contract lives in
`docs/crypto-animal-studio/episode-package-v1.md`.

---

## 1. Goal

Jellyfish is the **main project** (an end-to-end AI short-drama production workspace:
FastAPI + LangChain/LangGraph + SQLAlchemy, async task center, asset consistency,
image/video generation). CAS is the **upstream creative brain** that turns a news or
original premise into a fully-formed episode (script + storyboard + dialogue + character
and asset definitions). CAS delivers that episode to Jellyfish as a single validated
**EpisodePackage**, which Jellyfish then produces and exports.

```
CAS (creative brain)                         Jellyfish (production platform)
premise → episode + storyboard          ──▶  EpisodePackage (contract)
 + dialogue + characters + assets       ──▶  Chapter + Shots → assets → generation → export
```

## 2. Approach

Integrate CAS as a **bounded module** inside the Jellyfish backend
(`backend/app/crypto_animal_studio/`), reusing Jellyfish's existing Project / Chapter /
Shot / Asset / Media / Prompt / Task / Provider systems. Do **not** fork a parallel
platform. Build additively and keep every change inside the module plus a thin router
registration.

## 3. Approved final decisions (authoritative)

These are approved and binding. The ADR table with reasons/consequences is in
`docs/architecture-analysis.md` → "Final Architecture Decisions".

1. **A CAS Episode maps to one Jellyfish Chapter.**
2. **A Jellyfish Project represents a series / production / season** and may contain
   multiple CAS Chapters/Episodes.
3. **EpisodePackage directly creates Shots** (Chapter / Shot / ShotDetail /
   ShotDialogLine + character & asset links) from the completed storyboard.
4. **Completed CAS storyboards must not be passed through `ScriptDividerAgent`** —
   re-dividing would destroy comedy beats, timing, dialogue alignment, and shot structure.
5. **`Chapter.raw_text` stores the complete generated script for traceability**, but
   Shots are created from the EpisodePackage, not by re-dividing `raw_text`.
6. **No duplicate systems**: do not create parallel CAS Project / Episode / Shot / Asset
   / Media / Prompt / Task / Provider systems; reuse Jellyfish's.
7. **Provider configuration ultimately converges on Jellyfish** (`Provider` / `Model` /
   `ModelSettings`). A temporary adapter is allowed during transition; a second
   independent provider configuration system is not.
8. **The initial importer is synchronous** (no Celery for the first milestone).
9. **No new `ProjectStyle` or `ProjectVisualStyle` enum values** in the initial phase.

## 4. Sprint roadmap

| Sprint | Scope | Status |
|---|---|---|
| 2 — CAS Foundation | Bounded module + EpisodePackage v1 schema + validation + sample + docs + health endpoint + tests | Done |
| 2.1 — Foundation Hardening | Governance docs (this file + architecture-analysis) + structured `CameraSpec` (shot_type/angle/movement, CAS-local enums) + doc/sample/test/log updates | Done |
| 3 — Synchronous importer | EpisodePackage → validation → **synchronous** import service → create Chapter + Shots (+ ShotDetail/dialogue/links); no Celery/LLM/frontend | Planned |
| 4 — Consistency & generation hand-off | Seed characters/assets as Jellyfish entities; wire shots into existing generation workspace | Planned |
| 5 — Provider convergence & UX | Retire temporary provider adapter onto Jellyfish Provider/Model/ModelSettings; frontend entry; OpenAPI regen | Planned |

## 5. Scope guardrails (until explicitly lifted)

Do not, in the foundation phases: create DB tables, modify ORM models, create SQL
migrations, create Chapter/Shot records (before the importer sprint), add Celery tasks,
add Redis/S3 logic, invoke an LLM, migrate Creative OS agents, modify generated frontend
clients, build frontend UI, add a second provider system, or add
`ProjectStyle`/`ProjectVisualStyle` enum values.

## 6. Module boundary

```
backend/app/crypto_animal_studio/
├── api/          # thin routes → ApiResponse (health now; import later)
├── application/  # use cases (future synchronous import service)
├── domain/       # constants/enums/helpers (SCHEMA_VERSION, SourceType, camera enums)
├── schemas/      # the ONLY Pydantic models for EpisodePackage
├── agents/       # (future) CAS-specific agents
└── integrations/ # (future) bridge to Jellyfish Provider/Model/ModelSettings
```

## 7. References

- `docs/architecture-analysis.md` — full current architecture + Final Architecture Decisions (ADR).
- `docs/crypto-animal-studio/episode-package-v1.md` — EpisodePackage v1 contract.
- `docs/crypto-animal-studio/samples/sample-episode-package-v1.json` — valid sample.
- `docs/implementation-log.md` — per-sprint implementation log.
- `AGENTS.md` / `.cursor/rules/*` — repository conventions and definition of done.
