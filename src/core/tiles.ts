export const TILE_TYPES = ['spring', 'mill', 'beacon', 'bridge', 'vault'] as const;
export type TileType = (typeof TILE_TYPES)[number];

export const TILE_INFO: Record<TileType, { name: string; color: number; desc: string }> = {
  spring: { name: 'Spring', color: 0x3fa7ff, desc: 'Produces Ink.' },
  mill: { name: 'Mill', color: 0xe8c872, desc: 'Produces Ink, +100% per adjacent Spring.' },
  beacon: { name: 'Beacon', color: 0xff7a59, desc: 'Adjacent tiles x1.5 (stacks multiplicatively).' },
  bridge: { name: 'Bridge', color: 0xb68cff, desc: 'Its neighbours count as adjacent to each other.' },
  vault: { name: 'Vault', color: 0x6fe3a8, desc: '+10% offline efficiency, +2% global output.' },
};
