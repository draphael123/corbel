/* ============================================================================
   CORBEL — wiring and the main loop.
   ========================================================================== */
// Every local module is fetched against a version token set in index.html.
// The ES module cache will otherwise serve a stale copy, and a stale module
// reads exactly like a code bug — it throws at line numbers that no longer
// exist in the file on disk. three.js is imported statically inside render.js
// so the 1.2MB engine still caches normally. Pin __V to a build hash to ship.
const V = window.__V || '';
const [R, A, UI, SIM] = await Promise.all([
  import(`./render.js?v=${V}`),
  import(`./audio.js?v=${V}`),
  import(`./ui.js?v=${V}`),
  import(`./sim.js?v=${V}`),
]);
const S = SIM.S;

const canvas = document.getElementById('c');
const el = id => document.getElementById(id);

R.init(canvas, SIM);
UI.init(SIM, R, A);

let hover = null;
let prevBroken = 0, prevLost = 0, prevAcross = 0;

/* --------------------------------- screens -------------------------------- */
function beginPlay(fresh){
  A.unlock();                              // must ride a user gesture
  A.startMusic();                          // lazy 3MB fetch, optional
  if (fresh) SIM.resetLevel();
  UI.show('playing');
  if (fresh && !UI.prefs.tutorialDone) UI.startTutorial();
}

el('btnBegin').addEventListener('click', () => { A.click(); beginPlay(true); });
el('btnHowto').addEventListener('click', () => { A.click(); UI.show('howto'); });
el('btnSettings').addEventListener('click', () => { A.click(); UI.show('settings'); });
for (const id of ['btnCloseHowto', 'btnCloseSettings'])
  el(id).addEventListener('click', () => { A.click(); UI.show(S.links.length || S.phase !== 'build' ? 'playing' : 'title'); });
el('btnReplayTut').addEventListener('click', () => {
  A.click(); UI.prefs.tutorialDone = false; UI.savePrefs();
  beginPlay(true); UI.startTutorial();
});
el('tutNext').addEventListener('click', () => { A.click(); UI.tutorialNext(); });
el('tutSkip').addEventListener('click', () => { A.click(); UI.stopTutorial(); });

