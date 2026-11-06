/**
 * LIMITATIONS
 *
 * These tests check base token colours in sRGB (WCAG relative luminance, CIE Lab DeltaE76)
 * and the coefficient invariants in palette.ts. They do not check GPU-lit screenshots.
 * Lighting, ACES tone mapping, fog and bloom all change the final pixels, so actual render QA
 * is a separate step.
 */
import { describe, expect, it } from 'vitest';
import {
  TILE_IDENTITIES,
  EMPTY_SLOT,
  NEXT_SLOT,
  PLACE,
  MATERIAL,
  BLOOM,
  BOARD,
  contrastRatio,
  deltaE76,
  saturation,
  hue,
  lerpHex,
  sideColour,
  bevelColour,
  hoverFace,
  tileHeight,
  trimGlow,
  outputLevel,
  relativeLuminance,
} from '../src/art/palette';

type TypeName = keyof typeof TILE_IDENTITIES;
const TYPES = Object.keys(TILE_IDENTITIES) as TypeName[];

/** Pass-1 chip hues (degrees) the pass-3A base colours must stay close to. */
const CHIP_HEX: Record<TypeName, number> = {
  spring: 0x4a9be8,
  mill: 0xe0a040,
  beacon: 0xe0607a,
  bridge: 0x8a5cd6,
  vault: 0x2fb59c,
};

/** Circular difference between two hues in degrees (0..180). */
const hueDiff = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
};

describe('tile identity tokens', () => {
  for (const name of TYPES) {
    const tok = TILE_IDENTITIES[name];

    describe(name, () => {
      it('contrasts with the empty slot (WCAG ratio >= 2.0)', () => {
        expect(contrastRatio(tok.base, EMPTY_SLOT.base)).toBeGreaterThanOrEqual(2.0);
      });

      it('differs from the empty slot in Lab (DeltaE76 >= 25)', () => {
        expect(deltaE76(tok.base, EMPTY_SLOT.base)).toBeGreaterThanOrEqual(25);
      });

      it('keeps a saturated face colour', () => {
        expect(saturation(tok.base)).toBeGreaterThanOrEqual(0.75);
      });

      it('keeps saturation after the hover lerp', () => {
        expect(saturation(hoverFace(tok.base))).toBeGreaterThanOrEqual(0.6);
      });

      it('keeps the pass-1 chip hue within 10 degrees', () => {
        expect(hueDiff(hue(tok.base), hue(CHIP_HEX[name]))).toBeLessThanOrEqual(10);
      });

      it('uses a painted, not chrome, material response', () => {
        expect(tok.roughness).toBeGreaterThanOrEqual(0.3);
        expect(tok.roughness).toBeLessThanOrEqual(0.7);
        expect(tok.metalness).toBeLessThanOrEqual(0.2);
      });

      it('gives side walls a darker luminance than the face', () => {
        expect(relativeLuminance(sideColour(tok.base))).toBeLessThan(relativeLuminance(tok.base) * 0.3);
      });

      it('keeps side walls distinct from the gold pin outline', () => {
        expect(deltaE76(sideColour(tok.base), BOARD.gold)).toBeGreaterThan(25);
      });

      it('pulls the pinned bevel closer to gold than the unpinned bevel', () => {
        expect(deltaE76(bevelColour(tok, true), BOARD.gold)).toBeLessThan(
          deltaE76(bevelColour(tok, false), BOARD.gold),
        );
      });

      it('keeps the faces below the bloom threshold', () => {
        expect(trimGlow(1)).toBeLessThan(BLOOM.threshold);
        expect(MATERIAL.faceGlow).toBeLessThanOrEqual(0.1);
      });

      it('lets only the motif core bloom (above threshold, within the accent cap)', () => {
        expect(tok.emissiveIntensity).toBeGreaterThan(BLOOM.threshold);
        expect(tok.emissiveIntensity).toBeLessThanOrEqual(BOARD.glowAccentIntensity);
      });
    });
  }

  it('gives every pair of tile types a DeltaE76 of at least 25', () => {
    for (let i = 0; i < TYPES.length; i++) {
      for (let j = i + 1; j < TYPES.length; j++) {
        const a = TILE_IDENTITIES[TYPES[i]].base;
        const b = TILE_IDENTITIES[TYPES[j]].base;
        expect(deltaE76(a, b), `${TYPES[i]} vs ${TYPES[j]}`).toBeGreaterThanOrEqual(25);
      }
    }
  });
});

