export const TILE_TYPES = ['spring', 'mill', 'beacon', 'bridge', 'vault', 'lighthouse', 'cistern', 'scriptorium'] as const;
export type TileType = (typeof TILE_TYPES)[number];

export const TILE_INFO: Record<TileType, { name: string; desc: string }> = {
  spring: { name: 'Spring', desc: 'Produces Ink, split among the Mills it feeds: each extra Mill gives every one a smaller share. A Bridge touching it gives full flow.' },
  mill: { name: 'Mill', desc: 'Produces Ink, +100% per adjacent Spring. Springs shared with other Mills give less to each; a Mill draws on at most 8 Springs.' },
  beacon: { name: 'Beacon', desc: 'Adjacent tiles x1.5 (stacks multiplicatively). A Beacon reached only through a Bridge adds instead (strongest 6 count).' },
  bridge: { name: 'Bridge', desc: 'Touching a chain links every tile on that chain. A Spring touching a Bridge gives full flow to every Mill.' },
  vault: { name: 'Vault', desc: '+10% offline efficiency, +2% global output; each further Vault adds a little less.' },
  lighthouse: { name: 'Lighthouse', desc: 'Producers exactly 2 steps away x1.25.' },
  cistern: { name: 'Cistern', desc: 'Adjacent Springs produce x3 (each Cistern multiplies).' },
  scriptorium: { name: 'Scriptorium', desc: 'Produces 40/s times the number of different kinds of tile next to it (other Scriptoria do not count).' },
};
