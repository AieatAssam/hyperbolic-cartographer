# Hyperbolic Cartographer: Art Style Guide

## 1. Source of truth

The named tokens in `src/art/palette.ts` are authoritative. This document explains them. Code must read colours, intensities and quality numbers from those tokens and must not hardcode hex values. If a value here disagrees with the code, the code wins and this file should be updated.

Status markers: **Wired** means the code consumes the token or behaviour today. **Planned** means it is specified but not yet implemented.

## 2. Palette tokens

All colours are sRGB hex. three converts them to linear when it builds `Color` objects.

### LIGHTS (Wired in `scene.ts`)

| Token | Hex / value | Meaning |
|---|---|---|
| `hemiSky` | `#d9c4ff` | Hemisphere sky colour: warm-violet ambient from above. |
| `hemiGround` | `#1f4a52` | Hemisphere ground colour: deep teal bounce from below. |
| `hemiIntensity` | 0.6 | Hemisphere strength. |
| `key` | `#ffd9a8` | Warm key light, main directional. |
| `keyIntensity` | 2.0 | Key strength. |
| `keyPos` | [6, 12, 5] | Key position. |
| `fill` | `#7fc8ff` | Cool fill from the left, softens key falloff. |
| `fillIntensity` | 0.7 | Fill strength. |
| `fillPos` | [-9, 6, -2] | Fill position. |
| `rim` | `#ff7ad9` | Magenta rim from behind, separates tiles from the backdrop. |
| `rimIntensity` | 1.3 | Rim strength. |
| `rimPos` | [-2, 5, -12] | Rim position. |
| `envIntensity` | 0.35 | `scene.environmentIntensity` for procedural reflections. |
| `exposure` | 1.05 | `renderer.toneMappingExposure`. |

Shadow maps are off.

### BACKDROP (Wired)

| Token | Hex / value | Meaning |
|---|---|---|
| `top` | `#2a1850` | Sky gradient top (deep purple). |
| `horizon` | `#6a3a78` | Plum horizon band. |
| `bottom` | `#14343e` | Deep teal floor. |
| `nebulaA` | `#3fb8c4` | Teal nebula layer. |
| `nebulaB` | `#d0709a` | Rose nebula layer. |
| `star` | `#fff0d0` | Sparse ink-speck stars. |
| `vignette` | 0.35 | Screen-space vignette strength. |
| `grain` | 0.004 | Parchment grain amplitude. Lowered from 0.02 to remove visible static. |
| `drift` | 1 | Backdrop animation speed multiplier. |

### FOG (Wired)

| Token | Hex / value | Meaning |
|---|---|---|
| `color` | `#3a2350` | Plum fog. Distant tiles fade into colour, not black. Also the background fallback. |
| `density` | 0.012 | `FogExp2` density. |

### BLOOM (Wired)

| Token | Value | Meaning |
|---|---|---|
| `strength` | 0.22 | UnrealBloomPass strength. |
| `radius` | 0.4 | Bloom spread. |
| `threshold` | 1.4 | Linear luminance cut-off. Only surfaces above this glow. |

### Materials & bloom (pass 3A) (Wired in `board.ts`)

**Tile identities.** Each entry is a `MaterialToken` (`base`, `emissive`, `emissiveIntensity`, `roughness`, `metalness`, `accent`). Keys match the five tile kinds in `core/tiles.ts`. `base` is the face colour and the palette chip colour. `emissive` and `emissiveIntensity` drive the motif core only.

| Tile | Hue | Base | Emissive | Emissive I | Roughness / Metalness | Accent | Role |
|---|---|---|---|---|---|---|---|
| `spring` | celestial blue | `#1f6fd6` | `#6cc4ff` | 2.2 | 0.62 / 0 | `#ffd27a` | Produces Ink. |
| `mill` | warm amber | `#d9820f` | `#ffbe55` | 2.0 | 0.68 / 0 | `#5fd4ff` | Produces Ink, boosted by adjacent Springs. |
| `beacon` | coral rose | `#d8344f` | `#ff7a92` | 2.3 | 0.60 / 0 | `#6fe3d0` | Multiplies adjacent tiles. |
| `bridge` | ink-violet | `#6a2fd0` | `#b07cff` | 2.3 | 0.65 / 0 | `#e8c872` | Links its neighbours. |
| `vault` | verdigris green | `#0f9a6e` | `#4fe8b0` | 2.0 | 0.70 / 0 | `#ff9ab0` | Offline and global bonuses. |

