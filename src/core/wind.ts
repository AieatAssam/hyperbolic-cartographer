import { config } from './config';

/** Trade Wind timer: `left` seconds of catchable wind remain (0 = none); `at` counts down to the next wind. */
export interface WindTimer {
  left: number;
  at: number;
}

export type Rand = () => number;

export const windGap = (rand: Rand = Math.random) =>
  config.wind.minGap + rand() * (config.wind.maxGap - config.wind.minGap);

export const newWindTimer = (rand: Rand = Math.random): WindTimer => ({ left: 0, at: windGap(rand) });

/** Advance a Trade Wind timer by dt simulated seconds. */
export function tickWindTimer(w: WindTimer, dt: number, rand: Rand = Math.random): void {
  if (w.left > 0) {
    w.left = Math.max(0, w.left - dt);
    if (w.left === 0) w.at = windGap(rand);
  } else if ((w.at -= dt) <= 0) {
    w.left = config.wind.life;
  }
}

/** Catch the wind if one is up; schedules the next. Returns false when none is catchable. */
export function takeWind(w: WindTimer, rand: Rand = Math.random): boolean {
  if (w.left <= 0) return false;
  w.left = 0;
  w.at = windGap(rand);
  return true;
}
