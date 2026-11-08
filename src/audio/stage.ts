import type { Geometry, SurfacePreview } from '../core/state';

/** One playlist per stage of the design (Dimension and Horizon have music before they have gameplay). */
export const MUSIC_STAGES = ['survey', 'drift', 'projection', 'torus', 'klein', 'dimension', 'horizon'] as const;
export type MusicStage = (typeof MUSIC_STAGES)[number];

export const STAGE_LABEL: Record<MusicStage, string> = {
  survey: 'Survey',
  drift: 'Drift',
  projection: 'Projection',
  torus: 'Manifold (torus)',
  klein: 'Manifold (Klein bottle)',
  dimension: 'Dimension',
  horizon: 'Horizon',
};

export const isMusicStage = (v: unknown): v is MusicStage => MUSIC_STAGES.includes(v as MusicStage);

/** The stage whose music fits what is on screen: a Manifold preview wins, then the board geometry, then Drift history. */
export function musicStage(s: { geometry: Geometry; drifts: number }, surface: SurfacePreview): MusicStage {
  if (surface === 'torus' || surface === 'klein') return surface;
  if (s.geometry === 'hyper') return 'projection';
  return s.drifts > 0 ? 'drift' : 'survey';
}
