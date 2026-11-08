# Balance, visuals & gameplay analysis (2026-11-07)

Branch: `cursor/balance-visuals-gameplay-d961` (base `6886f24`).

Run headless economy sims: `npm run sim-economy` (see `src/core/sim-economy.ts`, `scripts/sim-economy.ts`). Policies: **greedy** (optimal buys + surveys) and **casual** (mobile-style: surveys on a timer, defers prestige, places Springs until Mill afford, milestone rewards).

Offline sample: 4h simulated at **5 min** play time (`applyOffline`).

## Findings ranked by impact on fun

| Rank | Area | Finding | Fix in PR |
|---|---|---|---|
| 1 | Balance | Casual first **Drift** was **~27.5 min** (target 8–12); prestige felt like a homework assignment. | Lower `drift.minInk`, more starting Ink, cheaper Mill, gentler `costGrowth`, stronger Springs; first-place Ink rewards. |
| 2 | Gameplay | Strong placements had weak feedback; Bridge value was hidden until commit. | Placement toasts on ΔInk/s; on-board **+Ink/s** label during Bridge preview (`bridgePreviewDelta`). |
| 3 | Visuals | Inspect dim was ~3% — unrelated tiles still competed for attention on phones. | `PREVIEW.inspectDim` + `inspectSatMul`; desat pass in `board.ts`. |
| 4 | Visuals | Particle layer felt noisy vs style-guide “purposeful bursts”. | Reduced `FX_BUDGETS` across tiers. |
| 5 | Balance | Greedy hit Drift ~14 min; economy had long plateaus before second ring on casual. | Tuning + rewards keeps **max dead zone &lt; 45 s** in first 15 min (sim). |
| 6 | Visuals | Backdrop read flat at phone scale vs §10 references (Hyperbolica / Manifold Garden richness). | Stronger backdrop drift multiplier, richer empty-slot rims. |
| 7 | Gameplay | First 10 s: only Spring — clear but low drama; first 5 min: surveys unlock before Mill puzzle. | Still true; mitigated by faster Ink ramp and survey timing in casual policy. |
| 8 | Gameplay | Hyperbolic / Klein payoff — reward is mostly visual; needs more explicit milestone toasts (future). | Out of scope beyond existing map unlock pacing. |
| 9 | Gameplay | Two-bridge chains did not relay Springs to far Mills at default reach — looked broken. | **Bridge relay closure:** tiles touching a contiguous bridge chain are mutually adjacent; **Long Bridges** adds hops past chain ends only. |

---

## Balance (simulation)

### Milestones (minutes) — before vs after

Config **before** = `6886f24`; **after** = this branch. Same sim code; rewards optional on old config.

| Milestone | Casual before | Casual after | Greedy before | Greedy after |
|---|---:|---:|---:|---:|
| firstSpring | 0 | 0 | 0 | 0 |
| firstMill | 7.7 | 8.5 | 1.0 | 0.6 |
| firstBeacon | 10.3 | — | 1.3 | 0.9 |
| firstBridge | 20.8 | — | — | — |
| firstDrift ready | 27.5 | 10.9 | 10.9 | 4.8 |
| **firstDrift** | **27.5** | **10.9** | **14.0** | **8.3** |
| ring5 | 20.4 | — | 11.7 | 15.1 |

Casual after sits in the **~11 min** Drift band (unit test allows 7–13 min over 20 min sim); greedy ~8.3 min.

### Dead zones & Ink/s

| Metric | Casual before | Casual after |
|---|---:|---:|
| Max dead zone (s) | 23 | 3 |
| Dead zones &gt; 45 s (first 8 of session) | 0 | 0 |
| Peak Ink/s @ 30 min | 1164 | 1299 |

**Ink/s samples (casual, every 3 min):**

| t (min) | Before | After |
|---:|---:|---:|
| 0 | 1.0 | 1.1 |
| 3 | 9.0 | 10.4 |
| 6 | 30.0 | 42.5 |
| 9 | 374.0 | 219.9 |
| 12 | 644.0 | 29.9* |
| 15 | 644.0 | 57.5 |

\*After: post-Drift reset collapses rate until ring refills — expected prestige dip; recovery &lt; 45 s.

### Offline (4h @ 5 min play)

| | Before | After |
|---|---:|---:|
| Ink gained | 129,600 | 207,000 |

### Tile dominance (30 min casual)

Before: mostly Springs, no Mills placed in sim tile counts (policy waited too long for prestige). After: faster Mill + Drift; still Spring-heavy for casual, which matches “tap survey, place Springs” phone flow.

### Config deltas (after)

- `startInk`: 10 → **22**
- `costGrowth`: 1.15 → **1.12**
- `tiles.spring.out`: 1 → **1.15**
- `tiles.mill.cost`: 100 → **85**
- `drift.minInk`: 1e6 → **2.42e5** (casual first Drift **~10.25 min** with offline @5 min)
- `rewards`: first Mill **35** Ink, first Bridge **120** Ink
- **Constellations** (graph patterns): Inkstream / Millwheel / Twin Mills (+Ink, gold lines, Menu **Stars** tab)
- **Camera (phone)**: steeper polar, **16px** margin, **1.28×** fill between HUD and info panel

---

## Gameplay notes

### First 10 seconds (phone)

- Tutorial + one obvious action: place **Spring** on centre. **Clear next step** ✓
- Ink ticks immediately; FX motes visible at medium/high quality (thinned at low).

### First 5 minutes

- Casual sim unlocks **ring 2–4** by ~7 min; Mill ~8.5 min. Decisions alternate **Survey** vs **save for Mill** — acceptable clarity; Bridge/Beacon still expert layers greedy hits first.

### Placement puzzle

- Mills still want Spring neighbours; Beacons multiply; Bridges need two occupied neighbours — **real adjacency puzzle** for greedy, lighter for casual.
- **Synergy feedback** improved: placement toasts when ΔInk/s ≥ 4 (“Network linked!” ≥ 25).

### Map / manifolds

- Hyperbolic unlock still tied to Survey ring; Klein/torus immersion unchanged — payoff is visual + production multiplier (see `production` tests). Worth a future milestone banner.

---

## Visuals vs `docs/art/style-guide.md`

### §10 references (short judgement)

| Reference | Gap (before) | PR direction |
|---|---|---|
| Hyperbolica | Cells at rim were readable but inspect didn’t pop focal tile | Stronger inspect desat/dim |
| Manifold Garden | Backdrop sometimes flat | Richer gradient drift, rim on empty slots |
| Hyperbolic Catacombs | Fog OK; particles busy | Lower FX budgets |
| Round Klein / MV | Monument-like clarity on motifs — good | Kept motif contrast; bridge pulse stronger |
| Vagrus cartography | HUD readable at 390px | Reused UX pass; bridge **+Ink/s** on board |

### Checklist

| Item | Before | After |
|---|---|---|
| Phone readability | Good motifs; weak inspect | Inspect clearly muted off-path |
| Cell vs edge contrast | OK | Slightly stronger empty-slot rim |
| Background dullness | Moderate | Higher backdrop drift |
| Bridge preview | Arc only | Arc + floating gain label |
| Particles | Noisy | Fewer bursts |

---

## Verification

- `npm test` (includes `tests/economy-balance.test.ts`)
- `npm run sim-economy` — reprint before/after after further tuning
- `npm run layout` — phone + desktop viewports (no fast mode)
- Captures: `/opt/cursor/artifacts/balance-*-390.png`, `balance-phone-gameplay.mp4`
