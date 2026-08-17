/* ============================================================================
   CORBEL — procedural audio. No sample files; everything is synthesised.

   The important one is the creak. Load already has a colour; giving it a sound
   means you can hear a span going before you can see which member is doing it.
   ========================================================================== */

let ctx = null, ready = false;
let master, ambBus, sfxBus;
let noiseBuf = null;
let windGain, windFilter, fireGain, creakGain, creakFilter, crowdGain;
let creakTimer = 0, stressNow = 0, crowdNow = 0, windLfo = 0;

export const settings = { master: 0.75, ambience: 0.8, effects: 0.9, music: 0.55, muted: false };

let musicBus, musicSrc, musicLoading = false, duck = 1;

function makeNoise(seconds = 2){
  const n = ctx.sampleRate * seconds;
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  // Brownian-ish noise: less hissy than white, sits better under everything.
  let v = 0;
  for (let i = 0; i < n; i++){
    v = (v + (Math.random() * 2 - 1) * 0.09) * 0.985;
    d[i] = v * 3.2;
  }
  return buf;
}

function loopSource(buf, gainNode, rate = 1){
  const s = ctx.createBufferSource();
  s.buffer = buf; s.loop = true; s.playbackRate.value = rate;
  s.connect(gainNode); s.start();
  return s;
}

/** Must be called from a user gesture — browsers refuse audio otherwise. */
export function unlock(){
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();

  master = ctx.createGain(); master.gain.value = settings.muted ? 0 : settings.master;
  master.connect(ctx.destination);
  ambBus = ctx.createGain(); ambBus.gain.value = settings.ambience; ambBus.connect(master);
  sfxBus = ctx.createGain(); sfxBus.gain.value = settings.effects; sfxBus.connect(master);
  musicBus = ctx.createGain(); musicBus.gain.value = settings.music; musicBus.connect(master);

  noiseBuf = makeNoise();

  // --- wind bed -----------------------------------------------------------
  windFilter = ctx.createBiquadFilter();
  windFilter.type = 'bandpass'; windFilter.frequency.value = 420; windFilter.Q.value = 0.7;
  windGain = ctx.createGain(); windGain.gain.value = 0.16;
  windFilter.connect(windGain); windGain.connect(ambBus);
  loopSource(noiseBuf, windFilter, 0.85);

  // --- distant fires, off to the left -------------------------------------
  const fireFilter = ctx.createBiquadFilter();
  fireFilter.type = 'lowpass'; fireFilter.frequency.value = 190;
  const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  fireGain = ctx.createGain(); fireGain.gain.value = 0.10;
  fireFilter.connect(fireGain);
  if (pan){ pan.pan.value = -0.65; fireGain.connect(pan); pan.connect(ambBus); }
  else fireGain.connect(ambBus);
  loopSource(noiseBuf, fireFilter, 0.42);

  // --- timber creak, driven by load ---------------------------------------
  creakFilter = ctx.createBiquadFilter();
  creakFilter.type = 'bandpass'; creakFilter.frequency.value = 240; creakFilter.Q.value = 6;
  creakGain = ctx.createGain(); creakGain.gain.value = 0;
  creakFilter.connect(creakGain); creakGain.connect(ambBus);
  loopSource(noiseBuf, creakFilter, 0.55);

  // --- crowd shuffle, scaled by how many are on the span ------------------
  const crowdFilter = ctx.createBiquadFilter();
  crowdFilter.type = 'bandpass'; crowdFilter.frequency.value = 900; crowdFilter.Q.value = 0.9;
  crowdGain = ctx.createGain(); crowdGain.gain.value = 0;
  crowdFilter.connect(crowdGain); crowdGain.connect(ambBus);
  loopSource(noiseBuf, crowdFilter, 1.6);

  ready = true;
  applySettings();
}

export function applySettings(){
  if (!ready) return;
  master.gain.setTargetAtTime(settings.muted ? 0 : settings.master, ctx.currentTime, 0.05);
  ambBus.gain.setTargetAtTime(settings.ambience, ctx.currentTime, 0.05);
  sfxBus.gain.setTargetAtTime(settings.effects, ctx.currentTime, 0.05);
  musicBus?.gain.setTargetAtTime(settings.music * duck, ctx.currentTime, 0.05);
}

/**
 * The score is the one thing synthesis here cannot do well, so it is a file.
 * Everything else stays procedural because it has to answer to the simulation.
 * Fetched lazily on first play so a 3MB download never blocks the title screen,
 * and entirely optional — if it fails the game carries on without it.
 */
export async function startMusic(url = './audio/crossing-theme.ogg'){
  if (!ready || musicSrc || musicLoading) return false;
  musicLoading = true;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const buf = await ctx.decodeAudioData(await res.arrayBuffer());
    musicSrc = ctx.createBufferSource();
    musicSrc.buffer = buf;
    musicSrc.loop = true;
    musicSrc.connect(musicBus);
    musicSrc.start();
    return true;
  } catch (e){
    console.warn('CORBEL: music unavailable —', e.message);
    return false;
  } finally { musicLoading = false; }
}

