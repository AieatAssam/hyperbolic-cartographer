# Hyperbolic Cartographer

An incremental game about placing tiles on a hyperbolic plane. Live at **https://aieatassam.github.io/hyperbolic-cartographer/**

![Phone-sized view of Hyperbolic Cartographer: tiles produce Ink on the board, then Survey, Drift and Projection transitions play.](docs/media/atlas-phone.gif)

*Real 10-second capture at 390x844, normal playback speed, no panning. The GIF is resized to 312x675 at 8 fps (about 2.2 MB) to keep it small. Dev-panel grants were used to show progression quickly.*

## What it is

You earn Ink from tiles, and a tile's output depends on its neighbours. The board starts as a flat square grid, where each cell touches 4 neighbours. Projection switches it to a hyperbolic {7,3} tiling, where each cell touches 7. Ring sizes on that board are 1, 7, 21, 56, 147. The same adjacency rules matter much more there.

## First steps

1. **Springs** produce Ink. Ink buys tiles.
2. Place a Spring, then save for a **Mill**. Mills produce more Ink, boosted by each adjacent Spring.
3. **Adjacency** is the core idea. Beacons multiply neighbours, and Bridges link their neighbours together.
4. **Survey** adds a ring of cells. Each ring costs more.
5. **Drift** ends the run, keeps pinned tiles, and turns run Ink into **Charts**. It unlocks at 1,000,000 Ink in a run.
6. **Projection** spends Charts, switches to the hyperbolic board, and resets the run.
7. **Curvature** is earned in Projection. It and its upgrades survive Drift and Projection.

Tiles (from `TILE_INFO` in `src/core/tiles.ts`):

- **Spring**: produces Ink.
- **Mill**: produces Ink, +100% per adjacent Spring.
- **Beacon**: adjacent tiles x1.5 (stacks multiplicatively).
- **Bridge**: its neighbours count as adjacent to each other. Long Bridges extends the reach.
- **Vault**: improves offline progress and adds a small global Ink bonus.

Other controls:

- **Sell**: removes a tile for a 50% refund.
- **Pin**: pins a tile so it survives Drift. Pin slots are limited; Brass Pins adds more.
- Disabled buttons show a line saying what is missing.
- Some upgrades automate play: Survey Crew (auto-Survey) and Well Diggers (auto-place Springs).

## Touch, mouse and keyboard

**Touch and pen**

- First tap previews the cell in the card above the tools: cost, Ink/s change, or why it's blocked.
- Second tap on the same cell, or **Place**, confirms. **Cancel** or **Esc** clears the preview.
- Drag pans. Pinch zooms. Drags, pinches and cancelled touches never place.
- Hyperbolic edge cells shrink. Centre moves the previewed cell into the middle without buying or changing zoom.

**Mouse**

- Click places at once. Hover previews cost and Ink/s change.
- Drag pans. Right-drag tilts the view. Scroll to zoom.
- In hyperbolic mode, dragging applies a Lorentz boost, so the board slides like a hyperbolic plane.

Hover is never required: everything it shows is also available by tapping.

**Keyboard**

