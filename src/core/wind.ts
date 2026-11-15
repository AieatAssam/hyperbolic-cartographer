import { config } from './config';

export type WindKind = 'trade' | 'gale' | 'monsoon';

/** Trade Wind timer: `left` seconds of catchable wind remain (0 = none); `at` counts down to the next wind; `kind` is the wind up (or last caught). */
export interface WindTimer {
  left: number;
  at: number;
  kind: WindKind;
}

export type Rand = () => number;

export const windGap = (rand: Rand = Math.random) =>
  config.wind.minGap + rand() * (config.wind.maxGap - config.wind.minGap);

/** Pick a wind kind by weight, using one rand() call. */
export function pickWindKind(rand: Rand = Math.random): WindKind {
  const kinds = Object.keys(config.wind.kinds) as WindKind[];
  const total = kinds.reduce((sum, k) => sum + config.wind.kinds[k].weight, 0);
  let r = rand() * total;
  for (const k of kinds) {
    r -= config.wind.kinds[k].weight;
    if (r < 0) return k;
  }
  return kinds[kinds.length - 1];
}

export const newWindTimer = (rand: Rand = Math.random): WindTimer => ({ left: 0, at: windGap(rand), kind: 'trade' });

/** Advance a Trade Wind timer by dt simulated seconds. */
export function tickWindTimer(w: WindTimer, dt: number, rand: Rand = Math.random): void {
  if (w.left > 0) {
    w.left = Math.max(0, w.left - dt);
    if (w.left === 0) w.at = windGap(rand);
  } else if ((w.at -= dt) <= 0) {
    w.left = config.wind.life;
    w.kind = pickWindKind(rand);
  }
}

/** Catch the wind if one is up; schedules the next. Returns the kind caught, or null when none is catchable. */
export function takeWind(w: WindTimer, rand: Rand = Math.random): WindKind | null {
  if (w.left <= 0) return null;
  w.left = 0;
  w.at = windGap(rand);
  return w.kind;
}
