# Attribution

## Audio

CORBEL splits its audio deliberately:

- **Music is a file**, because runtime synthesis does not write a good score.
- **Everything else is synthesised at runtime** in `audio.js` — wind, the distant
  fires, the crowd, and the timber creak — because those have to answer to the
  simulation. The creak in particular rides the live peak load, growing louder,
  brighter and more frequent as the span strains, and no fixed sample can do that.

### `audio/crossing-theme.ogg`

| | |
| --- | --- |
| Original title | *The World Fell Silent* |
| Author | tsorthan-grove |
| Source | <https://opengameart.org/content/the-world-fell-silent> |
| Licence | **CC0 1.0 Universal (public domain dedication)** |
| Retrieved | 2026-08-17 |
| Format | Ogg Vorbis, 48 kHz stereo, 2:55, 3.2 MB |

CC0 imposes no attribution requirement. It is credited here anyway.

The file is fetched lazily on first play and is entirely optional — if the request
fails the game logs a warning and carries on without it.

**Not yet listened to.** It was selected on title, duration and licence, not on
hearing it, so it may not suit. Three other CC0 tracks were downloaded and vetted
as alternatives; swapping is a one-line change in `audio.js` plus a download:

| Track | Author | Length | Source |
| --- | --- | --- | --- |
| Cold Silence | Epon | 5:55 | <https://opengameart.org/content/cold-silence> |
| Dark Place (loop) | skylethefrench | 0:55 | <https://opengameart.org/content/dark-place-loop> |
| Esther | Kistol | 1:21 | <https://opengameart.org/content/esther> |

All four are CC0 on OpenGameArt.

## Code

- **three.js** r160 — MIT Licence. Vendored at `vendor/three.module.js` rather than
  loaded from a CDN, so a CDN miss cannot leave the page silently dead.

## Everything else

All game code, art, geometry, terrain, the procedural audio, and the UI are original
to this project.
