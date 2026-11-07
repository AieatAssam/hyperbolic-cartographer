# Geometry and rendering roadmap

**Status: plan only. None of the C0–C7 phases below is implemented or authorised for gameplay release by this document.** This documentation change adds no renderer, surface, prestige layer, upgrade or teaser. The existing playable slice stays unchanged.

The [full game design](../design/full-game-design.md) is the source of truth for progression. This roadmap develops the reviewed Step C Opus proposal into a rendering plan. Read it alongside the [style guide](style-guide.md) and [particle language](particle-language.md).

## Ground rules

- Keep the current slice distinct from the full game. Today the repo uses `core/` and `TileGraph` with `ring[]` and `neighbours[][]`. The GDD's `rules/`, `content/`, `sim/` modules and CSR `CellGraph` describe future architecture.
- Let the simulation read graph neighbours. Positions, apparent contact, self-intersections and camera distance must not create adjacency. Read seams from explicit metadata.
- Preserve the GDD's balance values as design references. Loop multipliers, Spiral bonuses, Chord multipliers and later-layer currencies need separate content work, configuration and pacing tests before release.
- Extend `Embedding`, routes and `TileGraph` where practical. Avoid a parallel hierarchy for each surface.
- Provide a 2D picking overlay for each 3D view. Current plane/disk raycasting and tap previews form the baseline; they do not replace the proposed explicit fallback overlay.
- Treat Möbius strips and projective planes as optional research, not additional GDD rungs. A new prestige layer or teaser needs approval.

## Progression the renderer must support

| Layer | Spatial change | Rendering consequence |
|---|---|---|
| 0 Survey | Buy successive cell rings | Reveal the graph ring that unlocked. |
| 1 Drift | Reset layouts for Charts; retain selected progress | Wash away the old map without losing the explanation of what survived. |
| 2 Projection | Seven 2D rungs: square {4,4}, hex {6,3}, heptagon {7,3}, octagon {8,3}, pentagon {5,4}, square {4,5}, heptagon {7,7} | Reuse tile identities while neighbour counts and ring growth change. The slice currently jumps from square to {7,3}. |
| 3 Manifold | Close the board; replace Survey with Refine; add Loops and chirality | Show wrapped neighbours, coloured seams and mirrored spiral motifs. |
| 4 Dimension | Fill 3D space with face-adjacent honeycomb cells | Support a Poincaré ball, Strata slices, Chords, Fold links and Resonance waves. |
| 5 Horizon | Forge tilings; compute the distant rings analytically | Draw finite rings and Ideal Anchors, then compose the Atlas globe at Divergence. |

## What exists and what would change

| Concern | Current slice | Proposed extension |
|---|---|---|
| Cell identity | Array indices stay stable because graphs are built once at maximum size; Survey raises `state.ring`. | Stable `u32` cell IDs and an ID/index map for each graph revision, so Refine can replace cells. |
| Tile frame | Eight floats: position, local scale, normal and a reserved zero slot. The GPU reads two RGBA texels per cell. | A transported tangent and a chirality sign, with a tested, versioned packing layout. Allocate extra channels/texels as needed; the reserved scalar cannot hold a complete tangent. |
| World placement | The board writes local frames; FX applies the board's `uBoard` transform. Boost-pan updates the embedding. | Providers write frames for each view. Lorentz reprojection remains separate from the Three.js object/world transform. |
| Edge shape | A straight endpoint chord with sinusoidal lift along the mean normal. | A sampled curved-surface or geodesic route in a GPU lookup texture. |
| Cut edges | Optional `Embedding.seam(a,b)` metadata and leave/arrive stubs; plane and disk leave it unset. | Paired seam portals, ghost anchors and an orientation-flip bit. |
| Volume | No honeycomb view. | Shared-face ports for paths between volume cells. |
| Ink delivery | Production follows graph routes; the final mote leg targets the screen-space Ink counter. | Keep that final HUD transfer. Surface transport before it must follow embedded graph edges. |

## Separate topology, embedding and camera

### Logical graph

Keep graph generation and topology pure and Node-testable. Future optional metadata can record orientation-reversing edges, non-contractible cycles and honeycomb face relationships. The GDD describes `2g` independent loops for orientable genus `g`; record the Klein bottle's one orientable and one flipping route as its stated exception.

Geometry math uses 3×3 Lorentz isometries for hyperbolic 2D and 4×4 isometries for hyperbolic 3D. Keep analytic ring-size functions with geometry data. Neither an orbit camera nor apparent mesh proximity may alter the graph or its metric.

### Embedding provider

