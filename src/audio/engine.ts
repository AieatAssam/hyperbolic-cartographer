import { SFX_ASSETS, audioUrl, pickExt, tracksFor, type AudioExt, type Track } from './manifest';
import { playbackRate } from './scale';
import { sliderGain, type AudioSettings } from './settings';
import type { MusicStage } from './stage';

/** Crossfade between tracks of one stage, and on a stage change (seconds). */
export const TRACK_FADE = 6;
export const STAGE_FADE = 4;
/** Master level while the tab is hidden, and music level under a prestige transition. */
const HIDDEN_LEVEL = 0.2;
const DUCK_LEVEL = 0.35;
const MAX_VOICES = 12;
const START_TIMEOUT_MS = 12000;
/** 8 ms of silence. Playing it inside a gesture unlocks a media element for later scripted play() on iOS. */
const SILENT_WAV =
  'data:audio/wav;base64,UklGRmQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YUAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA';

export interface PlayOpts {
  semis?: number;
  gain?: number;
  /** delay in seconds */
  at?: number;
  pan?: number;
  /** fade the voice out after this many seconds */
  cut?: number;
}

const ramp = (p: AudioParam, v: number, now: number, secs: number) => {
  p.cancelScheduledValues(now);
  p.setValueAtTime(p.value, now);
  p.linearRampToValueAtTime(v, now + Math.max(0.01, secs));
};

const withTimeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);

/** One streaming music player: a media element (lazy, progressive download) routed through its own gain. */
class Deck {
  readonly el = new Audio();
  readonly gain: GainNode;
  track: Track | null = null;
  startedAt = 0;
  advancing = false;
  /** bumped on every load and retire, so stale callbacks can tell the deck was reused */
  gen = 0;

  constructor(private ctx: AudioContext, out: AudioNode) {
    this.el.preload = 'none';
    this.el.setAttribute('playsinline', '');
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    ctx.createMediaElementSource(this.el).connect(this.gain).connect(out);
  }

  load(track: Track, url: string) {
    this.gen++;
    this.el.pause();
    ramp(this.gain.gain, 0, this.ctx.currentTime, 0.01);
    this.track = track;
    this.advancing = false;
    this.el.loop = !!track.loopSec;
    this.el.preload = 'auto';
    this.el.src = url;
  }

  fade(to: number, secs: number) {
    ramp(this.gain.gain, to, this.ctx.currentTime, secs);
  }

  /** Fades out, then pauses so the element stops downloading and decoding (unless it was reused meanwhile). */
  retire(secs: number) {
    const g = ++this.gen;
    this.fade(0, secs);
    setTimeout(() => g === this.gen && this.el.pause(), secs * 1000 + 100);
  }
}

export class AudioEngine {
  readonly ext: AudioExt | null;
  onTrack: ((t: Track | null) => void) | null = null;
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private decks: Deck[] = [];
  private cur = -1;
  private seq = 0;
  private buffers = new Map<string, AudioBuffer>();
  private voices = 0;
  private stage: MusicStage | null = null;
  private bags: Partial<Record<MusicStage, string[]>> = {};
  private last: Partial<Record<MusicStage, string>> = {};
  private hidden = false;
  private ducked = false;
  private starting = false;

  constructor(private settings: AudioSettings) {
    this.ext = typeof Audio === 'undefined' ? null : pickExt((m) => new Audio().canPlayType(m));
  }

  get running() {
    return this.ctx?.state === 'running';
  }
  get current(): Track | null {
    return this.decks[this.cur]?.track ?? null;
  }
  /** Key of the playing track (pitch class of its major root); C before any music starts. */
  get root() {
    return this.current?.root ?? 0;
  }
  get wantsMusic() {
    return !this.settings.muted && this.settings.music > 0;
  }

