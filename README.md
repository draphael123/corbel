# CORBEL

Build a bridge of timber and rope across a gorge, then hold it while people cross.

They are running from something. The span never gets longer — the crowd gets heavier.
And you never demolish: each crossing hands you back the exact bridge you built last
time, early hacks and all.

## Playing

- **Drag between joints** to lay a member. New members must start from something that
  already exists.
- **1** timber — takes compression and tension, but buckles if you make it long.
- **2** rope — only pulls. It hangs slack until it's taut, and it spans much further.
- **Right-click** removes a member and refunds it.
- **Space** sends them across. **R** starts the level over.

Cost is by length, paid from the materials on hand. Longer members are weaker, which
is the whole reason triangulation beats one heroic span.

Colour is load: timber runs from its natural brown through amber to red as force runs
through it. If a member goes red, it is about to go.

## Running it

Any static server from the repo root:

```bash
python -m http.server 5808
```

Then open <http://localhost:5808>. There is no build step and no bundler — three.js is
vendored at `vendor/three.module.js` rather than pulled from a CDN, so it loads
identically offline, on localhost, and in production.

## Layout

| File | What it is |
| --- | --- |
| `sim.js` | The simulation. Verlet integration with position-based constraint relaxation. No DOM — it runs in Node, so the balance harness needs no browser. |
| `render.js` | The three.js scene: terrain, lighting, instanced structure, atmosphere. |
| `audio.js` | Procedural audio. No sample files; everything is synthesised at runtime. |
| `ui.js` | Title screen, settings, tutorial, HUD. |
| `main.js` | Wiring and the main loop. |
| `index-2d-snapshot.html` | The original Canvas 2D renderer, **frozen**. It carries its own inline copy of the sim and will drift. Reference only. |

## Balance

`TUNE` is mutable and exposed on `window.CORBEL`, so a sweep can find values without a
reload:

```js
CORBEL.TUNE.beamCap = 6.8
CORBEL.place(480, 400, 560, 400, 'beam')
CORBEL.sim()   // runs the whole crossing headlessly and reports
```

Current calibration: a bare four-beam deck stands under its own weight at 0.45, bows
visibly, then gives at about four seconds with two people on it. A Warren truss swings
0.16 → 0.37 under load and carries all twelve. **Re-run both after any change** — the
window between "trivially solvable" and "impossible" is narrow, and both failure modes
look fine in a screenshot.
