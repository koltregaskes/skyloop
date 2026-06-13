// SKYLOOP audio engine.
//
// Design: each cue tries a generated sample first (assets/audio/*.mp3 — e.g.
// ElevenLabs sound-generation output) and falls back to live WebAudio
// synthesis if the file is absent or fails to decode. So the prototype sounds
// good with zero external dependencies today, and automatically upgrades to
// higher-quality generated SFX the moment those files are dropped in — no code
// change needed. An ambient wind/pad drone is always synthesised and rises with
// boost. Press M to mute.

// Generated samples are discovered via assets/audio/manifest.json so that
// missing files never 404. The manifest maps cue name -> file under
// assets/audio/. An empty map means everything is synthesised live.
const MANIFEST_URL = './assets/audio/manifest.json';

export function createAudio() {
  let ctx = null;
  let master = null;
  let muted = false;
  const buffers = {};       // decoded one-shot samples, keyed by cue name
  let musicBuffer = null;   // optional looping background track
  let musicPlaying = false; // true once the looping bed starts
  let ambient = null;       // { gain, setBoost(amount) } once started

  function ensure() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
    // Load any generated samples listed in the manifest, in the background.
    fetch(MANIFEST_URL)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('no manifest'))))
      .then((m) => {
        for (const [name, file] of Object.entries(m.samples || {})) {
          fetch(`./assets/audio/${file}`)
            .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('404'))))
            .then((data) => ctx.decodeAudioData(data))
            .then((buf) => { buffers[name] = buf; })
            .catch(() => { /* listed but unreadable — synth fallback */ });
        }
        if (m.music) {
          fetch(`./assets/audio/${m.music}`)
            .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('404'))))
            .then((data) => ctx.decodeAudioData(data))
            .then((buf) => { musicBuffer = buf; if (ambient) ambient.startMusic(); })
            .catch(() => { /* no music bed — synth drone carries it */ });
        }
      })
      .catch(() => { /* no manifest — everything synthesised */ });
  }

  function resume() { ensure(); if (ctx && ctx.state === 'suspended') ctx.resume(); }

  function playSample(name, { rate = 1, gain = 0.9 } = {}) {
    if (!buffers[name]) return false;
    const src = ctx.createBufferSource();
    src.buffer = buffers[name];
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(master);
    src.start();
    return true;
  }

  // --- synth fallbacks -------------------------------------------------------

  function blip(freq, { type = 'sine', dur = 0.4, peak = 0.16, detune = 0 } = {}) {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.detune.value = detune;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function synthRing(combo) {
    // Bright two-layer pluck; pitch climbs with the combo multiplier.
    const base = 660 * Math.pow(2, Math.min(combo - 1, 11) / 12);
    blip(base, { type: 'triangle', dur: 0.5, peak: 0.16 });
    blip(base * 2, { type: 'sine', dur: 0.32, peak: 0.07, detune: 4 });
  }

  function synthBoost() {
    // Noise whoosh swept through a rising band-pass filter.
    const t = ctx.currentTime;
    const dur = 0.9;
    const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.1;
    bp.frequency.setValueAtTime(280, t);
    bp.frequency.exponentialRampToValueAtTime(2400, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp).connect(g).connect(master);
    src.start(t);
  }

  function synthWin() {
    // Rising major arpeggio + shimmer.
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => setTimeout(() => {
      if (ctx) { blip(f, { type: 'triangle', dur: 0.6, peak: 0.16 }); blip(f * 2, { type: 'sine', dur: 0.4, peak: 0.05 }); }
    }, i * 130));
  }

  // --- ambient drone ---------------------------------------------------------

  function startAmbient() {
    if (!ctx || ambient) return;
    const g = ctx.createGain();
    g.gain.value = 0.0;
    g.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 2);
    g.connect(master);
    // Two slightly detuned low oscillators = a calm pad.
    for (const f of [110, 110.7, 164.81]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = 0.33;
      o.connect(og).connect(g);
      o.start();
    }
    // Gentle filtered wind that intensifies with boost.
    const windBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const wd = windBuf.getChannelData(0);
    for (let i = 0; i < wd.length; i++) wd[i] = Math.random() * 2 - 1;
    const wind = ctx.createBufferSource();
    wind.buffer = windBuf;
    wind.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 600;
    const windGain = ctx.createGain();
    windGain.gain.value = 0.015;
    wind.connect(lp).connect(windGain).connect(g);
    wind.start();
    // When a generated music bed is present, drop the synth pad right back so
    // the two don't fight — the pad becomes a quiet underlay.
    let musicSource = null;
    function startMusic() {
      if (!ctx || !musicBuffer || musicSource) return;
      musicSource = ctx.createBufferSource();
      musicSource.buffer = musicBuffer;
      musicSource.loop = true;
      const mg = ctx.createGain();
      mg.gain.value = 0.0;
      mg.gain.linearRampToValueAtTime(0.32, ctx.currentTime + 3);
      musicSource.connect(mg).connect(master);
      musicSource.start();
      musicPlaying = true;
      g.gain.setTargetAtTime(0.018, ctx.currentTime, 1.5); // duck the synth pad
    }

    ambient = {
      gain: g,
      startMusic,
      setBoost(amount) {
        if (!ctx) return;
        windGain.gain.setTargetAtTime(0.015 + amount * 0.07, ctx.currentTime, 0.2);
        lp.frequency.setTargetAtTime(600 + amount * 1400, ctx.currentTime, 0.2);
      },
    };
    if (musicBuffer) startMusic(); // music may have loaded before ambient started
  }

  // --- public API ------------------------------------------------------------

  return {
    resume,
    toggleMute() { muted = !muted; if (master) master.gain.value = muted ? 0 : 0.9; return muted; },
    ring(combo = 1) { if (!ctx || muted) return; if (!playSample('ring', { rate: 1 + (combo - 1) * 0.04 })) synthRing(combo); },
    boost() { if (!ctx || muted) return; if (!playSample('boost')) synthBoost(); },
    win() { if (!ctx || muted) return; if (!playSample('win')) synthWin(); },
    startAmbient,
    setBoost(amount) { if (ambient) ambient.setBoost(amount); },
    status() {
      return {
        ctxState: ctx ? ctx.state : 'none',
        muted,
        ambient: !!ambient,
        music: musicPlaying,
        samplesLoaded: Object.keys(buffers),
      };
    },
  };
}
