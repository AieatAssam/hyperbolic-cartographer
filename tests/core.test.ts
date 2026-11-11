import { describe, expect, it } from 'vitest';
import Decimal from 'break_eternity.js';
import { config } from '../src/core/config';
import { GRAPHS, initialState } from '../src/core/state';
import { mods, place, production, springShare, vaultBonus } from '../src/core/economy';
import { applyOffline } from '../src/core/tick';
import { exportString, importSave, makeSave, toJson } from '../src/core/save';
import { drift, project } from '../src/core/prestige';
import type { TileType } from '../src/core/tiles';

describe('production', () => {
  // Same layout logic on both boards: Mill in the centre, Springs on every neighbour, a Beacon beside it.
  const layout = (geo: 'square' | 'hyper') => {
    const g = GRAPHS[geo];
    const tiles: (TileType | null)[] = g.ring.map(() => null);
    tiles[0] = 'mill';
    for (const n of g.neighbours[0]) tiles[n] = 'spring';
    return { g, tiles };
  };
  const m = mods(initialState());
  it('hyperbolic gives a bigger jump for the same layout', () => {
    const sq = layout('square'), hy = layout('hyper');
    const ps = production(sq.g, sq.tiles, m).total, ph = production(hy.g, hy.tiles, m).total;
    const M = config.tiles.mill.out;
    const S = config.tiles.spring.out;
    expect(ps).toBeCloseTo(M * 5 + 4 * S);
    expect(ph).toBeCloseTo(M * 8 + 7 * S);
    expect(ph).toBeGreaterThan(ps * 1.5);
  });
  it('beacon multiplies, bridge propagates adjacency', () => {
    const { g } = layout('square');
    const tiles: (TileType | null)[] = g.ring.map(() => null);
    const [a, b] = g.neighbours[0];
    tiles[0] = 'bridge';
    tiles[a] = 'mill';
    tiles[b] = 'spring';
    const M = config.tiles.mill.out;
    const S = config.tiles.spring.out;
    expect(production(g, tiles, m).total).toBe(M * 2 + S);
    tiles[0] = 'beacon';
    expect(production(g, tiles, m).total).toBeCloseTo(M * 1.5 + S * 1.5);
  });
});

