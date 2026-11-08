import assets from './assets.json';
import type { MusicStage } from './stage';

export type Licence = keyof typeof assets.licences;
export type PackId = keyof typeof assets.packs;

export interface Track {
  id: string;
  stage: MusicStage;
  title: string;
  author: string;
  licence: Licence;
  /** page the track was taken from */
  page: string;
  /** pitch class (0 = C) of the track's major key, or of the relative major for minor keys */
  root: number;
  /** short seamless loops: play this many seconds (looping) before moving on */
  loopSec?: number;
  maxSec?: number;
}

export interface SfxAsset {
  id: string;
  use: string;
  title: string;
  pack: PackId;
  path: string;
  /** MIDI note of the recorded pitch; null for unpitched sounds */
  midi: number | null;
  len: number;
}

export const TRACKS = assets.music as Track[];
export const SFX_ASSETS = assets.sfx as SfxAsset[];
export const PACKS = assets.packs as Record<PackId, { title: string; author: string; licence: Licence; page: string }>;
export const LICENCES = assets.licences as Record<Licence, { name: string; url: string }>;

export const tracksFor = (stage: MusicStage) => TRACKS.filter((t) => t.stage === stage);

export type AudioExt = 'webm' | 'm4a';

/** WebM/Opus where supported, else the AAC fallback (older Safari); null if neither plays. */
export function pickExt(canPlay: (mime: string) => string): AudioExt | null {
  if (canPlay('audio/webm; codecs="opus"')) return 'webm';
  if (canPlay('audio/mp4; codecs="mp4a.40.2"')) return 'm4a';
  return null;
}

export const audioUrl = (kind: 'music' | 'sfx', id: string, ext: AudioExt) => `${import.meta.env.BASE_URL}audio/${kind}/${id}.${ext}`;
