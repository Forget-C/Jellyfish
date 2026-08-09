# CAS-EP001 — BTC Breaks Out: Bruno Celebrates Too Early

> Creative specification only. No code, schema, sample, or provider work is authorized by this
> document. Canonical sources: [Crypto Animal Bible v1](../Crypto_Animal_Bible_v1.md),
> [ADR-015](../../adr/ADR-015-crypto-animal-bible-v1-canon.md),
> [gap report](../bible-v1-implementation-gap-report.md).
>
> All time-sensitive market values appear as `{{PLACEHOLDER}}` and **must** be supplied from a
> real source before production (see §3). No live price is invented here, and the story works
> unchanged once real values are inserted.

---

## 1. Episode identity

| Field | Value |
|---|---|
| Episode ID | **CAS-EP001** |
| Working title | BTC Breaks Out — Bruno Celebrates Too Early |
| Logline | Bitcoin pushes above resistance, Bruno throws a party on the signal alone; Boris points out the candle hasn't closed; the chart dips, and Milo reveals the confetti will land before the close does. |
| Target runtime | **24.0 seconds** (hard range 15–30 s) |
| Format | 9:16 vertical, premium stylized 3D |
| Spoken language | English |
| Subtitle language | Traditional Chinese (zh-Hant) |
| Canonical cast | Bruno Bull, Boris Bear, Milo Cat (launch trio only) |
| World | Block Street |
| Primary location | The Burrow |
| Generated footage | 4 cinematic shots, 0.0–21.0 s |
| Post-production card | Fact card + disclaimer, 21.0–24.0 s (not AI-generated) |

## 2. Creative objective

**Market concept viewers should understand.** Price moving above a resistance level is the
**initial breakout signal** — it is not the same thing as a *confirmed* breakout. Some traders
treat the move as confirmed only after a candle closes above the level and price follows through.
Those criteria are how the move is commonly judged; they do not guarantee future performance.

**Emotional experience.** `surprise → euphoria → doubt → renewed chaos → calm punchline`
(Bible §12). The viewer feels the pull of early celebration, then the small drop in the stomach
when the move is questioned, then relief through comedy rather than through advice.

**Memorable character joke.** Bruno ordered the confetti off the initial signal, so the delivery
will arrive **before** the candle that would confirm the move even closes. Boris is right about
confirmation and still overreacts. Milo says almost nothing and wins the scene.

**Why this is the right first episode.** It is the Bible's own first-episode baseline (§12); it
introduces each character's core function in a single situation (accelerator / risk / foresight);
it needs one set, three characters, and no supporting cast; it teaches one genuinely useful
market idea without giving advice; and it survives price substitution, so it can be produced on
any day a real breakout occurs.

## 3. Factual boundary

**Plain-language definitions (non-advisory).**

- *Resistance level* — a price area, here `{{RESISTANCE_LEVEL}}`, where selling has previously
  slowed or reversed advances.
- *Breakout signal (the opening event of this episode)* — price moves **above**
  `{{RESISTANCE_LEVEL}}`. This is the initial signal and an observation of what happened; it is
  not yet a confirmed breakout.
- *Confirmation (one common stricter reading)* — price **closes** above the level on the chosen
  timeframe (`{{TIMEFRAME}}`, close at `{{CANDLE_CLOSE_TIME_UTC}}`) and then shows follow-through,
  i.e. continues to hold or extend above it. Candle close and follow-through **may be used** as
  confirmation criteria; meeting them does not guarantee future performance.
- *Pullback* — price moving back toward or below the level after an initial move above it.

**Required distinction, stated in the episode.** The opening event is price moving above
`{{RESISTANCE_LEVEL}}` — the initial breakout signal. Bruno reacts to that signal alone. Boris
points out the candle has not closed, i.e. confirmation is still outstanding. That is the entire
educational payload; the script never asserts that the breakout was confirmed and never resolves
whether it ultimately held.

**Explicit non-claims.** Candle close and follow-through are **descriptions of how some traders
judge a move**, not a method that guarantees future performance. Nothing in this episode predicts
direction, recommends any action, or implies a reliable outcome. No "guaranteed", "risk-free",
"buy", or "sell" language appears anywhere, spoken or on-screen.