describe('spring strain, Cistern, Scriptorium', () => {
  const g = GRAPHS.square;
  const m = mods(initialState());
  const board = (...cells: [number, TileType][]) => {
    const tiles: (TileType | null)[] = g.ring.map(() => null);
    for (const [i, t] of cells) tiles[i] = t;
    return tiles;
  };
  const [a, b, c, d] = g.neighbours[0];
  const M = config.tiles.mill.out;
  const S = config.tiles.spring.out;

  it('share(k) = 1/(1+strain*(k-1)) for k = 1..4', () => {
    const r = config.tiles.spring.strain;
    for (let k = 1; k <= 4; k++) expect(springShare(k)).toBeCloseTo(1 / (1 + r * (k - 1)), 12);
  });

  it('a Spring feeding several Mills gives each less; a Bridge-touching Spring stays at full share', () => {
    // Spring at the centre, Mills on three neighbours.
    const plain = production(g, board([0, 'spring'], [a, 'mill'], [b, 'mill'], [c, 'mill']), m);
    expect(plain.feeds[0]).toBe(3);
    expect(plain.share[0]).toBeCloseTo(springShare(3), 12);
    // A Bridge on the fourth neighbour channels the Spring: full share to every Mill.
    const bridged = production(g, board([0, 'spring'], [a, 'mill'], [b, 'mill'], [c, 'mill'], [d, 'bridge']), m);
    expect(bridged.feeds[0]).toBe(3);
    expect(bridged.share[0]).toBe(1);
  });

  it('production does not depend on the order tiles were placed', () => {
    const cells: [number, TileType][] = [[a, 'spring'], [b, 'mill'], [c, 'spring'], [d, 'mill'], [0, 'beacon']];
    const build = (order: [number, TileType][]) => {
      const s = initialState();
      s.ink = new Decimal('1e30');
      s.ring = config.square.maxRing;
      for (const [i, t] of order) expect(place(s, i, t)).toBe(true);
      return production(g, s.tiles, mods(s)).total;
    };
    expect(build(cells)).toBeCloseTo(build([...cells].reverse()), 9);
  });

  it('a Mill on a Bridge chain counts only its strongest maxSprings Springs', () => {
    // A straight chain of Bridges; one touching cell is the Mill, every other touching cell a Spring.
    const chain = [0];
    while (chain.length < 6) chain.push(g.neighbours[chain[chain.length - 1]].find((n) => !chain.includes(n) && !chain.slice(0, -1).some((x) => g.neighbours[x].includes(n)))!);
    const touch = [...new Set(chain.flatMap((x) => g.neighbours[x]))].filter((n) => !chain.includes(n));
    const [mill, ...springs] = touch;
    expect(springs.length).toBeGreaterThan(config.tiles.mill.maxSprings);
    const tiles = board(...chain.map((x): [number, TileType] => [x, 'bridge']), [mill, 'mill'], ...springs.map((x): [number, TileType] => [x, 'spring']));
    expect(production(g, tiles, m).perTile[mill]).toBeCloseTo(M * (1 + config.tiles.mill.perSpring * config.tiles.mill.maxSprings));
  });

  it('only the strongest maxRelayed Bridge-relayed Beacons count for one producer', () => {
    const chain = [0];
    while (chain.length < 8) chain.push(g.neighbours[chain[chain.length - 1]].find((n) => !chain.includes(n) && !chain.slice(0, -1).some((x) => g.neighbours[x].includes(n)))!);
    const touch = [...new Set(chain.flatMap((x) => g.neighbours[x]))].filter((n) => !chain.includes(n));
    const [mill, ...beacons] = touch;
    const near = beacons.filter((n) => g.neighbours[mill].includes(n)).length;
    const bonus = config.tiles.beacon.mult - 1;
    expect(beacons.length - near).toBeGreaterThan(config.tiles.beacon.maxRelayed);
    const tiles = board(...chain.map((x): [number, TileType] => [x, 'bridge']), [mill, 'mill'], ...beacons.map((x): [number, TileType] => [x, 'beacon']));
    expect(production(g, tiles, m).perTile[mill]).toBeCloseTo(M * (1 + bonus) ** near * (1 + bonus * config.tiles.beacon.maxRelayed));
  });

  it('Vault bonus has diminishing returns and a limit', () => {
    const { global, decay } = config.tiles.vault;
    expect(vaultBonus(0)).toBe(0);
    expect(vaultBonus(1)).toBeCloseTo(global);
    expect(vaultBonus(2)).toBeCloseTo(global * (1 + decay));
    expect(vaultBonus(1000)).toBeLessThan(global / (1 - decay) + 1e-9);
    const one = production(g, board([0, 'spring'], [a, 'vault']), m).total;
    expect(one).toBeCloseTo(S * (1 + global));
  });

  it('a Mill with 2 Springs and 2 Beacons out-produces a Mill with 4 Springs', () => {
    const two = production(g, board([0, 'mill'], [a, 'spring'], [b, 'spring'], [c, 'beacon'], [d, 'beacon']), m).perTile[0];
    const four = production(g, board([0, 'mill'], [a, 'spring'], [b, 'spring'], [c, 'spring'], [d, 'spring']), m).perTile[0];
    expect(two).toBeGreaterThan(four * 1.2);
  });

  it('a Cistern triples an adjacent Spring own output but not the Mill bonus it feeds', () => {
    const plainSpring = production(g, board([0, 'spring']), m).perTile[0];
    const cisternSpring = production(g, board([0, 'spring'], [a, 'cistern']), m).perTile[0];
    expect(plainSpring).toBeCloseTo(S, 9);
    expect(cisternSpring).toBeCloseTo(plainSpring * config.tiles.cistern.mult, 9);
    const withoutCistern = production(g, board([0, 'mill'], [a, 'spring']), m).perTile[0];
    const withCistern = production(g, board([0, 'mill'], [a, 'spring'], [b, 'cistern']), m).perTile[0];
    expect(withoutCistern).toBeCloseTo(M * (1 + springShare(1) * config.tiles.mill.perSpring), 9);
    expect(withCistern).toBeCloseTo(withoutCistern, 9);
  });

  it('a Scriptorium counts distinct neighbour kinds (not other Scriptoria) and is boosted by a Beacon', () => {
    const tiles = board([0, 'scriptorium'], [a, 'spring'], [b, 'mill'], [c, 'beacon'], [d, 'scriptorium']);
    const out = config.tiles.scriptorium.out;
    expect(production(g, tiles, m).perTile[0]).toBeCloseTo(out * 3 * m.beacon, 9);
    expect(production(g, board([0, 'scriptorium']), m).perTile[0]).toBe(0);
  });
  it('a neighbouring Beacon multiplies; a Beacon reached only through a Bridge adds, so two relayed Beacons give 1 + 2*bonus', () => {
    expect(production(g, board([0, 'mill'], [a, 'beacon']), m).perTile[0]).toBeCloseTo(M * m.beacon, 9);
    const [p, q] = g.neighbours[a].filter((x) => x !== 0 && !g.neighbours[0].includes(x));
    const one = production(g, board([0, 'mill'], [a, 'bridge'], [p, 'beacon']), m).perTile[0];
    expect(one).toBeCloseTo(M * m.beacon, 9);
    const two = production(g, board([0, 'mill'], [a, 'bridge'], [p, 'beacon'], [q, 'beacon']), m).perTile[0];
    expect(two).toBeCloseTo(M * (1 + 2 * (m.beacon - 1)), 9);
    expect(two).toBeLessThan(M * m.beacon ** 2);
  });

  it('a Scriptorium ignores Beacons reached only through a Bridge', () => {
    const [p] = g.neighbours[a].filter((x) => x !== 0 && !g.neighbours[0].includes(x));
    const out = production(g, board([0, 'scriptorium'], [a, 'bridge'], [p, 'beacon']), m).perTile[0];
    expect(out).toBeCloseTo(config.tiles.scriptorium.out * 1, 9);
  });

  it('Deep Wells level 1 lowers strain, so a Spring feeding 4 Mills keeps more share', () => {
    const s = initialState();
    s.chartUpg.cheapSprings = 1;
    const deep = mods(s);
    expect(deep.strain).toBeCloseTo(config.tiles.spring.strain * config.tiles.spring.deepWells, 12);
    const tiles = board([0, 'spring'], [a, 'mill'], [b, 'mill'], [c, 'mill'], [d, 'mill']);
    const base = production(g, tiles, m).share[0];
    const better = production(g, tiles, deep).share[0];
    expect(base).toBeCloseTo(springShare(4), 12);
    expect(better).toBeGreaterThan(base);
    expect(better).toBeCloseTo(springShare(4, deep.strain), 12);
  });
});

