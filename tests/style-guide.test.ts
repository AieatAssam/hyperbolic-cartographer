import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TILE_TYPES } from '../src/core/tiles';
import { TILE_IDENTITIES, tileChipColour } from '../src/art/palette';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Collect 0x literals assigned in palette.ts object exports (excludes bit shifts in helpers). */
function paletteHexLiterals(src: string): number[] {
  const out = new Set<number>();
  for (const m of src.matchAll(/\b0x[0-9a-f]{6}\b/gi)) {
    const v = parseInt(m[0], 16);
    if (v <= 0xffffff) out.add(v);
  }
  return [...out].sort((a, b) => a - b);
}

const paletteSrc = readFileSync(join(ROOT, 'src/art/palette.ts'), 'utf8');
const guide = readFileSync(join(ROOT, 'docs/art/style-guide.md'), 'utf8');
const literals = paletteHexLiterals(paletteSrc);

describe('style guide documents palette hex values', () => {
  it('lists every distinct 0x literal from palette.ts (case-insensitive #hex in the guide)', () => {
    const missing = literals.filter((h) => !guide.toLowerCase().includes(`#${h.toString(16).padStart(6, '0')}`));
    expect(missing, `missing in style-guide: ${missing.map((h) => '#' + h.toString(16))}`).toEqual([]);
  });
});

describe('palette tool chips', () => {
  it('tileChipColour reads TILE_IDENTITIES.base for every tile type', () => {
    for (const t of TILE_TYPES) {
      expect(tileChipColour(t)).toBe(TILE_IDENTITIES[t].base);
    }
  });
});