  /** Creates or resumes the audio graph. Must run synchronously inside a user-gesture handler (iOS Safari). */
  unlock() {
    if (!this.ext) return;
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC({ latencyHint: 'interactive' });
      } catch {
        return;
      }
      const c = this.ctx;
      this.master = c.createGain();
      this.musicBus = c.createGain();
      this.sfxBus = c.createGain();
      this.master.gain.value = 0;
      this.musicBus.connect(this.master);
      this.sfxBus.connect(this.master);
      this.master.connect(c.destination);
      this.decks = [new Deck(c, this.musicBus), new Deck(c, this.musicBus)];
      for (const d of this.decks) {
        d.el.src = SILENT_WAV;
        d.el.play().catch(() => {});
      }
      this.applyLevels(0.3);
      this.loadSfx();
      setInterval(() => this.tick(), 500);
    }
    const c = this.ctx;
    if (c.state !== 'running') c.resume().catch(() => {});
    const s = c.createBufferSource();
    s.buffer = c.createBuffer(1, 1, 22050);
    s.connect(c.destination);
    s.start();
    if (this.cur < 0 && !this.starting && this.stage && this.wantsMusic) void this.next(STAGE_FADE);
  }

  setStage(stage: MusicStage) {
    if (stage === this.stage) return;
    this.stage = stage;
    if (this.ctx && this.wantsMusic) void this.next(STAGE_FADE);
  }

  setSettings(s: AudioSettings) {
    const wanted = this.wantsMusic;
    this.settings = s;
    this.applyLevels(0.15);
    if (wanted === this.wantsMusic || !this.ctx) return;
    const d = this.decks[this.cur];
    if (!this.wantsMusic) d?.retire(0.3);
    else if (d?.track) {
      d.el.play().catch(() => {});
      d.fade(1, 0.5);
    } else if (this.stage) void this.next(STAGE_FADE);
  }

  setHidden(hidden: boolean) {
    this.hidden = hidden;
    this.applyLevels(hidden ? 1.5 : 0.8);
  }

  /** Lowers the music under a prestige transition so the stage change never cuts in at full volume. */
  duck(on: boolean) {
    this.ducked = on;
    this.applyLevels(on ? 0.8 : 3);
  }

  /** Plays one decoded effect. Silently skipped before unlock, while loading, when muted, or past the voice cap. */
  play(id: string, o: PlayOpts = {}) {
    const c = this.ctx;
    const buf = this.buffers.get(id);
    if (!c || !buf || c.state !== 'running' || this.settings.muted || this.settings.sfx <= 0 || this.voices >= MAX_VOICES) return;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = playbackRate(o.semis ?? 0);
    const g = c.createGain();
    const t = c.currentTime + (o.at ?? 0);
    g.gain.setValueAtTime(o.gain ?? 1, t);
    if (o.cut) g.gain.setTargetAtTime(0, t + o.cut, 0.04);
    src.connect(g);
    let out: AudioNode = g;
    if (o.pan && c.createStereoPanner) {
      const p = c.createStereoPanner();
      p.pan.value = o.pan;
      out = g.connect(p);
    }
    out.connect(this.sfxBus);
    this.voices++;
    src.onended = () => {
      this.voices--;
      out.disconnect();
    };
    src.start(t);
    if (o.cut) src.stop(t + o.cut + 0.3);
  }

  /** Dev capture: a live stream of the final mix. */
  stream(): MediaStream | null {
    if (!this.ctx) return null;
    const d = this.ctx.createMediaStreamDestination();
    this.master.connect(d);
    return d.stream;
  }

  private applyLevels(secs: number) {
    const c = this.ctx;
    if (!c) return;
    const now = c.currentTime;
    const s = this.settings;
    ramp(this.master.gain, s.muted ? 0 : this.hidden ? HIDDEN_LEVEL : 1, now, secs);
    ramp(this.musicBus.gain, sliderGain(s.music) * (this.ducked ? DUCK_LEVEL : 1), now, secs);
    ramp(this.sfxBus.gain, sliderGain(s.sfx), now, secs);
  }

  private loadSfx() {
    const c = this.ctx!;
    for (const a of SFX_ASSETS) {
      fetch(audioUrl('sfx', a.id, this.ext!))
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((b) => c.decodeAudioData(b))
        .then((buf) => this.buffers.set(a.id, buf))
        .catch(() => {});
    }
  }

  /** Shuffled bag per stage, so every track plays before any repeats and the same one never plays twice running. */
  private pick(stage: MusicStage): Track | null {
    const list = tracksFor(stage);
    if (!list.length) return null;
    let bag = this.bags[stage];
    if (!bag?.length) {
      bag = list.map((t) => t.id);
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
      if (bag.length > 1 && bag[0] === this.last[stage]) bag.push(bag.shift()!);
      this.bags[stage] = bag;
    }
    const id = bag.shift()!;
    this.last[stage] = id;
    return list.find((t) => t.id === id)!;
  }

  /** Starts the next track for the current stage on the idle deck and crossfades once it is actually playing. */
  private async next(fade: number) {
    if (!this.ctx || !this.ext || !this.stage) return;
    const track = this.pick(this.stage);
    if (!track) return;
    const token = ++this.seq;
    const idx = this.cur === 0 ? 1 : 0;
    const deck = this.decks[idx];
    deck.load(track, audioUrl('music', track.id, this.ext));
    const gen = deck.gen;
    const drop = () => deck.gen === gen && deck.retire(0.1);
    this.starting = true;
    try {
      await withTimeout(deck.el.play(), START_TIMEOUT_MS);
    } catch {
      if (token === this.seq) this.starting = false;
      drop();
      if (token === this.seq && this.decks[this.cur]) this.decks[this.cur].advancing = false; // tick() retries later
      return;
    }
    if (token !== this.seq) return void drop();
    this.starting = false;
    if (!this.wantsMusic) return void drop();
    const old = this.decks[this.cur];
    this.cur = idx;
    deck.startedAt = this.ctx.currentTime;
    deck.fade(1, fade);
    old?.retire(fade);
    this.onTrack?.(track);
  }

  private tick() {
    const d = this.decks[this.cur];
    if (!this.ctx || !d?.track || d.advancing || !this.wantsMusic || this.ctx.state !== 'running') return;
    const len = d.track.loopSec ?? d.el.duration;
    if (!Number.isFinite(len)) return;
    const elapsed = d.track.loopSec ? this.ctx.currentTime - d.startedAt : d.el.currentTime;
    if (d.el.ended || elapsed >= len - TRACK_FADE) {
      d.advancing = true;
      void this.next(d.el.ended ? 1 : TRACK_FADE);
    }
  }
}
