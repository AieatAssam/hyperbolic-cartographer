# Particle language

Covers `src/render/fx.ts`, `fx-graph.ts`, `fx-model.ts` and `transition.ts`. Visual tokens (colours, sizes, lifetimes, timings) live in `src/art/palette.ts` (`FX`, `PLACE`, `TILE_IDENTITIES`, `EMPTY_SLOT`), not in gameplay balance `config.ts`. **Wired** means in source now. **Proposed** means specified only. Evidence for the current state is in [particle-review.md](particle-review.md).

## Transport (Wired)

- Each graph-anchored particle is one instanced quad. The whole FX layer is one draw call.
- Instances carry tile indices (`aIdx`) and a mode (`aTime.w`): Leg 0, Mote 1, Spark 2, Ring 3, Pop 4, Wash 5, Vortex 6.
- The vertex shader reads each tile's frame from a RGBA32F texture, 2 texels per tile (position and scale, then unit normal), 256 wide.
- The texture is the live `Embedding` from `board.ts`, and the shader applies `uBoard`. Boost-pan, recentre and warp move particles with the board. The CPU never writes graph-effect positions.

## Production routes (Wired)

From `productionRoutes()` in `fx-graph.ts`. There are no separate IDs. A route is its `kind` plus node path.

- `feed`: Spring -> Mill. `boost`: Beacon -> Mill or Spring.
- Interior nodes are Bridges only. Every consecutive pair is a `g.neighbours` edge. The pair set matches economy adjacency, tested on seeded boards.

## Feed, relay, producer, HUD (Wired, deterministic)

1. A feed route fires one leg per edge. Leg k starts at `k × 0.38 s` (`legLife`).
2. Each interior Bridge glints (two violet sparks, small ring) when the leg reaches it.
3. Producer cadence: one Mill mote per two feed arrivals, delayed by `legs × legLife`. No randomness.
4. The mote rises along its normal, then flies to the HUD Ink counter.
5. On arrival, its slot's arrival fires `onInkArrive`. At most one Pop per 140 ms, within the `pops` cap. A write to a slot cancels its pending arrival, so an overwritten mote never counts.

## Aura: actual boost paths only (Wired)

- Each Beacon rings every `auraEvery` s (2.4, 1.8 or 1.4 by quality), 0.45 to 0.7 pitch.
- Boost legs fire only on real `boost` routes from that Beacon, capped by `auraLinks` (12, 24 or 48 edges).
- No boost route: idle ring at alpha 0.3, no legs. There is no global radius hoop.

## Lone producers (Wired)

A Spring or Mill with no feed route emits its own mote stream (1, 1.5 or 2 per s, capped 4, 8 or 14 per s), in its tile's emissive colour. Vault and Bridge emit nothing.

## Look: soft coloured cores, halos, trails (Wired)

- Profile: `core = exp(-18 d²)`, `halo = exp(-4 d²)`. Legs get a trail that ramps to the tail.
- Colour is the tile emissive only, never mixed toward white. Brightest channel capped at 1.6, hue ratio kept. Premultiplied over, with per-particle additivity (legs 0.6, sparks 0.5, rings 0.3, pops 0.3, vortex 0.4, wash 0).
- Anchored sizes are in pitches (core 0.13, spark 0.09, ring width 0.06, leg lift 0.25), clamped to 2.5 to 34 CSS px.

## Placement envelope (Wired)

- `PLACE`: `dip` 0.07 s, `squash` 0.22, `decay` 14, `omega` 52, `life` 0.6 s. Compresses on [0, dip], then a damped rebound, exactly 1 from `life` on.
- `placeGlsl()` generates the shader copy from the same constants.
- Impact at `dip`: ring 0.35 to 0.75 pitch (0.35 s), then `burst` sparks.

## Sell and refund (Wired)