/* ---------------------------------- input --------------------------------- */
canvas.addEventListener('pointerdown', e => {
  if (UI.current() !== 'playing' || S.phase !== 'build') return;
  const p = R.simFromPointer(e.clientX, e.clientY);
  if (!p) return;
  if (e.button === 2){ if (SIM.removeLinkAt(p[0], p[1])) A.remove(); return; }
  let i = SIM.findPoint(p[0], p[1]);
  if (i < 0){
    const [gx, gy] = SIM.snapGrid(p[0], p[1]);
    i = SIM.findPoint(gx, gy, 1);
    if (i < 0){ A.deny(); return; }        // members must start from something real
  }
  S.drag = { from: i };
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove', e => { hover = R.simFromPointer(e.clientX, e.clientY); });
canvas.addEventListener('pointerleave', () => { hover = null; });
canvas.addEventListener('contextmenu', e => e.preventDefault());

canvas.addEventListener('pointerup', e => {
  if (UI.current() !== 'playing' || S.phase !== 'build' || !S.drag) return;
  const p = R.simFromPointer(e.clientX, e.clientY);
  const tool = S.tool;
  if (p && SIM.commit(p[0], p[1])) A.place(tool);
  else { S.drag = null; A.deny(); }
});

addEventListener('keydown', e => {
  if (e.key === '?' || (e.key === '/' && e.shiftKey) || e.key === 'h' || e.key === 'H'){
    UI.show(UI.current() === 'howto' ? 'playing' : 'howto'); return;
  }
  if (e.key === 'Escape'){
    if (UI.current() === 'howto' || UI.current() === 'settings') UI.show('playing');
    else S.drag = null;
    return;
  }
  if (UI.current() !== 'playing') return;
  if (e.key === '1') S.tool = 'beam';
  else if (e.key === '2') S.tool = 'rope';
  else if (e.key === 'Tab'){ e.preventDefault(); S.tool = S.tool === 'beam' ? 'rope' : 'beam'; }
  else if (e.key === ' '){
    e.preventDefault();
    if (S.phase === 'build') SIM.startTest(); else SIM.backToBuild();
  }
  else if (e.key === 'r' || e.key === 'R') SIM.resetLevel();
});

addEventListener('resize', () => R.resize());
addEventListener('visibilitychange', () => document.hidden ? A.suspend() : A.resume());

/* --------------------------------- the loop ------------------------------- */
let last = performance.now(), acc = 0, lastPaint = 0;

function tick(raw){
  acc += Math.min(raw, 0.1);
  while (acc >= SIM.DT){ SIM.step(SIM.DT); acc -= SIM.DT; }

  // The sim emits no events, so diff its counters to find the moments worth hearing.
  const broken = S.links.filter(l => l.broken).length;
  if (broken > prevBroken) A.snap();
  prevBroken = broken;
  if (S.lost > prevLost) A.fall();
  prevLost = S.lost;
  prevAcross = S.across;

  const onSpan = S.walkers.filter(w =>
    !w.safe && !w.fell && w.x > SIM.LEFT_EDGE && w.x < SIM.RIGHT_EDGE).length;
  A.update(R.peakStress(), onSpan, raw);

  const playing = UI.current() === 'playing';
  const info = R.syncOverlay(playing ? hover : null, playing && S.phase === 'build');
  const cost = el('cost');
  if (info){
    const p = info.pr;
    const label = p.bad === 'long'  ? (S.tool === 'rope' ? 'too long' : 'timber too long')
                : p.bad === 'stock' ? 'not enough ' + (S.tool === 'rope' ? 'rope' : 'timber')
                : p.bad === 'rock'  ? 'solid rock'
                : p.bad === 'dup'   ? 'already joined'
                : p.bad ? '' : p.cost + (S.tool === 'rope' ? ' rope' : ' timber');
    cost.textContent = label;
    cost.style.color = info.ok ? 'rgba(232,226,214,.92)' : '#d4552a';
    cost.style.left = info.sx + 'px';
    cost.style.top = info.sy + 'px';
    cost.style.opacity = label ? 1 : 0;
  } else cost.style.opacity = 0;

  if (playing){ UI.syncHUD(); UI.tickTutorial(); }
  R.frame(raw);

  if (!window.__corbelBooted){
    window.__corbelBooted = true;
    el('boot').classList.add('gone');
  }
  lastPaint = performance.now();
}

function frame(now){
  const raw = (now - last) / 1000;
  last = now;
  tick(raw);
  requestAnimationFrame(frame);
}

// RAF stops entirely in a hidden panel or a background tab — and a renderer that
// never runs looks identical to a crashed one. Drive a real frame on wall-clock
// so the game keeps running (and reports itself booted) either way.
setInterval(() => {
  const now = performance.now();
  if (now - lastPaint < 400) return;
  const raw = Math.min((now - last) / 1000, 0.5);
  last = now;
  try { tick(raw); } catch (e) { window.__corbelFail?.(e.message); }
}, 200);

/* ------------------------- headless test surface -------------------------- */
window.CORBEL = {
  S, SIM, R, A, UI, TUNE: SIM.TUNE, LEVEL: SIM.LEVEL,
  step: SIM.step, resetLevel: SIM.resetLevel,
  startTest: SIM.startTest, backToBuild: SIM.backToBuild,
  show: UI.show, beginPlay,
  place(ax, ay, bx, by, type = 'beam'){
    let a = SIM.findPoint(ax, ay, SIM.CELL * 0.5);
    if (a < 0){ if (SIM.inRock(ax, ay)) return false; a = SIM.addPoint(ax, ay, false); }
    let b = SIM.findPoint(bx, by, SIM.CELL * 0.5);
    if (b < 0){ if (SIM.inRock(bx, by)) return false; b = SIM.addPoint(bx, by, false); }
    if (a === b || SIM.linkExists(a, b)) return false;
    const rest = Math.hypot(S.points[b].x - S.points[a].x, S.points[b].y - S.points[a].y);
    const cost = SIM.costOf(rest);
    if (cost > S.stock[type]) return false;
    S.stock[type] -= cost;
    SIM.addLink(a, b, type);
    return true;
  },
  sim(maxSeconds = 90){
    SIM.startTest();
    let t = 0, peak = 0;
    while (t < maxSeconds && S.phase === 'test'){
      SIM.step(SIM.DT); t += SIM.DT;
      peak = Math.max(peak, R.peakStress());
    }
    return { phase: S.phase, across: S.across, lost: S.lost, seconds: +t.toFixed(2),
             broken: S.links.filter(l => l.broken).length, peakStress: +peak.toFixed(2),
             stranded: S.walkers.filter(w => w.stranded).length,
             why: S.phase === 'lost' ? UI.postMortem() : null,
             stockLeft: { ...S.stock } };
  },
};

/* ---------------------------------- boot ---------------------------------- */
SIM.resetLevel();
UI.show('title');
R.setCameraMode('title');
requestAnimationFrame(frame);