Start with a small provider function such as `embed(graph, params, out)`. It would fill the existing frame data and pitch, then optional edge paths, portals and 2D chart coordinates. Extract plane and disk providers first and pin their current output in tests.

Proposed additions:

| Data | Purpose |
|---|---|
| Stable IDs and revision-tagged remaps | Preserve surviving anchors through Refine; distinguish a moved embedding from a changed graph. |
| Tangent `t` and chirality `chi` | Define a local motif frame. With unit normal `n`, use `chi * cross(n,t)` for the bitangent. |
| Per-edge sampled path | Start with eight samples per edge in an RGBA32F lookup texture; measure quality and memory before choosing the final packing. Keep an analytic fallback for current plane/disk routes. |
| Portals `{a,b,portA,portB,flip}` | Identify actual exit/entry points on a drawn cut instead of guessing from edge length. |
| `chart2d` | Map cell IDs to a flat chart and back for picking, preview and seam ghosts. |

A Klein bottle has no continuous global choice of normal. Use local charts and transport orientation across edges. Crossing a flip edge negates chirality; the renderer must mirror the spiral motif rather than infer handedness from which side the camera sees.

### Camera rig

Keep Three.js orbit, zoom and shell-lock controls in the renderer. A disk pan changes a Lorentz view transform through its provider; a torus orbit moves the camera. They need separate operations even when the input gesture looks similar.

## Views per surface

| Surface or stage | Main view | Seam and picking treatment |
|---|---|---|
| Square and hyperbolic 2D | Existing extruded tabletop and Poincaré disk | Preserve current picking and boost-pan. Add an explicit flat picking overlay and parity tests. |
| Torus | A real 3D torus, as the GDD specifies | Offer a fundamental-square chart. Curved paths wrap around the handle rather than cut through the hole. |
| Klein bottle | Canonical fundamental square with coloured seams and ghost neighbours; a 3D immersion as a bonus view | Colour seam pairs and mirror spirals at the flip seam. Map immersion hits back to the chart; offer the chart when self-intersection makes a hit ambiguous. |
| Bolza-type, Klein quartic and higher-genus quotients | Fundamental polygons with paired seams and ghosts | Keep the polygon canonical. Additional 3D immersions remain research. The Klein quartic is orientable genus 3, unlike the Klein bottle. |
| Honeycombs | Poincaré ball with face adjacency and Strata | Default to a shell-locked slice on phones. Provide a 2D slice chart and optional free inspection. |
| Forge | Disk with six finite rings and analytic glow beyond | Snap Ideal Anchors to the boundary. Do not offer cell picking in the analytic region. |
| Divergence | Finite archived Atlas views arranged and folded into a globe | Offer an Atlas list. This is a visual composition, not a topology-preserving deformation of each surface into a sphere. |

The GDD permits the Klein immersion as a bonus view. Supporting it develops the requested move toward more 3D and self-looping figures; it does not replace the GDD's canonical seam chart. A visible self-intersection never adds a graph edge.

## Particle transport

Keep the current single instanced FX draw, frame texture and board transform. Use the existing 384/1024/2048 quality capacities as the starting budgets, not a performance promise for future scenes. Test a reduced-motion presentation for the new effects; current production streams still move under reduced motion.

| Effect | Proposed transport and explanation |
|---|---|
| Production and Bridge relays | Sample each actual graph edge from its embedded path. Lift along its sampled local normal. Preserve the producer's colour and relay timing. |
| Seam crossing | Travel from the source to `portA`, fade across the cut, then continue from the paired ghost at `portB`. Mirror chirality at a flip portal. |
| Loops | Travel a closed graph cycle with continuous phase through wraps and portals. Do not draw a shortcut through a torus hole or a Klein self-intersection. |
| Resonance | Advance a breadth-first wavefront through face-adjacent cells. Use graph distance, not a screen-space or Euclidean-radius circle. |
| Refine | Apply an explicit old-to-new ID remap when the graph changes. Cancel pending arrivals whose anchors disappeared; index reuse must not deliver a false counter pop. |
| Ink counter | After the surface-local route and rise, retain the intentional screen-space HUD leg and arrival pop. |

Let the GPU sample curved paths and local frames. Avoid CPU-written per-particle screen trajectories for graph effects. Bound halos and additive light, retain type colour in the cores, and lower path sampling or spawn budgets on phones before compromising picking or rule visibility.

## Camera and touch