describe('save', () => {
  const played = () => {
    const s = initialState();
    s.ink = new Decimal('1.5e7');
    s.runInk = new Decimal('3e7');
    s.tiles[0] = 'mill';
    s.tiles[1] = 'spring';
    s.pinned = [0];
    s.chartUpg.global = 2;
    return s;
  };
  it('export -> reset -> import round-trips', () => {
    const s = played();
    const str = exportString(makeSave(s, 1000));
    const r = importSave(str);
    expect(r.ok).toBe(true);
    if (r.ok) expect(makeSave(r.state, 1000)).toEqual(makeSave(s, 1000));
    const j = importSave(toJson(makeSave(s, 1000)));
    expect(j.ok).toBe(true);
  });
  it('rejects tampered and garbage input', () => {
    const f = makeSave(played(), 1000);
    (f.state as { ink: string }).ink = '1e100';
    const r = importSave(toJson(f));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Checksum/);
    expect(importSave('not a save').ok).toBe(false);
    expect(importSave(exportString(makeSave(played(), 1)).slice(0, 40)).ok).toBe(false);
  });
});

describe('offline + prestige', () => {
  it('1h offline equals rate * 3600 * eff', () => {
    const s = initialState();
    s.tiles[0] = 'mill';
    for (const n of GRAPHS.square.neighbours[0]) s.tiles[n] = 'spring';
    const before = s.ink;
    const rate = config.tiles.mill.out * 5 + 4 * config.tiles.spring.out;
    const expected = rate * 3600 * config.offline.baseEff;
    const r = applyOffline(s, 3600);
    expect(r.ink.toNumber()).toBeCloseTo(expected, 6);
    expect(s.ink.sub(before).toNumber()).toBeCloseTo(expected, 6);
  });
  it('drift keeps pins, projection switches geometry', () => {
    const s = initialState();
    s.tiles[0] = 'mill';
    s.tiles[1] = 'spring';
    s.pinned = [0];
    s.runInk = new Decimal(config.drift.divisor * 4);
    expect(drift(s).toNumber()).toBe(2);
    expect(s.tiles.filter(Boolean)).toEqual(['mill']);
    s.cycleCharts = new Decimal(32);
    expect(project(s).toNumber()).toBe(5);
    expect(s.geometry).toBe('hyper');
    expect(s.tiles).toHaveLength(GRAPHS.hyper.ring.length);
    expect(s.tiles[0]).toBe('mill'); // first Projection keeps pins
  });
});
