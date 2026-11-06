import Decimal from 'break_eternity.js';
import LZString from 'lz-string';
import { GRAPHS, initialState, type GameState } from './state';
import { TILE_TYPES } from './tiles';

export const SAVE_VERSION = 1;
const DECIMAL_KEYS = ['ink', 'runInk', 'lifetimeInk', 'charts', 'cycleCharts', 'curvature'] as const;

export interface SaveFile {
  version: number;
  savedAt: number;
  checksum: string;
  state: Record<string, unknown>;
}

/** migrations[v] upgrades a v state to v+1. */
export const migrations: Record<number, (s: Record<string, unknown>) => Record<string, unknown>> = {};

export function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function toPlain(s: GameState): Record<string, unknown> {
  const o: Record<string, unknown> = JSON.parse(JSON.stringify({ ...s, ...Object.fromEntries(DECIMAL_KEYS.map((k) => [k, null])) }));
  for (const k of DECIMAL_KEYS) o[k] = s[k].toString();
  return o;
}

export function makeSave(s: GameState, now: number): SaveFile {
  const state = toPlain(s);
  return { version: SAVE_VERSION, savedAt: now, checksum: fnv1a(JSON.stringify(state)), state };
}

export const toJson = (f: SaveFile) => JSON.stringify(f);
export const exportString = (f: SaveFile) => LZString.compressToBase64(toJson(f));

export type ImportResult = { ok: true; save: SaveFile; state: GameState } | { ok: false; error: string };

/** Accepts either the raw .json file text or the compressed base64 string. Never throws. */
export function importSave(text: string): ImportResult {
  try {
    text = text.trim();
    const json = text.startsWith('{') ? text : LZString.decompressFromBase64(text);
    if (!json) return { ok: false, error: 'Not a valid save string.' };
    const f = JSON.parse(json) as SaveFile;
    if (typeof f !== 'object' || typeof f.version !== 'number' || typeof f.savedAt !== 'number' || typeof f.checksum !== 'string' || typeof f.state !== 'object' || !f.state)
      return { ok: false, error: 'Save is missing required fields.' };
    if (fnv1a(JSON.stringify(f.state)) !== f.checksum) return { ok: false, error: 'Checksum mismatch: save is corrupted or was edited.' };
    if (f.version > SAVE_VERSION) return { ok: false, error: `Save is from a newer version (v${f.version}).` };
    let raw = f.state;
    for (let v = f.version; v < SAVE_VERSION; v++) raw = migrations[v](raw);
    return { ok: true, save: f, state: hydrate(raw) };
  } catch (e) {
    return { ok: false, error: `Could not read save: ${(e as Error).message}` };
  }
}

function hydrate(raw: Record<string, unknown>): GameState {
  const base = initialState();
  const s = { ...base, ...raw } as GameState;
  for (const k of DECIMAL_KEYS) {
    const d = new Decimal(raw[k] as string);
    if (!Number.isFinite(d.mag) || d.lt(0)) throw new Error(`bad ${k}`);
    s[k] = d;
  }
  s.chartUpg = { ...base.chartUpg, ...(raw.chartUpg as object) };
  s.curvUpg = { ...base.curvUpg, ...(raw.curvUpg as object) };
  s.autoDrift = { ...base.autoDrift, ...(raw.autoDrift as object) };
  if (s.geometry !== 'square' && s.geometry !== 'hyper') throw new Error('bad geometry');
  const n = GRAPHS[s.geometry].ring.length;
  if (!Array.isArray(s.tiles) || s.tiles.length !== n || s.tiles.some((t) => t !== null && !TILE_TYPES.includes(t)))
    throw new Error('bad tiles');
  if (!Array.isArray(s.pinned) || s.pinned.some((i) => !s.tiles[i])) throw new Error('bad pins');
  return s;
}
