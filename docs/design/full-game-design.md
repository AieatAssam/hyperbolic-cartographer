> Provenance: Markdown transcription of the owner's full Game Design Document. The design includes future content (Layers 2 to 5, post-game); the Implementation section's coordinates and CSR contracts are the proposed full-game contract and are not claimed to be fulfilled by the current slice.

# Hyperbolic Cartographer: Full Game Design
Nov 6, 2026 · @Aieat Assam

## Overview
Hyperbolic Cartographer is a 3D web incremental game where geometry is the progression system: the player maps an impossible world, and every major reset changes the shape of space itself, so the same placement rules grow more powerful as space grows more connected. Target length is 6 to 8 weeks to the ending, then an endless post-game. Ships as a static site on GitHub Pages.

Player fantasy: a cartographer who keeps discovering that the map is bigger on the inside. Flat paper, then curved paper, then paper that folds back on itself, then solid space, then the horizon at infinity.

### Design pillars
- Space is the multiplier. Growth comes from neighbour counts, ring sizes and topology, not from stacked x2 upgrades. Hyperbolic ring sizes grow exponentially, so exponential growth is literally visible.
- Every reset changes the rules. Each prestige layer adds a mechanic that re-breaks the player's solved layouts. A layer that only adds multipliers is cut.
- The preview is the game. Hovering any cell shows the exact change in output before committing. Decisions are spatial puzzles with full information; variance lives in discovery, not in hidden numbers.
- Automation is the reward for mastery. Each layer's milestones automate the layer below until it runs itself.
- Respect the player. No dark patterns, no premium currency, generous offline progress, full save portability.

### Design rules (binding for all content)
- Every layer needs: a visible next goal, a prestige sweet spot, automation milestones for the layer below, at least one variable-reward source, restricted-run challenges, and a new mechanic.
- A first-time layer should take 3x to 5x longer than the previous one; by the midpoint of layer N, layer N-2 should be fully automated.
- Logic is geometry-agnostic: rules read neighbours from a graph, never coordinates.
- All tunables live in data files, never in code.

## Progression map
Six stacked layers take the player from a flat square grid to an unbounded tiling at infinity, ending at Divergence around week 6 to 8. Each layer resets everything below it, adds one currency, and changes the shape of space.

*[Progression map diagram not extracted; text retained]*

progression map · 6 layers to the ending

Read top to bottom: each arrow is the unlock condition for the next reset, and the right-hand times are first-reach targets from the balance model.

## Layer 0: Survey (the run)
The run is a spatial puzzle: place tiles on cells, earn Ink from adjacency, and buy more cells with Survey. Every rule reads neighbours from the current tile graph, so the same tile behaves differently on every geometry.

### Core tiles (unlocked across Layers 0 to 1; later layers add geometry tiles)

| Tile | Base cost (Ink) | Effect | Role |
|---|---|---|---|
| Spring | 10 | +1 Ink/s | Base producer |
| Mill | 100 | +5 Ink/s, +100% per adjacent Spring | Rewards clustering |
| Beacon | 1e3 | Adjacent tiles x1.5 (multiplicative) | Neighbour-count scaler |
| Bridge | 5e3 | Its neighbours count as adjacent to each other | Adjacency amplifier |
| Vault | 2.5e4 | +10% offline efficiency (cap 100%), +2% global | Idle support |
| Archive | 1e6 (Drift 3+) | +1% global per distinct tile type within distance 2 | Diversity reward |
| Kiln | 1e8 (Drift 10+) | Consumes 10% of adjacent output, returns x3 to one chosen neighbour | Focus / sacrifice |

### Run mechanics
- Costs scale per type: cost = base x 1.15^owned. Selling refunds 50%.
- Tile levels: each placed tile levels up with Ink (cost x1.6 per level); x2 output at levels 10, 25, 50, 100.
- Survey buys the next ring of cells. Cost scales with ring size, so hyperbolic rings are exponentially expensive and exponentially rewarding.
- Hover preview shows the exact Ink/s delta for placing, levelling or removing a tile, including knock-on effects on neighbours.
- Landmarks (variable reward): every 3 to 8 minutes a Landmark appears on a random empty cell. Clicking it within 30s grants a burst (60 to 600s of production) or a 2-minute aura. Rarities: common 85%, rare 14%, legendary 1%. Legendary landmarks are logged permanently in the Atlas.
- Next goal bar: always shows the next unlock and its progress.

