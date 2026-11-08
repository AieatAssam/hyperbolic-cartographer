import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LICENCES, PACKS, SFX_ASSETS, TRACKS, pickExt, tracksFor } from '../src/audio/manifest';
import { PENTATONIC, closest, degree, nearest, tuned } from '../src/audio/scale';
import { DEFAULT_AUDIO, parseAudioSettings, serializeAudioSettings } from '../src/audio/settings';
import { MUSIC_STAGES, musicStage } from '../src/audio/stage';

const ROOT = join(__dirname, '..');
const file = (kind: string, id: string, ext: string) => join(ROOT, 'public', 'audio', kind, `${id}.${ext}`);

describe('audio assets', () => {
  it('uses only CC0 and CC BY licences (no NC, ND or SA)', () => {
    expect(Object.keys(LICENCES).sort()).toEqual(['CC-BY-3.0', 'CC-BY-4.0', 'CC0']);
    for (const t of TRACKS) expect(LICENCES[t.licence], t.id).toBeDefined();
    for (const p of Object.values(PACKS)) expect(LICENCES[p.licence], p.title).toBeDefined();
  });

  it('gives every stage at least three tracks, each with title, author and source', () => {
    for (const st of MUSIC_STAGES) expect(tracksFor(st).length, st).toBeGreaterThanOrEqual(3);
    for (const t of TRACKS) {
      expect(t.title && t.author, t.id).toBeTruthy();
      expect(t.page, t.id).toMatch(/^https:\/\//);
      expect(t.root, t.id).toBeGreaterThanOrEqual(0);
      expect(t.root, t.id).toBeLessThan(12);
    }
    expect(new Set(TRACKS.map((t) => t.id)).size).toBe(TRACKS.length);
  });

  it('ships every file in both formats, within the size budget', () => {
    for (const t of TRACKS) {
      for (const ext of ['webm', 'm4a']) {
        const f = file('music', t.id, ext);
        expect(existsSync(f), f).toBe(true);
        expect(statSync(f).size, f).toBeLessThan(1.25 * 1024 * 1024);
      }
    }
    for (const s of SFX_ASSETS) {
      for (const ext of ['webm', 'm4a']) {
        const f = file('sfx', s.id, ext);
        expect(existsSync(f), f).toBe(true);
        expect(statSync(f).size, f).toBeLessThan(40 * 1024);
      }
    }
  });

  it('lists every asset in AUDIO-CREDITS.md and the README', () => {
    const credits = readFileSync(join(ROOT, 'AUDIO-CREDITS.md'), 'utf8');
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
    for (const t of TRACKS) {
      for (const doc of [credits, readme]) {
        expect(doc, t.id).toContain(t.title);
        expect(doc, t.id).toContain(t.page);
      }
      expect(credits).toContain(t.author);
    }
    for (const p of Object.values(PACKS)) {
      expect(credits).toContain(p.page);
      expect(readme).toContain(p.page);
    }
    for (const s of SFX_ASSETS) expect(credits).toContain(`sfx/${s.id}`);
  });

  it('prefers Opus and falls back to AAC', () => {
    expect(pickExt((m) => (m.includes('opus') ? 'probably' : 'maybe'))).toBe('webm');
    expect(pickExt((m) => (m.includes('mp4') ? 'maybe' : ''))).toBe('m4a');
    expect(pickExt(() => '')).toBeNull();
  });
});

describe('music stage', () => {
  const st = (geometry: 'square' | 'hyper', drifts: number) => ({ geometry, drifts });
  it('follows the board, Drift history and the Manifold preview', () => {
    expect(musicStage(st('square', 0), 'off')).toBe('survey');
    expect(musicStage(st('square', 3), 'off')).toBe('drift');
    expect(musicStage(st('hyper', 3), 'off')).toBe('projection');
    expect(musicStage(st('hyper', 3), 'torus')).toBe('torus');
    expect(musicStage(st('square', 0), 'klein')).toBe('klein');
  });
});

describe('tuning', () => {
  it('wraps intervals to the nearest octave', () => {
    expect(nearest(0)).toBe(0);
    expect(nearest(7)).toBe(-5);
    expect(nearest(-7)).toBe(5);
    expect(nearest(18)).toBe(-6);
    for (let i = -30; i < 30; i++) {
      expect(nearest(i)).toBeGreaterThanOrEqual(-6);
      expect(nearest(i)).toBeLessThanOrEqual(5);
      expect((((nearest(i) - i) % 12) + 12) % 12).toBe(0);
    }
  });

  it('places notes in the key, near the instrument centre', () => {
    for (let root = 0; root < 12; root++) {
      for (let d = -5; d < 10; d++) {
        const m = tuned(root, degree(d), 72);
        expect(PENTATONIC).toContain(((((m - root) % 12) + 12) % 12) as (typeof PENTATONIC)[number]);
      }
      expect(Math.abs(tuned(root, 0, 72) - 72)).toBeLessThanOrEqual(6);
    }
  });

  it('picks the nearest sample so pitch shifts stay small', () => {
    const samples = [{ id: 'c', midi: 72 }, { id: 'g', midi: 79 }];
    expect(closest(samples, 74)).toEqual({ sample: samples[0], shift: 2 });
    expect(closest(samples, 77)).toEqual({ sample: samples[1], shift: -2 });
  });

  it('has pitch data for every pitched effect', () => {
    for (const s of SFX_ASSETS) if (s.midi !== null) expect(s.midi, s.id).toBeGreaterThan(20);
  });
});

describe('audio settings', () => {
  it('round-trips and clamps', () => {
    const s = { music: 0.25, sfx: 1, muted: true };
    expect(parseAudioSettings(serializeAudioSettings(s))).toEqual(s);
    expect(parseAudioSettings('{"music":7,"sfx":-1,"muted":"yes"}')).toEqual({ music: 1, sfx: 0, muted: false });
  });

  it('falls back to defaults on missing or broken data', () => {
    expect(parseAudioSettings(null)).toEqual(DEFAULT_AUDIO);
    expect(parseAudioSettings('not json')).toEqual(DEFAULT_AUDIO);
  });
});
