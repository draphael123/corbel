/* ============================================================================
   CORBEL — build a bridge of timber and rope; hold it while people cross.
   Single-file slice: one gap, full build → test → hold-or-fail loop.
   ========================================================================== */

/* ---------------------------------- tuning ------------------------------- */
const W = 1280, H = 720;
const CELL = 40;                 // build grid + the unit of material
const DT = 1/60;
const SUBSTEPS = 3;
const ITER = 14;                 // constraint relaxation passes per substep

const GRAV = 1500;
const DRAG = 0.995;

const BEAM_STIFF = 1.0;
const ROPE_STIFF = 0.85;

const MAX_BEAM = CELL * 4;       // longest single timber
const MAX_ROPE = CELL * 9;       // rope spans much further
const NODE_SNAP = 15;            // px radius to grab an existing node

// Live balance knobs. Kept mutable and exposed on window.CORBEL so a headless
// sweep can find values without a reload — this is the part that needs
// re-tuning every time a level is added.
const TUNE = {
  beamCap: 6.8,      // timber strength
  ropeCap: 4.4,      // rope strength
  walkerLoad: 4.5,   // how heavy a person is against the structure
};
// Calibrated headlessly: a bare 4-beam deck stands under self-weight (0.45),
// bows, then gives at ~4s with two people on it. A Warren truss swings
// 0.16→0.37 loaded and holds all twelve. Re-check both after any level change.

// Longer members buckle sooner — this is the whole reason triangulation beats
// one heroic span.
function capacity(l){
  const base = l.type === 'rope' ? TUNE.ropeCap : TUNE.beamCap;
  return base / (0.55 + l.rest / (CELL * 3));
}

const NODE_MASS = 1.0;
const WALKER_R = 8.5;
const WALKER_SPEED = 62;
const WALKER_PUSH = 0.55;        // how much of a walker's penetration the deck absorbs
// People walk on the deck, not up the trusswork. Anything steeper than this is
// structure they pass by, so a diagonal brace never becomes a wall.
const WALKABLE_RISE = 1.2;
const STUCK_LIMIT = 4;           // seconds of no progress before they're stranded

/* ---------------------------------- terrain ------------------------------ */
const DECK_Y   = 400;
const LEFT_EDGE  = 480;
const RIGHT_EDGE = 800;
const GOAL_X   = 880;            // walked past this = safe
const SPAWN_X  = 300;

/* ---------------------------------- level -------------------------------- */
const LEVEL = {
  name: "The First Crossing",
  timber: 34,
  rope: 20,
  walkers: 12,
  anchors: [
    [LEFT_EDGE, DECK_Y], [LEFT_EDGE - CELL, DECK_Y],
    [RIGHT_EDGE, DECK_Y], [RIGHT_EDGE + CELL, DECK_Y],
  ],
};

/* ---------------------------------- state -------------------------------- */
const S = {
  phase: 'build',                // build | test | won | lost
  points: [],
  links: [],
  walkers: [],
  debris: [],
  stock: { beam: 0, rope: 0 },
  tool: 'beam',
  drag: null,                    // {from, x, y}
  hover: null,
  across: 0, lost: 0, spawned: 0,
  spawnTimer: 0,
  settle: 0,
  shake: 0,
  t: 0,
  snapshot: null,                // build-phase geometry, restored on reset
};

/* ---------------------------------- model -------------------------------- */
function addPoint(x, y, pinned){
  const p = { x, y, px: x, py: y, invMass: pinned ? 0 : 1 / NODE_MASS, pinned: !!pinned };
  S.points.push(p);
  return S.points.length - 1;
}

function findPoint(x, y, r = NODE_SNAP){
  let best = -1, bd = r * r;
  for (let i = 0; i < S.points.length; i++){
    const p = S.points[i];
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d < bd){ bd = d; best = i; }
  }
  return best;
}

function linkExists(a, b){
  return S.links.some(l => !l.dead && ((l.a === a && l.b === b) || (l.a === b && l.b === a)));
}

function addLink(a, b, type){
  const pa = S.points[a], pb = S.points[b];
  const rest = Math.hypot(pb.x - pa.x, pb.y - pa.y);
  S.links.push({ a, b, rest, type, load: 0, stress: 0, broken: false, dead: false });
  return S.links[S.links.length - 1];
}

function costOf(rest){ return Math.max(1, Math.round(rest / CELL)); }

/* ------------------------------ build actions ---------------------------- */
function snapGrid(x, y){
  return [Math.round(x / CELL) * CELL, Math.round(y / CELL) * CELL];
}

