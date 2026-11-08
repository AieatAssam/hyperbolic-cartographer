import type { TileType } from '../core/tiles';
import type { AudioEngine } from './engine';
import { SFX_ASSETS } from './manifest';
import { closest, degree, nearest, tuned } from './scale';

/** An instrument: pitched samples plus the octave its notes are centred on, and its mix level. */
interface Family {
  samples: { id: string; midi: number }[];
  centre: number;
  gain: number;
}
const fam = (centre: number, gain: number, ...ids: string[]): Family => ({
  centre,
  gain,
  samples: ids.map((id) => ({ id, midi: SFX_ASSETS.find((a) => a.id === id)!.midi! })),
});

const HARP = fam(74, 0.5, 'harp-c', 'harp-g');
const MARIMBA = fam(62, 0.55, 'marimba-c', 'marimba-g');
const MARIMBA_LOW = fam(45, 0.45, 'marimba-low');
const GLOCK = fam(84, 0.32, 'glock-c', 'glock-g');
const PIZZ = fam(64, 0.55, 'pizz-c', 'pizz-g');
const PIANO = fam(50, 0.6, 'piano-low');
const XYLO = fam(84, 0.3, 'xylo');
const BASS = fam(36, 0.7, 'bass-pizz');

/** Every tile has its own instrument and figure (semitones above the key's root, delay in seconds). */
const NODE: Record<TileType, { fam: Family; figure: [number, number][] }> = {
  spring: { fam: HARP, figure: [] }, // a wandering pentatonic melody, see springNote
  mill: { fam: MARIMBA, figure: [[0, 0], [7, 0.085]] }, // a turning wheel: root, fifth
  beacon: { fam: GLOCK, figure: [[7, 0], [19, 0.05]] }, // a bright bell with a high shimmer
  bridge: { fam: PIZZ, figure: [[0, 0], [7, 0.05], [12, 0.1]] }, // a span: root, fifth, octave
  vault: { fam: PIANO, figure: [[0, 0], [7, 0.02]] }, // a low, warm open fifth
};

export type CueName =
  | 'click' | 'toggle' | 'error' | 'sell' | 'pin' | 'survey' | 'upgrade' | 'constellation' | 'link' | 'ink'
  | 'drift' | 'projection' | 'surface-in' | 'surface-out' | 'preview-sfx';

const now = () => performance.now();

/** Maps game events to tuned notes. Rate limits keep automation bursts and Ink ticks from becoming noise. */
export class Cues {
  private last = new Map<string, number>();
  private walk = 2;
  private placeTimes: number[] = [];

  constructor(private e: AudioEngine) {}

  /** True when `key` has not fired within `ms`; records the firing. */
  private gate(key: string, ms: number) {
    const t = now();
    if (t - (this.last.get(key) ?? -1e9) < ms) return false;
    this.last.set(key, t);
    return true;
  }

  private note(f: Family, semis: number, o: { at?: number; gain?: number; cut?: number; pan?: number } = {}) {
    const target = tuned(this.e.root, semis, f.centre);
    const { sample, shift } = closest(f.samples, target);
    this.e.play(sample.id, { semis: shift, gain: f.gain * (o.gain ?? 1), at: o.at, cut: o.cut, pan: o.pan });
  }

  private springNote(gain: number, cut?: number) {
    const step = [-2, -1, 1, 2][Math.floor(Math.random() * 4)];
    this.walk = Math.max(-2, Math.min(6, this.walk + step));
    this.note(HARP, degree(this.walk), { gain, cut, pan: (Math.random() - 0.5) * 0.3 });
  }

  /** At most 5 placement sounds per second, so Blueprint-style bursts stay musical. */
  place(t: TileType) {
    const ms = now();
    this.placeTimes = this.placeTimes.filter((x) => ms - x < 1000);
    if (this.placeTimes.length >= 5 || !this.gate(`place-${t}`, 90)) return;
    this.placeTimes.push(ms);
    if (t === 'spring') return this.springNote(1);
    const n = NODE[t];
    for (const [s, at] of n.figure) this.note(n.fam, s, { at });
  }

