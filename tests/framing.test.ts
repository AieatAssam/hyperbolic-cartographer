import { describe, expect, it } from 'vitest';
import { cellCorners, circlePts, classifyOverlay, fitDistance, freeRect, shouldReframe } from '../src/render/framing';

describe('classifyOverlay', () => {
  it('a half-width landscape dock is bottom, not left', () => {
    expect(classifyOverlay('dock', { left: 8, top: 300, right: 430, bottom: 390 }, 844, 390)).toBe('bottom');
  });
  it('hud top strip is top', () => {
    expect(classifyOverlay('hud', { left: 0, top: 0, right: 844, bottom: 50 }, 844, 390)).toBe('top');
  });
  it('tall side panel is right', () => {
    expect(classifyOverlay('panel', { left: 1500, top: 0, right: 1920, bottom: 1080 }, 1920, 1080)).toBe('right');
  });
});

describe('freeRect', () => {
  it('dock plus hud leaves a horizontally centred board band', () => {
    const r = freeRect(
      [
        { role: 'dock', rect: { left: 8, top: 300, right: 430, bottom: 390 } },
        { role: 'hud', rect: { left: 0, top: 0, right: 844, bottom: 50 } },
      ],
      844,
      390,
    );
    expect(r.left).toBe(0);
    expect(r.right).toBe(844);
    expect(r.bottom).toBe(300);
    expect(r.top).toBe(50);
  });
});

describe('fitDistance', () => {
  const W = 360, H = 640, fov = 45, margin = 12;
  const free = { left: 0, top: 60, right: 360, bottom: 520 };
  const polar = Math.atan2(11, 13);
  const pts = circlePts(9.6);
  const t = Math.tan((22.5 * Math.PI) / 180);
  const sp = Math.sin(polar), cp = Math.cos(polar);
  const cy = (free.top + free.bottom) / 2;

  // Projects a ground point (x, z) for camera distance d and returns pixel offsets from the free-rect centre.
  const project = (d: number, [x, z]: [number, number]) => {
    const depth = d - z * sp;
    const sx = x / depth;
    const sy = (-z * cp) / depth;
    return { px: W / 2 + ((sx / (t * (W / H))) * W) / 2, py: cy + ((sy / t) * H) / 2 };
  };
  const inside = (d: number, p: [number, number]) => {
    const { px, py } = project(d, p);
    return (
      px >= margin - 0.01 &&
      px <= W - margin + 0.01 &&
      py >= free.top + margin - 0.01 &&
      py <= free.bottom - margin + 0.01 &&
      Math.abs(py - cy) <= (free.bottom - free.top) / 2 - margin + 0.01
    );
  };

  it('every footprint point lands inside the free rect, and the fit is tight', () => {
    const d = fitDistance({ pts, W, H, free, fov, polar, margin, portraitWidthFirst: true });
    expect(d).toBeGreaterThan(0);
    for (const p of pts) expect(inside(d, p)).toBe(true);
    expect(pts.some((p) => !inside(d * 0.97, p))).toBe(true);
  });

  it('grows when the free rect shrinks (panel open)', () => {
    const d1 = fitDistance({ pts, W, H, free, fov, polar, margin, portraitWidthFirst: true });
    const d2 = fitDistance({
      pts, W, H, free: { left: 0, top: 60, right: 220, bottom: 520 }, fov, polar, margin, portraitWidthFirst: true,
    });
    expect(d2).toBeGreaterThan(d1);
  });

  it('cellCorners gives 4 corners per cell', () => {
    expect(cellCorners([[0, 0]])).toHaveLength(4);
  });
});

describe('shouldReframe', () => {
  it('reframes only when dirty and no touch cell is previewed', () => {
    expect(shouldReframe(true, -1)).toBe(true);
    expect(shouldReframe(false, -1)).toBe(false);
  });
  it('defers a dirty layout while a cell is previewed, then applies it once selection clears', () => {
    expect(shouldReframe(true, 42)).toBe(false);
    expect(shouldReframe(true, 0)).toBe(false);
    expect(shouldReframe(true, -1)).toBe(true);
  });
});
