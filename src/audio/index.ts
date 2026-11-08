import type { GameState, SurfacePreview } from '../core/state';
import { TILE_TYPES, type TileType } from '../core/tiles';
import { Cues, type CueName } from './cues';
import { AudioEngine } from './engine';
import type { Track } from './manifest';
import { parseAudioSettings, serializeAudioSettings, type AudioSettings } from './settings';
import { isMusicStage, musicStage, type MusicStage } from './stage';

/** What the audio layer reads from the game. It only observes; it never changes game state. */
export interface AudioHost {
  state(): GameState;
  /** tiles on the board being shown (the Manifold preview has its own) */
  tiles(): readonly (TileType | null)[];
  surface(): SurfacePreview;
  /** the prestige transition playing, if any */
  transition(): 'drift' | 'projection' | null;
  tool: { current: string };
  load(): string | null;
  save(v: string): void;
}

export interface AudioApi {
  settings(): AudioSettings;
  set(patch: Partial<AudioSettings>): void;
  stage(): MusicStage;
  nowPlaying(): Track | null;
  /** false when this browser can play neither WebM/Opus nor AAC */
  supported(): boolean;
  cue(name: CueName): void;
  /** Ink motes reaching the counter (subtle, heavily rate-limited). */
  inkTick(): void;
  /** Calls f whenever settings or the playing track change. Returns an unsubscribe. */
  subscribe(f: () => void): () => void;
}

/** localStorage key for the Sound settings (kept apart from the game save). */
export const AUDIO_KEY = 'hc-audio';

let active: AudioApi | null = null;
/** For call sites that cannot reach the API object (ui/chime.ts). No-op before initAudio. */
export const audioCue = (name: CueName) => active?.cue(name);

const isTile = (t: string): t is TileType => (TILE_TYPES as readonly string[]).includes(t);
const upgradeLevels = (s: GameState) =>
  Object.values(s.chartUpg).reduce((a, b) => a + b, 0) + Object.values(s.curvUpg).reduce((a, b) => a + b, 0);

export function initAudio(host: AudioHost): AudioApi {
  let settings = parseAudioSettings(host.load());
  const params = new URLSearchParams(location.search);
  /** Layout QA (?qa): settings UI only — no AudioContext, media elements, or decode work in headless runs. */
  if (params.has('qa')) {
    const subs = new Set<() => void>();
    const notify = () => subs.forEach((f) => f());
    const musicParam = params.get('music');
    let forced: MusicStage | null = isMusicStage(musicParam) ? musicParam : null;
    const stageNow = () => forced ?? musicStage(host.state(), host.surface());
    const api: AudioApi = {
      settings: () => settings,
      set(patch) {
        settings = { ...settings, ...patch };
        host.save(serializeAudioSettings(settings));
        notify();
      },
      stage: stageNow,
      nowPlaying: () => null,
      supported: () => true,
      cue: () => {},
      inkTick: () => {},
      subscribe(f) {
        subs.add(f);
        return () => subs.delete(f);
      },
    };
    active = api;
    return api;
  }

  const engine = new AudioEngine(settings);
  const cues = new Cues(engine);
  const subs = new Set<() => void>();
  const notify = () => subs.forEach((f) => f());
  engine.onTrack = notify;

  const musicParam = params.get('music');
  let forced: MusicStage | null = isMusicStage(musicParam) ? musicParam : null;
  const stageNow = () => forced ?? musicStage(host.state(), host.surface());

  // First gesture creates the audio graph (autoplay rules); later gestures resume it after iOS interruptions.
  const onGesture = () => {
    if (!engine.running) engine.unlock();
  };
  for (const type of ['pointerdown', 'touchend', 'keydown', 'click']) {
    window.addEventListener(type, onGesture, { capture: true, passive: true });
  }
  document.addEventListener('visibilitychange', () => engine.setHidden(document.hidden));
  document.addEventListener(
    'click',
    (e) => {
      const b = (e.target as Element | null)?.closest?.('button, summary');
      if (b && !b.matches('button.tool') && !b.closest('[data-audio-silent]')) cues.cue('click');
    },
    true,
  );

  // Observer: diffs what the player can see ten times a second, so manual taps and automation sound alike.
  let prev = { state: host.state(), tiles: host.tiles().slice(), ring: 0, upg: 0, pins: 0, surface: host.surface(), trans: host.transition(), tool: host.tool.current };
  const resync = () => {
    const s = host.state();
    prev = { state: s, tiles: host.tiles().slice(), ring: s.ring, upg: upgradeLevels(s), pins: s.pinned.length, surface: host.surface(), trans: host.transition(), tool: host.tool.current };
  };
  resync();
  engine.setStage(stageNow());
  setInterval(() => {
    const s = host.state();
    const tiles = host.tiles();
    const surface = host.surface();
    const trans = host.transition();
    if (trans !== prev.trans) {
      if (trans) cues.cue(trans);
      engine.duck(!!trans);
    }
    if (surface !== prev.surface) cues.cue(surface === 'off' ? 'surface-out' : 'surface-in');
    if (host.tool.current !== prev.tool) {
      if (isTile(host.tool.current)) cues.select(host.tool.current);
      else cues.cue('click');
    }
    const sameBoard = s === prev.state && tiles.length === prev.tiles.length && surface === prev.surface;
    if (sameBoard && !trans) {
      let placed = 0;
      for (let i = 0; i < tiles.length; i++) {
        const a = prev.tiles[i];
        const b = tiles[i];
        if (a === b) continue;
        if (b && placed++ < 3) cues.place(b);
        else if (!b && a) cues.cue('sell');
      }
      if (s.ring > prev.ring) cues.cue('survey');
      if (upgradeLevels(s) > prev.upg) cues.cue('upgrade');
      if (s.pinned.length !== prev.pins) cues.cue('pin');
    }
    resync();
    engine.setStage(stageNow());
  }, 100);

  const api: AudioApi = {
    settings: () => settings,
    set(patch) {
      settings = { ...settings, ...patch };
      engine.setSettings(settings);
      host.save(serializeAudioSettings(settings));
      notify();
    },
    stage: stageNow,
    nowPlaying: () => engine.current,
    supported: () => engine.ext !== null,
    cue: (name) => cues.cue(name),
    inkTick: () => cues.cue('ink'),
    subscribe(f) {
      subs.add(f);
      return () => subs.delete(f);
    },
  };
  active = api;

  if (params.has('dev')) {
    (window as unknown as { hcAudio: unknown }).hcAudio = {
      api,
      engine,
      cues,
      /** null returns to the stage the game is in */
      forceStage: (st: MusicStage | null) => (forced = st),
      place: (t: TileType) => cues.place(t),
      select: (t: TileType) => cues.select(t),
      stream: () => engine.stream(),
    };
  }
  return api;
}
