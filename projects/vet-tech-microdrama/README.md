# Vet Tech Micro-Drama / UGC Content Pilot

**Status:** Phase 0 complete — awaiting go/no-go on Phase 2
**Originated by:** Benny Pugh (AE, Inventory Ally)
**Depends on:** [`../00-setup-and-test/`](../00-setup-and-test/)

## What this is

Short, comedic AI-generated "micro-drama" video content aimed at vet techs, paired with a UGC
(user-generated content) mechanic: solicit clinics' craziest on-the-job stories, turn the best
submissions into episodes ("based on a true story"), and let people tag themselves in wanting to
be next. Originated by Benny Pugh on a call exploring Google Flow/Gemini/Vids/NotebookLM as
possible production tools.

## Two phases, deliberately sequenced

- **Phase 0 (complete): feasibility test.** Can a coherent episode actually be produced on
  purpose, reliably — not by accident? See `../00-setup-and-test/` for the full technical
  validation. Answer: yes. A real 6-shot test episode, "The Case of the Missing Simparica," was
  produced end-to-end and is the concrete evidence.
- **Phase 2 (not started): the actual pilot.** UGC contest, 3-5 real episodes, tech-facing-only
  distribution (TikTok/Instagram — explicitly not LinkedIn or anywhere enterprise buyers would see
  it). Gated on a go/no-go conversation with Benny.

## Why vet techs specifically

Inventory Ally's Inventory Technician persona is TikTok/Instagram-native, has a documented desire
for recognition beyond clinical work, and has real word-of-mouth leverage between techs at
different practices — even with zero purchasing authority. The UGC contest plays directly into
that: it's low-cost content supply *and* a distribution mechanic through exactly the right persona.
Economic-buyer personas (GP/Independent Practice Owners, Enterprise Network Managers) are
explicitly **not** the audience for this content — they respond to ROI/trust signals, not
entertainment, and enterprise buyers in particular are shown (in Inventory Ally's own sales
research) to actively scrutinize company legitimacy, making off-brand entertainment content a real
risk if it reaches them.

## What's still open before Phase 2

1. **Go/no-go conversation with Benny.** Phase 0 proved the "can this be made on purpose" question
   and the Gemini switch answered the cost/tooling question — the creative and business decision is
   what's left.
2. **VMX timing** — Benny referenced running this ahead of conference season. Resolved to VMX
   (~2027-01-17), not the mis-heard "BMX," based on his own phrasing and what VMX is used for
   elsewhere in Inventory Ally's messaging. ~23 weeks out from Phase 0 completion — real runway,
   not a rush.
3. **Who owns production time** — Benny is an AE, not marketing staff; his commission ramp window
   ended 2026-08-31.
4. **Debra Noble (VP Sales & Marketing) sign-off** — needed before anything ships externally; not
   sought yet since nothing has gone external during Phase 0.
5. **Script discipline for Veo's safety filter** — see `../00-setup-and-test/README.md`'s known
   issues. Scripts for real episodes should avoid ambiguous action/emotion phrasing that tends to
   trip the filter.

## The test episode

"The Case of the Missing Simparica" — a vet tech (Mara) confronts a colleague (Theo) over
"eyeballed" inventory counts and a missing medication bin. 6 shots, ~48 seconds. Produced via:
script → shot breakdown → two reusable character keyframes (Mara solo, Mara+Theo confrontation) →
six image-conditioned video clips → stitched into one file. See `../00-setup-and-test/` for the
full production recipe and provider details.
