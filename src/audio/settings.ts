export interface AudioSettings {
  /** 0..1 slider positions */
  music: number;
  sfx: number;
  muted: boolean;
}

export const DEFAULT_AUDIO: AudioSettings = { music: 0.6, sfx: 0.7, muted: false };

const unit = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback);

/** Reads stored settings; anything missing or malformed falls back to the defaults. */
export function parseAudioSettings(raw: string | null): AudioSettings {
  if (!raw) return { ...DEFAULT_AUDIO };
  try {
    const o = JSON.parse(raw) as Partial<AudioSettings>;
    return {
      music: unit(o.music, DEFAULT_AUDIO.music),
      sfx: unit(o.sfx, DEFAULT_AUDIO.sfx),
      muted: typeof o.muted === 'boolean' ? o.muted : DEFAULT_AUDIO.muted,
    };
  } catch {
    return { ...DEFAULT_AUDIO };
  }
}

export const serializeAudioSettings = (s: AudioSettings) => JSON.stringify({ music: s.music, sfx: s.sfx, muted: s.muted });

/** Slider position to linear gain: squared, so the slider feels even across its range. */
export const sliderGain = (v: number) => v * v;