// Solid rock — can't drop a new node inside the cliff.
function inRock(x, y){
  if (y < DECK_Y - 0.5) return false;
  if (x <= LEFT_EDGE)  return true;
  if (x >= RIGHT_EDGE) return true;
  return false;
}

function proposal(x, y){
  // What would happen if the player released the drag here?
  if (!S.drag) return null;
  const from = S.drag.from;
  let to = findPoint(x, y);
  let np = null;
  if (to < 0){
    const [gx, gy] = snapGrid(x, y);
    to = findPoint(gx, gy, 1);
    if (to < 0) np = [gx, gy];
  }
  const pa = S.points[from];
  const tx = np ? np[0] : S.points[to].x;
  const ty = np ? np[1] : S.points[to].y;
  const rest = Math.hypot(tx - pa.x, ty - pa.y);
  const cost = costOf(rest);
  const maxLen = S.tool === 'rope' ? MAX_ROPE : MAX_BEAM;

  let bad = null;
  if (!np && to === from)            bad = 'same';
  else if (rest < CELL * 0.5)        bad = 'short';
  else if (rest > maxLen + 0.5)      bad = 'long';
  else if (np && inRock(tx, ty))     bad = 'rock';
  else if (!np && linkExists(from, to)) bad = 'dup';
  else if (cost > S.stock[S.tool])   bad = 'stock';

  return { from, to, np, tx, ty, rest, cost, bad };
}

function commit(x, y){
  const pr = proposal(x, y);
  S.drag = null;
  if (!pr || pr.bad) return false;
  const to = pr.np ? addPoint(pr.np[0], pr.np[1], false) : pr.to;
  addLink(pr.from, to, S.tool);
  S.stock[S.tool] -= pr.cost;
  return true;
}

function removeLinkAt(x, y){
  let best = -1, bd = 10;
  for (let i = 0; i < S.links.length; i++){
    const l = S.links[i];
    if (l.dead) continue;
    const a = S.points[l.a], b = S.points[l.b];
    const d = distToSeg(x, y, a.x, a.y, b.x, b.y);
    if (d < bd){ bd = d; best = i; }
  }
  if (best < 0) return false;
  const l = S.links[best];
  S.stock[l.type] += costOf(l.rest);
  l.dead = true;
  pruneOrphans();
  return true;
}

function pruneOrphans(){
  // Drop unpinned nodes that nothing connects to any more, so the canvas
  // doesn't fill up with invisible litter.
  const used = new Set();
  for (const l of S.links) if (!l.dead){ used.add(l.a); used.add(l.b); }
  const keep = [], remap = new Array(S.points.length).fill(-1);
  for (let i = 0; i < S.points.length; i++){
    if (S.points[i].pinned || used.has(i)){ remap[i] = keep.length; keep.push(S.points[i]); }
  }
  for (const l of S.links) if (!l.dead){ l.a = remap[l.a]; l.b = remap[l.b]; }
  S.points = keep;
  S.links = S.links.filter(l => !l.dead);
}


