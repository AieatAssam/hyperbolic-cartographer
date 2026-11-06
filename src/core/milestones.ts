import type { GameState } from './state';

export interface Milestone {
  id: string;
  name: string;
  desc: string;
  req: (s: GameState) => boolean;
}

export const MILESTONES: Milestone[] = [
  { id: 'keepSurvey', name: '1 Drift', desc: 'Drift keeps your first Survey.', req: (s) => s.drifts >= 1 },
  { id: 'headStart', name: '2 Drifts', desc: 'Start each run with 100 Ink.', req: (s) => s.drifts >= 2 },
  { id: 'autoSurvey', name: '3 Drifts', desc: 'Auto-Survey when affordable.', req: (s) => s.drifts >= 3 },
  { id: 'autoSprings', name: '5 Drifts', desc: 'Auto-place Springs into empty cells.', req: (s) => s.drifts >= 5 },
  { id: 'autoDrift', name: '10 Drifts', desc: 'Auto-Drift at a Chart threshold.', req: (s) => s.drifts >= 10 },
  { id: 'pinsAcross', name: '1 Projection', desc: 'Pinned tiles survive Projection.', req: (s) => s.projections >= 1 },
  { id: 'doubleCharts', name: '1 Projection', desc: 'x2 Charts on Drift.', req: (s) => s.projections >= 1 },
  { id: 'brightBeacons', name: '2 Projections', desc: 'Beacons +0.25x.', req: (s) => s.projections >= 2 },
];

export const has = (s: GameState, id: string) => MILESTONES.find((m) => m.id === id)!.req(s);
