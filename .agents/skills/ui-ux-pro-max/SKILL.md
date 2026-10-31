---
name: ui-ux-pro-max
description: Design new interfaces or substantial visual redesigns using the bundled UI/UX reference database. Use for explicit design-system work or focused UX research when the existing project does not answer the design question. Routine UI bug fixes, text changes, and code-only reviews do not require this skill.
---

# UI/UX Pro Max

Use the bundled searchable design database when the task needs a design decision that the user's brief or existing UI does not already settle.

## Scope and existing conventions

- Start with the affected screen and its existing components, tokens, and framework. Jellyfish's `front` uses React and Ant Design; preserve the surrounding conventions.
- A local UI fix can proceed directly. Do not generate a design system, search unrelated domains, or redesign adjacent UI to fix one control.
- For a new interface or substantial redesign, identify the product, audience, requested visual direction, and actual stack. Use `html-tailwind` only for a new project with no established stack or user preference.
- Existing user decisions and project conventions take precedence over database recommendations. Colors, spacing, icon libraries, navigation styles, and animation durations in search results are examples, not universal requirements.
- Reuse an existing design-system document when relevant. Read only the page and master sections needed for the current change; do not create or persist new design documents for routine work.

## Optional search workflow

Run scripts only when a concrete design question remains. Check for an available Python interpreter once before the first script invocation. If none is available, continue with the existing UI and direct analysis where sufficient; do not install a system runtime as a prerequisite for a small UI change. Report a missing runtime only if the requested database search cannot proceed.

The commands below run from the Jellyfish repository root. If working elsewhere, resolve `scripts/search.py` relative to this `SKILL.md` directory rather than assuming a top-level `skills/` folder.

### Focused question

Search the domain or stack that answers the current question:

```bash
python3 .agents/skills/ui-ux-pro-max/scripts/search.py "keyboard focus" --domain ux
python3 .agents/skills/ui-ux-pro-max/scripts/search.py "form state" --stack react
```

| Need | Domain |
| --- | --- |
| Product patterns | `product` |
| Visual direction | `style` |
| Palette | `color` |
| Typography | `typography` |
| Landing-page structure | `landing` |
| Chart choice | `chart` |
| Interaction and accessibility | `ux` |
| React performance | `react` |
| Web interface behavior | `web` |
| Visual prompt terminology | `prompt` |

Use `--help` only when the available options are unclear. Refine a query when its results leave the current question unresolved; stop searching once there is enough evidence to act. Reuse prior results for the same question and unchanged context.

### New design system or substantial redesign

Use `--design-system` only when the requested scope needs a complete set of design recommendations:

```bash
python3 .agents/skills/ui-ux-pro-max/scripts/search.py "creative production dashboard" --design-system -p "Jellyfish"
```

This searches product, style, color, landing, and typography together. Add targeted searches only for gaps relevant to the requested design. Use `-f markdown` when Markdown output is useful.

### Persisting an explicitly requested design system

Add `--persist` when reusable design documentation is part of the user's task:

```bash
python3 .agents/skills/ui-ux-pro-max/scripts/search.py "creative production dashboard" --design-system --persist -p "Jellyfish" --page "dashboard"
```

Use the paths returned by the script. The project name determines a directory under `design-system/`; its `MASTER.md` holds shared rules and `pages/<page>.md` holds overrides. Apply the relevant master rules together with any page overrides, with the page winning only where it specifies a difference. Persistence is optional and does not gate UI delivery.

## Verify the affected behavior

Choose checks based on what changed. Use the project's completion rules for build and type checks, and reuse successful results for unchanged code and environment.

| Change | Relevant checks |
| --- | --- |
| Control or interaction | Activation, disabled/loading/error states as applicable, keyboard focus and labels |
| Layout | Affected breakpoints, fixed-element overlap, overflow, hover-induced layout shifts |
| Theme or color | Relevant supported themes, readable contrast, distinguishable states without color alone |
| Image or icon | Existing icon conventions, correct affected asset, sizing and appropriate alternative text |
| Animation | Relevant transitions and reduced-motion behavior |
| Shared styles or broad redesign | Expand checks to affected consumers, supported themes and responsive layouts |

Do not run a full-page, both-theme, four-viewport checklist for every local change. Broaden verification when the change affects shared layout or theme rules, or when a specific failure indicates wider impact. Report actual validation and any relevant gaps without implying checks that were not performed.
