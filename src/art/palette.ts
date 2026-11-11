/**
 * Art palette: lights, backdrop, fog, bloom, and tile/board material tokens.
 *
 * Pure module: no three import, no DOM. Safe to use from core-adjacent code and tests.
 *
 * Colour notes:
 * - All colours are sRGB hex numbers. three converts them to linear when creating Color objects.
 * - The scene uses ACES tone mapping and a bloom threshold of BLOOM.threshold (luminance in linear space).
 *   Only emissive * emissiveIntensity above ~1 (linear) glows. Use emissiveIntensity > 1 only for
 *   deliberate accents (see BOARD.glowAccentIntensity).
 */

/** Scene lights. Consumed by scene.ts: hemisphere + three directional lights + environment. */
export const LIGHTS = {
  /** Hemisphere sky colour (warm-violet ambient from above). */
  hemiSky: 0xd9c4ff, hemiGround: 0x1f4a52, hemiIntensity: 0.6,
  /** Warm key light, main shadow-less directional. */
  key: 0xffd9a8, keyIntensity: 2.0, keyPos: [6, 12, 5] as [number, number, number],
  /** Cool fill light from the left, softens key shadows (no shadow maps are used). */
  fill: 0x7fc8ff, fillIntensity: 0.7, fillPos: [-9, 6, -2] as [number, number, number],
  /** Magenta rim light from behind, separates tiles from the backdrop. */
  rim: 0xff7ad9, rimIntensity: 1.3, rimPos: [-2, 5, -12] as [number, number, number],
  /** scene.environmentIntensity for the procedural RoomEnvironment reflections. */
  envIntensity: 0.35,
  /** renderer.toneMappingExposure. */
  exposure: 1.05,
} as const;

/**
 * Backdrop shader inputs (sky gradient, nebula, stars, parchment grain, vignette).
 * Consumed by the backdrop ShaderMaterial in scene.ts as uniform colours and scalars.
 * `drift` scales the backdrop animation speed (1 = normal).
 */
export const BACKDROP = {
  top: 0x2a1850, horizon: 0x6a3a78, bottom: 0x14343e,
  nebulaA: 0x3fb8c4, nebulaB: 0xd0709a, star: 0xfff0d0,
  vignette: 0.35, grain: 0.004, drift: 1.0,
} as const;

/**
 * Exponential fog. Consumed as scene.fog = FogExp2(color, density) and as the
 * scene.background fallback colour. Board tiles fade toward `color` with distance.
 */
export const FOG = { color: 0x3a2350, density: 0.012 } as const;

/**
 * UnrealBloomPass parameters: new UnrealBloomPass(res, strength, radius, threshold).
 * threshold is the luminance cut-off; only emissive surfaces above it bloom.
 */
export const BLOOM = { strength: 0.22, radius: 0.4, threshold: 1.4 } as const;

/**
 * A material token for a tile or slot. Face colour and emissive glow are separate on purpose:
 * - base: lit face albedo (vertex colour). Saturated and mid-dark so key light can't push it past
 *   BLOOM.threshold. This is the colour the palette chip shows.
 * - emissive / emissiveIntensity: the motif core glow. The face itself gets only MATERIAL.faceGlow.
 * - roughness / metalness: face material response.
 * - accent: motif, selection ring and pip highlight. A complement or gold of the base.
 */
export interface MaterialToken {
  base: number;
  emissive: number;
  emissiveIntensity: number;
  roughness: number;
  metalness: number;
  accent: number;
}

/**
 * Tile identity tokens, keyed by TileType from core/tiles.ts. Same hue angles as the pass-1 chips,
 * saturation restored and value lowered so faces stay coloured under ACES.
 * emissiveIntensity is the motif core intensity: above BLOOM.threshold so only the small core blooms.
 */
