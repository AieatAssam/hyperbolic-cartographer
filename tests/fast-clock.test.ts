import { expect, it } from 'vitest';
import Decimal from 'break_eternity.js';
import { config } from '../src/core/config';
import { initialState, type GameState } from '../src/core/state';
import { isActive, place, prod } from '../src/core/economy';
import { fastForward } from '../src/core/tick';
import { newWindTimer, takeWind, tickWindTimer, type WindTimer } from '../src/core/wind';

/** A small fixed opening: one spring on the first active cell, some ink to spend. */
function opening(): GameState {
  const s = initialState();
  s.ink = new Decimal(500);
  const i = s.tiles.findIndex((_, k) => isActive(s, k));
  place(s, i, 'spring');
  return s;
}

const fingerprint = (s: GameState) => JSON.stringify({ ink: s.ink.toString(), run: s.runTime, tiles: s.tiles, surge: s.surge });

it('fastForward is deterministic and chunk-independent', () => {
  const a = fastForward(opening(), 300);
  const b = fastForward(opening(), 300);
  expect(fingerprint(a)).toBe(fingerprint(b));

  const c = opening();
  fastForward(c, 100);
  fastForward(c, 200);
  expect(fingerprint(c)).toBe(fingerprint(a));
});

it('fastForward pays the live rate in full (no offline efficiency factor)', () => {
  const s = opening();
  const rate = prod(s).total;
  const before = s.lifetimeInk.toNumber();
  fastForward(s, 60);
  expect(s.runTime).toBeCloseTo(60, 6);
  expect(s.lifetimeInk.toNumber() - before).toBeCloseTo(rate * 60, 3);
});

it('Trade Winds come up on the simulated clock after the configured minimum gap', () => {
  const rand = () => 0; // every gap is exactly config.wind.minGap
  const w: WindTimer = newWindTimer(rand);
  const s = opening();
  fastForward(s, config.wind.minGap - 1, () => tickWindTimer(w, 0.1, rand));
  expect(w.left).toBe(0);
  fastForward(s, 2, () => tickWindTimer(w, 0.1, rand));
  expect(w.left).toBeGreaterThan(0);
  expect(w.left).toBeLessThanOrEqual(config.wind.life);
});

it('a caught wind is gone and the next one is scheduled after the gap', () => {
  const rand = () => 0;
  const w = newWindTimer(rand);
  for (let k = 0; k < Math.ceil(config.wind.minGap * 10) + 5; k++) tickWindTimer(w, 0.1, rand);
  expect(w.left).toBeGreaterThan(0);
  expect(takeWind(w, rand)).toBe('trade');
  expect(w.left).toBe(0);
  expect(takeWind(w, rand)).toBe(null);
});

it('the wind schedule (times and kinds) is deterministic for a seed and independent of chunking', () => {
  // A small seeded LCG, so the same seed always gives the same winds.
  const seeded = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const schedule = (chunks: number[]) => {
    const rand = seeded(7);
    const w = newWindTimer(rand);
    const s = opening();
    const winds: string[] = [];
    let was = 0;
    const onStep = () => {
      tickWindTimer(w, 0.1, rand);
      if (w.left > 0 && was === 0) winds.push(`${w.kind}@${s.runTime.toFixed(1)}`);
      was = w.left;
    };
    for (const c of chunks) fastForward(s, c, onStep);
    return winds;
  };
  const whole = schedule([600]);
  expect(whole.length).toBeGreaterThan(3);
  expect(schedule([100, 200, 300])).toEqual(whole);
  expect(schedule([600])).toEqual(whole);
});
