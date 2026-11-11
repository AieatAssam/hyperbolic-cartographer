export const TILE_TYPES = ['spring', 'mill', 'beacon', 'bridge', 'vault', 'lighthouse'] as const;
export type TileType = (typeof TILE_TYPES)[number];

export const TILE_INFO: Record<TileType, { name: string; desc: string }> = {
  spring: { name: 'Spring', desc: 'Produces Ink.' },
  mill: { name: 'Mill', desc: 'Produces Ink, +100% per adjacent Spring.' },
  beacon: { name: 'Beacon', desc: 'Adjacent tiles x1.5 (stacks multiplicatively).' },
  bridge: { name: 'Bridge', desc: 'Touching a chain links every tile on that chain.' },
  vault: { name: 'Vault', desc: '+10% offline efficiency, +2% global output.' },
  lighthouse: { name: 'Lighthouse', desc: 'Producers exactly 2 steps away x1.25.' },
};