  /** Choosing a tool: the tile's first note, softer and shorter than placing it. */
  select(t: TileType) {
    if (!this.gate('select', 60)) return;
    if (t === 'spring') return this.springNote(0.5, 0.35);
    const [s] = NODE[t].figure[0];
    this.note(NODE[t].fam, s, { gain: 0.5, cut: 0.35 });
  }

  cue(name: CueName) {
    const e = this.e;
    switch (name) {
      case 'click':
        if (this.gate('click', 50)) e.play('click', { gain: 0.35 });
        return;
      case 'toggle':
        if (this.gate('toggle', 50)) e.play('toggle', { gain: 0.45 });
        return;
      case 'error':
        if (!this.gate('error', 300)) return;
        this.note(BASS, 2, { cut: 0.22 });
        this.note(BASS, 0, { at: 0.13, cut: 0.3 });
        return;
      case 'sell':
        if (!this.gate('sell', 120)) return;
        this.note(MARIMBA_LOW, 7);
        this.note(MARIMBA_LOW, 0, { at: 0.1 });
        return;
      case 'pin':
        if (this.gate('pin', 120)) this.note(XYLO, 12, { cut: 0.4 });
        return;
      case 'survey':
        if (!this.gate('survey', 400)) return;
        [0, 4, 7, 12].forEach((s, i) => this.note(HARP, s, { at: i * 0.06, gain: 0.7 }));
        e.play('triangle', { gain: 0.18 });
        return;
      case 'upgrade':
        if (!this.gate('upgrade', 250)) return;
        this.note(MARIMBA, 0);
        this.note(MARIMBA, 7, { at: 0.08 });
        this.note(GLOCK, 12, { at: 0.16, gain: 0.9 });
        return;
      case 'constellation':
        if (!this.gate('constellation', 500)) return;
        [0, 4, 7, 12, 16].forEach((s, i) => this.note(HARP, s, { at: 0.12 + i * 0.07, gain: 0.8 }));
        e.play('glock-gliss', { semis: nearest(e.root - 6), gain: 0.3, at: 0.18 }); // the gliss is in F# pentatonic
        return;
      case 'link':
        if (!this.gate('link', 200)) return;
        this.note(GLOCK, 7, { gain: 0.7 });
        this.note(GLOCK, 12, { at: 0.07, gain: 0.7 });
        return;
      case 'ink': {
        // one soft drop at most every 1.6 s, skipped right after other effects so it never crowds them
        const quiet = [...this.last.values()].every((t) => now() - t > 300);
        if (!quiet || Math.random() < 0.35 || !this.gate('ink', 1600)) return;
        const target = tuned(e.root, degree(Math.floor(Math.random() * 5)), 78);
        e.play('ink-drop', { semis: target - 78, gain: 0.12, pan: (Math.random() - 0.5) * 0.5 });
        return;
      }
      case 'drift':
        e.play('timpani-roll', { semis: nearest(e.root - 1), gain: 0.55 });
        e.play('bells-b', { gain: 0.22, at: 0.9 });
        return;
      case 'projection':
        e.play('gong', { gain: 0.5 });
        e.play('glock-gliss', { semis: nearest(e.root - 6), gain: 0.35, at: 0.35 });
        return;
      case 'surface-in':
        e.play('bells-a', { gain: 0.45 });
        [0, 7, 12].forEach((s, i) => this.note(HARP, s, { at: 0.3 + i * 0.09, gain: 0.55 }));
        return;
      case 'surface-out':
        e.play('bells-a', { gain: 0.25 });
        return;
      case 'preview-sfx':
        if (this.gate('preview', 120)) this.springNote(0.9);
        return;
    }
  }
}
