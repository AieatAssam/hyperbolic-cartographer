/** Major pentatonic steps. Node sounds use only these, transposed to the playing track's key, so they never clash with it. */
export const PENTATONIC = [0, 2, 4, 7, 9] as const;

/** Wraps a semitone interval into [-6, 5]: the nearest octave placement. */
export const nearest = (semis: number) => ((((semis + 6) % 12) + 12) % 12) - 6;

/** Absolute MIDI note for `offset` semitones above the key's root, placed in the octave nearest `centre`. */
export const tuned = (root: number, offset: number, centre: number) => centre + nearest(root - centre) + offset;

/** Pentatonic degree d (any integer; wraps into higher or lower octaves) as semitones above the root. */
export const degree = (d: number) => {
  const n = PENTATONIC.length;
  return PENTATONIC[((d % n) + n) % n] + 12 * Math.floor(d / n);
};

export const playbackRate = (semis: number) => 2 ** (semis / 12);

/** Picks the sample closest in pitch to `target`, so the playback-rate shift (and its timbre change) stays small. */
export function closest<T extends { midi: number }>(samples: readonly T[], target: number): { sample: T; shift: number } {
  let best = samples[0];
  for (const s of samples) if (Math.abs(target - s.midi) < Math.abs(target - best.midi)) best = s;
  return { sample: best, shift: target - best.midi };
}
