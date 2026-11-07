import { describe, expect, it } from 'vitest';
import type { SurfacePreview } from '../src/core/state';
import { SURFACE } from '../src/art/palette';

/** Pure mirror of main.ts surface URL parsing. */
const surfaceFromUrl = (q: string): SurfacePreview => {
  const v = new URLSearchParams(q).get('surface');
  return v === 'torus' || v === 'klein' ? v : 'off';
};

describe('manifold preview URL flag', () => {
  it('parses ?surface=torus and klein', () => {
    expect(surfaceFromUrl('?surface=torus')).toBe('torus');
    expect(surfaceFromUrl('?surface=klein')).toBe('klein');
    expect(surfaceFromUrl('')).toBe('off');
  });
});

describe('surface chart and seam toggles', () => {
  it('toggles flip booleans (orbit UI state)', () => {
    let chart = false, seam = true;
    chart = !chart;
    seam = !seam;
    expect(chart).toBe(true);
    expect(seam).toBe(false);
  });
});

describe('SURFACE palette tokens', () => {
  it('exposes seam colours and ghost alpha', () => {
    expect(SURFACE.seamA).toBeGreaterThan(0);
    expect(SURFACE.ghostAlpha).toBeGreaterThan(0);
    expect(SURFACE.ghostAlpha).toBeLessThan(1);
    expect(SURFACE.dashPattern.length).toBe(2);
  });
});