`sell(index, colour)` puffs sparks from a 0.45-pitch ring inward and down along the normal, 0.5 s × (0.9 to 1.1). The colour argument is the sold tile's colour when passed, default `FX.sell`. One refund mote flies to Ink.

## Survey wave (Wired)

`surveyWave()` delays each cell by `graph ring × 0.07 s`. Graph rings, not world distance. New cells get a ring from 0.2 to `FX.revealRadius` (0.48) pitch and two sparks. The ring stays local to its cell. An earlier 0.9 radius overlapped neighbouring cells and read as a lattice, so the radius was reduced to 0.48. Older cells get a glint at alpha 0.4. Budget is `reveal` cells (64, 128 or 256). `surveyReveal` is the only survey path. The old `fx.survey()` (XZ distance) and `arcPoint` (world-Y lift) were deleted, so do not look for or copy them.

## Prestige handoff (Wired)

- `prestigeTimeline` over `T` = 1.5 s. Outgoing windows end at T/2. Incoming start at T/2 and end at T + 0.25 s. Reveal windows are board work and FX skips them.
- **Anchor fade:** `stepTransition` computes one `fade` (out `1 - k`, in `k`, otherwise 1) and passes it to both `board.setFade` and `fx.setAnchorFade`. Leg, Mote, Spark and Ring multiply their alpha by `uAnchorFade`. Wash, Vortex and Pop do not. Reveal rings from `surveyReveal` are anchored, so they fade too. A same-geometry reset regression in the browser confirms the fade recovers to 1 and emissions resume.
- **Stream suppression:** feed legs, lone-producer motes and aura ticks run only while `anchorFade >= 1`. In-flight motes still land and can still pop.
- **Swap:** `clearAnchored()` kills anchored instances, pending arrivals and pops. Then `prestige(..., 'in')` starts the screen overlay, so Wash and Vortex carry across the swap.
- `syncBoard()` resets the fade to 1 and calls `clear()` only on a full rebuild (imports, resets). A non-full swap sets the fade through `stepTransition`.

## Adaptive budgets (Wired)

| Quality | Capacity | Spawn/frame | Pops | Burst / puff | Overlay |
|---|---|---|---|---|---|
| 0 low | 384 | 12 | 4 | 10 / 8 | 48 |
| 1 medium | 1024 | 24 | 8 | 18 / 14 | 120 |
| 2 high | 2048 | 40 | 16 | 28 / 22 | 220 |

Capacity is never scaled. `viewportScale` (clamped 0.55 to 1 from sqrt(px / 1,024,000)) scales stream rates, overlay and reveal counts only. A viewport-only change calls `rescale()`, which re-derives the budget and keeps the ring, pool and pending arrivals, so a pending mote still lands. A change of capacity or Pop count, or of quality, takes the full path and cancels arrivals.

## HUD leg versus graph (Wired, by design)

The Ink mote's last leg is screen-space, ending at the HUD counter (`uInk`). Production edges, relay glints, rings and sparks stay on the graph.

## Geometry: implemented versus proposed

- **Implemented:** square plane and hyperbolic disk, via `Embedding` frames. `pitch` is the median edge chord divided by the endpoints' mean local scale `s`, so it is the chord at s = 1 (`medianEdgePitch` in `fx-graph.ts`, scale passed from `board.ts`). The shader multiplies it by `s`. Square pitch is exactly 1. Seams come only from metadata: `isSeam` is true only when `Embedding.seam` says so.
- **Cut metadata:** the plane and disk have no quotient cuts, so `Embedding.seam` is unset. A true closed immersion also usually leaves it unset. Only a quotient provider (glued fundamental polygon) supplies cuts, and it **must** set `Embedding.seam` for its cut edges.
- **Proposed (Step C, not built):** torus, Klein and honeycomb, needing a route and embedding sampler with local normal and frame. A full transported frame with chirality and a curved-surface edge sampler are roadmap requirements, not existing code.
- No closed-surface, geodesic or chirality renderer exists. Do not describe one as existing.
