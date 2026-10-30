# Four-card C visual contract v1

Confirmed source: 794ee4a0cc7f3ec7e549328ca190155d7f3bc94f (variant C). These retained targets are design references, never actual acceptance screenshots. Version changes require an explicit reason and a new directory; retain this version. Negative review screenshots are excluded.

Matrix: F01/F02/F03 text default/expanded/empty; F04/F05/F06 image; F07/F08/F09 model-text; F10/F11/F12 model-image. Each at 1440×960, 390×844, 3830×1688, canvas zoom 1. Default and expanded share content, file, adopted bindings and outputs. Empty models are selected with no adopted input/output, distinct from no-output-with-basis or unselected model.

Required review regions: page/context (persistent toolbar, overlays, viewport, focus and obstruction); card/title (common surface, external title and icon, weak status, readable summary, preview, separators, whitespace and image/text proportions); editor/body (actual content and complete image); editor/actions (required controls, units, expand/close and reachability). Model groups additionally require editor/inputs (adopted structured bindings) and editor/parameters (actual selected model/capability values, units, single material and current single-model submission). Empty groups additionally require empty-state (readable empty prompt and disabled run where applicable). Every region is reviewed against original images, with explicit reasons for any allowed difference.

## Mobile prototype card absence

Target card PNGs exclude external titles. cardWithTitle PNGs supplement default/empty desktop and large viewports; expanded cards remain behind the modal, intentionally dimmed. Actual card captures include their external title. No title crop target exists for expanded state; use the paired default title and full context. At 390px the prototype hides cards: target card absence is permitted ONLY for this viewport; actual mobile cards remain mandatory and must satisfy the text contract.

Confirmed text overrides: mobile basic-image labels/values and two actions stack vertically; model empty adopted-input text remains readable instead of prototype narrow-grid wrapping; ready text-model card uses actual formal text summary; basic image editor contains the complete source file (card thumbnail may cover); formal mobile expanded mode has no prototype switcher and keeps required controls reachable. Prototype sample names/photos, ratio 16:9, resolution 2K, generic ready summaries and memory/debug content are placeholders, not required literal values. Any actual replacement must be described per group with real file identity, ratio, model parameters and structured bindings; placeholders never excuse missing title/separator/actions/unit or obstruction.

See observations.md for the original capture inspection scope and known limitations. Retention here does not claim a fresh visual review or formal behavior run.
