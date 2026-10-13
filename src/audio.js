// Synthesized sound effects (Web Audio). Sounds are pre-rendered once with an
// OfflineAudioContext into buffers (several variants each), so playback is cheap.
// Everything is routed through a small "room" reverb so it sounds like it's indoors.

const SR = 44100;

function makeNoise(ctx, seconds) {
  const b = ctx.createBuffer(1, Math.ceil(seconds * ctx.sampleRate), ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

// tiny helper DSL for offline rendering
function voice(ctx, noiseBuf) {
  const env = (param, t, peak, attack, decay, curve = 'exp') => {
    param.setValueAtTime(0.0001, t);
    param.exponentialRampToValueAtTime(peak, t + attack);
    if (curve === 'exp') param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    else param.linearRampToValueAtTime(0, t + attack + decay);
  };
  return {
    noise({ t = 0, dur = 0.05, type = 'bandpass', f = 1000, f1 = null, q = 1, gain = 0.5, attack = 0.001, out = ctx.destination }) {
      const s = ctx.createBufferSource(); s.buffer = noiseBuf;
      const fl = ctx.createBiquadFilter(); fl.type = type; fl.Q.value = q;
      fl.frequency.setValueAtTime(f, t);
      if (f1) fl.frequency.exponentialRampToValueAtTime(f1, t + dur);
      const g = ctx.createGain(); env(g.gain, t, gain, attack, dur);
      s.connect(fl).connect(g).connect(out);
      s.start(t, Math.random() * 0.4); s.stop(t + attack + dur + 0.02);
    },
    tone({ t = 0, dur = 0.05, type = 'sine', f = 440, f1 = null, gain = 0.3, attack = 0.001, out = ctx.destination }) {
      const o = ctx.createOscillator(); o.type = type;
      o.frequency.setValueAtTime(f, t);
      if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      const g = ctx.createGain(); env(g.gain, t, gain, attack, dur);
      o.connect(g).connect(out);
      o.start(t); o.stop(t + attack + dur + 0.02);
    },
  };
}

async function render(seconds, build) {
  const ctx = new OfflineAudioContext(1, Math.ceil(seconds * SR), SR);
  const v = voice(ctx, makeNoise(ctx, 1));
  build(v, ctx);
  return ctx.startRendering();
}

const rnd = (a, b) => a + Math.random() * (b - a);

// --- sound recipes -------------------------------------------------------
const RECIPES = {
  // the "tak": pusher clack + plastic body knock + dart leaving the barrel
  fire: (v) => {
    const p = rnd(0.94, 1.06);
    v.noise({ dur: 0.006, type: 'highpass', f: 3800 * p, gain: 0.9 });                       // pusher tip hits the dart
    v.tone({ dur: 0.012, f: 2600 * p, f1: 1800 * p, gain: 0.25 });                           // hard plastic click
    v.noise({ t: 0.002, dur: 0.032, type: 'bandpass', f: 820 * p, q: 2.2, gain: 1.0 });      // the "tak" body
    v.tone({ t: 0.002, dur: 0.045, f: 175 * p, f1: 85, gain: 0.55 });                         // chest of the blaster
    v.tone({ t: 0.004, dur: 0.05, f: 1150 * p, gain: 0.06 });                                 // shell ring
    v.tone({ t: 0.004, dur: 0.04, f: 1730 * p, gain: 0.04 });
    v.noise({ t: 0.006, dur: 0.06, type: 'bandpass', f: 3600, f1: 1400, q: 1.4, gain: 0.22 }); // dart "fwip" out of the barrel
    v.noise({ t: 0.048, dur: 0.012, type: 'highpass', f: 2800 * p, gain: 0.18 });             // pusher returns
  },
  dry: (v) => {
    v.noise({ dur: 0.005, type: 'highpass', f: 3500, gain: 0.5 });
    v.noise({ t: 0.002, dur: 0.02, type: 'bandpass', f: 1300, q: 3, gain: 0.35 });
    v.noise({ t: 0.06, dur: 0.008, type: 'highpass', f: 3000, gain: 0.2 });
  },
  magOut: (v) => {
    v.noise({ dur: 0.008, type: 'highpass', f: 3000, gain: 0.7 });                            // release button
    v.noise({ t: 0.004, dur: 0.03, type: 'bandpass', f: 1500, q: 3, gain: 0.5 });
    v.noise({ t: 0.03, dur: 0.12, type: 'bandpass', f: 2200, f1: 900, q: 1.2, gain: 0.18 });  // slide out
  },
  magDrop: (v) => {
    v.noise({ dur: 0.04, type: 'bandpass', f: 600, q: 1.5, gain: 0.6 });                      // hits the floor
    v.tone({ dur: 0.07, f: 210, f1: 140, gain: 0.25 });
    v.noise({ t: 0.09, dur: 0.03, type: 'bandpass', f: 900, q: 2, gain: 0.25 });              // small bounce
  },
  magIn: (v) => {
    v.noise({ dur: 0.1, type: 'bandpass', f: 1200, f1: 2600, q: 1.3, gain: 0.2 });            // slide in
    v.noise({ t: 0.1, dur: 0.007, type: 'highpass', f: 3200, gain: 0.9 });                    // ka-
    v.noise({ t: 0.101, dur: 0.03, type: 'bandpass', f: 950, q: 2.5, gain: 0.9 });
    v.tone({ t: 0.101, dur: 0.05, f: 190, f1: 100, gain: 0.4 });
    v.noise({ t: 0.16, dur: 0.006, type: 'highpass', f: 3600, gain: 0.6 });                   // -chak (latch)
    v.noise({ t: 0.161, dur: 0.02, type: 'bandpass', f: 1600, q: 3, gain: 0.4 });
  },
  impactWall: (v) => { v.noise({ dur: 0.035, type: 'bandpass', f: 1100, q: 1.2, gain: 0.7 }); v.tone({ dur: 0.04, f: 170, f1: 110, gain: 0.18 }); },
  impactWood: (v) => { v.noise({ dur: 0.03, type: 'bandpass', f: 1600, q: 1.8, gain: 0.7 }); v.tone({ dur: 0.06, f: 280, f1: 190, gain: 0.2 }); v.tone({ dur: 0.05, f: 720, gain: 0.05 }); },
  impactTile: (v) => { v.noise({ dur: 0.02, type: 'bandpass', f: 3200, q: 1.6, gain: 0.7 }); v.tone({ dur: 0.04, f: 1900, gain: 0.04 }); },
  impactSoft: (v) => { v.noise({ dur: 0.05, type: 'lowpass', f: 450, gain: 0.5 }); },
  impactPlastic: (v) => { v.noise({ dur: 0.02, type: 'bandpass', f: 2300, q: 2, gain: 0.7 }); v.tone({ dur: 0.03, f: 1400, gain: 0.05 }); },
  impactGlass: (v) => { v.noise({ dur: 0.015, type: 'bandpass', f: 5000, q: 2, gain: 0.5 }); v.tone({ dur: 0.35, f: rnd(3000, 3600), gain: 0.07 }); v.tone({ dur: 0.25, f: rnd(4700, 5200), gain: 0.03 }); },
  impactMetal: (v) => { v.noise({ dur: 0.02, type: 'bandpass', f: 3500, q: 2, gain: 0.5 }); v.tone({ dur: 0.45, f: rnd(1800, 2300), gain: 0.08 }); v.tone({ dur: 0.3, f: rnd(2900, 3300), gain: 0.04 }); },
  can: (v) => { v.noise({ dur: 0.02, type: 'bandpass', f: 2600, q: 2, gain: 0.6 }); v.tone({ dur: 0.25, f: rnd(1150, 1450), gain: 0.07 }); v.tone({ dur: 0.18, f: rnd(2200, 2600), gain: 0.035 }); },
  target: (v) => { v.noise({ dur: 0.04, type: 'bandpass', f: 1700, q: 1.4, gain: 0.6 }); v.tone({ dur: 0.08, f: 240, f1: 160, gain: 0.25 }); },
  ding: (v) => { v.tone({ dur: 0.15, f: 880, gain: 0.14 }); v.tone({ t: 0.07, dur: 0.25, f: 1320, gain: 0.14 }); },
  dingBig: (v) => { v.tone({ dur: 0.15, f: 880, gain: 0.14 }); v.tone({ t: 0.07, dur: 0.22, f: 1320, gain: 0.14 }); v.tone({ t: 0.14, dur: 0.35, f: 1760, gain: 0.13 }); },
  step: (v) => { v.noise({ dur: 0.06, type: 'lowpass', f: rnd(260, 380), gain: 0.35 }); v.noise({ t: 0.01, dur: 0.02, type: 'bandpass', f: 1800, q: 2, gain: 0.03 }); },
  pickup: (v) => { v.noise({ dur: 0.02, type: 'bandpass', f: 1500, q: 3, gain: 0.3 }); v.tone({ t: 0.01, dur: 0.08, f: 660, f1: 990, gain: 0.08 }); },
};
const VARIANTS = { fire: 6, step: 4, impactWall: 3, impactWood: 3, impactTile: 3, impactGlass: 3, impactMetal: 3, can: 4, impactPlastic: 2, impactSoft: 2 };

export class Sfx {
  constructor() { this.ctx = null; this.buf = {}; }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    comp.connect(ctx.destination);
    this.master = ctx.createGain(); this.master.gain.value = 0.8;
    this.master.connect(comp);
    // room reverb (generated impulse: short, dark, slightly stereo)
    this.reverb = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 0.9);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / ctx.sampleRate;
        const early = (i < ctx.sampleRate * 0.03 && Math.random() < 0.02) ? 2.5 : 1; // sparse early reflections
        lp += ((Math.random() * 2 - 1) - lp) * (0.35 - t * 0.25);                   // darker as it decays
        d[i] = lp * early * Math.exp(-t * 7.5);
      }
    }
    this.reverb.buffer = ir;
    this.wet = ctx.createGain(); this.wet.gain.value = 0.32;
    this.reverb.connect(this.wet).connect(this.master);
    this.bus = ctx.createGain();           // dry + send
    this.bus.connect(this.master);
    this.bus.connect(this.reverb);
    // pre-render all sounds (async; plays nothing until ready)
    this.ready = (async () => {
      for (const [name, fn] of Object.entries(RECIPES)) {
        const n = VARIANTS[name] || 1;
        this.buf[name] = [];
        for (let i = 0; i < n; i++) this.buf[name].push(await render(name.startsWith('impactGlass') || name.startsWith('impactMetal') || name === 'can' || name.startsWith('ding') ? 0.6 : 0.3, fn));
      }
    })();
  }

  get ok() { return !!this.ctx; }

  setListener(cam) {
    if (!this.ok) return;
    const l = this.ctx.listener, p = cam.position, t = this.ctx.currentTime;
    const f = cam.getWorldDirection(this._v || (this._v = cam.position.clone()));
    if (l.positionX) {
      l.positionX.setValueAtTime(p.x, t); l.positionY.setValueAtTime(p.y, t); l.positionZ.setValueAtTime(p.z, t);
      l.forwardX.setValueAtTime(f.x, t); l.forwardY.setValueAtTime(f.y, t); l.forwardZ.setValueAtTime(f.z, t);
      l.upX.setValueAtTime(0, t); l.upY.setValueAtTime(1, t); l.upZ.setValueAtTime(0, t);
    } else {
      l.setPosition(p.x, p.y, p.z); l.setOrientation(f.x, f.y, f.z, 0, 1, 0);
    }
  }

  play(name, { gain = 1, rate = 1, pos = null, delay = 0 } = {}) {
    if (!this.ok) return;
    const list = this.buf[name];
    if (!list || !list.length) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = list[Math.floor(Math.random() * list.length)];
    src.playbackRate.value = rate;
    const g = ctx.createGain(); g.gain.value = gain;
    src.connect(g);
    if (pos) {
      const p = ctx.createPanner();
      p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 1.2; p.rolloffFactor = 1.1;
      p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
      g.connect(p).connect(this.bus);
    } else g.connect(this.bus);
    src.start(ctx.currentTime + delay);
  }

  fire() { this.play('fire', { gain: 0.8, rate: rnd(0.97, 1.03) }); }
  dryFire() { this.play('dry', { gain: 0.8 }); }
  reload(stage) {
    if (stage === 0) { this.play('magOut'); this.play('magDrop', { gain: 0.6, delay: 0.32 }); }
    if (stage === 1) this.play('magIn');
  }
  impact(pos, surface = 'wall', strength = 1) {
    const s = Math.min(1, strength);
    const map = { wall: 'impactWall', wood: 'impactWood', tile: 'impactTile', soft: 'impactSoft', plastic: 'impactPlastic', glass: 'impactGlass', metal: 'impactMetal' };
    this.play(map[surface] || 'impactWall', { pos, gain: 0.25 + 0.75 * s, rate: rnd(0.92, 1.08) });
  }
  targetHit(pos, bull) { this.play('target', { pos }); this.play(bull ? 'dingBig' : 'ding', { gain: 0.9 }); }
  can(pos, strength = 1) { this.play('can', { pos, gain: 0.3 + 0.7 * Math.min(1, strength), rate: rnd(0.95, 1.05) }); }
  step() { this.play('step', { gain: 0.5, rate: rnd(0.9, 1.1) }); }
  pickup() { this.play('pickup', { gain: 0.8 }); }
  revUp() { /* no motor hum by design */ }
}
