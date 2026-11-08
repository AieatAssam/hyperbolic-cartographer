import { audioCue } from '../audio';

/** Board feedback from main.ts. Placements are voiced by the audio observer, so 'place' needs no extra cue. */
export function playChime(kind: 'constellation' | 'link' | 'place'): void {
  if (kind !== 'place') audioCue(kind);
}
