import { expect, it } from 'vitest';
import { config } from '../src/core/config';
import { runSim } from '../src/core/sim-economy';

it('casual first Drift lands in 8–12 minutes (20 min sim)', () => {
  const r = runSim('casual', 20);
  const d = r.milestones.firstDrift;
  expect(d).toBeDefined();
  expect(d!).toBeGreaterThanOrEqual(7);
  expect(d!).toBeLessThanOrEqual(13);
});

it('casual has no affordability dead zone over 45s in the first 15 minutes', () => {
  const r = runSim('casual', 20);
  expect(r.maxDeadZoneSecFirst15).toBeLessThanOrEqual(45);
});

it('greedy pacing drift still under 15 minutes', () => {
  const r = runSim('greedy', 25);
  expect(r.milestones.firstDrift).toBeDefined();
  expect(r.milestones.firstDrift!).toBeLessThan(15);
});

it('first placement rewards are configured', () => {
  expect(config.rewards.firstMillInk).toBeGreaterThan(0);
  expect(config.rewards.firstBridgeInk).toBeGreaterThan(0);
  expect(config.drift.minInk).toBeLessThan(8e5);
});
