import { describe, expect, it } from 'vitest';
import { analyseCanvasPixels } from '../src/render/canvas-check';

describe('analyseCanvasPixels', () => {
  it('rejects an all-black canvas', () => {
    const w = 128, h = 128;
    const data = new Uint8ClampedArray(w * h * 4);
    expect(analyseCanvasPixels(data, w, h).ok).toBe(false);
  });

  it('accepts a coloured board-like sample', () => {
    const w = 128, h = 128;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 80; data[i + 1] = 120; data[i + 2] = 200; data[i + 3] = 255;
    }
    const s = analyseCanvasPixels(data, w, h);
    expect(s.ok).toBe(true);
    expect(s.mean).toBeGreaterThan(0.2);
  });
});