export const TILE_IDENTITIES = {
  /** spring: celestial blue. Produces Ink. */
  spring: { base: 0x1f6fd6, emissive: 0x6cc4ff, emissiveIntensity: 2.2, roughness: 0.62, metalness: 0, accent: 0xffd27a },
  /** mill: warm amber. Produces Ink, boosted by adjacent Springs. */
  mill: { base: 0xd9820f, emissive: 0xffbe55, emissiveIntensity: 2.0, roughness: 0.68, metalness: 0, accent: 0x5fd4ff },
  /** beacon: coral rose. Multiplies adjacent tiles. */
  beacon: { base: 0xd8344f, emissive: 0xff7a92, emissiveIntensity: 2.3, roughness: 0.6, metalness: 0, accent: 0x6fe3d0 },
  /** bridge: ink-violet. Links its neighbours. */
  bridge: { base: 0x6a2fd0, emissive: 0xb07cff, emissiveIntensity: 2.3, roughness: 0.65, metalness: 0, accent: 0xe8c872 },
  /** vault: verdigris green. Offline and global bonuses. */
  vault: { base: 0x0f9a6e, emissive: 0x4fe8b0, emissiveIntensity: 2.0, roughness: 0.7, metalness: 0, accent: 0xff9ab0 },
  /** lighthouse: magenta beacon-light. Boosts producers two steps away. */
  lighthouse: { base: 0xd0289a, emissive: 0xff7ad0, emissiveIntensity: 2.2, roughness: 0.64, metalness: 0, accent: 0xfff0a0 },
  /** cistern: teal basin water. Multiplies adjacent Springs. */
  cistern: { base: 0x22b0b0, emissive: 0x7ff0f0, emissiveIntensity: 2.2, roughness: 0.6, metalness: 0, accent: 0xf6e7a0 },
  /** scriptorium: sienna ink. Output grows with the kinds of tile beside it. */
  scriptorium: { base: 0x8ebf1d, emissive: 0xc6f060, emissiveIntensity: 2.1, roughness: 0.66, metalness: 0, accent: 0xf4e4c1 },
} as const satisfies Record<'spring' | 'mill' | 'beacon' | 'bridge' | 'vault' | 'lighthouse' | 'cistern' | 'scriptorium', MaterialToken>;

/**
 * Empty board slot: a dark recessed well with a subdued violet border (accent), never near-white.
 * emissive is a faint inner breath, well below bloom.
 * At rest (not hovered, not a neighbour of the focus) the rim is quiet: restInset leaves a thin bevel band,
 * the border is mixed toward the face by restRimMix, and the trim is restTrim of the slot glow.
 * Focused or neighbour slots use the current bright rim at the placed-tile inset (board.ts INSET). These are
 * visual tokens, not balance.
 */
export interface EmptySlotToken extends MaterialToken {
  /** Inner face / outline ratio at rest (placed tiles use 0.8). */
  restInset: number;
  /** Border = lerp(accent, base, restRimMix) at rest. */
  restRimMix: number;
  /** Trim = emissive · restTrim at rest. */
  restTrim: number;
}
export const EMPTY_SLOT: EmptySlotToken = {
  base: 0x1c1430, emissive: 0x3a2e60, emissiveIntensity: 0.12, roughness: 0.9, metalness: 0, accent: 0x54467a,
  restInset: 0.88, restRimMix: 0.38, restTrim: 0.55,
};

/**
 * Placement curve for a tile that was just placed (transition.ts placeScale, mirrored in GLSL by placeGlsl so the
 * two cannot drift). Times are seconds from placement.
 * - dip: anticipation. Ease-in compression to 1 − squash (0.78) over [0, dip]. Impact (FX ring and sparks) fires at dip.
 * - squash: depth of the anticipation, and the amplitude of the damped rebound.
 * - decay / omega: rebound e^(−decay·τ) and frequency. The peak is about 1.098 at τ ≈ 0.055 s after dip.
 * - life: the curve is exactly 1 from here on (matches the old SQUASH_S).
 */
export const PLACE = { dip: 0.07, squash: 0.22, decay: 14, omega: 52, life: 0.6 } as const;

/** Next-ring (not yet surveyed) slot: darker still, border barely visible. */
export const NEXT_SLOT = { base: 0x140e22, border: 0x2e2546 } as const;

