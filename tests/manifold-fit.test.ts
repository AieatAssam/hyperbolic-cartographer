import { describe, expect, it } from 'vitest';
import { boardRectInset, projectedFillRatio } from '../src/render/manifold-camera-fit';
import { manifoldFitSamples } from '../src/render/manifold-camera-fit';

describe('manifold board rect', () => {
  it('inset uses margin only once', () => {
    const r = boardRectInset({ left: 0, top: 50, right: 390, bottom: 750 }, 16);
    expect(r.left).toBe(16);
    expect(r.right).toBe(374);
    expect(r.width).toBeCloseTo(358, 0);
    expect(r.height).toBeCloseTo(668, 0);
  });

  it('torus fit sample grid is dense', () => {
    const b = { surface: 'torus' as const, isChartFlat: () => false, group: { rotation: { y: 0 } } };
    const pts = manifoldFitSamples(b as import('../src/render/surface-board').SurfaceBoard);
    expect(pts.length).toBe(25 * 13);
  });
});

describe('projectedFillRatio', () => {
  it('computes limiting axis', () => {
    const board = boardRectInset({ left: 0, top: 0, right: 400, bottom: 400 }, 16);
    const ext = { minX: 50, maxX: 350, minY: 80, maxY: 320, width: 300, height: 240 };
    const fill = projectedFillRatio(ext, board);
    expect(fill).toBeCloseTo(Math.min(300 / board.width, 240 / board.height), 2);
  });
});
