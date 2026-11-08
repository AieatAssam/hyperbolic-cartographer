# Music by stage

Each stage has its own playlist. Tracks play in shuffled order and never repeat back to back. A new track crossfades in over 6 seconds, and a stage change crossfades over 4 seconds. Drift and Projection transitions dip the music to 35% while their sound plays. Credits and licences are in [AUDIO-CREDITS.md](../../AUDIO-CREDITS.md). `src/audio/assets.json` is the source of truth for this list.

The music gets stranger and wider as the game goes on. Survey and Drift use piano, pads and soft synths in major keys, for quiet mapmaking. Projection and the Manifold previews move to bells, arpeggios and slow-moving harmony that doesn't settle. Dimension and Horizon use long space-ambient pieces with lots of reverb and little melody.

The key column is each track's estimated key root, from a chroma analysis of the decoded audio. Tile and UI sounds are tuned to a major pentatonic scale on that root, so a Mill or Beacon placed during "Crypto" sits in A♭ and the same tile during "Air" sits in E.

## Survey: a flat grid, the first map

| Track | Author | Key | Length | Why it fits |
|---|---|---|---|---|
| Calm Piano 1 (Vaporware) | The Cynic Project | C | 2:45 | Soft pads under a slow, hopeful piano line. It sets the tone of drawing a first map: unhurried and a little optimistic. |
| Air | Alexandr Zhelanov | E | 1:49 | A small, sparse piano piece. It leaves room for the tile sounds, which matter most while the player is learning them. |
| Meditation Impromptu 02 | Kevin MacLeod | C♯ | 3:20 (shortened) | Gentle piano improvisation that drifts without a strong beat, so it works through long idle stretches. |
| Calm Ambient 1 (Synthwave 4k) | The Cynic Project | C | 2:38 | Warm synth chords. A slightly more modern colour to vary the piano tracks, still calm. |

## Drift: after the first prestige, the same flat world mapped again

| Track | Author | Key | Length | Why it fits |
|---|---|---|---|---|
| November Snow | The Cynic Project | C | 3:20 (shortened) | Lo-fi, tape-coloured downtempo. It sounds like going back over old ground, which is what a Drift is. |
| Calm Ambient 2 (Synthwave 15k) | The Cynic Project | C | 3:20 (shortened) | Relaxing pads with a plucked figure. A bit more movement than Survey, for a player who now knows the loop. |
| Dreamy Flashback | Kevin MacLeod | C | 2:07 | Dreamy, nostalgic textures: memory and repetition. |

## Projection: the hyperbolic disc

| Track | Author | Key | Length | Why it fits |
|---|---|---|---|---|
| Crystal Cave (song18) | The Cynic Project | F | 0:50 loop, played for 2:30 | Deep bass with stone and bell textures and arpeggios. The repeating crystalline figure suits a tiling that keeps branching outward. Written to loop cleanly. |
| Mysterious Ambience (song21) | The Cynic Project | D | 0:43 loop, played for 2:10 | Piano textures and arpeggios made for a "mysterious puzzle" level. The first place the music stops sounding settled, as the board stops being flat. |
| Crypto | Kevin MacLeod | A♭ | 3:20 (shortened) | Pulsing and slightly eerie. Something mathematical is happening that the player doesn't fully see yet. |

## Manifold: the torus preview

| Track | Author | Key | Length | Why it fits |
|---|---|---|---|---|
| Global Resonance | Eponasoft | B♭ | 2:37 | Slow, resonant ambient. A closed surface that wraps around itself, with a long held sound to match. |
| Contemplation | Joth | C | 2:00 | Pure ambience with "no real melody or focus" (the author's words). The torus has no edge and no centre. |
| Echoes of Time v2 | Kevin MacLeod | E♭ | 3:20 (shortened) | Echoing, cyclical pads: going around the torus and arriving back where you started. |

## Manifold: the Klein bottle preview

| Track | Author | Key | Length | Why it fits |
|---|---|---|---|---|
| Futuristic Ambient 1 | Alexandr Zhelanov | F♯ | 3:20 (shortened) | Tangerine Dream-style sequenced synths. The strangest music in the game so far, for the one-sided surface. |
| Futuristic Ambient 4 | Alexandr Zhelanov | E♭ | 2:45 | Another theme from the same set, darker and slower, so the Klein playlist has one voice in two moods. |
| Unwritten Return | Kevin MacLeod | E♭ | 3:20 (shortened) | Quiet and bittersweet. Coming back to the start after the twist the Klein bottle puts in every path. |

## Dimension: 3D honeycombs (planned; `?music=dimension`)

| Track | Author | Key | Length | Why it fits |
|---|---|---|---|---|
| Observing The Star | yd | B♭ | 2:14 | Wide space background with a slow pulse. The first stage where the map has depth. |
| Space Atmosphere | Alexandr Zhelanov | F | 3:20 (shortened) | Space ambient in the style of Osmos: floating, cellular, large. |
| Lightless Dawn | Kevin MacLeod | F | 3:20 (shortened) | Dark, slow, very wide reverb. Space with almost nothing in it yet. |

## Horizon: the end game (planned; `?music=horizon`)

| Track | Author | Key | Length | Why it fits |
|---|---|---|---|---|
| Infinite Perspective | Kevin MacLeod | D | 3:20 (shortened) | A spacious sci-fi ambient piece, chosen to sound like an endless view. |
| Space Music: Out There | yd | C | 3:20 (shortened) | Long, patient background music: looking out past everything already mapped. |
| Harmony in the Mists | Tsorthan Grove | C♯ | 2:53 | Serene and luminous. The calmest track in the late game, a resolution after the strange middle stages. |
| Singularity (calm version) | vitalezzz | F♯ | 3:20 (shortened) | Electronic and expansive. The author wrote calm and action versions; the calm one fits an idle game's finale. |

## How each stage is chosen

`src/audio/stage.ts` picks the stage from the game state, highest priority first:

1. a torus or Klein Manifold preview is showing;
2. the board is the hyperbolic disc (Projection);
3. the player has Drifted at least once (Drift);
4. otherwise, Survey.

Dimension and Horizon have no gameplay yet. Their playlists are wired up and can be heard with `?music=dimension` or `?music=horizon`.

## Loudness and size

Every track is normalised to about -20 LUFS with a peak limiter, so a stage change never jumps in volume. "Shortened" tracks were cut to 200 seconds with an 8-second fade-out, which keeps the download small. Files are 32 kbps stereo Opus (WebM), with a 40 kbps mono AAC fallback. A stage's playlist is about 2.5 to 3.5 MB, streamed only while that stage plays.
