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
  hemiSky: 0xd9c4ff, hemiGround: 0x1f4a52, hemiIntensity: 0.85,
  /** Warm key light, main shadow-less directional. */
  key: 0xffd9a8, keyIntensity: 2.4, keyPos: [6, 12, 5] as [number, number, number],
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
  vignette: 0.35, grain: 0.004, drift: 1,
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
export const BLOOM = { strength: 0.65, radius: 0.55, threshold: 0.85 } as const;

/**
 * A material token for a tile or slot. Expected use: the tile mesh is a
 * MeshStandardMaterial built from the token: color = base, emissive = emissive,
 * emissiveIntensity, roughness, metalness. `accent` is the highlight colour used for
 * selection rings, pips and hover edges. It is a complement or gold hue of the base.
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
 * Tile identity tokens, keyed by TileType from core/tiles.ts (spring, mill, beacon,
 * bridge, vault). tiles.ts defines exactly these 5 kinds, so the keys are the real ids.
 * Each token is a mid-luminance hue with a brighter emissive of the same hue and a resting
 * emissiveIntensity of 0.25 to 0.4. Hover and affordable highlights go up to BOARD.glowAccentIntensity.
 * Hues: spring = celestial blue, mill = warm amber, beacon = coral rose,
 * bridge = ink-violet, vault = verdigris teal.
 */
export const TILE_IDENTITIES = {
  /** spring: celestial blue. Produces Ink. */
  spring: { base: 0x4a9be8, emissive: 0x8fd0ff, emissiveIntensity: 0.3, roughness: 0.5, metalness: 0.2, accent: 0xffd27a },
  /** mill: warm amber. Produces Ink, boosted by adjacent Springs. */
  mill: { base: 0xe0a040, emissive: 0xffc870, emissiveIntensity: 0.3, roughness: 0.5, metalness: 0.2, accent: 0x5fd4ff },
  /** beacon: coral rose. Multiplies adjacent tiles. */
  beacon: { base: 0xe0607a, emissive: 0xff8fa6, emissiveIntensity: 0.35, roughness: 0.45, metalness: 0.15, accent: 0x6fe3d0 },
  /** bridge: ink-violet. Links its neighbours. */
  bridge: { base: 0x8a5cd6, emissive: 0xb88cff, emissiveIntensity: 0.35, roughness: 0.55, metalness: 0.15, accent: 0xe8c872 },
  /** vault: verdigris teal. Offline and global bonuses. */
  vault: { base: 0x2fb59c, emissive: 0x6fe3c8, emissiveIntensity: 0.3, roughness: 0.6, metalness: 0.1, accent: 0xff9ab0 },
} as const satisfies Record<'spring' | 'mill' | 'beacon' | 'bridge' | 'vault', MaterialToken>;

/**
 * Empty board slot. Dusky parchment-violet, matte, barely emissive so it reads as "unused"
 * without competing with placed tiles. Used for unoccupied hex cells.
 */
export const EMPTY_SLOT: MaterialToken = {
  base: 0x4a3a66, emissive: 0x6a5a9a, emissiveIntensity: 0.15, roughness: 0.85, metalness: 0, accent: 0xe8c872,
} as const;

/**
 * Board chrome and interaction colours.
 * - table / tableEdge: the board base and its rim, MeshStandardMaterial colours.
 * - rim: thin cyan ring around the playable area.
 * - gold: selection and reward highlights.
 * - hover: the target colour the hovered tile's material lerps toward (white).
 * - adjacency: outline colour for tiles adjacent to the current selection.
 * - glowAccentIntensity: emissiveIntensity for affordable or active highlights. Values up to
 *   this bloom past BLOOM.threshold. Keep it at or below this value.
 */
export const BOARD = {
  table: 0x3b2a4f, tableEdge: 0x7a5a3a,
  rim: 0x5fd4ff, gold: 0xe8c872, hover: 0xffffff, adjacency: 0x5fd4ff,
  glowAccentIntensity: 1.8,
} as const;