/**
 * Material response coefficients for board.ts (multipliers on the tokens above).
 * - sideShade: side faces = base * sideShade. Darker extrusion walls, pinned tiles included.
 * - bevelAccent / bevelLift: glassy edge = base lerped toward accent, then lifted.
 * - faceGlow: emissive on the face as a fraction of base. Small: faces are lit, not lamps.
 * - trimGlowRest..trimGlowMax: token.emissive on the bevel, by output level. Max < BLOOM.threshold.
 * - heightBase + heightPerLevel * L: extrusion, L = outputLevel(output) in 0..1 over heightLogFull decades.
 * - hoverLerp: face lerp toward white on hover, low so the hue survives. hoverTrim: bevel glow on hover.
 * - pinBorder: bevel lerp toward BOARD.gold on pinned tiles (outline only).
 * - motifScaleMin..Max: motif core scale by output level.
 * - bodyEnv: envMapIntensity on the merged tile body. Low so room reflections don't wash faces pastel; scene env/table unaffected.
 */
export const MATERIAL = {
  sideShade: 0.32, bevelAccent: 0.18, bevelLift: 1.15,
  faceGlow: 0.06, trimGlowRest: 0.12, trimGlowMax: 0.55,
  heightBase: 0.34, heightPerLevel: 1.0, heightLogFull: 6,
  slotHeight: 0.015, nextHeight: 0.008,
  hoverLerp: 0.12, hoverTrim: 0.8, pinBorder: 0.75,
  motifScaleMin: 0.85, motifScaleMax: 1.35,
  bodyEnv: 0.15,
} as const;

/**
 * Board chrome and interaction colours.
 * - table / tableEdge: the board base and its rim, MeshStandardMaterial colours.
 * - rim: thin cyan ring around the playable area.
 * - gold: selection, pin outline and reward highlights.
 * - hover: the colour a hovered face lerps toward, by MATERIAL.hoverLerp.
 * - adjacency: outline colour for tiles adjacent to the current selection.
 * - glowAccentIntensity: cap for deliberate bloom accents (rim). Motif cores sit just under it.
 */
/** Placement / inspect highlight strengths (board vertex colours, not DOM). */
export const PREVIEW = {
  bridgeOutline: 0xe8c872,
  bridgePulse: 0.32,
  inspectDim: 0.82,
  inspectSatMul: 0.48,
  directMix: 0.68,
  bridgeMix: 0.78,
} as const;

export const BOARD = {
  table: 0x3b2a4f, tableEdge: 0x7a5a3a,
  rim: 0x5fd4ff, gold: 0xe8c872, hover: 0xffffff, adjacency: 0x5fd4ff,
  glowAccentIntensity: 2.4,
} as const;

/**
 * Constellation edge ink on the board (ribbons, no bloom). Saturated gold for phone readability; glow stays on Klein seams only.
 */
/** Inspect-time ink flow arches (emissive tubes, below bloom). */
export const FLOW_LINK = {
  feed: 0x5fd4ff,
  boost: 0xff5a7a,
  bridge: 0xc080ff,
  relay: 0xaa66ff,
  penalty: 0xff6b6b,
  foot: 0xffffff,
  shadow: 0x0a0e18,
} as const;

export const CONSTELLATION = {
  /** In-progress burst (saturated gold, dashed line). */
  inkPulse: 0xffb800,
  /** Completed permanent ribbons. */
  inkComplete: 0xc88700,
  /** Ghost hint while previewing. */
  inkGhost: 0xffd033,
  ribbonWidth: 0.28,
  ribbonWidthComplete: 0.26,
  opacityPulse: 0.92,
  opacityComplete: 1,
  opacityGhost: 0.72,
  star: 0xffcc33,
} as const;

// ---- Pure colour math on sRGB hex. Used by tests; mirrors what board.ts does with THREE.Color. ----