**Placeholders (all must be replaced with sourced values before production).**

| Placeholder | Meaning |
|---|---|
| `{{BTC_PRICE}}` | Price shown at the moment of the hook |
| `{{RESISTANCE_LEVEL}}` | The resistance area being cleared |
| `{{PRICE_MOVE_PCT}}` | Percentage move for the period |
| `{{PULLBACK_PCT}}` | Size of the brief pullback in Shot 3 |
| `{{TIMEFRAME}}` | Candle timeframe used for confirmation (e.g. 4h, 1D) |
| `{{CANDLE_CLOSE_TIME_UTC}}` | Close time of the relevant candle |
| `{{BREAKOUT_TIMESTAMP_UTC}}` | Timestamp of the observed move |
| `{{DATA_SOURCE}}` | Named market-data source |
| `{{ATH_CONTEXT}}` | Optional: prior high context, only if factual |

**Metadata to supply before production** (belongs in EpisodePackage `source`, per Bible §7 — not
in spoken dialogue): `{{DATA_SOURCE}}`, `{{BREAKOUT_TIMESTAMP_UTC}}`, `{{TIMEFRAME}}`,
`{{CANDLE_CLOSE_TIME_UTC}}`, `{{RESISTANCE_LEVEL}}`, `{{BTC_PRICE}}`, `{{PRICE_MOVE_PCT}}`,
`{{PULLBACK_PCT}}`, source URL, and a one-line factual note confirming the move was observed.

## 4. Beat sheet with exact timing

| Beat | Time | Duration | Content |
|---|---|---|---|
| Hook | 0.0–3.0 | 3.0 s | Price moves above `{{RESISTANCE_LEVEL}}` — the initial breakout signal; the alert flares and Bruno bursts in mid-celebration. |
| Conflict | 3.0–10.0 | 7.0 s | Boris blocks the celebration: the candle hasn't closed, so confirmation is outstanding. |
| Escalation | 10.0–16.5 | 6.5 s | Chart dips `{{PULLBACK_PCT}}`; Bruno freezes mid-air; Boris overreacts. |
| Punchline | 16.5–21.0 | 4.5 s | Milo sips coffee and reveals the confetti will arrive before the candle closes. |
| Fact card / disclaimer | 21.0–24.0 | 3.0 s | Post-production card: breakout signal vs confirmation + "Not financial advice". |
| **Total** | | **24.0 s** | Within the 15–30 s canonical range. |

## 5. Four-shot storyboard specification

Global: 9:16 (1080×1920 target), central safe area for faces and critical action, one dominant
camera movement per shot, cut on action or reaction. Palette anchors: night navy `#0B1220`,
steel `#6F8199`, market green `#16C784`, risk red `#EA3943`, teal `#18A7A0`, amber `#F5B942`.
Red/green never carry meaning alone — character reaction and shape carry it too.

### Shot 1 — Hook

