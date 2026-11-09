import { describe, expect, it } from 'vitest';
import {
  cellCorners, circlePts, classifyOverlay, fitBoard, fitDistance, freeRect, projectGround,
  shouldReframe, sphericalOffset,
} from '../src/render/framing';

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

describe('portrait projected fit', () => {
  const W = 390, H = 844, fov = 45, margin = 8, topPad = 18;
  const free = { left: 0, top: 72, right: 390, bottom: 620 };
  const pts = cellCorners([[-2, -2], [2, -2], [2, 2], [-2, 2], [0, 0]]);
  const polar = 0.55;

  it('sphericalOffset is along +Z at azimuth 0', () => {
    const [x, y, z] = sphericalOffset(polar, 0, 10);
    expect(x).toBeCloseTo(0, 6);
    expect(y).toBeCloseTo(10 * Math.cos(polar), 6);
    expect(z).toBeCloseTo(10 * Math.sin(polar), 6);
  });

  it('top-aligns the footprint under the HUD and stays inside the free rect', () => {
    const fit = fitBoard({ pts, W, H, free, fov, polar, margin, align: 'top', topPad });
    expect(fit.d).toBeGreaterThan(4);
    expect(fit.d).toBeLessThan(40);
    let minPy = Infinity, maxPy = -Infinity, minPx = Infinity, maxPx = -Infinity;
    for (const [x, z] of pts) {
      const pr = projectGround(x, 0, z, fit.d, polar, fov, W, H, fit.viewOffX, fit.viewOffY);
      expect(pr).not.toBeNull();
      const [px, py] = pr!;
      expect(px).toBeGreaterThanOrEqual(margin - 0.5);
      expect(px).toBeLessThanOrEqual(W - margin + 0.5);
      expect(py).toBeGreaterThanOrEqual(free.top + margin - 0.5);
      expect(py).toBeLessThanOrEqual(free.bottom - margin + 0.5);
      minPy = Math.min(minPy, py);
      maxPy = Math.max(maxPy, py);
      minPx = Math.min(minPx, px);
      maxPx = Math.max(maxPx, px);
    }
    expect(minPy).toBeGreaterThanOrEqual(free.top + topPad - 1.5);
    expect(minPy).toBeLessThan(free.top + topPad + 8);
    const height = maxPy - minPy;
    const band = free.bottom - free.top;
    expect(height / band).toBeGreaterThan(0.45);
    expect((maxPx - minPx) / W).toBeGreaterThan(0.7);
  });

  it('a more overhead polar fills more of the tall free band', () => {
    const low = fitBoard({ pts, W, H, free, fov, polar: 0.85, margin, align: 'top', topPad });
    const high = fitBoard({ pts, W, H, free, fov, polar: 0.50, margin, align: 'top', topPad });
    const span = (fit: typeof low, polar: number) => {
      let minPy = Infinity, maxPy = -Infinity;
      for (const [x, z] of pts) {
        const pr = projectGround(x, 0, z, fit.d, polar, fov, W, H, fit.viewOffX, fit.viewOffY)!;
        minPy = Math.min(minPy, pr[1]);
        maxPy = Math.max(maxPy, pr[1]);
      }
      return maxPy - minPy;
    };
    expect(span(high, 0.50)).toBeGreaterThan(span(low, 0.85) * 1.04);
  });

  it('is tight: a 4% zoom-in leaves the free rect', () => {
    const fit = fitBoard({ pts, W, H, free, fov, polar, margin, align: 'top', topPad });
    const dIn = fit.d * 0.96;
    const off = { x: fit.viewOffX, y: fit.viewOffY };
    const clipped = pts.some(([x, z]) => {
      const pr = projectGround(x, 0, z, dIn, polar, fov, W, H, off.x, off.y);
      if (!pr) return true;
      return pr[0] < margin || pr[0] > W - margin || pr[1] < free.top + margin || pr[1] > free.bottom - margin;
    });
    expect(clipped).toBe(true);
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
