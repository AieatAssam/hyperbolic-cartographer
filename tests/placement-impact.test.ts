import { describe, expect, it } from 'vitest';
import { place } from '../src/core/economy';
import { placementImpact, tileInfluenceSet } from '../src/core/placement-impact';
import { graphOf, initialState } from '../src/core/state';
import { mods } from '../src/core/economy';

describe('placementImpact', () => {
  it('marks bridge-reach separately from direct neighbours', () => {
    const s = initialState();
    const g = graphOf(s);
    const reach = mods(s).reach;
    place(s, 0, 'bridge');
    const i = g.neighbours[0].find((n) => !s.tiles[n])!;
    const imp = placementImpact(g, s.tiles, i, 'spring', reach);
    expect(imp.direct).toContain(g.neighbours[i][0]);
    expect(imp.viaBridge.length).toBeGreaterThanOrEqual(0);
    for (const d of imp.direct) expect(imp.viaBridge).not.toContain(d);
  });
});

describe('tileInfluenceSet', () => {
  it('includes bridged partners for a mill', () => {
    const s = initialState();
    place(s, 0, 'spring');
    const g = graphOf(s);
    const reach = mods(s).reach;
    const millCell = g.neighbours[0][0];
    place(s, millCell, 'mill');
    const lit = tileInfluenceSet(g, s.tiles, millCell, reach);
    expect(lit).toContain(0);
    expect(lit).toContain(millCell);
  });
});
