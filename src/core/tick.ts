import Decimal from 'break_eternity.js';
import { config } from './config';
import { graphOf, type GameState } from './state';
import { isActive, offlineCapSec, offlineEff, place, prod, surgeMult, survey } from './economy';
import { chartsOnDrift, drift } from './prestige';
import { has } from './milestones';

export const autoSurveyOn = (s: GameState) => s.chartUpg.autoSurvey > 0 || has(s, 'autoSurvey');
export const autoSpringsOn = (s: GameState) => s.chartUpg.autoSprings > 0 || has(s, 'autoSprings');

/** Advance the simulation by dt seconds. Mutates and returns state. */
export function simulate(s: GameState, dt: number, eff = 1, offline = false): GameState {
  if (offline) s.surge = 0; // surges are a live-play reward
  const gain = new Decimal(prod(s).total * dt * eff * surgeMult(s));
  s.surge = Math.max(0, s.surge - dt);
  s.ink = s.ink.add(gain);
  s.runInk = s.runInk.add(gain);
  s.lifetimeInk = s.lifetimeInk.add(gain);
  s.runTime += dt;
  s.totalTime += dt;

  if (autoSurveyOn(s)) survey(s);
  // Board is static offline: auto-Springs only run live.
  if (!offline && autoSpringsOn(s) && (s.autoSpringTimer += dt) >= config.autoSpringInterval) {
    s.autoSpringTimer = 0;
    const empty = graphOf(s).ring.findIndex((_, i) => isActive(s, i) && !s.tiles[i]);
    if (empty >= 0) place(s, empty, 'spring');
  }
  if (has(s, 'autoDrift') && s.autoDrift.on && chartsOnDrift(s).gte(Math.max(1, s.autoDrift.at))) drift(s);
  return s;
}

/**
 * Advance `seconds` of simulated time in the same 0.1 s steps as live play, with live rules
 * (no offline penalty). `onStep(s, t)` runs after each step with t = simulated seconds so far.
 */
export function fastForward(s: GameState, seconds: number, onStep?: (s: GameState, t: number) => void): GameState {
  const steps = Math.round(seconds * config.tickRate);
  const dt = 1 / config.tickRate;
  for (let k = 1; k <= steps; k++) {
    simulate(s, dt);
    onStep?.(s, k * dt);
  }
  return s;
}

export interface OfflineReport {
  seconds: number;
  ink: Decimal;
  drifts: number;
  eff: number;
}

/** Offline progress: closed-form rate * dt * eff, in coarse steps so auto-Survey/auto-Drift still fire. */
export function applyOffline(s: GameState, seconds: number, step = 60): OfflineReport {
  const dt = Math.max(0, Math.min(seconds, offlineCapSec(s)));
  const eff = offlineEff(s);
  const ink0 = s.lifetimeInk;
  const d0 = s.drifts;
  for (let t = 0; t < dt; t += step) simulate(s, Math.min(step, dt - t), eff, true);
  return { seconds: dt, ink: s.lifetimeInk.sub(ink0), drifts: s.drifts - d0, eff };
}