| Field | Specification |
|---|---|
| Shot number | 1 of 4 |
| Time / duration | 0.0–3.0 s (3.0 s) |
| Story purpose | Establish The Burrow, the initial breakout signal (price moving above `{{RESISTANCE_LEVEL}}`), and Bruno's impulsive optimism in one image. |
| Visible characters | Bruno (primary, entering); Boris seated at his workstation (background left, partly visible); Milo not yet visible. |
| Composition & safe area | Vertical thirds: wall-sized BTC chart occupies the upper third; Bruno's head/shoulders centred in the middle third; desk edge in the lower third. Bruno's face inside the central safe area; chart glow may bleed to frame edges. |
| Character action | Bruno shoulders through the doorway, both arms already rising, tie swinging. |
| Facial expression | Wide-eyed delight, open mouth mid-shout, thick eyebrows raised high. |
| Beginning state | Door half-open, Bruno's silhouette entering frame right; chart line just crossing `{{RESISTANCE_LEVEL}}`. |
| Ending state | Bruno fully in frame, arms up, hooves planted; chart alert glowing green. |
| Camera framing | Medium-wide, slight low angle to make Bruno read as tallest. |
| Dominant camera movement | **Push-in** (gentle, toward Bruno's chest/face). |
| Lighting & market accent | Cool office ambience `#6F8199` + warm amber key on Bruno's face; **green accent** `#16C784` as secondary light from the chart — accent only, never a full-frame neon wash. |
| Environment & props | Doorway (frame right), curved trading desk, wall BTC chart with a rising line crossing a horizontal level, Boris's red notebook visible on desk. |
| English dialogue | Bruno: "Breakout! We are so back!" |
| zh-Hant subtitle | 「突破了！我們回來了！」 |
| Sound effects | Door swing, single bright alert chime, hoof impacts with weight. |
| Music direction | Rising synth stab entering on the alert; energetic but not chaotic. |
| Transition out | Hard cut on Bruno's arms reaching apex → Shot 2. |
| Continuity requirements | Forest-green rolled-sleeve shirt, mustard tie loosened, black smartwatch on **left** wrist, ivory horns with dark tips curving outward then upward. Chart level line must sit at the same screen height in Shots 1, 3. |
| Generation risks | Extra or asymmetric horns; jacket or hat appearing; smartwatch drifting to right wrist; readable text baked into the chart; doorway geometry inconsistent with Shot 4. |

### Shot 2 — Conflict

| Field | Specification |
|---|---|
| Shot number | 2 of 4 |
| Time / duration | 3.0–10.0 s (7.0 s) |
| Story purpose | Boris blocks the celebration with the episode's actual market point. |
| Visible characters | Boris (primary, seated/half-rising); Bruno's arm and shoulder intruding from frame right. |
| Composition & safe area | Boris centred slightly left, occupying the middle third; his red notebook raised into the lower-middle third; Bruno's forearm crossing the right edge to keep both characters connected. Boris's glasses and eyes inside the safe area. |
| Character action | Boris raises a flat paw to stop Bruno, other paw clutching the red notebook; ears flick back at the alert. |
| Facial expression | Tight-lipped, brows drawn, steel-blue eyes narrowed behind rectangular glasses; controlled stress, not panic yet. |
| Beginning state | Boris mid-turn from his monitor, notebook at desk level. |
| Ending state | Paw up, notebook raised chest-high, glasses caught in the chart's green light. |
| Camera framing | Medium close-up on Boris, Bruno's limb as foreground framing. |
| Dominant camera movement | **Rack focus** from Bruno's foreground arm to Boris's face. |
| Lighting & market accent | Cool base; green accent still present but weaker; warm key preserves Boris's fur colour so charcoal-brown never reads black. |
| Environment & props | Boris's workstation, monitor with unreadable placeholder chart, red risk notebook, red pen, coffee station soft-focus behind. |
| English dialogue | Boris: "The candle hasn't closed yet." |
| zh-Hant subtitle | 「這根K棒還沒收。」 |
| Sound effects | Notebook flap, chair creak, subtle ear-flick whoosh, low UI blip. |
| Music direction | Pull energy back; hold a single tense sustained note under the line. |
| Transition out | Cut on Boris's paw reaching full extension → Shot 3. |
| Continuity requirements | Burgundy knit vest over pale blue dress shirt, navy trousers, rectangular black reading glasses, red notebook **and** red pen present. Boris reads clearly wider than Milo and slightly shorter than Bruno. |
| Generation risks | Glasses vanishing or changing shape; vest colour drifting toward brown/red; ears rendered large/pointed instead of small and rounded; notebook changing colour; readable numbers appearing on the monitor. |

### Shot 3 — Escalation

| Field | Specification |
|---|---|
| Shot number | 3 of 4 |
| Time / duration | 10.0–16.5 s (6.5 s) |
| Story purpose | The market answers: a brief dip freezes Bruno mid-celebration and spikes Boris's alarm. |
| Visible characters | Bruno (primary, frozen mid-celebration); Boris (secondary, reacting); Milo's mug and shoulder entering frame edge as a plant for Shot 4. |
| Composition & safe area | Two-shot: Bruno frame-right in the middle third, Boris frame-left slightly lower; the wall chart's dipping line visible in the upper third at the **same screen height** as Shot 1. Both faces inside the safe area. |
| Character action | Bruno's arms stop at their peak, one hoof still lifted; loose papers he knocked up are still falling. Boris grabs his glasses with one paw and the notebook with the other. |
| Facial expression | Bruno: smile collapsing into uncertainty, eyes flicking sideways to the chart. Boris: alarmed, mouth open, freeze-before-panic posture. |
| Beginning state | Celebration at maximum; chart line at local high. |
| Ending state | Bruno statue-still, papers mid-air; chart line visibly lower by `{{PULLBACK_PCT}}`; red accent rising. |
| Camera framing | Medium two-shot, eye level. |
| Dominant camera movement | **Controlled handheld reaction** (small, motivated settle — no shake for its own sake). |
| Lighting & market accent | Green accent fades; **red accent** `#EA3943` rises as practical alert light on the wall and rims, while warm key preserves fur and skin tones. Shape cue (falling line, papers) reinforces meaning so colour is not the only signal. |
| Environment & props | Wall BTC chart with a dipping line, falling loose papers, Bruno's workstation edge, glass wall to Block Street showing distant red accents, Milo's matte black mug at frame edge. |
| English dialogue | Bruno: "It's still green… right?" |
| zh-Hant subtitle | 「還是綠的……對吧？」 |
| Sound effects | Paper flutter, descending alert tone, a single low bass drop; Boris's short inhale. |
| Music direction | Cut the drive; leave a hollow low pulse and room tone. |
| Transition out | Cut on Bruno's held stillness → Shot 4 (silence carries across the cut). |
| Continuity requirements | Bruno's wardrobe unchanged from Shot 1; Boris's props unchanged from Shot 2; the resistance line stays at a consistent screen height; papers that leave Bruno's desk in this shot may appear settled in Shot 4. |
| Generation risks | Duplicate characters; extra limbs from the frozen pose; wardrobe change between Shots 1 and 3; full-frame red wash destroying fur colour; motion blur so heavy the faces stop reading; readable price text baked in. |

### Shot 4 — Punchline

| Field | Specification |
|---|---|
| Shot number | 4 of 4 |
| Time / duration | 16.5–21.0 s (4.5 s) |
| Story purpose | Milo lands the understated reveal — the confetti beats the candle close — and closes the emotional arc calmly. |
| Visible characters | Milo (primary, coffee corner); Bruno and Boris soft in background, still frozen. |
| Composition & safe area | Milo centred in the middle third at his coffee station, shortest of the trio so his eyeline sits lower in frame; Bruno and Boris out of focus behind at frame right and left. Milo's face and mug inside the safe area. |
| Character action | Milo lowers the matte black mug after one controlled sip, gives his phone screen a brief downward glance (delivery cue), slow blink, tail giving one unhurried flick. |
| Facial expression | Calm, faintly amused; emerald-green eyes half-lidded; no smirk larger than necessary. |
| Beginning state | Mug at lips, steam rising, warm amber practical light on his face; phone face-up on the counter, screen glow only. |
| Ending state | Mug lowered to chest height, gaze returning level to camera-adjacent, tail settled. |
| Camera framing | Reaction close-up (chest-up), eye level. |
| Dominant camera movement | **Short pan to Milo** — canonical and locked; a single short pan settling on him. *Regeneration fallback only:* if repeated attempts show identity drift during the pan, a locked frame may be substituted. The fallback is a recovery measure, not an equal production option. |
| Lighting & market accent | Warm amber `#F5B942` practical from the coffee corner as the dominant key; residual red accent only as a distant rim on the background pair; teal `#18A7A0` bounce on his turtleneck. |
| Environment & props | Coffee station, matte black mug, teal accent surface, phone face-up on the counter (screen glow only — no legible content in the plate), background curved desk with settled papers, glass wall beyond. |
| English dialogue | Milo: "Your confetti arrives before candle close." |
| zh-Hant subtitle | 「你的彩帶會比收盤先到。」 |
| Sound effects | Single ceramic set-down, quiet sip, one short delivery-notification chime from the phone, room tone. |
| Music direction | One clean resolving note on the line, then space. No sting stacked on top of the joke. |
| Transition out | Hold ~0.3 s of stillness, then cut to the post-production fact card (no dialogue over the card). |
| Continuity requirements | Dark teal turtleneck, slim black trousers, small silver Bitcoin pin on **left** chest, three forehead stripes, ringed tail, cream chin/chest patch and paw tips. Milo remains clearly shortest; background pair keep the poses they ended Shot 3 with. The phone is an ordinary supporting screen prop (Bible §2.5), not a new signature prop, and never becomes a character trait. |
| Generation risks | Milo rendered with glasses/jacket/hat; stripe count or eye colour drift; pin moving side or growing; tail duplicated or missing rings; background characters re-posing or changing wardrobe; mug changing to glossy or coloured; **legible text generated on the phone screen** (must stay an abstract glow — any readable notification is composited in post). |

### Post-production card (not a generated shot)

21.0–24.0 s. Full-screen graphic over a defocused, colour-graded still of Shot 4's final frame,
or a clean brand plate on `#0B1220`. All readable financial text lives **here**, never inside
AI-generated imagery.

## 6. Dialogue table

| # | Speaker | English line | zh-Hant subtitle | Intended delivery | Words | Est. spoken duration |
|---|---|---|---|---|---|---|
| 1 | Bruno | Breakout! We are so back! | 突破了！我們回來了！ | Warm baritone, loud but not screaming; celebratory, on the move. | 5 | ~1.6 s |
| 2 | Boris | The candle hasn't closed yet. | 這根K棒還沒收。 | Low, controlled, clipped; a reluctant correction, not a lecture. | 5 | ~1.8 s |
| 3 | Bruno | It's still green… right? | 還是綠的……對吧？ | Confidence draining mid-line; the question is genuine and quiet. | 4 | ~1.5 s |
| 4 | Milo | Your confetti arrives before candle close. | 你的彩帶會比收盤先到。 | Smooth, understated, slightly amused; no emphasis on the joke. | 6 | ~2.2 s |

Total spoken ≈ 7.1 s across 24.0 s — the rest is action, reaction, and silence. Every line is
under eight English words. No line explains the market ("as you know…" is absent); the concept is
carried by Boris's single objection plus the fact card. Milo speaks last and least.

**Why line 4 lands.** It ties the joke directly to the episode's market point: Bruno acted on the
initial signal, so the confetti will physically arrive **before** the candle that would confirm
the move has even closed. The line reveals the pre-order without stating it, and it needs no
readable on-screen text to work — the phone glance plus the delivery chime carry the cue.

## 7. Character continuity sheet (this episode)

Names are metadata only. Every prompt must carry the full locked identity below or an approved
reference image — never "Bruno Bull" alone.

### Bruno Bull

- **Immutable identity:** anthropomorphic bull; broad shoulders, strong upper body; warm
  chestnut-brown fur; cream muzzle; symmetrical ivory horns with dark tips curving outward then
  upward; thick dark eyebrows; amber-brown eyes; late 20s; **tallest of the trio**.
- **Locked wardrobe/props:** dark forest-green rolled-sleeve shirt; mustard-yellow tie, loosened;
  black smartwatch on **left** wrist.
- **Episode emotion range:** elation → suspended uncertainty → sheepish stillness. He never
  becomes stupid or humiliated; he is simply early. Likable throughout.
- **Episode action range:** fast entry, broad raised-arm gestures, weighty hoof impacts,
  secondary motion in horns and tie, then a full freeze.
- **Screen position:** enters frame right (Shot 1); frame right in the Shot 3 two-shot;
  background right and defocused in Shot 4.
- **Visual negatives:** no jacket, no hat, no glasses; no extra or asymmetric horns; no human
  hands replacing hooves; no wardrobe change between shots; no watch on the right wrist; no fur
  colour drift toward red or black.

### Boris Bear

- **Immutable identity:** anthropomorphic bear; heavy, rounded, compact power; deep
  charcoal-brown fur; lighter gray-brown muzzle and inner ears; **small rounded ears**;
  steel-blue eyes; early 30s; slightly shorter than Bruno, **much wider than Milo**.
- **Locked wardrobe/props:** burgundy knit vest over pale blue dress shirt; dark navy trousers;
  rectangular black reading glasses; red risk notebook **and** red pen.
- **Episode emotion range:** wary → firm objection → alarmed overreaction. He is **correct**
  about confirmation and still visibly overreacts; correctness and composure are separate.
- **Episode action range:** small guarded gestures, flat-paw stop, glasses adjust, notebook
  clutch, freeze-before-panic, subtle ear reaction to alerts.
- **Screen position:** background left (Shot 1); centre-left (Shot 2); frame left (Shot 3);
  background left and defocused (Shot 4).
- **Visual negatives:** glasses never disappear or change to round frames; no jacket over the
  vest; ears never large or pointed; fur never pure black; no human hands; notebook never changes
  colour; no wardrobe change between shots.

### Milo Cat

- **Immutable identity:** anthropomorphic orange tabby cat; slim, upright; triangular ears;
  expressive ringed tail; burnt-orange tabby fur with darker stripes — **three forehead marks**,
  cheek stripes, ringed tail; cream chin, chest patch and paw tips; emerald-green eyes;
  mid-to-late 20s; **shortest of the trio**.
- **Locked wardrobe/props:** dark teal turtleneck; slim black trousers; small silver Bitcoin pin
  on **left** chest; matte black coffee mug.
- **Episode emotion range:** unbothered observation → the faintest amusement. Never smug enough
  to become unlikable; he withholds, he does not gloat.
- **Episode action range:** economical movement, one controlled sip, slow blink, single tail
  flick, stillness while the room is chaotic.
- **Screen position:** absent from Shots 1–2 (mug enters frame edge in Shot 3); centre in Shot 4.
- **Visual negatives:** no glasses, no jacket, no hat; stripe count and placement never change;
  eye colour never shifts to yellow/blue; pin never moves to the right chest or scales up; tail
  never duplicated or unringed; mug never glossy or coloured; no human hands replacing paws.

**Trio rules.** Height order on screen is always Bruno > Boris > Milo. No character is the
permanently intelligent one: Boris is right on the facts and wrong on proportion; Bruno is early,
not foolish; Milo is observant but contributes nothing until the last second. No legacy
characters (Fox, Hammy, Monkey, Walter) appear in any capacity.

## 8. Environment continuity — The Burrow (locked for EP001)

**Fixed layout (screen-direction map, camera facing the chart wall as the reference axis):**

- **Wall-sized BTC chart** — upper third of the chart wall, frame **centre-left**; the horizontal
  resistance line sits at a consistent screen height in every shot that shows it.
- **Central curved trading desk** — mid-frame, curving from frame left toward frame right,
  foreground edge in the lower third.
- **Three workstations** — Boris **left** (monitor, red notebook, red pen), Bruno **right**
  (cluttered, loose papers), Milo **centre-right toward the coffee corner** (tidiest).
- **Coffee station** — frame **right** wall, warm amber practical light; Milo's territory.
- **Glass wall overlooking Block Street** — frame **rear/right**, visible behind the desk; distant
  city market accents only, never legible signage.
- **Doorway** — frame **right**, adjacent to the glass wall; Bruno's entrance in Shot 1.

**Screen direction.** Bruno enters right→left. Boris occupies left. Milo occupies right/centre.
Nobody crosses to the opposite side within this episode, so cuts stay spatially legible.

**Approved market-light usage.** Default is cool office ambience with a warm facial key. Bullish
moments add **green** `#16C784` as a secondary accent (Shot 1). Bearish moments add **red**
`#EA3943` as alert accents (Shot 3). Accents never become a full-frame neon wash and never
override fur or skin tone. Milo's corner keeps its warm amber practical regardless of market
state. Because red/green must not be the only carrier of meaning, each market change is also
expressed by chart-line shape, prop behaviour (falling papers), and character reaction.

**Anti-drift rules.** Desk curvature, chart position, workstation ownership, coffee-station side,
and glass-wall placement are fixed for all four shots. Props may move only as scripted (papers
launched in Shot 3 may be settled in Shot 4). No new furniture, plants, posters, screens, or
signage may appear between shots. No provider logos, watermarks, or real-company branding
anywhere. Background monitors show abstract, unreadable chart shapes only.

## 9. Text and graphics plan

- **All final readable financial text is added in post-production.** Nothing legible and factual
  is trusted to generated imagery.
- **Chart placeholders in generated footage:** abstract rising line crossing a horizontal level
  (Shot 1), the same line visibly lower (Shot 3). No digits, tickers, axis labels, or exchange
  names in the plate. Real values are composited later if needed.
- **Subtitle safe area:** zh-Hant subtitles sit in the lower ~18% of the 9:16 frame, above
  platform UI, horizontally centred, max two lines, high-contrast with a subtle scrim. Never
  overlapping a character's face or the chart's resistance line. Cue 4
  (「你的彩帶會比收盤先到。」) is the longest at ~2.2 s and stays on a single line; it must clear
  before the fact card appears.
- **Delivery-notification overlay (optional, post-production only):** if the confetti order needs
  to be spelled out visually, a small notification graphic may be composited over Milo's phone
  during Shot 4. It is **optional** — the glance plus the chime plus the line already carry the
  cue. The generated plate must contain only an abstract screen glow; no legible notification may
  come out of the image/video provider. A visible delivery box is **not** required anywhere.
- **Fact card wording (21.0–24.0 s):**
  > Moving above `{{RESISTANCE_LEVEL}}` is the initial breakout signal — not a confirmed breakout.
  > Some traders wait for the `{{TIMEFRAME}}` candle to close above it and follow through.
  > Confirmation criteria don't guarantee future performance.
  > Source: `{{DATA_SOURCE}}` · `{{BREAKOUT_TIMESTAMP_UTC}}`
- **Disclaimer treatment:** "For education and entertainment, not financial advice." — one line,
  smaller weight, bottom of the fact card, present for the card's full duration.
- **CTA:** optional and only on the fact card, never over Milo's line. If used, a single quiet
  question such as "Do you wait for the close?" It must not compete with the punchline; if in
  doubt, omit it.

## 10. Audio direction

**Voice direction.**

- *Bruno* — energetic warm baritone; celebratory, projected but **never screaming**; slight rasp
  of excitement; lines land fast and land early.
- *Boris* — low, controlled, a touch clipped; the stress shows as tightness, and only the tail of
  his line may crack; no shouting.
- *Milo* — smooth, understated, slightly amused; low volume, unhurried; the punchline is placed,
  not sold.

**Music arc.** Rising synth stab on the alert (Shot 1) → pull back to a single sustained tense
note under Boris (Shot 2) → drop to a hollow low pulse and near-silence on the freeze (Shot 3) →
one clean resolving note on Milo's line, then space (Shot 4) → soft brand bed under the fact card.

**Required SFX.** Door swing; bright alert chime; weighted hoof impacts; notebook flap; chair
creak; descending alert tone; low bass drop; paper flutter; ceramic mug set-down; quiet sip;
one soft distant delivery buzzer; continuous The Burrow room tone.

**Mixing priority.** 1) dialogue intelligibility, 2) the punchline's surrounding silence,
3) story-critical SFX (alert, papers, mug), 4) music, 5) ambience. Music ducks under every line.
Nothing is layered on top of Milo's last four words except room tone.