describe('lerpHex', () => {
  it('returns the endpoints at t = 0 and t = 1', () => {
    expect(lerpHex(0x102030, 0xa0b0c0, 0)).toBe(0x102030);
    expect(lerpHex(0x102030, 0xa0b0c0, 1)).toBe(0xa0b0c0);
  });
});

describe('empty slot', () => {
  it('is a dark recessed well', () => {
    expect(relativeLuminance(EMPTY_SLOT.base)).toBeLessThan(0.03);
  });

  it('has a subdued border, never near-white', () => {
    expect(relativeLuminance(EMPTY_SLOT.accent)).toBeLessThan(0.15);
  });

  it('is matte', () => {
    expect(EMPTY_SLOT.roughness).toBeGreaterThanOrEqual(0.8);
  });

  it('keeps its faint emissive below the bloom threshold', () => {
    expect(EMPTY_SLOT.emissiveIntensity).toBeLessThan(BLOOM.threshold);
  });

  it('makes the next ring darker than the empty slot', () => {
    expect(relativeLuminance(NEXT_SLOT.base)).toBeLessThan(relativeLuminance(EMPTY_SLOT.base));
  });

  it('at rest, keeps a thin bevel band (inset between the placed-tile 0.8 and a full face of 1)', () => {
    expect(EMPTY_SLOT.restInset).toBeGreaterThan(0.8);
    expect(EMPTY_SLOT.restInset).toBeLessThan(1);
  });

  it('at rest, mixes the border toward the face and trims with a fraction of the glow', () => {
    expect(EMPTY_SLOT.restRimMix).toBeGreaterThanOrEqual(0);
    expect(EMPTY_SLOT.restRimMix).toBeLessThanOrEqual(1);
    expect(EMPTY_SLOT.restTrim).toBeGreaterThan(0);
    expect(EMPTY_SLOT.restTrim).toBeLessThanOrEqual(1);
  });

  it('the quiet resting border is darker than the accent but still visible against the face', () => {
    const rest = lerpHex(EMPTY_SLOT.accent, EMPTY_SLOT.base, EMPTY_SLOT.restRimMix);
    expect(relativeLuminance(rest)).toBeLessThan(relativeLuminance(EMPTY_SLOT.accent));
    expect(contrastRatio(rest, EMPTY_SLOT.base)).toBeGreaterThanOrEqual(1.2);
  });
});

describe('placement curve tokens (PLACE)', () => {
  it('orders dip before life, with a positive decay and frequency', () => {
    expect(PLACE.dip).toBeGreaterThan(0);
    expect(PLACE.dip).toBeLessThan(PLACE.life);
    expect(PLACE.decay).toBeGreaterThan(0);
    expect(PLACE.omega).toBeGreaterThan(0);
  });

  it('has a squash depth strictly between 0 and 0.5, so the tile never flattens', () => {
    expect(PLACE.squash).toBeGreaterThan(0);
    expect(PLACE.squash).toBeLessThan(0.5);
  });

  it('settles inside its life (the curve is exactly 1 from life on)', () => {
    expect(PLACE.life).toBeGreaterThanOrEqual(0.45);
  });
});

describe('extrusion', () => {
  it('gives an empty-output tile more height than a slot is thick', () => {
    expect(tileHeight(outputLevel(0))).toBeGreaterThan(MATERIAL.slotHeight * 5);
  });

  it('increases height monotonically with output', () => {
    const outputs = [0, 10, 1e3, 1e6];
    const heights = outputs.map((o) => tileHeight(outputLevel(o)));
    for (let i = 1; i < heights.length; i++) {
      expect(heights[i]).toBeGreaterThan(heights[i - 1]);
    }
  });

  it('caps the output level at 1', () => {
    expect(outputLevel(1e9)).toBe(1);
  });
});

describe('body environment', () => {
  it('keeps the merged tile body env reflection low (0.05..0.25)', () => {
    expect(MATERIAL.bodyEnv).toBeGreaterThanOrEqual(0.05);
    expect(MATERIAL.bodyEnv).toBeLessThanOrEqual(0.25);
  });
});
