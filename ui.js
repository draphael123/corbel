/* ============================================================================
   CORBEL — screens, settings, and the tutorial.

   The tutorial teaches by doing: each step highlights the exact place to act and
   advances on a real condition in the simulation, never on a timer. And when a
   span fails we say WHY, because "it broke" teaches nobody anything.
   ========================================================================== */

let SIM, S, R, A;
const el = id => document.getElementById(id);

export const prefs = {
  master: 0.75, ambience: 0.8, effects: 0.9, music: 0.55, muted: false,
  shadows: true, shake: true, cvdPalette: false, reducedMotion: false,
  tutorialDone: false,
};

let screen = 'title';          // title | playing | settings | howto
let tutStep = -1, tutSeen = new Set(), lastPhase = '';

/* ------------------------------- persistence ------------------------------ */
function load(){
  try {
    const raw = localStorage.getItem('corbel.prefs');
    if (raw) Object.assign(prefs, JSON.parse(raw));
  } catch {}
}
function save(){
  try { localStorage.setItem('corbel.prefs', JSON.stringify(prefs)); } catch {}
}

/* --------------------------- structural analysis -------------------------- */
// Used by the tutorial to know when a lesson has actually landed, and by the
// post-mortem to explain a collapse.
// `asBuilt` judges the structure the player actually made, ignoring what has
// since snapped. The post-mortem must use it — otherwise a truss that failed is
// told it never triangulated, which is both wrong and the opposite of the lesson.
function adjacency(asBuilt){
  const adj = new Map();
  for (const l of S.links){
    if (l.broken && !asBuilt) continue;
    if (!adj.has(l.a)) adj.set(l.a, new Set());
    if (!adj.has(l.b)) adj.set(l.b, new Set());
    adj.get(l.a).add(l.b); adj.get(l.b).add(l.a);
  }
  return adj;
}

export function hasTriangle(asBuilt = false){
  const adj = adjacency(asBuilt);
  for (const [, nb] of adj){
    const arr = [...nb];
    for (let i = 0; i < arr.length; i++)
      for (let j = i + 1; j < arr.length; j++)
        if (adj.get(arr[i])?.has(arr[j])) return true;
  }
  return false;
}

/** Is there a walkable path of shallow members from the near lip to the far one? */
export function deckConnected(asBuilt = false){
  const WALKABLE = 1.2;
  const adj = new Map();
  for (const l of S.links){
    if (l.broken && !asBuilt) continue;
    const a = S.points[l.a], b = S.points[l.b];
    if (Math.abs(b.y - a.y) > Math.abs(b.x - a.x) * WALKABLE) continue;
    if (!adj.has(l.a)) adj.set(l.a, []);
    if (!adj.has(l.b)) adj.set(l.b, []);
    adj.get(l.a).push(l.b); adj.get(l.b).push(l.a);
  }
  const starts = [], goals = new Set();
  S.points.forEach((p, i) => {
    if (!p.pinned) return;
    if (p.x <= SIM.LEFT_EDGE) starts.push(i);
    if (p.x >= SIM.RIGHT_EDGE) goals.add(i);
  });
  const seen = new Set(starts), q = [...starts];
  while (q.length){
    const n = q.shift();
    if (goals.has(n)) return true;
    for (const m of (adj.get(n) || [])) if (!seen.has(m)){ seen.add(m); q.push(m); }
  }
  return false;
}

function longestBroken(){
  let m = null;
  for (const l of S.links) if (l.broken && (!m || l.rest > m.rest)) m = l;
  return m;
}