export type RGB = [number, number, number];
export const hexToRgb = (h: number): RGB => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
export const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
/** WCAG relative luminance of an sRGB hex colour. */
export function relativeLuminance(h: number): number {
  const [r, g, b] = hexToRgb(h).map(srgbToLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** Luminance ratio (Lhi + 0.05) / (Llo + 0.05). */
export function contrastRatio(a: number, b: number): number {
  const la = relativeLuminance(a), lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
/** CIE L*a*b* (D65) of an sRGB hex colour. */
export function toLab(h: number): RGB {
  const [r, g, b] = hexToRgb(h).map(srgbToLinear);
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, y = 0.2126 * r + 0.7152 * g + 0.0722 * b, z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
export function deltaE76(a: number, b: number): number {
  const [l1, a1, b1] = toLab(a), [l2, a2, b2] = toLab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}
/** HSV saturation (0..1). */
export function saturation(h: number): number {
  const c = hexToRgb(h), mx = Math.max(...c), mn = Math.min(...c);
  return mx === 0 ? 0 : (mx - mn) / mx;
}
/** HSV hue in degrees. */
export function hue(h: number): number {
  const [r, g, b] = hexToRgb(h), mx = Math.max(r, g, b), d = mx - Math.min(r, g, b);
  if (d === 0) return 0;
  const k = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (k * 60 + 360) % 360;
}
const pack = (c: number[]) => c.reduce((acc, v) => (acc << 8) | Math.round(Math.min(1, Math.max(0, v)) * 255), 0);
/** Per-channel lerp in sRGB (as THREE.Color.lerp on sRGB-authored values). */
export const lerpHex = (a: number, b: number, t: number) => pack(hexToRgb(a).map((v, i) => v + (hexToRgb(b)[i] - v) * t));
export const scaleHex = (a: number, k: number) => pack(hexToRgb(a).map((v) => v * k));

// ---- Material response helpers (consumed by board.ts, checked by tests). ----

/** Output level 0..1: log10(1 + output) over MATERIAL.heightLogFull decades. */
export const outputLevel = (output: number) => Math.min(1, Math.log10(1 + Math.max(0, output)) / MATERIAL.heightLogFull);
/** Placed-tile extrusion height at level L. */
export const tileHeight = (L: number) => MATERIAL.heightBase + MATERIAL.heightPerLevel * L;
/** Bevel trim emissive multiplier on token.emissive at level L. */
export const trimGlow = (L: number) => MATERIAL.trimGlowRest + (MATERIAL.trimGlowMax - MATERIAL.trimGlowRest) * L;
/** Motif core scale at level L. */
export const motifScale = (L: number) => MATERIAL.motifScaleMin + (MATERIAL.motifScaleMax - MATERIAL.motifScaleMin) * L;
/** Side wall colour: darker than the face for every type, pinned or not. */
export const sideColour = (base: number) => scaleHex(base, MATERIAL.sideShade);
/** Glassy bevel colour, and its pinned (gold outline) variant. */
export const bevelColour = (t: MaterialToken, pinned = false) => {
  const b = scaleHex(lerpHex(t.base, t.accent, MATERIAL.bevelAccent), MATERIAL.bevelLift);
  return pinned ? lerpHex(b, BOARD.gold, MATERIAL.pinBorder) : b;
};
/** Hovered face colour. */
export const hoverFace = (base: number) => lerpHex(base, BOARD.hover, MATERIAL.hoverLerp);

/**
 * Cartography FX tokens (render/fx.ts). Particle colours are saturated tile emissives so they read
 * without bloom; *Px sizes are CSS pixels (shader multiplies by DPR) so motes stay legible at phone zoom.
 * - ink: motes flying to the HUD Ink counter. ring/beacon/bridge: procedural ring and arc colours.
 * - wash/vortex: Drift ink-wash and Projection vortex overlay colours.
 * - *Life: seconds. *Px: CSS px for screen-space sprites (motes, Pop, Wash, Vortex).
 * - Graph-anchored sizes are in tile pitches at s = 1 (coreR, sparkR, ringWidth, legs) and scale with perspective.
 *   minPx/maxPx clamp them on screen. Leg lift is in pitches too (legLift, riseR, stub).
 * - add*: how much of a particle is additive (1) versus over-blended (0). Colour never mixes toward white.
 * - legLife, stub, trail, waveStep: the graph timings. They match fx-graph ROUTE_TIMING and SURVEY_WAVE_STEP.
 * These are visual tokens, not balance.
 */
/** Manifold preview tokens (seams, ghosts, portal glow). */
export const SURFACE = {
  seamA: 0xff6b9d,
  seamB: 0x5fd4ff,
  /** Klein vertical flip pair (distinct from orientable seamA/B). */
  seamFlip: 0xe8c872,
  ghost: 0x6a4e86,
  ghostAlpha: 0.28,
  edgeGhostAlpha: 0.35,
  portalGlow: 0xe8c872,
  /** Klein self-intersection ring: emissive just under bloom threshold. */
  seamGlow: 0xe8c872,
  seamGlowEmissive: 1.38,
  dashPattern: [0.12, 0.08] as const,
  skin: 0x4a3568,
  skinInk: 0x8b6cc4,
  skinGrid: 0x5fd4ff,
} as const;

/** sRGB hex as `#rrggbb` for DOM / CSS. */
export const hexString = (h: number) => `#${(h & 0xffffff).toString(16).padStart(6, '0')}`;

/**
 * DOM / HUD chrome (plain CSS, not Three.js). Values are wired on `:root` via `applyUiCssVars` in ui-theme.ts.
 * `--gold` and `--cyan` mirror `BOARD.gold` and `BOARD.rim`.
 */
export const UI = {
  bg: 0x070b14,
  ink: 0xd8e2f0,
  muted: 0x7d8aa3,
  primaryOnGold: 0x1a1405,
  controlBg: 0x0f1828,
  fieldBg: 0x050a14,
  panelBg: 0x0c1424,
  barLo: 0xb8912e,
  barHi: 0xfff3c4,
  danger: 0xff6b6b,
  dangerRgb: [255, 107, 107] as const,
  pos: 0x7fd9a0,
  dangerSoft: 0xffb3b3,
  gainLabel: 0xffe7a8,
  gainLabelBg: 0x04060e,
  flash: 0xffffff,
  /** Solid fill behind palette chips for WCAG contrast (HUD glass over bg). */
  hudChipBg: 0x0c1220,
  glassRgb: [12, 18, 32] as const,
  glassAlpha: 0.78,
  lineRgb: [95, 212, 255] as const,
  lineAlpha: 0.22,
  devPanelBg: [30, 8, 12] as const,
  devPanelBgAlpha: 0.8,
} as const;

/**
 * Tile models (render/tile-models.ts). fill: model footprint as a fraction of the cell side (GAP), about 75% of the
 * inner face at mid output. emissive: tint on the lit body (bloom stays off the models). Body colour = the type's
 * emissive hue, accent band = the type's accent. ring*: the glow ring under each model. strain*: a Spring's loss of
 * share (1 - share) dims and shrinks its model; a Bridge-channelled Spring gets a bright ring.
 */
/** Constellation completion choreography (seconds). Lines trace edge by edge, then members flare in turn. */
export const CONSTELLATION_BURST = { seconds: 1.5, drawSeconds: 0.8, stagger: 0.12, bump: 0.5 } as const;

export const MOTIF = {
  fill: 0.56, emissive: 0.18, ringInner: 0.42, ringOuter: 0.5, ringLift: 0.012, ringAlpha: 0.55,
  strainDim: 0.55, strainShrink: 0.22, strainTint: 0x6b7388, channelBoost: 1.3,
} as const;

/** Palette tool-chip fill: tile `base` from TILE_IDENTITIES. */
export const tileChipColour = (t: keyof typeof TILE_IDENTITIES) => TILE_IDENTITIES[t].base;

export const FX = {
  ink: 0x6cc4ff, production: 0x8fe6ff, sell: 0xc9b8e8, ring: 0x5fd4ff, beacon: 0xff7a92, bridge: 0xb07cff,
  wash: 0x2a6bd6, vortex: 0xe8c872,
  motePx: 11, overlayPx: 22, popPx: 26,
  moteLife: 0.85, ringLife: 1.4, auraLife: 0.9, overlayLife: 2.4, popLife: 0.25, impactLife: 0.35, sparkLife: 0.45,
  sellLife: 0.5, relayLife: 0.3,
  coreR: 0.13, sparkR: 0.09, ringWidth: 0.06, revealRadius: 0.48, minPx: 2.5, maxPx: 34,
  legLife: 0.38, legLift: 0.25, stub: 0.5, trail: 0.12, riseR: 0.25, riseFrac: 0.18,
  popGap: 0.14, waveStep: 0.07, motesPerArrivals: 2,
  beaconAlpha: 0.6, beaconIdle: 0.3, popStrength: 1.6,
  addLeg: 0.6, addSpark: 0.5, addRing: 0.3, addPop: 0.3, addWash: 0, addVortex: 0.4,
} as const;

/** Manifold display stage (render/surface-stage.ts): brass plinth and gimbal, lacquer, engraving, motes, stage lights. */
export const STAGE = {
  brass: 0xc9a25a, lacquer: 0x140d24, engrave: 0x7fd4ff, mote: 0xcfd8ff, key: 0xffe2b8, rim: 0x8fd0ff,
} as const;
