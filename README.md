# Hyperbolic Cartographer

Hyperbolic Cartographer is an incremental game in the browser. You place tiles that produce Ink, and the Ink you earn depends on which tiles sit next to which. You start on a flat square grid where each cell has 4 neighbours. Prestige through Projection and the board becomes a hyperbolic {7,3} tiling where each cell has 7 neighbours (ring sizes 1, 7, 21, 56, 147). The same adjacency rules get much stronger there, because every tile now touches far more of its neighbours.

## How to play

- Tiles (effects from `TILE_INFO` in `src/core/tiles.ts`):
  - **Spring**: produces Ink.
  - **Mill**: produces Ink, +100% per adjacent Spring.
  - **Beacon**: adjacent tiles x1.5 (stacks multiplicatively).
  - **Bridge**: its neighbours count as adjacent to each other (adjacency hops through it); Long Bridges extends the reach.
  - **Vault**: improves offline progress and adds a small global Ink bonus.
- **Survey**: expands the board by one ring. Each ring costs more.
- **Sell (S)**: removes a tile for a 50% refund.
- **Pin (P)**: pins a tile so it survives Drift. The number of pins is limited; Brass Pins adds more.
- Hotkeys **1-5** select the tiles.
- Drag to pan. In hyperbolic mode dragging applies a Lorentz boost, so the board slides like a hyperbolic plane.
- Right-drag to tilt the view. Scroll or pinch to zoom.
- **Drift** (prestige 1) resets the run and gives Charts. Drift unlocks at 1,000,000 Ink in a run.
- **Projection** (prestige 2) spends Charts on Curvature, switches the board to hyperbolic geometry, and resets the run. Its tab is visible from the start (locked until you can project) and compares 4 neighbours per cell on the square board with 7 on the {7,3} board.
- The Drift and Projection tabs list what resets and what is kept.
- Disabled buttons show a red line saying what is missing.
- Milestones automate parts of play (auto-Survey, auto-placed Springs, and similar).

### Input

- Mouse: click places at once. Hover previews the cost and the Ink/s change.
- Touch and pen: the first tap previews the cell in the card above the tools (cost, Ink/s change, or the reason it's blocked). Tap the same cell again, or press **Place**, to confirm. **Cancel** or **Esc** clears the preview.
- Drags, pinches and cancelled touches never place.

### Tutorial and top bar

- The first run shows a 5-step tutorial card above the tools: Ink buys tiles, place your first Spring, save for a Mill, the adjacency boost, and reading the preview. Each step moves on by itself once its goal is met.
- **Hide** dismisses the card. The top-right **Guide** button reopens it.
- The Menu's **Guide** tab has Show tutorial and Restart tutorial, plus a reference for every tool and button.
- Tutorial progress is stored in `localStorage` under `hc-tutorial`, separate from your save. The save format and `SAVE_VERSION` are unchanged.
- The top bar always shows **Now** (your next concrete step, with progress and an ETA), a live line explaining what the board is producing, and the next unlock.

### Layout

- Panels are bounded and scroll. Close them with **Close** or **Menu**. On small screens, Esc also closes them.
- All controls are at least 44px.

## Local dev

```sh
npm install
npm run dev         # then open http://localhost:5173/hyperbolic-cartographer/
npm test            # Vitest, core logic only, runs in Node
npm run typecheck
npm run build
npm run preview     # serve the production build
npm run pacing      # headless greedy bot; asserts first Drift < 15 min and Projection < 90 min
```

The dev panel toggles with the backtick key (`` ` ``). It is on in dev builds, and in production builds when the URL has `?dev`. It can grant currency, jump to Drift or Projection, and change time speed.

## Deploy

The GitHub Actions workflow `.github/workflows/deploy.yml` runs on every push to `main`. It runs typecheck, test, and build, then deploys `dist` to GitHub Pages.

One-time setup: in the repo's **Settings → Pages**, set **Source** to **GitHub Actions**.

`base` in `vite.config.ts` is `/hyperbolic-cartographer/`. Change it if the repo is renamed, or the asset paths will break.

## Saves

- Autosave to `localStorage` every 10 s, when the tab is hidden, and before prestige.
- Export as a compressed string, or download `cartographer-save-<date>.json`.
- Import accepts either format. It validates the schema and the FNV-1a checksum, shows a preview, and keeps a one-slot backup of the previous save.
- Offline progress is capped at 8 h (+4 h per Ship's Log level) and runs at 50% base efficiency, plus 10% per Vault.

## Balance

Changes from the original brief (all in `src/core/config.ts`; formulas unchanged):

- Mill output 5 → 9 Ink/s (pacing: first Drift was ~25 min).
- Survey growth 8^ring → 6^ring on the square board (base 50).
- Charts on Drift = floor((runInk / 2.5e5)^0.5) instead of /1e6 (Drift still unlocks at 1e6 Ink); otherwise Projection took > 2 h.
- Hyperbolic survey: base 2e5, growth 12^ring; board starts at radius 2, base max radius 3, +1 via the "Deeper Horizon" Curvature upgrade (radius 4 = 232 tiles).
- Offline base efficiency 50% (unspecified in brief).
- Bot results with these numbers: Drift available ~11 min (bot drifts at ~14), Projection ~71 min, hyperbolic board fully built ~95 min (~24 min of hyperbolic play).

Pass 1 (clarity/touch) made no balance changes.

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
  render/
    scene.ts       Three.js scene, camera, controls
    board.ts       one merged extruded-prism mesh for both geometries, incl. Poincare
                   projection and picking (boardSquare/boardHyperbolic/picking merged here)
    fx.ts          pulses and other visual feedback
  ui/
    ui.ts          plain DOM overlay (styled in src/style.css)
    format.ts      number formatting
  main.ts          fixed 10 Hz sim loop + requestAnimationFrame render loop
tests/             Vitest suites, plus the opt-in pacing bot
```

Game logic never knows its geometry. It only sees a `TileGraph`, so tile indices stay stable while Survey just raises `state.ring`.

- `src/ui/help.ts`, `goals.ts`, `tutorial.ts`, `input.ts` are pure (no DOM) and unit-tested in `tests/`.
