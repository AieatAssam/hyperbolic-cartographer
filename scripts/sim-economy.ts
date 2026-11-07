#!/usr/bin/env node
/** Balance report: `npx tsx scripts/sim-economy.ts` */
import { runSim } from '../src/core/sim-economy.ts';

const minutes = Number(process.env.SIM_MIN ?? 30);
const label = process.env.SIM_LABEL ?? '';

for (const policy of ['casual', 'greedy'] as const) {
  const r = runSim(policy, minutes, { offlineAtMin: policy === 'casual' ? 5 : undefined });
  console.log(`\n=== ${label}${label ? ' ' : ''}${policy} (${minutes} min) ===`);
  console.log('Milestones (min):', JSON.stringify(r.milestones, null, 2));
  console.log('Max dead zone (s):', r.maxDeadZoneSec, 'peak Ink/s:', r.peakInkPerSec.toFixed(2));
  console.log('Dead zones >45s (first 8):', r.deadZones.filter((z) => z.durationSec > 45).slice(0, 8));
  console.log('Tiles:', r.tileCounts);
  if (r.offlineGain) console.log('Offline @5min (4h sim):', r.offlineGain);
  console.log('Ink/s curve:', r.samples.map((s) => `${s.tMin.toFixed(1)}:${s.inkPerSec.toFixed(1)}`).join(' '));
  console.log('Final:', r.final);
}