## Layer 1: Drift
Drift resets the board for Charts, and its signature mechanic is the Blueprint: the player saves layouts that rebuild themselves after each Drift, turning hand-placement skill into automation.

Trigger and gain: available at 1e6 run Ink. The Drift button shows Charts on Drift and Charts per minute; the per-minute figure peaks and falls, which marks the sweet spot.

Resets: Ink, unpinned tiles, tile levels, Survey rings. Keeps: Charts, Chart tree, pinned tiles, Blueprints, milestones, Atlas.

### New mechanics
- Pins: pinned tiles survive Drift at level 1. Starts at 1 pin, up to 12 via the Chart tree.
- Blueprints: save the current layout (tile type per cell). After Drift, the Blueprint auto-places tiles in priority order as Ink allows. Slots: 1, then 3, then 5. Blueprints are geometry-specific and exportable as strings.
- Chart tree: about 24 nodes in three branches:
- Ink: global multipliers, cheaper Springs and Mills, tile-level discounts.
- Survey: starting rings, cheaper Survey, auto-Survey.
- Craft: pins, Blueprint slots, Archive and Kiln unlocks, Landmark frequency.
- Drift streak: consecutive Drifts within 1.5x of the best Charts-per-minute add a stacking +5% (cap +50%) to Charts. Rewards finding the sweet spot without punishing a long idle run.

### Milestones (automate Layer 0)

| Drifts | Reward |
|---|---|
| 1 | Keep first Survey ring |
| 3 | Archive tile unlocked |
| 5 | Auto-Survey |
| 10 | Kiln tile; Blueprint auto-place |
| 25 | Auto-level tiles (cheapest first) |
| 50 | Auto-Drift at a set Charts threshold or time |

## Layer 2: Projection
Projection moves the player up a ladder of seven 2D geometries for Curvature. Each rung raises neighbour count or ring growth and unlocks one tile whose rule only shines in that geometry, so every Projection re-breaks the player's Blueprints.

Trigger and gain: first available at 25 lifetime Charts. Resets: everything in Layers 0 and 1 except milestones, Blueprints for other geometries, and Atlas. Once a rung is unlocked, the player picks which geometry to run on each Projection; each geometry has its own Atlas mastery track, so revisiting old rungs stays useful.

### Geometry ladder

| Rung | Tiling | Edge neighbours | Ring growth | Unlocks | New tile and rule |
|---|---|---|---|---|---|
| 1 | Square {4,4} | 4 | Linear | Start | (core set) |
| 2 | Hex {6,3} | 6 | Linear | 25 Charts | River: output flows along a chain of Rivers, +25% per link to the tile at its mouth |
| 3 | Heptagon {7,3} | 7 | Exponential | 5 Curvature | Lens: boosts every tile at distance exactly 2 (ring growth makes this huge) |
| 4 | Octagon {8,3} | 8 | Exponential, faster | 25 Curvature | Compass: boosts tiles along one geodesic line; lines diverge, so placement angle matters |
| 5 | Pentagon {5,4} | 5 | Exponential | 100 Curvature | Junction: placed on a vertex, not a cell; boosts all 4 cells sharing it. Adds vertex slots |
| 6 | Square {4,5} | 4 | Exponential | 500 Curvature | Junction upgrade: 5 cells per vertex |
| 7 | Heptagon {7,7} | 7 | Extreme | 2.5e3 Curvature | Horizon Lens: distance 3; teases Layer 5 |

Curvature tree (about 30 nodes): keep N Chart nodes through Projection, Bridge reach +1, Beacon strength scales with the geometry's neighbour count, extra Survey ring cap, faster Charts, Blueprint carry-over between geometries with matching neighbour count.

Expeditions (challenges): restricted runs started from the Projection screen, each with 5 tiers of rising goals and a permanent reward per tier.

| Expedition | Restriction | Reward per tier |
|---|---|---|
| Monoculture | Springs only | +10% Spring output |
| Blind Survey | No hover preview | +1 Landmark rarity tier chance |
| Small Island | Board fixed at radius 2 | +1 starting ring |
| No Lights | No Beacons | Beacon x1.5 becomes x1.6, then x1.7 ... |
| Drift Lock | No Drift allowed | +5% Charts |
| Flatland | Square geometry, Ink target scaled to hyperbolic | Euclidean geometries x2 output |

