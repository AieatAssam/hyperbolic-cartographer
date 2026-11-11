import { expect, it } from 'vitest';
import { playGreedy } from '../src/core/greedy-bot';

it.runIf(process.env.PACING)('pacing: Drift available < 15 min, taken < 30 min, Projection < 90 min', () => {
  const { log, s } = playGreedy(120);
  console.log(JSON.stringify({ ...log, drifts: s.drifts, ring: s.ring, geometry: s.geometry }));
  expect(log.firstDriftReady).toBeLessThan(15); // a player can Drift
  expect(log.firstDrift).toBeLessThan(30); // the bot waits for its Charts/s peak, so it drifts later

  expect(log.projection).toBeLessThan(90);
}, 900_000);