**Motifs (Wired).** Each tile kind has a distinct silhouette, drawn as an instanced accent mesh on top of the tile in its `accent` colour. The shape reads without colour, which matters on phones and for colour-blind players:

| Tile | Motif |
|---|---|
| `spring` | droplet orb (sphere) |
| `mill` | wheel (torus) |
| `beacon` | spire (cone) |
| `bridge` | arch (half torus) |
| `vault` | gem (octahedron) |

**Empty slot.** `EMPTY_SLOT`: `base` `#1c1430` (dark recessed well), `accent` `#54467a` (subdued violet border), `emissive` `#3a2e60` at `emissiveIntensity` 0.12, `roughness` 0.9, `metalness` 0.

**Next ring.** `NEXT_SLOT`: `base` `#140e22`, `border` `#2e2546`. Darker than the empty slot.

**Board chrome.** `BOARD`: `table` `#3b2a4f`, `tableEdge` `#7a5a3a`, `rim` `#5fd4ff`, `gold` `#e8c872` (pin outline and reward highlight), `hover` `#ffffff`, `adjacency` `#5fd4ff`, `glowAccentIntensity` 2.4 (the accent cap; motif cores sit just under it).

**Constellation ink (Wired in `board.ts`).** Ribbons use saturated golds; no bloom.

| Token | Hex | Meaning |
|---|---|---|
| `CONSTELLATION.inkPulse` | `#ffb800` | In-progress burst (dashed). |
| `CONSTELLATION.inkComplete` | `#c88700` | Completed ribbons. |
| `CONSTELLATION.inkGhost` | `#ffd033` | Ghost hint while previewing. |
| `CONSTELLATION.star` | `#ffcc33` | Star markers on completed shapes. |

**Inspect ink-flow arches (`FLOW_LINK`, Wired).** Emissive tube colours for tile inspect (below bloom); foot rings at each tile anchor.

| Token | Hex | Meaning |
|---|---|---|
| `FLOW_LINK.feed` | `#5fd4ff` | Spring → Mill production. |
| `FLOW_LINK.boost` | `#ff5a7a` | Beacon multiplier. |
| `FLOW_LINK.shadow` | `#0a0e18` | Under-stroke for tubes on bright tiles. |
| `FLOW_LINK.bridge` | `#c080ff` | Bridge neighbour link (violet tube). |
| `FLOW_LINK.relay` | `#aa66ff` | Bridge-to-bridge relay (violet). |
| `FLOW_LINK.penalty` | `#ff6b6b` | Downstream loss / blocked feed. |

Inspect flow uses one smooth quadratic arch per source–target pair (no hop trunks), a dark under-stroke (`FLOW_LINK.shadow`), foot rings, and small motes for direction (respect `prefers-reduced-motion`).

**Placement / inspect preview (`PREVIEW`, Wired).** `bridgeOutline` `#e8c872`, plus dim/saturation scalars for inspect and bridge mixes.

**DOM spacing (`style.css`, Wired).** `--space-1` (4px) through `--space-6` (16px), `--shell-gap`, `--chrome-pad-x/y` rhythm the HUD, dock, palette, panel and modal padding.

**FX particle colours (Wired in `fx.ts`).** Selected hex tokens:

| Token | Hex | Meaning |
|---|---|---|
| `FX.ink` | `#6cc4ff` | Ink mote default. |
| `FX.production` | `#8fe6ff` | Production overlay accent. |
| `FX.sell` | `#c9b8e8` | Sell puff. |
| `FX.wash` | `#2a6bd6` | Drift ink-wash. |
| `FX.ring` | `#5fd4ff` | Survey / idle rings. |
| `FX.beacon` | `#ff7a92` | Beacon aura legs. |
| `FX.bridge` | `#b07cff` | Bridge relay glint. |
| `FX.vortex` | `#e8c872` | Projection vortex. |