Milestones (automate Layer 1): 1 Projection keeps 1 Blueprint per geometry; 3 Projections auto-Drift from start; 10 Projections keep the Chart tree; 25 Projections auto-Projection to a chosen geometry.

## Layer 3: Manifold
Manifold closes space: boards become finite surfaces with no edge, everything wraps, and growth comes from loops around handles and refinement instead of Survey. Currency is Handles.

Trigger and gain: unlocks at 1e4 lifetime Curvature and all 7 rungs reached. Resets: Layers 0 to 2 progress except milestones, Atlas and Expedition rewards.

### Surface ladder

| Surface | Built from | Genus | Orientable | Independent loops |
|---|---|---|---|---|
| Torus | Square or hex grid, opposite edges glued | 1 | Yes | 2 |
| Klein bottle | Square grid, one pair glued with a flip | (non-orientable) | No | 1 orientable + 1 flipping |
| Bolza-type surface | {8,3} tiling quotient | 2 | Yes | 4 |
| Klein quartic | {7,3} tiling, 24 heptagons | 3 | Yes | 6 |
| Higher-genus quotients | Generated from {p,q} quotients | 4+ | Yes | 2g |

### New mechanics
- No Survey. The board is finite from the start. Growth replaces Survey with Refine: subdivide a tile into child cells (each child inherits the parent's neighbours plus its siblings). Refinement depth is the long-term Ink sink.
- Loops: a connected chain of tiles that wraps all the way around a handle (a non-contractible cycle) becomes a Loop. Each Loop multiplies every tile on it by x(1 + 0.5 x loop length / board circumference). A surface of genus g supports 2g independent Loops, so higher genus means more Loops.
- Chirality (non-orientable surfaces): tiles placed on a Klein bottle have a handedness, shown as a spiral. Crossing the flipped seam mirrors it. The new Spiral tile gains +50% per same-handed neighbour and loses 25% per opposite one, so seams become puzzle features.
- Seam view: seams are coloured edges; tiles next to a seam show a ghost of their wrapped neighbour so adjacency is never hidden.

Handles tree (about 20 nodes): Loop multiplier, refinement cost, start Projection runs at rung 3+, keep Curvature tree nodes, Expedition tier cap +1, unlock Layer 4 preview.

Milestones (automate Layer 2): 1 Manifold keeps all geometry rungs; 3 auto-Projection from start; 5 Expeditions auto-complete tiers already beaten; 10 Curvature tree persists; 20 auto-Manifold.

## Layer 4: Dimension
Dimension lifts the map into 3D: tiles become cells of honeycombs that fill space, neighbours share faces, and the camera flies through a Poincaré ball. Currency is Folds. This is where the 3D engine becomes the game rather than presentation.

Trigger and gain: unlocks at 50 lifetime Handles and the Klein quartic Loop-complete. Resets: Layers 0 to 3 progress except milestones, Atlas and Expedition rewards.

### Honeycomb ladder

| Honeycomb | Cell | Face neighbours | Cells around each edge | Space |
|---|---|---|---|---|
| {4,3,4} | Cube | 6 | 4 | Euclidean |
| {4,3,5} | Cube | 6 | 5 | Hyperbolic |
| {5,3,4} | Dodecahedron | 12 | 4 | Hyperbolic |
| {5,3,5} | Dodecahedron | 12 | 5 | Hyperbolic |
| {3,5,3} | Icosahedron | 20 | 3 | Hyperbolic |

### New mechanics
- Face adjacency: all 2D tile rules carry over using face neighbours. A Beacon among 12 or 20 neighbours is the run's main power spike.
- Edge rings: the cells around one edge form a ring. Filling a ring with tiles of one type completes a Chord (x2 to those cells, stacking). Ring size differs per honeycomb, so Chord strategy changes on every rung.
- Strata: the ball is shown as concentric shells. The player can lock the view to one shell (a 2D-like slice) to place efficiently, then fly freely to inspect.
- Fold tiles: a Fold links two non-adjacent cells as if they shared a face, at a rising cost per Fold. Folds are the late-game Bridge, and the key tool for Chords.
- Resonance (variable reward): completing a Chord has a chance to trigger Resonance, a 60s wave that runs through the honeycomb, multiplying every cell it passes.

Folds tree (about 20 nodes): Chord strength, cheaper Folds, Resonance chance, start Manifold runs at genus 2+, Loop multiplier carry-over, Horizon preview.

Milestones (automate Layer 3): 1 Dimension keeps all surfaces; 3 auto-Refine; 5 auto-Loop (game builds the cheapest Loop per handle); 10 Handles tree persists; 20 auto-Dimension.

## Layer 5: Horizon (endgame)
The endgame is literally reaching infinity: the board becomes an unbounded tiling, tiles are placed by rule rather than by hand, and the game ends when the player makes their map's production series diverge. Currency is Horizon Points.

Trigger and gain: unlocks at 100 lifetime Folds and every honeycomb rung reached. Horizon is the final prestige; it resets Layers 0 to 4 except milestones, Atlas and Expedition rewards.

### New mechanics
- Schläfli Forge: the player designs their own 2D tiling {p,q}, choosing any hyperbolic pair where (p - 2)(q - 2) > 4 within unlocked limits. Higher p and q mean faster ring growth λ but cost more Horizon Points to forge.
- Decrees: placement rules applied to every ring at once, such as "Beacon on every third cell of each ring" or "Mill wherever two Springs touch". Decrees are the end of an automation arc: hand placement (Layer 0), Blueprints (Layer 1), auto-Loops (Layer 3), Decrees (Layer 5).
- Asymptote: only the first 6 rings are rendered and simulated per cell. Beyond that, output is computed analytically: total = sum over rings r of ringSize(r) x perTile(r), where ringSize grows like λ^r and perTile is damped by a factor δ^r (δ < 1). The total converges while λ x δ < 1.
- Ideal Anchors: placed on the boundary circle (points at infinity). Each anchor boosts every tile on geodesics ending at it, across all rings. Anchor count is capped and upgradeable.
- Horizon Index: shown as λ x δ. Horizon upgrades raise δ (damping falls) and Forge choices raise λ. The index is the endgame's single visible goal.

Ending: when the Horizon Index reaches 1, the series diverges, Ink becomes infinite, and the Divergence sequence plays: the camera pulls back as the whole Atlas folds into a globe showing every geometry, surface and honeycomb the player mapped. Target: 6 to 8 weeks from first launch.

### Post-game (endless)
- Oaths (New Game+): restart with chosen handicaps (for example "no Beacons", "Euclidean only until Manifold") for Atlas stars and small permanent bonuses. Oaths stack.
- Daily Survey: a seeded daily geometry plus rule set, the same for everyone. Because the simulation is deterministic, a score string (seed + inputs + result hash) can be shared and re-verified locally, with no server.
- Fossils: share Blueprints and Decrees as strings; imported Fossils grant small diminishing Atlas bonuses, one per unique hash.
- Forge sandbox: free play with any {p,q} or {p,q,r}, no progression.

## Cross-layer systems
Four systems span every layer and are never reset: the Atlas, milestones, offline progress, and Landmarks.

- Atlas (collection log): one entry per geometry, surface, honeycomb, legendary Landmark, Expedition tier and Oath. Each entry grants a small permanent bonus (+1% to +5% to a named stat), and mastery tracks per geometry (best Ink, fastest Drift) add stars. Completion % is always visible. The Atlas is also the ending's visual.
- Milestones: each layer's milestones automate the layer below (tables in each layer section). Every automation has an on/off toggle and thresholds, so active players keep control.
- Offline progress: on load, gains are computed in closed form for the static board (rate x elapsed time x offline efficiency), with automation milestones simulated in coarse 60s steps. Starting cap 8h and 50% efficiency; Vaults and upgrades raise this to 48h and 100%. A "while you were away" summary lists gains and auto-prestiges.
- Stored time: offline time past the cap is banked (up to 24h) and can be spent at 2x game speed. Rewards returning without punishing long absences.
- Landmarks: the variable-reward layer (see Layer 0), scaled per layer: Resonance in Dimension, Divergence spikes in Horizon.
- Numbers: all currencies use break_eternity; display supports standard suffixes, scientific and engineering notation. Expected peak values: Ink around e1e6 at Horizon.
- Accessibility: colour-blind palettes, reduced-motion mode, full keyboard placement, text scale. All 3D views have a 2D fallback overlay for picking.

## Balance model
Pacing targets drive every number: each first-time layer takes 3x to 5x longer than the last, and a headless balance simulator must hit these targets in CI before content ships. All constants below are starting values in data files.

### Pacing targets (first time, engaged play of about 1 to 2 hours a day plus offline)

| Layer | First reached | Typical run length at that point |
|---|---|---|
| Drift | 12 min | 10 to 15 min |
| Projection | 1.5 h | 20 to 40 min |
| Manifold | Day 5 | 2 to 4 h |
| Dimension | Day 15 | 6 to 12 h |
| Horizon | Day 30 | 1 to 2 days |
| Divergence (ending) | Day 42 to 56 | n/a |

### Tile output

$$
O_t = b_t \cdot \ell_t \cdot \left(1 + a_t \cdot n_t\right) \cdot \beta^{B_t} \cdot L_t \cdot C_t \cdot G
$$

b = base output, ℓ = level multiplier, a x n = the tile's adjacency term (n = qualifying neighbours), β = Beacon strength (1.5 base) raised to adjacent Beacon count B, L = Loop multiplier, C = Chord multiplier, G = global multipliers.

### Costs

$$
c_t(k) = c_{0,t} \cdot 1.15^{k} \qquad S(r) = S_0 \cdot g^{r} \cdot |R_r|
$$

Tile cost after k owned; Survey cost for ring r, with |R_r| the ring's cell count (g = 8 Euclidean, 3 hyperbolic, because ring size already grows exponentially).

### Prestige gains

$$
\text{Charts} = \left\lfloor (I/10^6)^{0.5} \cdot m_C \right\rfloor \quad \text{Curvature} = \left\lfloor \kappa_g (\log_{10} C_{life} - 1)^{1.5} \right\rfloor
$$

$$
\text{Handles} = \left\lfloor (\log_{10} K_{life})^{2} / 4 \right\rfloor \quad \text{Folds} = \left\lfloor 2 \log_2 H_{life} \right\rfloor \quad \text{HP} = \left\lfloor F_{life}^{0.75} \right\rfloor
$$

I = run Ink, C, K, H, F = lifetime Charts, Curvature, Handles, Folds; κ_g = geometry factor (1 for {4,4}, rising to 4 for {7,7}); m_C = Chart multipliers.

### Horizon series

$$
\text{Ink/s} = \sum_{r=0}^{\infty} |R_r| \, p_r \, \delta^{r}, \quad |R_r| \sim \lambda^{r}, \quad \text{diverges when } \lambda\delta \ge 1
$$

### Rules
- Sweet spot: every prestige gain formula is sublinear in the input, so gain per minute peaks mid-run. The UI shows gain per minute and marks the peak.
- Softcaps: above a layer's design ceiling (for example Ink 1e1000 in Layer 2), exponents are damped by ^0.5 and the HUD says so. No hidden caps.
- Neighbour-count guard: Beacon strength per geometry is tuned so a full Beacon cluster gives at most about 10x the previous rung's best layout, keeping each new geometry a jump, not a break.

## Implementation guide
The whole game rests on one abstraction: a cell graph that every rule reads, generated from a geometry definition and rendered by a geometry-specific view. Content is data, the simulation is deterministic, and a balance simulator gates every change.

Stack: TypeScript (strict), Vite, Three.js, break_eternity.js, lz-string, Vitest, Playwright smoke tests. Static build to GitHub Pages via Actions. No backend.

### Modules

| Module | Owns | Must not |
|---|---|---|
| core/ | State, fixed-step tick (10/s), economy, prestige, milestones | Import DOM, Three.js, or geometry coordinates |
| rules/ | Declarative effect evaluator over the cell graph; dirty-set recompute | Hard-code tile behaviour in code |
| geometry/ | Generators: Euclidean 2D, hyperbolic 2D, quotient surfaces, honeycombs, Forge | Know about tiles or economy |
| content/ | JSON/TS data: tiles, trees, milestones, Expeditions, geometries, Atlas | Contain logic |
| render/ | One view per geometry kind, picking, effects | Mutate state directly |
| ui/ | HUD, panels, previews, settings | Compute game numbers |
| save/ | Schema, migrations, checksum, export/import, offline | Depend on render |
| sim/ | Headless bot players and pacing reports for CI | Ship in the client bundle |

### Core data contracts

```ts
type GeometryDef = {
  id: string;
  kind: 'euclid2' | 'hyper2' | 'surface' | 'honeycomb' | 'forge';
  schlafli: number[];          // [p,q] or [p,q,r]
  quotient?: string;           // surface construction id
  maxDepth: number;
};
type CellGraph = {
  count: number;
  offsets: Int32Array;         // CSR neighbour lists
  neighbours: Int32Array;
  depth: Int16Array;           // ring / shell index
  vertexSlots?: Int32Array[];  // Junction placement
  chirality?: Int8Array;       // seam flips on non-orientable surfaces
  cycleBasis?: Int32Array[];   // non-contractible loops (2g)
  edgeRings?: Int32Array[];    // honeycomb Chords
  ringSizeFn?: (r: number) => number; // analytic, for Asymptote
};
type EffectSpec =
  | { kind: 'produce'; base: number }
  | { kind: 'perNeighbour'; of: string[]; add: number }
  | { kind: 'multiplyNeighbours'; factor: number; distance?: number }
  | { kind: 'linkNeighbours' }                  // Bridge
  | { kind: 'chain'; of: string; perLink: number } // River
  | { kind: 'geodesic'; factor: number }        // Compass
  | { kind: 'chirality'; same: number; opposite: number };
type TileDef = { id: string; cost: number; costGrowth: number; unlock: string; effects: EffectSpec[] };
```

### Rendering per geometry kind

| Kind | View | Notes |
|---|---|---|
| euclid2 | Flat tabletop, extruded prisms | Instanced meshes |
| hyper2 | Poincaré disk on a tabletop | Points in hyperboloid model; pan = Lorentz boost; geodesic edge subdivision |
| surface | Torus as a real 3D torus; others as fundamental polygon with coloured seams and ghost neighbours | Klein bottle can use a 3D immersion as a bonus view |
| honeycomb | Poincaré ball, fly camera, shell slicing | Points in 4D hyperboloid; cell count capped by depth; LOD and frustum culling |
| forge | Disk for depth 0 to 6, analytic glow beyond | Asymptote output computed, not rendered |

Save schema: { version, savedAt, checksum, layers: { run, drift, projection, manifold, dimension, horizon }, atlas, milestones, settings, storedTime }. Migration chain from v1, FNV-1a checksum, LZ-compressed export string and .json file, preview-and-confirm import, one-slot backup. Blueprints, Decrees and Fossils export as separate strings.

### Test invariants (CI-blocking)
- Neighbour relation symmetric; neighbour counts match the Schläfli symbol away from boundaries.
- Ring counts match known sequences for each 2D tiling.
- Surfaces satisfy Euler: V - E + F = 2 - 2g (Klein quartic: 56 - 84 + 24 = -4, g = 3); cycle basis has 2g loops.
- Honeycomb face count per cell matches the cell type (6, 12, 20).
- Lorentz boost then inverse returns to origin within 1e-9.
- Deterministic tick: same seed and inputs produce identical state hashes.
- Save round-trip (export, reset, import) is lossless; corrupted strings fail without touching the current save.
- Balance sim: greedy and lazy bots each hit every pacing target within ±25%.

### Delivery roadmap (each phase ends with the balance sim green and a Pages deploy)
- Slice: square and {7,3}, Layers 0 to 2 (per existing Claude Code brief).
- Full 2D: all 7 rungs, River/Lens/Compass/Junction, Chart and Curvature trees, Expeditions, Atlas, Landmarks.
- Manifold: quotient surfaces, Refine, Loops, chirality, seam view.
- Dimension: honeycomb generators, ball renderer, Chords, Folds, Resonance.
- Horizon: Forge, Decrees, Asymptote, Anchors, Divergence ending.
- Post-game: Oaths, Daily Survey with verifiable scores, Fossils, sandbox.

### Agent working rules
- New content is data plus a test; no tile or upgrade logic outside rules/ evaluators.
- Any change to content/ numbers must rerun the balance sim and commit its report.
- Geometry work starts with invariant tests before rendering.
- Keep CLAUDE.md current with module rules, commands, and links to this document.
