# Prompt for Benny

Meant to be pasted into Benny's own Claude, with `project.html` (this folder) attached as context.
Gives his Claude enough background on the pipeline and its real constraints to help him draft a
script without re-deriving any of this from scratch.

---

I'm an Inventory Ally account executive drafting a script for a short "micro-drama" video —
comedic, ~45–60 seconds, meant to be produced through an AI pipeline called Jellyfish that turns a
script into: shot breakdown → 1–2 reusable character keyframe images → several image-conditioned
video clips with real spoken dialogue → stitched into one episode.

I've attached `project.html`, a status page from the team that validated this pipeline — read it
first for context on how it actually works, the cost/quality tradeoffs, and known issues before
helping me draft anything.

Help me draft a short script for an episode centered on **"the life of a practice manager"** at a
veterinary clinic — weaving in inventory-management pain points (stockouts, expired product,
manual counts, the eternal "who moved the Simparica" mystery) in a way that's funny and relatable,
not a sales pitch. Think of the recent wave of short-form "microdrama" content (the kind Netflix
has been acquiring companies to get into) rather than a corporate explainer. Audience is vet techs
and practice managers — native to TikTok/Instagram/Facebook, not a LinkedIn/enterprise crowd.

**Constraints from the pipeline** (see `project.html`'s "Known issues" section for full detail):
- Keep it to about 5–7 shots, ~45–60 seconds total.
- Reuse 1–2 consistent character "looks" across shots (same setting/wardrobe) so a couple of
  keyframe images can carry the whole episode's visual consistency.
- Write dialogue as actual spoken lines — the video model generates real lip-synced audio straight
  from what's in the script. This isn't a "we'll add voiceover later" workflow.
- Avoid ambiguous action/emotion stage directions in shot descriptions — things like "she laughs"
  or "he raises his hands defensively" have a real false-positive rate against the video model's
  safety filter. Prefer calm, literal visual descriptions, or lean on explicit quoted dialogue
  instead of a vague emotional stage direction.

**Structure the output as:**
1. A one-paragraph premise/logline.
2. A numbered shot list — for each shot: setting, who's in it, the spoken dialogue line(s), and a
   brief literal visual description.
3. Any format variants worth flagging for later (e.g. a branching/choose-your-own-adventure cut,
   or a product-launch angle tying in a specific feature) — don't build these out, just note them.

**Last step — give me back an updated file, not just chat text:** take the `project.html` I
attached and hand me back a complete, updated copy of that same file with the script (premise +
shot list) added to it as a new section, matching the page's existing design (same fonts, colors,
card style — don't introduce a different look). I need a single self-contained `.html` file I can
download and send back to Jen over Slack, so make sure the whole thing — including your added
section — is valid, complete HTML on its own, not a diff or a snippet I'd need to merge in myself.