export function stopMusic(){
  if (!musicSrc) return;
  try { musicSrc.stop(); } catch {}
  musicSrc = null;
}
export const musicPlaying = () => !!musicSrc;

export function suspend(){ if (ready && ctx.state === 'running') ctx.suspend(); }
export function resume(){ if (ready && ctx.state === 'suspended') ctx.resume(); }

/* ------------------------------- one-shots -------------------------------- */
function ping({ freq = 220, dur = 0.2, type = 'sine', gain = 0.2, sweep = 0, q = 1 }){
  if (!ready) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (sweep) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * sweep), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = freq * 6; f.Q.value = q;
  o.connect(f); f.connect(g); g.connect(sfxBus);
  o.start(t); o.stop(t + dur + 0.02);
}

function burst({ dur = 0.25, freq = 900, q = 3, gain = 0.3, rate = 1 }){
  if (!ready) return;
  const t = ctx.currentTime;
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf; s.playbackRate.value = rate;
  s.loopStart = Math.random() * 1.5;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
  f.frequency.exponentialRampToValueAtTime(Math.max(60, freq * 0.35), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(sfxBus);
  s.start(t); s.stop(t + dur + 0.02);
}

/** A member has failed. Sharp crack, then the timber tumbling. */
export function snap(){
  burst({ dur: 0.16, freq: 2200, q: 1.4, gain: 0.5, rate: 1.7 });
  ping({ freq: 150, dur: 0.34, type: 'triangle', gain: 0.28, sweep: 0.35 });
  setTimeout(() => burst({ dur: 0.5, freq: 380, q: 0.9, gain: 0.16, rate: 0.7 }), 70);
}

/** Someone has gone into the gorge. */
export function fall(){
  ping({ freq: 420, dur: 1.5, type: 'sine', gain: 0.10, sweep: 0.16 });
}

export function place(type){
  if (type === 'rope') burst({ dur: 0.12, freq: 1500, q: 2.5, gain: 0.14, rate: 1.4 });
  else { ping({ freq: 330, dur: 0.1, type: 'square', gain: 0.07 });
         burst({ dur: 0.09, freq: 700, q: 2, gain: 0.16, rate: 1.1 }); }
}
export function remove(){ burst({ dur: 0.1, freq: 500, q: 2, gain: 0.13, rate: 0.9 }); }
export function deny(){ ping({ freq: 150, dur: 0.14, type: 'square', gain: 0.10, sweep: 0.7 }); }
export function click(){ ping({ freq: 620, dur: 0.05, type: 'sine', gain: 0.10 }); }

export function won(){
  [0, 0.13, 0.28].forEach((d, i) =>
    setTimeout(() => ping({ freq: [262, 349, 523][i], dur: 1.5, type: 'sine', gain: 0.13 }), d * 1000));
}
export function lost(){
  [0, 0.16].forEach((d, i) =>
    setTimeout(() => ping({ freq: [196, 147][i], dur: 2.0, type: 'sine', gain: 0.15 }), d * 1000));
}

/* -------------------------------- per-frame ------------------------------- */
/**
 * @param stress  peak load across the structure, 0..1+
 * @param crowd   how many people are currently on the span
 * @param dt      seconds
 */
export function update(stress, crowd, dt){
  if (!ready) return;
  stressNow += (stress - stressNow) * 0.1;
  crowdNow  += (crowd  - crowdNow)  * 0.06;
  const t = ctx.currentTime;

  // Wind breathes on its own slow cycle.
  windLfo += dt * 0.21;
  const gust = 0.5 + 0.5 * Math.sin(windLfo) * Math.sin(windLfo * 0.37 + 1.1);
  windGain.gain.setTargetAtTime(0.10 + gust * 0.14, t, 0.4);
  windFilter.frequency.setTargetAtTime(330 + gust * 320, t, 0.5);

  crowdGain.gain.setTargetAtTime(Math.min(0.5, crowdNow) * 0.05, t, 0.15);

  // Pull the score back as the span strains, so the creak is what you hear at
  // the moment it matters. The music returns once the load comes off.
  const want = 1 - Math.min(0.72, Math.max(0, stressNow - 0.25) * 1.1);
  duck += (want - duck) * 0.04;
  musicBus?.gain.setTargetAtTime(settings.music * duck, t, 0.2);

  // Creak rides load: louder, brighter and more frequent as the span strains.
  const s = Math.min(1.4, stressNow);
  creakGain.gain.setTargetAtTime(s > 0.12 ? (s - 0.12) * 0.22 : 0, t, 0.12);
  creakFilter.frequency.setTargetAtTime(180 + s * 420, t, 0.2);

  creakTimer -= dt;
  if (s > 0.35 && creakTimer <= 0){
    creakTimer = Math.max(0.16, 1.5 - s * 1.1) * (0.6 + Math.random() * 0.8);
    burst({ dur: 0.20 + Math.random() * 0.25, freq: 170 + Math.random() * 260 + s * 200,
            q: 7, gain: 0.05 + s * 0.13, rate: 0.5 + Math.random() * 0.4 });
  }
}

export function isReady(){ return ready; }