**Subtitle timing.** Subtitles appear on the first phoneme and clear ~0.2–0.3 s after the line
ends; minimum 1.0 s on screen; never bridging a hard cut; the punchline subtitle clears before
the fact card so the two never coexist.

## 11. Production asset checklist

**Character reference images (per character — Bruno, Boris, Milo):** front neutral portrait; left
and right three-quarter views; full-body front and side; six-expression sheet (neutral, elation,
alarm, freeze/uncertainty, calm amusement, slow blink); colour palette swatch; signature prop
plate (tie+watch / notebook+pen+glasses / mug+pin); written immutable description; approved
negative prompt.

**Environment references:** The Burrow master wide; chart-wall elevation with the resistance line
height marked; curved desk plan showing all three workstations; coffee-station corner; glass wall
with Block Street beyond; doorway; lighting variants (default cool, green accent, red accent).

**Prop references:** wall BTC chart plate (abstract, textless); Bruno's loose papers; Boris's red
notebook and red pen; Boris's monitor with abstract chart; Milo's matte black mug; ordinary phone
prop for Shot 4 (screen glow only, textless — a supporting screen per Bible §2.5, not a signature
prop). No delivery box is required; if a confetti cue is ever shown it stays background-only.

**Market-data inputs:** every placeholder in §3, plus source URL and a factual note confirming
the observed move.

