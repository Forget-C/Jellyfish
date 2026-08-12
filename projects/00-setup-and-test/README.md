# Setup & Test

**Status:** Complete
**Owner:** Jen (Inventory Ally)

## What this is

Standing up this Jellyfish instance and validating whether its structured script → shot →
keyframe → video pipeline could reliably produce a coherent short episode, before committing
anyone's time or budget to using it for a real content pilot. This is the foundational project —
`vet-tech-microdrama/` and any future video project depend on the provider setup and lessons
recorded here.

## What happened

1. **Feasibility test**: stood up a local instance (FastAPI backend + Celery worker + Redis + Vite
   frontend), ran a deliberately-written test script through the real pipeline, and produced a real
   6-shot, ~48-second test episode — script broken into shots by an LLM, two reusable character
   keyframes, six image-conditioned video clips, stitched together. This answered the real question:
   can a coherent episode be produced *on purpose*, not by accident (the alternative being manual,
   ad hoc use of consumer AI tools like Google Flow, which took ~20 minutes of trial and error for
   one clip in initial exploration).

2. **xAI (Grok) provider adapter** — wrote and merged a native provider adapter (text, image, video)
   following this repo's existing OpenAI/Volcengine pattern. [PR #1](../../../../pull/1).

3. **Switched to Gemini (Veo)** — after live comparison, replaced the xAI adapter entirely:
   - **Cost**: Veo 3.1 Lite (~$0.05/sec, ~$0.40/8-second clip) lands in the same range as xAI's
     video cost, confirmed against Google's own pricing docs.
   - **Native scripted dialogue** — Veo 3 generates actual spoken lines synced to a script, which
     xAI's pipeline never did. This matters specifically for a *drama* format.
   - **Tradeoff**: an unpredictable safety filter rejects some fraction of otherwise-ordinary
     prompts (not charged when it fires, but a real reliability cost — see "Known issues" below).
   - Removed the xAI adapter entirely (no Grok code left in this repo) rather than maintaining both.
     [PR #2](../../../../pull/2).

## Current provider setup

| Category | Model | Notes |
|----------|-------|-------|
| Text | `gemini-3-flash-preview` | Script/shot breakdown |
| Image | `gemini-2.5-flash-image` | Native multimodal generation (not the deprecated Imagen `:predict` API) |
| Video | `veo-3.1-lite-generate-preview` | Cheapest tier that still hits good quality; Fast/Standard cost 2x–8x more |

## Known issues

- **Veo's safety filter is unpredictable.** In testing, roughly 2 of 5 video generation attempts
  were rejected by a generic "audio" content filter on ordinary, non-explicit phrasing (a character
  "laughing," a character "raising hands defensively"). Calmer wording, and even explicit quoted
  dialogue, passed clean. Not charged when it fires, but budget time for retries when scripting.
- Local dev environment has no S3/RustFS configured (SQLite-only) — file persistence for generated
  media hasn't been exercised past the download step in this environment. Should work in a real
  deployment with object storage configured; not independently verified here.

## Links

- [PR #1 — xAI (Grok) provider adapter](../../../../pull/1) (merged, later removed)
- [PR #2 — Gemini (Veo) provider adapter, xAI removed](../../../../pull/2) (merged, current state)
