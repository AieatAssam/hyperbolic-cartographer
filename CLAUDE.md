# Hyperbolic Cartographer

## Commands
- `npm run dev` — Vite dev server (dev panel enabled; toggle with backtick). Prod: add `?dev` to the URL.
- `npm test` — Vitest (core logic only, runs in Node)
- `npm run pacing` — headless greedy bot; asserts Drift < 15 min, Projection < 90 min (slow, opt-in)
- `npm run playtest` — headless greedy bot on the fast clock; 120 min game time, prints a timeline, exits 1 if Drift/Projection are late (`MIN=60` for less)
- `npm run typecheck`, `npm run build`

## Design documents

- [Full game design](docs/design/full-game-design.md): the complete design, including future layers; the playable slice does not implement it all.
- [Geometry and rendering roadmap](docs/art/geometry-roadmap.md): proposed C0–C7 work for surfaces, particles, cameras and accessible picking. Documentation only; no new layer is implemented.

## Architecture rules
- `src/core/` is pure and deterministic: no DOM, no Three imports. Must stay unit-testable in Node.
- Game logic never knows its geometry; it only sees `TileGraph` (`ring[]`, `neighbours[][]`). Graphs are generated once at max size (`GRAPHS` in `state.ts`), so tile indices are stable; Survey just raises `state.ring`.
- Every tunable number lives in `src/core/config.ts`. If you change balance, change numbers there and note it in README "Balance", don't alter formulas silently.
- Simulation: fixed 10 ticks/s via `simulate(state, dt)`; rendering on rAF reads state. Offline uses the same `simulate` in 60s steps with an efficiency factor.
- Hyperbolic math: hyperboloid model, 3x3 Lorentz matrices (`core/geometry/hyperbolic.ts`); rendering projects to the Poincaré disk and pans by left-multiplying the view by a boost.
- `save.ts` is pure (strings in/out); `localStorage` is only touched in `main.ts`. Add a `migrations[v]` entry and bump `SAVE_VERSION` for any state shape change.
- UI is plain DOM (`src/ui/ui.ts`), classes styled in `src/style.css`.
