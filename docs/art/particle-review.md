# Particle review (Step B)

Reviewed 2026-11-06 against the uncommitted working tree on top of `acfa0fb`. Companion notes outside the repo: `stepB-fx-audit.md` and `stepB-opus-review.md`.

## Evidence and limits

- **Before captures:** `390x844-all-effects.mp4`, `1280x800-all-effects.mp4` and `review-capture.json`.
- **After captures:** the executor's final real-time phone and desktop recordings, with stills in `shots/stepB-after-executor/`. Both sets are held in the executor workspace, outside git. They are not linked from the repo and are not repo assets.
- **Coverage:** the final captures show all ten effects: placement, the lone Spring counter, feed links, the Beacon aura, an actual Bridge relay, Vault placement, sell, Survey, Drift and Projection.
- **Core captures** use dev-granted currency and real UI actions at speed 1.
- **Supplementary clips** (populated Projection, hyperproduction and an actual boost pan) use a Projection-ready fixture and the actual confirmation. They show live embedding following the pan, the type colours, and the Ink counter moving from 1.00K to 1.19K after Ink is set to 1000 in that fixture. Ordinary progression was not played through, and no capture claims it was.
- **Performance caveat:** the recordings are software-rendered (SwiftShader). The mean requestAnimationFrame intervals were 97.6 ms on phone and 219.9 ms on desktop. Those numbers describe the renderer and the recording, not device frame rate. They do not support any hardware phone performance claim.

## Verification results

- **Source:** typecheck and build are green. `npm test` passed 356 tests, with 1 opt-in pacing test skipped. The count includes a reveal-radius test added in this step.
- **Local matrix:** 216 of 216 checks pass at six viewport sizes. The touch matrix passes 120 of 120 with zero errors.
- **Render calls:** a probe measured 6 calls without FX and 7 with FX, so the FX layer adds one draw call.
- **Layout at 360x640 (phone):** the latest board band is 68.3203125% of the viewport, and the first-tutorial band is 55.751953125%. The existing touch and preview band is at least 55%, about 61% in the 360 hyper preview. The HUD row is 54 px and the toggle is 44 px.
- **Contrast, rendered 390 phone:** five sampled 5x5 face patches. Minimum luminance ratio 2.276903957 and minimum DeltaE76 48.240653154, against the pass-3 baseline of 2.137735 and 45.946933. This is a sampled comparison. It is not universal contrast and not a WCAG guarantee.
- **CI:** a new first-tutorial 55% layout assertion was added in this step and will run in CI. CI has not yet run on this change.

## Before (executor audit)

- **Size and count:** Phone Beacon hoop about 280 px on a 390 px screen, crossing unrelated cells. Ring width 0.12. Production dots had no tail.
- **Lifetimes:** Burst 0.7 s. Production mote 0.65 s, follow-on 1.1 s. Particles at 2.4 s outlived the 1.5 s prestige transition.
- **Easing:** Spring squash began at 125% height, with no compression. The mote's smoothstep slowed into the counter.
- **Type colour and white blowout:** Cores mixed toward white and were multiplied, then additively blended over everything, so identities washed out. The sold puff lost its type colour. Pale empty rims dominated.
- **Readability:** Bridge read as a dotted violet slash through empty cells. Empty bevels were about 20% of cell width, a loud lattice.
- **Action timing and causality:** Survey circles did not show which cells unlocked. Counter transfer was probabilistic, so output did not visibly cause the counter to move. Lone Springs had no link to Ink.
- **Jank:** Anchored particles were cut off in one frame at the board swap. The Drift wash obscured the clearing.
- **Phone layout:** HUD about 160 px. Target: at least 55% of 360x640 unobstructed.
- **Contrast baseline (pass 3, 390 face patches):** minimum luminance ratio 2.137735, minimum DeltaE76 45.946933. Sampled 5x5 patch comparison, not WCAG certification.

## Implemented (checked in source)