**Voice assets:** four TTS or recorded lines (one per dialogue row) with the §10 direction, plus
optional non-verbal breaths for Bruno's freeze and Boris's inhale.

**Post-production graphics:** zh-Hant subtitle set (4 cues); fact card with placeholder
substitution; disclaimer line; optional CTA; optional composited chart values; optional
delivery-notification overlay for Milo's phone in Shot 4; brand plate.

**Expected Image Provider outputs:** first/last/key frame stills per shot at 9:16, character- and
environment-consistent, textless.

**Expected Video Provider outputs:** four 9:16 clips matching the specified durations (3.0 / 7.0 /
6.5 / 4.5 s), one dominant camera movement each, no baked text.

**Expected TTS + composition (FFmpeg) outputs:** four voice tracks; SFX and music stems; a 24.0 s
9:16 master with burned or sidecar zh-Hant subtitles and the post-production fact card appended.

## 12. Quality acceptance checklist

### Automatically verifiable

> **Scope note.** These are **pre-render / data-lock acceptance conditions**, evaluated against a
> production-bound episode package immediately before rendering — not statements about the current
> state of this design document. This document deliberately still contains unresolved
> `{{PLACEHOLDER}}` tokens (see §3); that is correct at the design stage and is not a failure.

- Total runtime is 24.0 s ±0.5 s and inside 15–30 s.
- Output aspect ratio is exactly 9:16.
- Exactly four generated shots exist, with durations 3.0 / 7.0 / 6.5 / 4.5 s.
- Exactly three characters are credited, matching the canonical trio; no legacy character key
  (fox, hammy, monkey, walter) appears anywhere in the episode data.