**DOM UI (`UI`, Wired).** Plain CSS chrome on `#ui`; `main.ts` calls `applyUiCssVars` so `style.css` reads custom properties. `--gold` and `--cyan` mirror `BOARD.gold` and `BOARD.rim`.

| Token | Hex | CSS variable | Role |
|---|---|---|---|
| `UI.bg` | `#070b14` | `--bg` | Page / canvas letterbox. |
| `UI.ink` | `#d8e2f0` | `--ink` | Primary text. |
| `UI.muted` | `#7d8aa3` | `--muted` | Labels, secondary text. |
| `UI.controlBg` | `#0f1828` | `--control-bg` | Default buttons. |
| `UI.fieldBg` | `#050a14` | `--field-bg` | Inputs, modal fields. |
| `UI.panelBg` | `#0c1424` | `--panel-bg` | Modal surface. |
| `UI.primaryOnGold` | `#1a1405` | `--primary-on-gold` | Text on gold primary buttons. |
| `UI.barLo` / `UI.barHi` | `#b8912e` / `#fff3c4` | `--bar-lo` / `--bar-hi` | Progress bar gradient ends. |
| `UI.danger` | `#ff6b6b` | `--red` | Errors, blocked costs. |
| `UI.pos` | `#7fd9a0` | `--green` | Positive deltas. |
| `UI.dangerSoft` | `#ffb3b3` | `--danger-soft` | Dev panel text. |
| `UI.gainLabel` | `#ffe7a8` | `--gain-label` | Bridge +Ink/s floater. |
| `UI.gainLabelBg` | `#04060e` | `--gain-label-bg` | Floater backdrop. |
| `UI.flash` | `#ffffff` | `--flash` | Prestige flash. |
| `UI.hudChipBg` | `#0c1220` | (contrast ref) | Solid fill under HUD glass for palette-dot contrast. |
| `UI.glassRgb` + `glassAlpha` | rgba(12, 18, 32, 0.78) | `--glass` | HUD / toast glass. |
| `UI.lineRgb` + `lineAlpha` | rgba(95, 212, 255, 0.22) | `--line` | Borders. |
| `UI.devPanelBg` + alpha | rgba(30, 8, 12, 0.8) | `--dev-bg` | Dev panel fill. |

**Palette tool chips (Wired in `ui.ts`).** Each build-tool button shows an 8×8 px dot filled with `tileChipColour(type)` = `TILE_IDENTITIES[type].base`. When contrast on `UI.hudChipBg` is low, a `--ink` ring is drawn; the fill never substitutes another hue.

**Material coefficients.** `MATERIAL`, multipliers on the tokens above:

| Field | Value | Meaning |
|---|---|---|
| `sideShade` | 0.32 | Side walls = `base * sideShade`. |
| `bevelAccent` / `bevelLift` | 0.18 / 1.15 | Glassy bevel: base lerped toward accent, then lifted. |
| `faceGlow` | 0.06 | Emissive on the face, as a fraction of base. |
| `trimGlowRest` / `trimGlowMax` | 0.12 / 0.55 | Bevel emissive by output level. Max is below the bloom threshold. |
| `heightBase` / `heightPerLevel` / `heightLogFull` | 0.34 / 1.0 / 6 | Extrusion: `tileHeight = 0.34 + 1.0 * L`, where `L = min(1, log10(1 + output) / 6)`. |
| `slotHeight` / `nextHeight` | 0.015 / 0.008 | Empty and next-ring slot thickness. |
| `hoverLerp` / `hoverTrim` | 0.12 / 0.8 | Face lerp toward white on hover, and bevel glow on hover. |
| `pinBorder` | 0.75 | Bevel lerp toward `BOARD.gold` on pinned tiles. |
| `motifScaleMin` / `motifScaleMax` | 0.85 / 1.35 | Motif core scale by output level. |
| `bodyEnv` | 0.15 | `envMapIntensity` on the merged tile body. Low so room reflections don't wash faces pastel; scene env/table unaffected. |

## 3. Colour pipeline (Wired)

