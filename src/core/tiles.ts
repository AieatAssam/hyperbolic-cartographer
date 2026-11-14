import { config } from './config';

export const TILE_TYPES = ['spring', 'mill', 'beacon', 'bridge', 'vault', 'lighthouse', 'cistern', 'scriptorium'] as const;
export type TileType = (typeof TILE_TYPES)[number];

// Descriptions read their numbers from config, so the in-game text cannot drift from the balance.
const T = config.tiles;
const pct = (x: number) => `${Math.round(x * 100)}%`;

export const TILE_INFO: Record<TileType, { name: string; desc: string }> = {
  spring: { name: 'Spring', desc: 'Produces Ink, split among the Mills it feeds: each extra Mill gives every one a smaller share. A Bridge touching it gives full flow.' },
  mill: { name: 'Mill', desc: `Produces Ink, +${pct(T.mill.perSpring)} per adjacent Spring. Springs shared with other Mills give less to each; a Mill draws on at most ${T.mill.maxSprings} Springs.` },
  beacon: { name: 'Beacon', desc: `Adjacent tiles x${T.beacon.mult} (stacks multiplicatively). A Beacon reached only through a Bridge adds instead (strongest ${T.beacon.maxRelayed} count).` },
  bridge: { name: 'Bridge', desc: 'Touching a chain links every tile on that chain. A Spring touching a Bridge gives full flow to every Mill.' },
  vault: { name: 'Vault', desc: `+${pct(T.vault.offline)} offline efficiency, +${pct(T.vault.global)} global output; each further Vault adds a little less.` },
  lighthouse: { name: 'Lighthouse', desc: `Producers exactly 2 steps away x${T.lighthouse.mult}.` },
  cistern: { name: 'Cistern', desc: `Adjacent Springs produce x${T.cistern.mult} and count as ${T.cistern.millFlow} Springs for their Mills (each Cistern multiplies).` },
  scriptorium: { name: 'Scriptorium', desc: `Produces ${T.scriptorium.out}/s times the number of different kinds of tile next to it (other Scriptoria do not count).` },
};