| View | Controls and safeguards |
|---|---|
| Plane/disk | Preserve current pan, hyperbolic boost-pan, pinch zoom, recentre and panel-aware framing. Keep tap preview before placement. |
| Torus/Klein immersion | Orbit and pinch zoom; use cutaway or backface clearance so an obscured surface does not steal taps. Provide one-tap chart and seam-view toggles. |
| Honeycomb ball | Start phones in a locked Strata slice. Use shell steppers with at least 44px targets. Make fly inspection opt-in, particularly on desktop/tablet. |
| Forge | Preserve disk navigation. Make boundary-anchor snapping distinct from cell placement. |
| Divergence | Use a non-interactive sequence or orbit-only inspection. Retain reduced-motion and Atlas-list alternatives. |

Every new 3D view needs a usable 2D picking overlay, touch equivalents for hover information, and unambiguous cell-ID selection. Compare 3D and chart hits on seeded tap grids. Dragging, pinching, orbiting and changing shells must not buy tiles.

## One art language

Keep the current type identities across views: Spring blue, Mill amber, Beacon coral, Bridge violet and Vault green. Preserve saturated top faces, darker sides, output-relative extrusion and legible motifs. Start from the existing `sideShade` of 0.32 and `MATERIAL.height*` tokens; tune through the art tokens rather than scattering constants through providers.

Extrude curved tiles along their local normal, scaling height with local scale and pitch. Retain ACES tone mapping, sRGB output, subtle environment reflections and the key/fill/rim rig. Control bloom on emissive motif cores and rims using the existing accent limits. Carry the colourful cartographic/ink background into each view instead of leaving a dead black field.

Show chirality through spiral shape. Mark seam pairs with colour and dash patterns so colour alone does not carry the rule. Test motifs at 360×640. Add seam colours, ghost opacity and portal glow to `palette.ts` before introducing view-specific styling.

## Gates before rendering or release

| Gate | Required evidence |
|---|---|
| Topology | Symmetric neighbours; correct degrees and ring counts; orientable Euler characteristic `V - E + F = 2 - 2g`; Klein characteristic 0. For the Klein quartic, check `56 - 84 + 24 = -4`. |
| Cycles and faces | Check `2g` orientable independent cycles and the GDD's Klein exception. Check honeycomb face counts of 6, 12 or 20 against the selected cell. |
| Isometries | Boost followed by inverse returns within `1e-9`; visual navigation leaves logical adjacency unchanged. |
| Refine identity | Survivor remaps are bijective on surviving IDs; removed anchors cannot acquire a child's identity by index reuse. |
| FX paths | Each leg uses an actual graph edge; seam legs use paired portals; flip metadata mirrors chirality; mesh proximity creates no false neighbours. |
| Picking | 3D and 2D chart hits resolve to the same cell IDs; exercise self-intersection and hidden-side cases. |
| Touch and layout | Keep the current six sizes and 37 cases per size green. Add orbit, seam/chart toggle and shell-lock cases; retain no-overflow, no-overlap and 44px-target checks. |
| Performance and accessibility | Measure FPS on real devices, not SwiftShader CI. Test particle budgets, reduced motion, text scaling, non-colour cues and the 2D fallback. |

When a phase changes gameplay content or balance, add the GDD's deterministic simulation and pacing evidence before shipping that content. A rendering prototype does not authorise new layer mechanics.

## C0–C7 migration plan

These phases describe future work. None has started through this documentation commit.

| Phase | Modules | Outcome and boundary |
|---|---|---|
| C0 | `render/fx-graph.ts`, `render/board.ts` | Extract plane/disk embedding providers. Pin identical frames and pitch in tests; preserve current behaviour. |
| C1 | `render/fx-graph.ts`, `render/fx.ts` | Add transported frame channels and an edge-path lookup texture. Retain the analytic fallback when no sampled path exists; preserve current visuals. |
| C2 | `core/geometry` | Add quotient generators and Euler, cycle-basis and flip invariants. Tests only; no gameplay UI. |
| C3 | Renderer | Prototype a torus provider, orbit rig and 2D chart behind a dev flag. |
| C4 | Renderer | Add the Klein polygon, seam portals and ghosts; follow with the bonus immersion view. |
| C5 | Core geometry and renderer | Add stable IDs and Refine transaction plumbing. Do not add Refine gameplay in this phase. |
| C6 | Core geometry and renderer | Prototype `{p,q,r}` generators, a ball provider and Strata slicing. |
| C7 | Renderer | Plan/prototype the finite Forge disk, boundary anchors and Divergence globe composition. Do not add Horizon gameplay. |

At each phase, keep the geometry invariants, existing tests and phone touch suite green. Review the prototype before extending scope. Build prestige mechanics, progression trees and balance as separate approved content work.
