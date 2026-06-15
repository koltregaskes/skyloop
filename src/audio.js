// SKYLOOP 2.0 audio engine.
//
// - Two looping music beds (menu + gameplay) that crossfade on state changes.
//   Both are generated tracks listed in assets/audio/manifest.json; whichever is
//   missing is simply skipped. An always-on synth wind/pad underlay fills in and
//   swells with boost, so there is always sound even with no generated audio.
// - One-shot SFX cues (ring/boost/win/count/go) prefer generated samples
//   (manifest "samples") and fall back to live WebAudio synthesis.
// Press M to mute.

const MANIFEST_URL = './assets/audio/manifest.json';

export function createAudio() {
  let ctx = null, master = null, muted = false, started = false;
  const buffers = {};                 // one-shot SFX samples
  const voices = {};                  // ElevenLabs announcer clips, keyed by cue
  let lastVoiceAt = -10;              // throttle so callouts never stack
  const music = { menu: null, gameplay: null }; // { buffer, source, gain }
  let musicTarget = 'menu';
  let ambient = null;                 // { setBoost }

  function ensure() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    ctx = new AC(); master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
    fetch(MANIFEST_URL).then((r) => r.ok ? r.json() : Promise.reject()).then((m) => {
      for (const [name, file] of Object.entries(m.samples || {})) load(`./assets/audio/${file}`, (b) => { buffers[name] = b; });
      for (const [name, file] of Object.entries(m.voice || {})) load(`./assets/audio/${file}`, (b) => { voices[name] = b; });
      if (m.music) load(`./assets/audio/${m.music}`, (b) => startMusic('menu', b));
      if (m.musicGameplay) load(`./assets/audio/${m.musicGameplay}`, (b) => startMusic('gameplay', b));
    }).catch(() => {});
  }
  function load(url, cb) { fetch(url).then((r) => r.ok ? r.arrayBuffer() : Promise.reject()).then((d) => ctx.decodeAudioData(d)).then(cb).catch(() => {}); }

  function startMusic(which, buffer) {
    const src = ctx.createBufferSource(); src.buffer = buffer; src.loop = true;
    const gain = ctx.createGain(); gain.gain.value = 0; src.connect(gain).connect(master); src.start();
    music[which] = { buffer, source: src, gain };
    applyMusic();
  }
  function applyMusic() {
    const now = ctx ? ctx.currentTime : 0;
    for (const which of ['menu', 'gameplay']) {
      const m = music[which]; if (!m) continue;
      const want = which === musicTarget ? (which === 'gameplay' ? 0.42 : 0.34) : 0;
      m.gain.gain.setTargetAtTime(want, now, 0.6);
    }
    // If the desired track is missing, lean on the other one so there's still music.
    if (!music[musicTarget]) { const other = musicTarget === 'menu' ? 'gameplay' : 'menu'; if (music[other]) music[other].gain.gain.setTargetAtTime(0.3, now, 0.6); }
  }

  function resume() { ensure(); if (ctx && ctx.state === 'suspended') ctx.resume(); if (!started) { started = true; startAmbient(); } }

  function startAmbient() {
    if (!ctx || ambient) return;
    const g = ctx.createGain(); g.gain.value = 0.0; g.gain.linearRampToValueAtTime(0.04, ctx.currentTime + 2); g.connect(master);
    for (const f of [110, 110.7, 164.81]) { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f; const og = ctx.createGain(); og.gain.value = 0.3; o.connect(og).connect(g); o.start(); }
    const wb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const wd = wb.getChannelData(0); for (let i = 0; i < wd.length; i++) wd[i] = Math.random() * 2 - 1;
    const wind = ctx.createBufferSource(); wind.buffer = wb; wind.loop = true; const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600; const wg = ctx.createGain(); wg.gain.value = 0.014; wind.connect(lp).connect(wg).connect(g); wind.start();
    ambient = { setBoost(a) { if (!ctx) return; wg.gain.setTargetAtTime(0.014 + a * 0.06, ctx.currentTime, 0.2); lp.frequency.setTargetAtTime(600 + a * 1500, ctx.currentTime, 0.2); } };
  }

  function playSample(name, { rate = 1, gain = 0.9 } = {}) { if (!buffers[name]) return false; const s = ctx.createBufferSource(); s.buffer = buffers[name]; s.playbackRate.value = rate; const g = ctx.createGain(); g.gain.value = gain; s.connect(g).connect(master); s.start(); return true; }

  function blip(freq, { type = 'sine', dur = 0.4, peak = 0.16, detune = 0, delay = 0 } = {}) {
    const t = ctx.currentTime + delay; const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t); o.detune.value = detune;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.02);
  }
  function noiseWhoosh() {
    const t = ctx.currentTime, dur = 0.9; const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate); const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const s = ctx.createBufferSource(); s.buffer = buf; const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.1; bp.frequency.setValueAtTime(280, t); bp.frequency.exponentialRampToValueAtTime(2400, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.2, t + 0.08); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(bp).connect(g).connect(master); s.start(t);
  }

  return {
    resume,
    toMenu() { musicTarget = 'menu'; applyMusic(); },
    toGameplay() { resume(); musicTarget = 'gameplay'; applyMusic(); },
    toggleMute() { muted = !muted; if (master) master.gain.value = muted ? 0 : 0.9; return muted; },
    ring(combo = 1, type = 'standard') {
      if (!ctx || muted) return;
      if (playSample('ring', { rate: 1 + (combo - 1) * 0.04 })) return;
      const base = (type === 'gold' ? 880 : 660) * Math.pow(2, Math.min(combo - 1, 11) / 12);
      blip(base, { type: type === 'gold' ? 'sine' : 'triangle', dur: 0.5, peak: 0.16 });
      blip(base * 2, { type: 'sine', dur: 0.3, peak: 0.06, detune: 4 });
      if (type === 'boost') blip(base * 1.5, { type: 'sawtooth', dur: 0.25, peak: 0.05, delay: 0.04 });
    },
    boost() { if (!ctx || muted) return; if (!playSample('boost')) noiseWhoosh(); },
    win() { if (!ctx || muted) return; if (playSample('win')) return; [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => blip(f, { type: 'triangle', dur: 0.6, peak: 0.15, delay: i * 0.13 })); },
    count() { if (!ctx || muted) return; blip(440, { type: 'square', dur: 0.2, peak: 0.1 }); },
    go() { if (!ctx || muted) return; blip(880, { type: 'square', dur: 0.4, peak: 0.14 }); blip(1320, { type: 'triangle', dur: 0.4, peak: 0.08, delay: 0.02 }); },
    setBoost(a) { if (ambient) ambient.setBoost(a); },
    // ElevenLabs announcer. force=true bypasses the anti-stacking throttle
    // (used for countdown/rank where every clip should land).
    say(name, { force = false, gain = 1.0 } = {}) {
      if (!ctx || muted || !voices[name]) return false;
      const now = ctx.currentTime;
      if (!force && now - lastVoiceAt < 0.6) return false;
      lastVoiceAt = now;
      const s = ctx.createBufferSource(); s.buffer = voices[name];
      const g = ctx.createGain(); g.gain.value = gain; s.connect(g).connect(master); s.start();
      // brief music duck so the voice sits on top
      for (const which of ['menu', 'gameplay']) { const mu = music[which]; if (mu && mu.gain.gain.value > 0.01) { const base = mu.gain.gain.value; mu.gain.gain.cancelScheduledValues(now); mu.gain.gain.setValueAtTime(base * 0.5, now); mu.gain.gain.setTargetAtTime(base, now + 0.5, 0.4); } }
      return true;
    },
    hasVoice() { return Object.keys(voices).length > 0; },
    status() { return { ctxState: ctx ? ctx.state : 'none', muted, ambient: !!ambient, music: musicTarget, menuLoaded: !!music.menu, gameplayLoaded: !!music.gameplay, samplesLoaded: Object.keys(buffers), voicesLoaded: Object.keys(voices) }; },
  };
}