- Four dialogue lines exist; each has both an English line and a non-empty zh-Hant subtitle.
- Every English line is fewer than eight words.
- Milo speaks the final line.
- At data lock (pre-render), no `{{PLACEHOLDER}}` remains unresolved in any production-bound
  field. Unresolved placeholders in this design document are expected and do not fail this check.
- Required source metadata is present (`{{DATA_SOURCE}}`, `{{BREAKOUT_TIMESTAMP_UTC}}`,
  `{{TIMEFRAME}}`, `{{CANDLE_CLOSE_TIME_UTC}}`).
- Prohibited-phrase scan passes: no "guaranteed", "risk-free", "buy now", "sell now",
  "price target", "financial advice" in spoken lines.
- The disclaimer string is present on the fact card.
- Each shot declares exactly one camera movement.
- Subtitles sit inside the defined lower safe area and never overlap a hard cut.
- No shot contains more than one dominant camera action field.

### Human creative review

- Each character is immediately recognizable and matches the Bible: fur, markings, eye colour,
  wardrobe, and signature props are correct in every shot.
- Height order reads Bruno > Boris > Milo on screen.
- The humour comes from personality collision, not from noise, memes, or cruelty.
- Bruno stays likable rather than incompetent; Boris is right about confirmation yet visibly
  overreacts; Milo's punchline is understated and lands cleanly with silence after it.
- A viewer with no trading background understands that moving above resistance is the initial
  breakout signal, not a confirmed breakout, and that confirmation criteria are not a guarantee.
- Milo's punchline reads without any on-screen text: the phone glance, the delivery chime, and the
  line alone make the pre-ordered confetti understandable.
- The zh-Hant subtitles carry the same meaning and comic timing as the English, and read
  naturally rather than literally.
- No market claim exceeds what the supplied source data supports.
- Continuity holds: wardrobe, props, chart-line height, screen direction, and background layout
  are stable across all four shots; Shot 4's background pair match their Shot 3 poses.
- No anatomy or identity defect distracts (extra limbs/horns/ears/tails, duplicate characters,
  human hands).
- Subtitles and the fact card are legible on a phone at arm's length.
- No provider logo, watermark, or unintended real-company branding is visible.
- No readable AI-generated financial text survives in the final footage.
- Nothing imitates a recognizable entertainment franchise's characters or signature style.
