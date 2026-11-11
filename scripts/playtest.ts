/**
 * Headless fast-clock playtest: the greedy bot plays MINUTES of game time (default 120) as fast as
 * the CPU allows, prints a timeline, and exits 1 when Drift or Projection is missing or late.
 *   npm run playtest            (MIN=60 npm run playtest for a shorter run)
 */
import { playGreedy } from '../src/core/greedy-bot';

const LIMITS = { driftReady: 15, firstDrift: 30, projection: 90 }; // minutes, same as the pacing test
const minutes = Number(process.env.MIN ?? 120);

/** Per-type tile counts, e.g. "sp 40 mi 12 be 3 br 0 va 0 lh 0 ci 0 sc 0". */
const mix = (st: { tiles: (string | null)[] }) => {
  const n = (t: string) => st.tiles.filter((x) => x === t).length;
  return `sp ${n('spring')} mi ${n('mill')} be ${n('beacon')} br ${n('bridge')} va ${n('vault')} lh ${n('lighthouse')} ci ${n('cistern')} sc ${n('scriptorium')}`;
};

const t0 = performance.now();
let peakHeap = process.memoryUsage().heapUsed;
const { log, s } = playGreedy(minutes, (st, sec) => {
  if (sec % 60 !== 59) return;
  const min = (sec + 1) / 60;
  if (sec % 1800 === 1799 || min === minutes) {
    peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
    console.log(
      `t=${String(min).padStart(5)} min  ring ${st.ring}  ${st.geometry.padEnd(6)} drifts ${st.drifts}  proj ${st.projections}  ` +
        `tiles ${st.tiles.filter(Boolean).length}  ink ${st.ink.toExponential(2)}  ${mix(st)}`,
    );
  }
});
peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
const wallSec = (performance.now() - t0) / 1000;

const fmt = (x: number | undefined) => (x === undefined ? 'never' : `${x.toFixed(1)} min`);
console.log(`\nmilestones: Drift available ${fmt(log.firstDriftReady)}, first Drift ${fmt(log.firstDrift)}, Projection ${fmt(log.projection)}, ring 4+ hyper ${fmt(log.hyperFull)}`);
console.log(`final: ring ${s.ring} ${s.geometry}, drifts ${s.drifts}, projections ${s.projections}, ${mix(s)}`);
console.log(`wall ${wallSec.toFixed(1)} s, peak heap ${(peakHeap / 1e6).toFixed(0)} MB`);

const failures: string[] = [];
// A run shorter than a limit cannot judge that milestone.
if (minutes >= LIMITS.driftReady && (log.firstDriftReady === undefined || log.firstDriftReady >= LIMITS.driftReady)) failures.push(`Drift not available before ${LIMITS.driftReady} min`);
if (minutes >= LIMITS.firstDrift && (log.firstDrift === undefined || log.firstDrift >= LIMITS.firstDrift)) failures.push(`Drift not taken before ${LIMITS.firstDrift} min`);
if (minutes >= LIMITS.projection && (log.projection === undefined || log.projection >= LIMITS.projection)) failures.push(`Projection not before ${LIMITS.projection} min`);
if (failures.length) {
  console.error(`FAIL: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('PASS');
