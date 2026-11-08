export const TILE_TYPES = ['spring', 'mill', 'beacon', 'bridge', 'vault'] as const;
export type TileType = (typeof TILE_TYPES)[number];

export const TILE_INFO: Record<TileType, { name: string; desc: string }> = {
  spring: { name: 'Spring', desc: 'Produces Ink.' },
  mill: { name: 'Mill', desc: 'Produces Ink, +100% per adjacent Spring.' },
  beacon: { name: 'Beacon', desc: 'Adjacent tiles x1.5 (stacks multiplicatively).' },
  bridge: { name: 'Bridge', desc: 'Its neighbours count as adjacent to each other.' },
  vault: { name: 'Vault', desc: '+10% offline efficiency, +2% global output.' },
};