/** Why did this crossing fail? Returns a short, specific sentence. */
export function postMortem(){
  const stranded = S.walkers.filter(w => w.stranded).length;
  const broke = S.links.filter(l => l.broken).length;

  // Nothing snapped — so this was never a structural failure. Either the span
  // did not reach, or it reached but nobody could walk it.
  if (!broke){
    if (!deckConnected(true))
      return 'Nothing carried them. A walkable deck has to run unbroken from one lip ' +
             'to the other — and anything steeper than a gentle ramp counts as structure, ' +
             'not floor, so they will not climb it.';
    if (stranded)
      return 'The deck reached, but they could not get along it. Look for the step or ' +
             'the gap where the crowd piled up and stopped.';
    return 'They walked into the gorge. Check that the deck actually meets both lips.';
  }

  // Something snapped. Judge the structure as it was BUILT, not as it survived.
  if (!hasTriangle(true))
    return 'A flat deck bends until it breaks. A triangle cannot change shape without ' +
           'changing the length of a member — which is why triangulation holds and a ladder does not.';
  const lb = longestBroken();
  if (lb && lb.rest >= SIM.CELL * 3)
    return 'The longest members went first. Timber buckles as it gets longer, so more ' +
           'joints and shorter members carry far more than one heroic span.';
  return 'It carried them partway and then lost a member. Add bracing where the timber ' +
         'ran red, or hang some of the weight from rope.';
}

/* -------------------------------- tutorial -------------------------------- */
const STEPS = [
  {
    title: 'The gorge',
    body: 'They are coming, and the far side is the only safe ground. ' +
          'Build something that will carry them.',
    hint: 'Drag from the iron anchor on the near lip to the joint beside it.',
    focus: () => {
      const p = S.points.find(q => q.pinned && q.x >= SIM.LEFT_EDGE);
      return p ? [p.x, p.y] : null;
    },
    done: () => S.links.length >= 1,
  },
  {
    title: 'Timber',
    body: 'Timber is priced by length and paid from the stock in the corner. ' +
          'It takes both push and pull — but the longer you cut it, the sooner it buckles.',
    hint: 'Carry the deck all the way to the far anchor.',
    done: () => deckConnected(),
  },
  {
    title: 'Why it will fall',
    body: 'A flat deck is a row of squares, and a square folds. A triangle cannot ' +
          'change shape unless a member changes length.',
    hint: 'Build upward from the deck and close the shapes into triangles.',
    done: () => hasTriangle(),
  },
  {
    title: 'Reading the load',
    body: 'Colour is force. Timber runs from its own brown through amber to red as ' +
          'load passes through it. Red means that member is about to go.',
    hint: 'Rope is on 2. It only pulls — it hangs slack until something tightens it.',
    done: () => false,           // advanced by the player pressing on
    manual: true,
  },
  {
    title: 'Send them across',
    body: 'You will not get a second chance at this crowd, and the next one is larger.',
    hint: 'Press Space.',
    done: () => S.phase !== 'build',
  },
];

export function startTutorial(){ tutStep = 0; tutSeen.clear(); renderTutorial(); }
export function stopTutorial(){
  tutStep = -1;
  prefs.tutorialDone = true; save();
  el('tut').classList.remove('on');
  el('focusRing').classList.remove('on');
}
export const tutorialActive = () => tutStep >= 0 && tutStep < STEPS.length;

function renderTutorial(){
  const box = el('tut');
  if (!tutorialActive()){ box.classList.remove('on'); el('focusRing').classList.remove('on'); return; }
  const s = STEPS[tutStep];
  el('tutStep').textContent = `${tutStep + 1} / ${STEPS.length}`;
  el('tutTitle').textContent = s.title;
  el('tutBody').textContent = s.body;
  el('tutHint').textContent = s.hint || '';
  el('tutNext').style.display = s.manual ? '' : 'none';
  box.classList.add('on');
}

export function tickTutorial(){
  if (!tutorialActive()) return;
  const s = STEPS[tutStep];

  const f = s.focus?.();
  const ring = el('focusRing');
  if (f && R){
    const [sx, sy] = R.screenOf(f[0], f[1]);
    ring.style.left = sx + 'px'; ring.style.top = sy + 'px';
    ring.classList.add('on');
  } else ring.classList.remove('on');

  if (!s.manual && s.done()){
    tutStep++;
    if (tutStep >= STEPS.length) stopTutorial(); else renderTutorial();
  }
}
export function tutorialNext(){
  if (!tutorialActive()) return;
  tutStep++;
  if (tutStep >= STEPS.length) stopTutorial(); else renderTutorial();
}

/* --------------------------------- screens -------------------------------- */
export function show(name){
  screen = name;
  for (const id of ['title', 'settings', 'howto'])
    el(id).classList.toggle('on', id === name);
  el('hudWrap').classList.toggle('on', name === 'playing');
  if (R) R.setCameraMode(name === 'playing' ? 'play' : 'title');
}
export const current = () => screen;