- **1-5**: select a tile tool.
- **S**: Sell tool. **P**: Pin tool. Then click or tap a cell.
- **Esc**: closes an open dialog, or cancels the current preview. On small screens it also closes the side panel.
- **`** (backtick): toggles the dev panel, where enabled (see below).

Keys are ignored while focus is in a text field, with Ctrl/Cmd/Alt held, or while a dialog is open.

## Tutorial and panels

- The first run shows a 5-step tutorial above the tools: Ink buys tiles, place your first Spring, save for a Mill, the adjacency boost, and reading the preview. Each step moves on once its goal is met.
- **Hide** dismisses the card. The **Guide** button reopens it.
- The Menu's Guide tab has tutorial controls and a reference for every tool and button.
- Tutorial progress is stored in `localStorage` under `hc-tutorial`, separate from your save.
- The top bar shows **Now** (your next step, with progress and an ETA), a live line about what the board is producing, and the next unlock.
- Panels scroll. Close them with **Close** or **Menu**.
- All controls are at least 44px.

## Saves

- Autosave to `localStorage` every 10 s, when the tab is hidden, and before a prestige.
- Export as a compressed string, or download `cartographer-save-<date>.json`.
- Import accepts either format. It checks the schema and an FNV-1a checksum, and shows a preview before anything is replaced.
- Importing or hard-resetting keeps a one-slot backup of the previous save (`hc-save-backup`).
- Offline progress is capped at 8 h, plus 4 h per Ship's Log level. It runs at 50% base efficiency, plus 10% per Vault, up to 100%. Offline time is simulated in 60-second steps. Auto-Springs only run while the game is open.

## Performance

There is no guaranteed 60 fps. Frame rate depends on the device and GPU. The renderer lowers its quality automatically on slower devices and on phones.

## Local development

```sh
npm install
npm run dev         # then open http://localhost:5173/hyperbolic-cartographer/
npm test            # Vitest, core logic only, runs in Node
npm run typecheck
npm run build
npm run preview     # serve the production build
npm run pacing      # headless greedy bot; slow and opt-in
npm run layout      # layout QA; after npm run build and npx playwright install chromium
```

- `npm run pacing` asserts the first Drift comes before 15 minutes and Projection before 90 minutes of game time.
- Layout QA setup: `npm run build`, then `npx playwright install chromium`, then `npm run layout`. See [Layout QA](#layout-qa).
- The dev panel toggles with the backtick key. It is on in dev builds, and in production builds when the URL has `?dev`. It can grant currency, jump to Drift or Projection, and change time speed.

## Deploy

`.github/workflows/deploy.yml` runs on every push to `main` (and on manual dispatch). The `build` job runs typecheck, test and build and uploads the Pages artifact. In parallel, a `layout` matrix runs six jobs, one per viewport, each doing its own `npm ci`, build and Playwright Chromium install, then `npm run layout` with `LAYOUT_VIEWPORT` set to that viewport. The matrix is not fail-fast, so every viewport reports. A failing viewport uploads its `layout-artifacts/` as `layout-artifacts-<viewport>`. Deploy waits for `build` and all six layout jobs and runs only if every one passes; it then deploys `dist` to GitHub Pages. Locally, `npm run layout` still runs all six viewports; set `LAYOUT_VIEWPORT=<WxH>` (for example `LAYOUT_VIEWPORT=360x640`) to run just one while debugging.

One-time setup: in the repo's **Settings → Pages**, set **Source** to **GitHub Actions**.

`base` in `vite.config.ts` is `/hyperbolic-cartographer/`. Change it if the repo is renamed, or asset paths will break.

## Layout QA

`npm run layout` drives the built app in headless Chromium at six viewports: phone portrait (360x640, 390x844, 430x932), phone landscape (844x390, 932x430), and desktop (1280x800) and checks overflow, overlap, tap-target size and reachability, plus per-case expectations for tutorial, tabs, modals, import/export, and offline.

- Run `npm run build` first (the script serves `dist/` with `vite preview`), or set `LAYOUT_URL` to a running build including the base path.
- Set `LAYOUT_SHOTS=1` to screenshot every case. Failures always write `layout-artifacts/<viewport>-<case>.png` and `layout-artifacts/report.json`. Set `LAYOUT_OUT=<dir>` to write them somewhere else (for example, to keep parallel runs apart).
- Needs Playwright's Chromium: `npx playwright install chromium`. The script uses [Playwright](https://playwright.dev) (Apache-2.0).
- CI runs it after the build and uploads `layout-artifacts/` when it fails.

## Design documents

- [Full game design](docs/design/full-game-design.md): the complete design, including future layers; the playable slice does not implement it all.
- [Geometry and rendering roadmap](docs/art/geometry-roadmap.md): proposed C0–C7 work for surfaces, particles, cameras and accessible picking. Documentation only; no new layer is implemented.

## Architecture

```
src/
  core/        pure, deterministic, Node-testable; no DOM, no Three
    config.ts      every tunable number
    tiles.ts       tile types and TILE_INFO
    economy.ts     costs, production, placement, prestige gains
    tick.ts        simulate(state, dt) and offline catch-up
    state.ts       GameState; GRAPHS built once at max size
    prestige.ts, milestones.ts, save.ts
    geometry/      TileGraph (ring[], neighbours[][]), square.ts, hyperbolic.ts (Lorentz 3x3)
  render/        Three.js scene, board mesh, effects and framing
  ui/            plain DOM overlay (styled in src/style.css); help, tutorial and input logic
  main.ts        fixed 10 ticks/s simulation + requestAnimationFrame render loop
tests/           Vitest suites, plus the opt-in pacing bot
```

- Game logic never knows its geometry. It only sees a `TileGraph` (`ring[]`, `neighbours[][]`). Tile indices stay stable, and Survey just raises `state.ring`.
- Every tunable number lives in `src/core/config.ts`.
- The simulation runs at a fixed 10 ticks/s through `simulate(state, dt)`. Rendering runs on requestAnimationFrame and reads state.
- Hyperbolic geometry uses the hyperboloid model with 3x3 Lorentz matrices. Rendering projects to the Poincaré disk.
- `save.ts` is pure (strings in, strings out). Only `main.ts` touches `localStorage`. Save changes add a `migrations[v]` entry and bump `SAVE_VERSION`.

## Balance

Changes from the original brief (all in `src/core/config.ts`; formulas unchanged):

- Mill output 5 → 9 Ink/s (pacing: first Drift was ~25 min).
- Survey growth 8^ring → 6^ring on the square board (base 50).
- Charts on Drift = floor((runInk / 2.5e5)^0.5) instead of /1e6 (Drift still unlocks at 1e6 Ink); otherwise Projection took > 2 h.
- Hyperbolic survey: base 2e5, growth 12^ring; board starts at radius 2, base max radius 3, +1 via the "Deeper Horizon" Curvature upgrade (radius 4 = 232 tiles).
- Offline base efficiency 50% (unspecified in brief).
- Bot results with these numbers: Drift available ~11 min (bot drifts at ~14), Projection ~71 min, hyperbolic board fully built ~95 min (~24 min of hyperbolic play).

## Credits and related works

**Dependencies**

- [Three.js](https://threejs.org/): rendering.
- [break_eternity.js](https://github.com/Patashu/break_eternity.js): large-number arithmetic.
- [lz-string](https://github.com/pieroxy/lz-string): save compression.
- [Vite](https://vitejs.dev/): build and dev server.
- [Vitest](https://vitest.dev/): tests.

**Art.** All art is original and procedurally generated in code. Textures are drawn at runtime, the backdrop is a GLSL shader, and reflections come from a generated environment. No image, font, HDR or model files are loaded. See `docs/art/style-guide.md`, and `docs/art/particle-language.md` for the particle effects.

**Related works.** These are named for context only:

- HyperRogue: a well-known game set in hyperbolic geometry.
- Antimatter Dimensions: a well-known incremental game.

They are listed only as context for readers, not as inspiration or sources. No assets or code from either are used. This project is independent and is not affiliated with or endorsed by their creators.

## License

MIT. See [LICENSE](LICENSE).
