# projects/

One folder per video idea/initiative that uses this Jellyfish instance for production. Each
project folder has:

- `README.md` — the working brief: what it is, status, links to relevant PRs/commits, open questions
- `project.html` — a standalone, self-contained HTML page (no build step, no server) that can be
  downloaded and shared directly with people outside this repo (partners, stakeholders, whoever
  needs the status without a GitHub account)

## Active projects

| Folder | What it is | Status |
|--------|-----------|--------|
| [`00-setup-and-test/`](./00-setup-and-test/) | Standing up this Jellyfish instance and validating its generation pipeline (provider adapters, cost/quality comparison, testing) | Complete |
| [`vet-tech-microdrama/`](./vet-tech-microdrama/) | Benny Pugh's vet-tech-targeted micro-drama concept, paired with a UGC contest idea | Phase 0 complete, Phase 2 pending go/no-go |

## Convention

- Numbered prefix (`00-`, `01-`, ...) for foundational/infrastructure projects that other projects
  depend on; plain slugs for content/product projects.
- `project.html` should stay self-contained (inline CSS, no external assets) so it works as a
  plain downloaded file, not just when viewed in a browser pointed at the repo.
- Update both files as the project's status changes — `project.html` is what gets shared externally,
  so don't let it go stale relative to the README.
