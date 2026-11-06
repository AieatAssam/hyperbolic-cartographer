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
| `hemiIntensity` | 0.85 | Hemisphere strength. |
| `key` | `#ffd9a8` | Warm key light, main directional. |
| `keyIntensity` | 2.4 | Key strength. |
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
| `strength` | 0.65 | UnrealBloomPass strength. |
| `radius` | 0.55 | Bloom spread. |
| `threshold` | 0.85 | Linear luminance cut-off. Only surfaces above this glow. |

### TILE_IDENTITIES (Wired in `board.ts`)

Each entry is a `MaterialToken` (`base`, `emissive`, `emissiveIntensity`, `roughness`, `metalness`, `accent`). The keys match the five tile kinds in `core/tiles.ts`.

| Tile | Hue | Base | Emissive | Emissive I | Roughness / Metalness | Accent | Role |
|---|---|---|---|---|---|---|---|
| `spring` | celestial blue | `#4a9be8` | `#8fd0ff` | 0.30 | 0.50 / 0.20 | `#ffd27a` | Produces Ink. |
| `mill` | warm amber | `#e0a040` | `#ffc870` | 0.30 | 0.50 / 0.20 | `#5fd4ff` | Produces Ink, boosted by adjacent Springs. |
| `beacon` | coral rose | `#e0607a` | `#ff8fa6` | 0.35 | 0.45 / 0.15 | `#6fe3d0` | Multiplies adjacent tiles. |
| `bridge` | ink-violet | `#8a5cd6` | `#b88cff` | 0.35 | 0.55 / 0.15 | `#e8c872` | Links its neighbours. |
| `vault` | verdigris teal | `#2fb59c` | `#6fe3c8` | 0.30 | 0.60 / 0.10 | `#ff9ab0` | Offline and global bonuses. |

**Motifs (Wired).** Each tile kind has a distinct silhouette, drawn as an instanced accent mesh on top of the tile in its `accent` colour (emissive 0.6). The shape reads without colour, which matters on phones and for colour-blind players:

| Tile | Motif |
|---|---|
| `spring` | droplet orb (sphere) |
| `mill` | wheel (torus) |
| `beacon` | spire (cone) |
| `bridge` | arch (half torus) |
| `vault` | gem (octahedron) |

### EMPTY_SLOT (Wired in `board.ts`)

| Field | Value |
|---|---|
| `base` | `#4a3a66` (dusky violet, matte), lerped 18% toward parchment for the slot face |
| `emissive` | `#6a5a9a` |
| `emissiveIntensity` | 0.15 |
| `roughness` / `metalness` | 0.85 / 0 |
| `accent` | `#e8c872` (gold), used for the preview border of the next ring |

Empty-slot rules are in section 4.

### BOARD (Wired)

| Token | Hex / value | Meaning |
|---|---|---|
| `table` | `#3b2a4f` | Tabletop base colour (outer edge of the ink-map texture). |
| `tableEdge` | `#7a5a3a` | Bevelled edge and lip colour. |
| `rim` | `#5fd4ff` | Luminous cyan rim of the hyperbolic disk. |
| `gold` | `#e8c872` | Pinned tiles and reward highlight. |
| `hover` | `#ffffff` | Target colour the hovered tile lerps toward. |
| `adjacency` | `#5fd4ff` | Outline for tiles adjacent to the hovered tile. |
| `glowAccentIntensity` | 1.8 | Emissive intensity for the hovered tile. Also the ceiling for accents. |

## 3. Colour pipeline (Wired)

- `outputColorSpace = SRGBColorSpace`, `toneMapping = ACESFilmicToneMapping`, exposure `LIGHTS.exposure`.
- The composer renders into a half-float linear target.
- `OutputPass` applies tone mapping and sRGB conversion once, at the end of the chain.
- The backdrop shader includes the tonemapping and colorspace chunks, so it is correct on the direct-render path as well.
- Hex values in the palette are sRGB. Do not pre-convert them to linear.
- The UI is plain DOM, so bloom never touches it.

## 4. Surfaces and materials

### Empty slots (Wired)

Empty slots look inviting, not dead:

- Each slot has an inset border lerped between parchment and teal (`SLOT_TEAL`, 35%). The cell reads as a place to build.
- The next ring (one step out, preview only) is a dimmer violet with a gold-tinted border.
- Never grey slabs. Grey reads as disabled.
- Matte (roughness 0.85), barely emissive, so placed tiles still stand out.

### Tabletop (Wired)

- A procedural `CanvasTexture` drawn at startup. It holds a radial violet-to-table gradient, parchment grain, a gold graticule, cyan rhumb lines, rose wobbly contours, and seven ink constellations. No image files.
- Square board: a bevelled slab (`tableEdge` sides, textured top) with a lip beneath.
- Hyperbolic board: a round slab with the same texture and a bevelled edge.

### Hyperbolic disk (Wired)

- Same ink-map language as the square tabletop, with a circular texture.
- A luminous cyan rim: a torus in `BOARD.rim` colour multiplied by `BLOOM.threshold + 1.2` (about 2.05), so it is deliberately above the bloom threshold.

### Backdrop (Wired)

An inverted sphere (radius 100) that follows the camera, drawn first with no depth test. Layers, back to front:

1. Sky gradient: `top` to `horizon` to `bottom`.
2. Two slow fbm nebula layers (`nebulaA`, `nebulaB`).
3. Sparse stars, kept under the bloom threshold.
4. Parchment grain.
5. Screen-space vignette, with a floor clamp so it never goes black.

## 5. Bloom and output scaling (Wired)

- **Resting emissive stays under the threshold.** Resting `emissiveIntensity` is 0.25 to 0.4 (0.30 to 0.35 for most kinds) and does not bloom at `BLOOM.threshold` 0.85.
- **Glow scales with output.** For a placed tile, `L = log10(1 + output)`. Glow is the tile emissive multiplied by `rest + (GLOW_MAX - rest) * min(1, L / 6)`, so it rises from the resting value to `GLOW_MAX` 1.25 at `L = 6`. Busy, productive tiles cross the threshold on purpose.
- **Height follows output too.** Tile height is `0.25 + 0.22 * L`.
- **Hover uses the accent ceiling.** The hovered tile's glow is its emissive times `BOARD.glowAccentIntensity` (1.8). Hovered empty slots use a dimmer glow (0.6 of the slot border colour).
- **Adjacency.** Tiles next to the hovered tile lerp their border 60% toward `BOARD.adjacency` and their glow 25%.
- **Caching.** Output is quantised to 8 steps per decade (`round(L * 8)`) for each tile. The board rebuilds only when that quantised signature, tiles, ring, pins, hover, hovered neighbours or view change. It does not rebuild every frame, and sub-step output changes do not trigger a rebuild.
- **Above 1 is for accents only.** Keep any non-accent emissive at or below the resting range.

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

## 8. Known gaps

- `board.ts` keeps a few local derived constants (`PARCHMENT`, `SLOT_TEAL`, and the rgba strings in the tabletop texture) that are not palette tokens. Move them into `palette.ts` before adding more.

## 9. Checklist for a change

1. Add or change the token in `src/art/palette.ts` first.
2. Consume it by name. No hex literals in render or UI code.
3. If a balance number changes, note it in the README "Balance" section.
4. Check bloom: resting emissives stay at or below 0.35. Accents go up to 1.8 only on purpose.
5. Check the phone path: a level 1 start and a manual `setQuality(0)` both render correctly.