- `outputColorSpace = SRGBColorSpace`, `toneMapping = ACESFilmicToneMapping`, exposure `LIGHTS.exposure`.
- The composer renders into a half-float linear target.
- `OutputPass` applies tone mapping and sRGB conversion once, at the end of the chain.
- The backdrop shader includes the tonemapping and colorspace chunks, so it is correct on the direct-render path as well.
- Hex values in the palette are sRGB. Do not pre-convert them to linear.
- The UI is plain DOM, so bloom never touches it.

## 4. Surfaces and materials

### Empty slots (Wired)

Empty slots are dark recessed wells, not grey slabs:

- The base is `EMPTY_SLOT.base`, very dark violet. The border is `EMPTY_SLOT.accent`, subdued and never near-white.
- The next ring (one step out, preview only) is darker still, with a barely visible border (`NEXT_SLOT`).
- Grey reads as disabled. Keep slots dark and matte (roughness 0.9), with a faint inner emissive (0.12).

### Tabletop (Wired)

- A procedural `CanvasTexture` drawn at startup. It holds a radial violet-to-table gradient, parchment grain, a gold graticule, cyan rhumb lines, rose wobbly contours, and seven ink constellations. No image files.
- Square board: a bevelled slab (`tableEdge` sides, textured top) with a lip beneath.
- Hyperbolic board: a round slab with the same texture and a bevelled edge.

### Hyperbolic disk (Wired)

- Same ink-map language as the square tabletop, with a circular texture.
- A luminous cyan rim (`BOARD.rim`). It is a deliberate bloom accent, capped at `BOARD.glowAccentIntensity`.

### Backdrop (Wired)

An inverted sphere (radius 100) that follows the camera, drawn first with no depth test. Layers, back to front:

1. Sky gradient: `top` to `horizon` to `bottom`.
2. Two slow fbm nebula layers (`nebulaA`, `nebulaB`).
3. Sparse stars, kept under the bloom threshold.
4. Parchment grain.
5. Screen-space vignette, with a floor clamp so it never goes black.

## 5. Bloom rules (pass 3A)

- **Face colour and glow are separate.** `base` is the lit albedo and is what the palette chip shows. Glow comes only from `emissive`.
- **Faces get only `MATERIAL.faceGlow`.** The face never blooms.
- **Bloom is for motif cores and the table rim only.** Motif cores have `emissiveIntensity` above `BLOOM.threshold` (1.4), up to `BOARD.glowAccentIntensity` (2.4).
- **Trim glow stays below the threshold.** Bevel emissive runs from `trimGlowRest` to `trimGlowMax` (0.55) with output level, so it never blooms.
- **Side walls** are `base * sideShade` for every tile, pinned tiles included. Pins are a gold bevel outline only (`pinBorder`), not a change to the walls.
- **Hover.** The face lerps 0.12 toward white (`hoverLerp`) so the hue survives. The bevel glow rises by `hoverTrim`.
- **Caching.** Output is quantised to 8 steps per decade (`round(L * 8)`) for each tile. The board rebuilds only when that quantised signature, tiles, ring, pins, hover, hovered neighbours or view change. It does not rebuild every frame, and sub-step output changes do not trigger a rebuild.

## 6. Phone and adaptive quality (Wired)

### Quality levels

| Level | DPR cap | Bloom | Bloom buffer |
|---|---|---|---|
| 2 (high) | 2 | on | full resolution |
| 1 (medium) | 1.5 | on | half resolution |
| 0 (low) | 1 | off | none |

### Starting level

- Coarse pointer, or a short side under 700 px, starts at level 1.
- Anything else starts at level 2.

### Governor

- Tracks an exponential moving average of frame time (alpha 0.05).
- If the EMA stays above 25 ms (under 40 fps) for 2 s, it steps down one level, then waits a 4 s cooldown.
- It only steps down, so it cannot oscillate.
- Frames longer than 0.25 s (tab switch, hitch) are ignored.

### Framing

Pure logic lives in `src/render/framing.ts` (Wired, covered by `tests/framing.test.ts`). The camera wiring in `main.ts` follows this design.

- **Overlay roles.** Each UI overlay is classified by role and position, not by touching a screen edge.
  - `hud` is a top band.
  - `dock` is a bottom band, unless it is tall and thin (then it is a side panel).
  - Tall panels take a side, chosen by their centre x.
  - Short floating cards are ignored.
  - A phone sheet that would leave less than 40% x 30% of the screen is ignored.
