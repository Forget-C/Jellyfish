# ADR-015 — Crypto Animal Bible v1 is Canon

- Status: **Accepted**
- Date: 2026-07-26
- Deciders: Product Owner (decision), Architect/CTO (review), Engineer (record)
- Canonical document: [`docs/crypto-animal-studio/Crypto_Animal_Bible_v1.md`](../crypto-animal-studio/Crypto_Animal_Bible_v1.md)
- Related: [ADR-012](ADR-012-episode-importer.md) (importer), [ADR-013](ADR-013-cas-import-ledger.md) (ledger),
  [ADR-014](ADR-014-cas-production-pipeline.md) (production pipeline),
  contract: [`episode-package-v1.md`](../crypto-animal-studio/episode-package-v1.md),
  gap analysis: [`bible-v1-implementation-gap-report.md`](../crypto-animal-studio/bible-v1-implementation-gap-report.md)
- Scope: **governance only.** This ADR changes no code, no schema, no tests, and no samples.

---

## 1. Context

Crypto Animal Studio (CAS) now has a complete creative and brand specification:
**Crypto Animal Bible v1**. Until now the codebase carried an earlier, informal demo cast
(six animal keys) and a demo fixture with a 45-second target duration. Those predate the
Bible and were never a brand decision — they were scaffolding for contract and pipeline work
(Sprints 2–4).

Without an explicit decision, two competing "truths" would coexist: the Bible's launch trio
and the legacy demo cast. That ambiguity would leak into prompts, samples, validation rules,
and eventually into published video. This ADR resolves it.

## 2. Decision

### 2.1 Bible v1 is the canonical source of truth

`docs/crypto-animal-studio/Crypto_Animal_Bible_v1.md` is the authoritative specification for:
world setting, character identities and personalities, character visual consistency, art
direction, humor and dialogue rules, cinematography, prompt construction, continuity
requirements, prohibited content, and quality-control rules.

Bible v1 is **immutable**. It must not be rewritten or modified without explicit
authorization. Any permanent change to a locked field requires a new Bible version plus the
change-control steps in Bible §13 (updated character reference assets, prompt-regression
test, review of an existing episode under the new configuration).

### 2.2 The canonical launch trio

The primary cast is **Bruno Bull**, **Boris Bear**, and **Milo Cat**, with the locked visual
identities, personalities, voice/dialogue rhythms, and motion language defined in Bible §3.

### 2.3 Canonical runtime and format

- Runtime: **15–30 seconds** per episode.
- Format: **9:16 vertical video**.
- **English dialogue with Traditional Chinese subtitles is required for publishable episodes.**

### 2.4 Legacy status of the six-character demo

The Bible **supersedes**, as a creative specification, the older six-character demo cast and
the 45-second demo duration. Those artifacts remain in the repository only as technical
fixtures for existing contract/pipeline tests.

### 2.5 Legacy compatibility policy

- The existing character keys `bull, bear, fox, hammy, monkey, walter` are **legacy technical
  compatibility values**.
- In this step we **do not delete, rename, or reinterpret** existing enum/constant values.
- **No destructive data migration** is performed.
- Legacy characters may remain supported by the generic EpisodePackage contract, but they are
  **not part of the current canonical launch cast**.
- `bull` and `bear` **must not be treated as sufficient visual identities**. Canonical
  production prompts must eventually carry Bruno's and Boris's full Bible identities
  (Bible §10: "Prompts must not rely on character names alone").
- **Walter must not be substituted for Milo** in new canonical content.

### 2.6 Why existing enums are not removed now

1. **Non-destructive by default.** Removing or renaming values risks breaking stored data and
   the green Sprint 4 baseline (68 CAS tests) for no immediate creative benefit.
2. **Separation of concerns.** The canonical cast is a *creative* decision; the character keys
   are a *technical* compatibility surface. The Bible constrains what we produce, not what the
   generic contract can represent.
3. **The contract is intentionally generic.** EpisodePackage v1 describes arbitrary characters;
   restricting it to three would couple a general interchange format to one show's launch cast.
4. **Sequencing.** Canonical enforcement belongs with Prompt Builder v1 and the first real
   video work, where it can be implemented and tested together rather than as a risky
   stand-alone rename.

### 2.7 EpisodePackage v1 remains unchanged

This decision introduces **no** change to EpisodePackage v1. The contract, its validation
rules, the importer contract, the production pipeline, tests, and samples are untouched by
this ADR.

### 2.8 Schema evolution requires a separate approved proposal

Bible requirements that have no representation in EpisodePackage v1 — notably Traditional
Chinese subtitle text, the fact-card/CTA beat, and explicit format fields (aspect ratio, fps,
resolution) — **must not** be added ad hoc. They require a separately approved **v1.1 or v2**
schema proposal with its own ADR, following the existing versioning policy in
`episode-package-v1.md`.

### 2.9 Prompt Builder v1 is a separate scoped implementation

The current deterministic Prompt Builder v0 (Sprint 4) does not satisfy Bible §10. Bringing
prompts to canon — the 11 required blocks, world/style anchors, full immutable character
identities, continuity/reference injection, and Bible-derived exclusions — is a **separate,
scoped sprint** and is explicitly **not** authorized by this ADR.

### 2.10 Automated checks and human review must be distinguished

Bible §11's production quality gate mixes machine-verifiable constraints with human
judgement. Any future "quality gate" work must state, per criterion, whether it is an
**automated check** or a **human review check**. Claiming the gate is "implemented" without
that distinction is not acceptable.

## 3. Consequences

**Positive.** A single unambiguous creative source of truth; conflicts now surface as review
findings instead of silent drift; the Sprint 4 baseline stays green because nothing is
migrated; canonical enforcement is deliberately sequenced with the work that needs it.

**Trade-offs.** Legacy and canonical casts coexist temporarily, so documentation and samples
will disagree with the Bible until the compatibility work lands — the gap report tracks this
explicitly. Publishable episodes are blocked until subtitle representation and Prompt Builder
v1 exist; those are recorded as separate approvals, not assumed.

**Non-goals of this ADR.** No code, schema, test, sample, or Bible modification; no enum
removal; no data migration; no Prompt Builder implementation.