function distToSeg(px, py, ax, ay, bx, by){
  const abx = bx - ax, aby = by - ay;
  const len2 = abx * abx + aby * aby;
  let t = len2 < 1e-9 ? 0 : ((px - ax) * abx + (py - ay) * aby) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

/* -------------------------------- physics -------------------------------- */
function integrate(dt){
  for (const p of S.points){
    if (p.invMass === 0) continue;
    const vx = (p.x - p.px) * DRAG;
    const vy = (p.y - p.py) * DRAG;
    p.px = p.x; p.py = p.y;
    p.x += vx;
    p.y += vy + GRAV * dt * dt;
  }
}

function solve(){
  for (const l of S.links) l.load = 0;

  for (let it = 0; it < ITER; it++){
    for (const l of S.links){
      if (l.broken) continue;
      const a = S.points[l.a], b = S.points[l.b];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 1e-6;
      const diff = d - l.rest;
      if (l.type === 'rope' && diff <= 0) continue;   // cable only pulls
      const w = a.invMass + b.invMass;
      if (w === 0) continue;
      const k = l.type === 'rope' ? ROPE_STIFF : BEAM_STIFF;
      const corr = (diff / d) * k / w;
      const cx = dx * corr, cy = dy * corr;
      a.x += cx * a.invMass; a.y += cy * a.invMass;
      b.x -= cx * b.invMass; b.y -= cy * b.invMass;
      // Total correction is a clean proxy for the force running through the
      // member — this is what paints the stress colours.
      l.load += Math.abs(diff) * k;
    }
  }
}

function updateStress(breakable){
  for (const l of S.links){
    if (l.broken) continue;
    const raw = l.load / capacity(l);
    l.stress += (raw - l.stress) * 0.18;             // smooth out single-frame spikes
    if (breakable && l.stress > 1){
      l.broken = true;
      S.shake = Math.min(14, S.shake + 6);
      spawnSnapDebris(l);
    }
  }
}

function spawnSnapDebris(l){
  const a = S.points[l.a], b = S.points[l.b];
  const n = 3 + Math.floor(l.rest / CELL);
  for (let i = 0; i < n; i++){
    const t = (i + 0.5) / n;
    S.debris.push({
      x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t,
      vx: (Math.random() - 0.5) * 70, vy: -Math.random() * 60,
      rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 7,
      len: CELL * 0.5 * (0.5 + Math.random() * 0.6),
      type: l.type, life: 1,
    });
  }
}

/* -------------------------------- walkers -------------------------------- */
function makeWalker(i){
  return {
    x: SPAWN_X - i * 4, y: DECK_Y - WALKER_R - 1,
    vx: 0, vy: 0, r: WALKER_R,
    grounded: false, safe: false, fell: false, stranded: false,
    maxX: SPAWN_X - i * 4, stuckT: 0,
    // a little variety so the crowd doesn't read as clones
    h: 15 + Math.random() * 5,
    bulk: 0.75 + Math.random() * 0.5,
    pack: Math.random() < 0.55,
    child: Math.random() < 0.18,
    phase: Math.random() * 6.28,
    bob: 0,
  };
}

function stepWalker(w, dt){
  if (w.safe || w.fell) return;

  w.vy += GRAV * dt;
  w.x += w.vx * dt;
  w.y += w.vy * dt;
  w.grounded = false;

  // solid cliff tops
  if (w.x < LEFT_EDGE || w.x > RIGHT_EDGE){
    const floor = DECK_Y - w.r;
    if (w.y > floor){ w.y = floor; if (w.vy > 0) w.vy = 0; w.grounded = true; }
  }

  // the bridge itself
  for (const l of S.links){
    if (l.broken) continue;
    const a = S.points[l.a], b = S.points[l.b];
    const abx = b.x - a.x, aby = b.y - a.y;
    const len2 = abx * abx + aby * aby;
    if (len2 < 1e-6) continue;
    if (Math.abs(aby) > Math.abs(abx) * WALKABLE_RISE) continue;   // too steep to walk
    let t = ((w.x - a.x) * abx + (w.y - a.y) * aby) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = a.x + abx * t, cy = a.y + aby * t;
    let dx = w.x - cx, dy = w.y - cy;
    let d = Math.hypot(dx, dy);
    if (d >= w.r) continue;
    if (d < 1e-6){ d = 1e-6; dx = 0; dy = -1; }
    const nx = dx / d, ny = dy / d;
    const pen = w.r - d;

    w.x += nx * pen * (1 - WALKER_PUSH);
    w.y += ny * pen * (1 - WALKER_PUSH);
    const vn = w.vx * nx + w.vy * ny;
    if (vn < 0){ w.vx -= nx * vn; w.vy -= ny * vn; }
    if (ny < -0.45) w.grounded = true;

    // Reaction into the structure. Gravity keeps re-penetrating each substep,
    // so this is exactly how the crowd's weight reaches the timber.
    const s = pen * WALKER_PUSH * w.bulk * TUNE.walkerLoad;
    if (a.invMass > 0){ a.x -= nx * s * (1 - t); a.y -= ny * s * (1 - t); }
    if (b.invMass > 0){ b.x -= nx * s * t;       b.y -= ny * s * t; }
  }

  if (w.grounded) w.vx += (WALKER_SPEED - w.vx) * 0.14;
  else            w.vx *= 0.994;

  w.bob += Math.abs(w.vx) * dt * 0.42;

  // Stranding. Guarantees the test always resolves, and someone stopped dead
  // at the lip of the gorge is a failure whether or not they fell.
  if (w.x > w.maxX + 1.5){ w.maxX = w.x; w.stuckT = 0; }
  else if (!w.stranded){
    w.stuckT += dt;
    if (w.stuckT > STUCK_LIMIT){ w.stranded = true; S.lost++; }
  }

  if (w.x > GOAL_X){ w.safe = true; S.across++; }
  if (w.y > H + 80 && !w.fell){
    w.fell = true;
    if (!w.stranded) S.lost++;
    S.shake = Math.min(16, S.shake + 4);
  }
}


/* ---------------------------------- hooks --------------------------------- */
// The sim owns no DOM. Renderers assign these to surface messages.
const HOOKS = {
  verdict: () => {},          // (null | 'won' | 'lost')
  flash:   () => {},          // (string | null)
};

/* --------------------------------- phases -------------------------------- */
function snapshotBuild(){
  S.snapshot = {
    points: S.points.map(p => ({ x: p.x, y: p.y, pinned: p.pinned })),
    links: S.links.map(l => ({ a: l.a, b: l.b, rest: l.rest, type: l.type })),
  };
}

function restoreBuild(){
  if (!S.snapshot) return;
  S.points = S.snapshot.points.map(p => ({
    x: p.x, y: p.y, px: p.x, py: p.y,
    invMass: p.pinned ? 0 : 1 / NODE_MASS, pinned: p.pinned,
  }));
  S.links = S.snapshot.links.map(l => ({
    a: l.a, b: l.b, rest: l.rest, type: l.type,
    load: 0, stress: 0, broken: false, dead: false,
  }));
}

function startTest(){
  if (S.phase !== 'build') return;
  if (!S.links.length){ HOOKS.flash("Nothing to cross"); return; }
  snapshotBuild();
  S.phase = 'test';
  S.walkers = []; S.debris = [];
  S.across = 0; S.lost = 0; S.spawned = 0; S.spawnTimer = 0; S.settle = 0;
  HOOKS.verdict(null);
  HOOKS.flash(null);
}

function backToBuild(){
  restoreBuild();
  S.phase = 'build';
  S.walkers = []; S.debris = [];
  S.across = 0; S.lost = 0; S.spawned = 0;
  S.drag = null;
  HOOKS.verdict(null);
}

function resetLevel(){
  S.points = []; S.links = []; S.walkers = []; S.debris = [];
  S.snapshot = null;
  S.stock.beam = LEVEL.timber;
  S.stock.rope = LEVEL.rope;
  for (const [x, y] of LEVEL.anchors) addPoint(x, y, true);
  S.phase = 'build';
  S.across = 0; S.lost = 0; S.spawned = 0;
  HOOKS.verdict(null);
}

/* ---------------------------------- step --------------------------------- */
function step(dt){
  S.t += dt;
  S.shake *= 0.9;

  if (S.phase === 'test' || S.phase === 'won' || S.phase === 'lost'){
    const sd = dt / SUBSTEPS;
    for (let s = 0; s < SUBSTEPS; s++){
      integrate(sd);
      solve();
      for (const w of S.walkers) stepWalker(w, sd);
    }
    updateStress(true);

    if (S.phase === 'test'){
      S.spawnTimer -= dt;
      if (S.spawned < LEVEL.walkers && S.spawnTimer <= 0){
        S.walkers.push(makeWalker(S.spawned));
        S.spawned++;
        S.spawnTimer = 0.85;
      }
      const done = S.spawned >= LEVEL.walkers &&
                   S.walkers.every(w => w.safe || w.fell || w.stranded);
      if (done){
        S.settle += dt;
        if (S.settle > 0.6) S.phase = S.lost > 0 ? 'lost' : 'won';
      }
    }
  } else {
    // Build phase: let the structure hang under its own weight so the player
    // can read sag and stress before committing anyone to it.
    const sd = dt / SUBSTEPS;
    for (let s = 0; s < SUBSTEPS; s++){ integrate(sd); solve(); }
    updateStress(false);
  }

  for (const d of S.debris){
    d.vy += GRAV * dt;
    d.x += d.vx * dt; d.y += d.vy * dt;
    d.rot += d.vr * dt;
    if (d.y > H + 60) d.life = 0;
  }
  S.debris = S.debris.filter(d => d.life > 0);

}

/* --------------------------------- exports -------------------------------- */
export {
  W, H, CELL, DT, GRAV,
  MAX_BEAM, MAX_ROPE, NODE_SNAP,
  DECK_Y, LEFT_EDGE, RIGHT_EDGE, GOAL_X, SPAWN_X,
  WALKER_R,
  TUNE, LEVEL, S, HOOKS,
  capacity, costOf,
  addPoint, addLink, findPoint, linkExists, distToSeg,
  snapGrid, inRock, proposal, commit, removeLinkAt,
  startTest, backToBuild, resetLevel, step,
};