- **Free rect.** The free rect is what remains after the non-ignored overlays are applied.
- **Distance from footprint.** The camera distance is solved in closed form from the ground footprint, not iterated.
  - Hyperbolic board: the whole disk, including the rim at `DISK_R + 0.6`.
  - Square board: the active cells plus the next ring.
  - The solve uses the free rect's aspect, FOV 45 degrees, the camera polar angle, and a 12 px margin on every side.
- **Centring.** A view offset centres the board in the free rect. Raycasts and `worldAt` stay exact because NDC still covers the full canvas.
- **When to refit.** On UI ready, on geometry change, and on recenter.
- **Ring change and panel toggle.** These rescale the distance by the fit ratio (new fit over old fit) and keep the user's orbit angles.
- **Limits.** `maxDistance` is raised so it always covers the fit.
- **Dirty-only reads.** Overlay rects are read only when marked dirty, by `ResizeObserver`, `MutationObserver` on `#ui`, or window `resize`. They are never read per frame.

### Performance notes

- Backdrop grain was lowered from 0.02 to 0.004 (`BACKDROP.grain`). At 0.02 the grain read as visible static on the backdrop.
- Overlay rects are read only when the dirty flag is set (see Framing). Nothing reads DOM geometry per frame.

### Dev inspection (Wired)

- `getQuality()` on the scene handle returns `{level, maxDpr, bloom, bloomScale, dpr, emaMs, width, height}`.
- `setQuality(0|1|2)` forces a level for QA.
- `window.game.renderQuality()` is exposed in dev mode (`npm run dev`, or `?dev` in production). It is the same as `getQuality`.

## 7. No external assets or network

Every texture and environment is generated in code. Nothing is fetched at runtime.

- Textures: `CanvasTexture`, drawn locally (tabletop).
- Backdrop: GLSL shader.
- Reflections: `RoomEnvironment` baked through `PMREMGenerator`.
- No image, font, HDR or model files are loaded.

## 7a. FX

The particle mechanics are specified in `particle-language.md`. This section lists the rules that affect the art. Visual tokens (`FX`, `PLACE`, `TILE_IDENTITIES`) live in `src/art/palette.ts`.

- **Rendering.** All particles draw in one instanced call, premultiplied and hue-preserving. Colour is never mixed toward white, and brightness is capped. Additivity is per particle mode, not a single additive blend.
- **Graph anchoring.** Feed legs, relay glints, Beacon boost legs, Mill motes and survey rings sit on real graph routes. They read tile frames from the live board embedding, so they move with boost-pan, recentre and warp.
- **Producers.** Mill motes follow feed routes and fly to the HUD Ink counter (`#ink-counter`). Standalone Springs and Mills emit their own motes in the tile's emissive colour. Vault and Bridge emit none. Arrivals belong to their slot, so overwriting a slot cancels its pending arrival.
- **Beacon.** Aura legs run only on real boost routes. A Beacon with no boost route shows an idle ring.
- **Place.** A compress, impact and settle envelope (`PLACE`), with an impact ring and burst. Motifs follow the squash.
- **Sell.** A puff in the sold tile's colour, then one refund mote to Ink.
- **Survey.** A ring sweep over graph rings, not world distance. It is budgeted.
- **Board-coupled fades.** During a prestige transition, anchored particles fade with the board. Wash, Vortex and Pop do not. Wash and Vortex carry across the board swap.
- **Prestige transitions** (about 1.5 s).
  - Drift: an ink wash erases the old map, then the new map is revealed.
  - Projection: the old square board warps and fades out. A luminous disk fades in under a GPU vortex.
  - Board input is disabled while a transition runs.
- **Adaptive budgets.** Capacity, spawn rate, pop count and overlay counts scale with quality level. See `particle-language.md`, Adaptive budgets. Viewport size scales stream rates and overlay counts only.
- **Phone HUD.** The compact phone HUD leaves at least 55% of a 360x640 screen as free band. Controls keep 44 px touch targets.
- **Reduced motion.** With `prefers-reduced-motion`, the placement squash and HUD pulse are disabled, and transitions shorten to plain fades.
- **Dev QA hooks.** Only with the dev flag: `game.fxStats()` and `game.triggerFx(kind, index?)`.