/* --------------------------------- settings ------------------------------- */
function bindToggle(id, keyName, onChange){
  const node = el(id);
  const paint = () => node.setAttribute('aria-checked', String(!!prefs[keyName]));
  node.addEventListener('click', () => {
    prefs[keyName] = !prefs[keyName];
    paint(); save(); onChange?.(); A?.click();
  });
  paint();
}
function bindSlider(id, keyName, onChange){
  const node = el(id);
  node.value = Math.round(prefs[keyName] * 100);
  node.addEventListener('input', () => {
    prefs[keyName] = node.value / 100;
    save(); onChange?.();
  });
}

export function initSettings(){
  const applyAudio = () => {
    if (!A) return;
    Object.assign(A.settings, {
      master: prefs.master, ambience: prefs.ambience,
      effects: prefs.effects, music: prefs.music, muted: prefs.muted,
    });
    A.applySettings();
  };
  const applyRender = () => {
    if (!R) return;
    Object.assign(R.opts, {
      shadows: prefs.shadows, shake: prefs.shake,
      cvdPalette: prefs.cvdPalette, reducedMotion: prefs.reducedMotion,
    });
    R.applyOptions();
    document.documentElement.style.setProperty('--timber', R.restColour());
  };

  bindSlider('setMaster', 'master', applyAudio);
  bindSlider('setAmb', 'ambience', applyAudio);
  bindSlider('setSfx', 'effects', applyAudio);
  bindSlider('setMusic', 'music', applyAudio);
  bindToggle('setMute', 'muted', applyAudio);
  bindToggle('setShadows', 'shadows', applyRender);
  bindToggle('setShake', 'shake', applyRender);
  bindToggle('setCvd', 'cvdPalette', applyRender);
  bindToggle('setMotion', 'reducedMotion', applyRender);

  applyAudio(); applyRender();
}

/* ----------------------------------- HUD ---------------------------------- */
export function syncHUD(){
  const L = SIM.LEVEL;
  el('nTimber').textContent = S.stock.beam;
  el('nRope').textContent = S.stock.rope;
  el('rowTimber').className = 'row' + (S.tool === 'beam' ? ' sel' : '') + (S.stock.beam ? '' : ' out');
  el('rowRope').className = 'row' + (S.tool === 'rope' ? ' sel' : '') + (S.stock.rope ? '' : ' out');
  el('nAcross').textContent = S.across;
  el('nTotal').textContent = L.walkers;
  el('nLost').textContent = S.lost;
  el('crossing').classList.toggle('any-lost', S.lost > 0);

  el('hint').innerHTML = S.phase === 'build'
    ? 'drag between joints &nbsp;·&nbsp; <b>1</b> timber &nbsp; <b>2</b> rope &nbsp;·&nbsp; right-click removes &nbsp;·&nbsp; <b>space</b> sends them &nbsp;·&nbsp; <b>?</b> help'
    : S.phase === 'test' ? '<b>space</b> to call it off'
    : '<b>space</b> to rebuild &nbsp;·&nbsp; <b>R</b> to start over';

  if (S.phase !== lastPhase){
    lastPhase = S.phase;
    const v = el('verdict');
    if (S.phase === 'won' || S.phase === 'lost'){
      v.className = 'overlay on' + (S.phase === 'lost' ? ' fail' : '');
      el('vBig').textContent = S.phase === 'won' ? 'ALL ACROSS' : 'THE SPAN GAVE';
      el('vSmall').textContent = S.phase === 'won'
        ? `${S.across} souls · the next crowd is larger`
        : `${S.lost} ${S.lost === 1 ? 'soul' : 'souls'} lost`;
      el('vWhy').textContent = S.phase === 'lost' ? postMortem() : '';
      A?.[S.phase === 'won' ? 'won' : 'lost']?.();
    } else v.className = 'overlay';
  }
}

export function init(sim, render, audio){
  SIM = sim; S = sim.S; R = render; A = audio;
  load();
  initSettings();
  return prefs;
}
export { save as savePrefs };
