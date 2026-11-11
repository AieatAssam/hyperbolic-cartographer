import { expect, it } from 'vitest';
import { playGreedy } from '../src/core/greedy-bot';

it.runIf(process.env.PACING)('pacing: Drift < 15 min, Projection < 90 min', () => {
  const { log, s } = playGreedy(120);
  console.log(JSON.stringify({ ...log, drifts: s.drifts, ring: s.ring, geometry: s.geometry }));
  expect(log.firstDrift).toBeLessThan(15);
  expect(log.projection).toBeLessThan(90);
}, 900_000);