- **Colour:** no white mix. Brightest channel capped at 1.6, hue ratio kept. Premultiplied, per-mode additivity (`fx.ts` fragment).
- **Routes and cadence:** real graph routes for legs and relays. Deterministic producer cadence. Slot-owned arrivals.
- **Placement and sell:** placement curve with an impact ring. Sell sinks inward over 0.5 s, with a sold-type colour argument.
- **Survey:** wave on graph rings, budgeted. Beacon legs only on real boost routes.
- **Empty slots:** `EMPTY_SLOT.restInset` 0.9 with a dimmed rest rim.
- **Prestige:** windows end at T/2. `clearAnchored` keeps Wash and Vortex.
- **Anchor fade (B2):** `setAnchorFade` drives `uAnchorFade` in the Leg, Mote, Spark and Ring branches only. `stepTransition` uses one fade value for `board.setFade` and `fx.setAnchorFade`. `update()` runs feed legs, lone-producer motes and aura ticks only at fade 1. `syncBoard(true)` resets the fade to 1.
- **Viewport:** a viewport-only change calls `rescale()`, which keeps the ring, pool and pending arrivals. A capacity, Pop-count or quality change takes the full path.
- **Dead code removed:** `FX.survey()` and `arcPoint`, with their tests. No references remain in `src`, `tests` or `scripts`.
- **Hyper pitch (B1):** `board.ts` passes the identity-view scale `s = 1 − |disk|²`. `medianEdgePitch` divides each chord by its endpoints' mean `s`, so `pitch` is the chord at s = 1. Square passes unit scales, so its pitch is exactly 1. Edges with zero mean scale are skipped.
- **Leg lift (B3, geometry half):** `legPoint` uses `lift · pitch · s̄ · sin(πu) · n̄`, matching the GPU.
- **Tests:** `tests/fx-renderer.test.ts` covers fade 0 and stream stop/resume, in-flight landing, Wash at fade 0, `uAnchorFade` clamping, shader branches, in-place embedding rewrite, and viewport-only rescale. `tests/fx-graph.test.ts` covers scaled pitch, the live hyper edge band (0.6 to 1.6 at identity and boosted views), and `legPoint` at pitch ≠ 1.

## Browser evidence

- **Anchor fade:** a same-geometry reset regression in the browser shows that anchorFade recovers to 1 and emissions resume. A viewport-only rescale preserves in-flight arrivals.
- **Prestige handoff:** anchored particles fade with the board, and the Wash and Vortex overlays continue across the swap. In-flight motes still land.
- **Survey radius:** the first version of the Survey wave used 0.9-pitch rings. They overlapped into a cyan lattice across neighbouring cells. The executor requested a 0.48 radius. The final source and the final capture both use 0.48, with leg and burst budgets unchanged. With a stroke half-width of 0.06, the outer halo reaches about 0.54 pitch, so the rings are not strictly clipped inside their cell. They read as localised rings, not large circles spanning cells.

## Visual findings (final capture)

- **Cores and tails:** soft, source-coloured small cores with tails. No giant Beacon hoop. Rings are local.
- **Placement:** anticipation, then impact, then settle.
- **Sell:** particles sink inward and a refund mote flies to Ink.
- **Production:** producer, then neighbour, then counter, ending in the actual landing pop.
- **Prestige:** anchored fade and overlays continue across the handoff.

## Geometry and graph checks

- **Reviewed and clean:** source colour clamp, graph and economy route parity, and seam classification. No false seam classification was found.
- **Seam fixture:** `tests/fx-graph.test.ts` still calls `medianEdgePitch(hb, xy)` without scale on purpose. It is the old-heuristic regression, and the scaled tests sit beside it.
- **Not built:** torus, Klein and 3D honeycomb. A full transported frame with chirality, and a curved-surface edge sampler, are Step C roadmap requirements. They are not implemented.

## Non-blocking caveats

- Reduced motion currently covers mostly prestige. Producer streams still fly under reduced motion.
- There is no extra coral glint at the boost recipient.
- Compact goal copy can truncate.
- Landscape uses the full HUD, which leaves less spare height.

## Maintenance

- **B3, token half:** `ROUTE_TIMING` and the `FX` timing tokens remain separate constants in source (`palette.ts` was out of scope). `tests/fx-graph.test.ts` guards their equality for `legLife`, `legLift`, `stub` and `trail`. This is the intended state, not an open blocker.