## 8. Known gaps

- `board.ts` slot and tile colours now come only from `palette.ts` (`PARCHMENT`/`SLOT_TEAL` are gone). The rgba strings in the tabletop texture are still local, not palette tokens.
- The merged board mesh is one draw call, so face roughness/metalness is the mean of the tile tokens, not per type.
- The merged body uses an explicit `envMap` (the scene environment texture) so `MATERIAL.bodyEnv` applies. three ignores `envMapIntensity` when `envMap` is null. `scene.environmentIntensity` (0.35) still lights the table and other materials.

## 9. Checklist for a change

1. Add or change the token in `src/art/palette.ts` first.
2. Consume it by name. No hex literals in render or UI code.
3. If a balance number changes, note it in the README "Balance" section.
4. Check bloom: faces stay at `MATERIAL.faceGlow` and trim at or below `trimGlowMax`. Only motif cores go above `BLOOM.threshold`, and never past `BOARD.glowAccentIntensity`.
5. Check the phone path: a level 1 start and a manual `setQuality(0)` both render correctly.

## 10. References (direction only)

These works inform readability and framing. They are **not** sources to copy or trace. Implement only through `palette.ts` tokens and the rules above.

| Reference | Link | Rule it drives |
|---|---|---|
| Hyperbolica (CodeParade) | [Steam store page](https://store.steampowered.com/app/1256230/Hyperbolica/) | Placed tiles and landmarks stay high-saturation and readable as cells shrink; empty cells stay muted against denser rim space. |
| Manifold Garden box design (William Chyr) | [Development update: box design](https://williamchyr.com/development-update-box-design/) | Colour-coded regions; heavy rim on placed/active tiles, thin rim on inactive; paired seam hues plus a distinct flip hue on Klein. |
| Hyperbolic Catacombs {3,7,3} (Nelson & Segerman) | [Bridges 2015 exhibition](https://gallery.bridgesmathart.org/exhibitions/2015-bridges-conference/roice3) | Clear figure–ground between cell fill and edge ink (disk and future ball). |
| Round Klein Bottle (Segerman & Schleimer) | [JMM 2012 exhibition](https://gallery.bridgesmathart.org/exhibitions/2012-joint-mathematics-meetings/henrys) | Self-intersection reads as a seam with a local glow motif (`SURFACE.seamGlow`), not whole-surface bloom. |
| Cartography of the Riven Realms (Vagrus) | [Lost Pilgrims devlog](https://lostpilgrims.itch.io/vagrus/devlog/837441/cartography-of-the-riven-realms) | On phones, keep the free play band clean; drop secondary ornament before shrinking touch targets. |
| Monument Valley (ustwo games) | [Monument Valley](https://ustwogames.co.uk/our-games/monument-valley/) | Each 3D surface reads as a calm centred monument with breathing room; building tiles use chunky silhouettes at phone size. |

### Manifold preview (Wired)

| Token / behaviour | Meaning |
|---|---|
| `SURFACE.seamA` / `seamB` | `#ff6b9d` / `#5fd4ff` — orientable seam pair hues on chart and 3D patch rims. |
| `SURFACE.seamFlip` | Klein vertical flip seam (distinct from seamA/B). |
| `SURFACE.skin` / `skinInk` | `#4a3568` / `#8b6cc4` — Klein immersion parchment skin and ink lines. |
| `SURFACE.ghost` | `#6a4e86` — manifold ghost tile tint. |
| `SURFACE.seamGlow` / `seamGlowEmissive` | Klein self-intersection ring glow beads (just under bloom threshold). |
| `config.manifold.kleinSkinAlpha` | Klein immersion glass (~32%); torus uses `skinAlpha` (~50%). |
| `config.manifold.kleinTileAlpha` | Opaque tile patches over Klein glass; back faces dimmed via `kleinBackfaceDim`. |
| Manifold placed `inset` 0.66 / empty ~0.9 | Active versus inactive rim weight on 3D surfaces. |
