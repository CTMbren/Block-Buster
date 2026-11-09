// Tiny synthesized sound effects: no audio files to download.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
export let muted = false;
let lastTink = 0;

export function setMuted(m: boolean) {
  muted = m;
  if (master) master.gain.value = m ? 0 : 0.5;
}

export function unlockAudio() {
  if (ctx) { if (ctx.state === 'suspended') void ctx.resume(); return; }
  try {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
  } catch { ctx = null; }
}

function blip(freq: number, dur: number, type: OscillatorType, vol: number, slide = 1) {
  if (!ctx || !master || muted) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

/** Hit sound: higher pitch as the gem gets closer to breaking. Rate-limited. */
export function sfxHit(tier: number) {
  if (!ctx) return;
  const now = ctx.currentTime;
  if (now - lastTink < 0.035) return;
  lastTink = now;
  blip(1400 - tier * 120, 0.05, 'triangle', 0.08);
}

const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
/** Break sound climbs a musical scale with the chain counter. */
export function sfxBreak(chain: number) {
  const step = SCALE[Math.min(SCALE.length - 1, chain)];
  const f = 440 * Math.pow(2, step / 12);
  blip(f, 0.18, 'sine', 0.16, 1.02);
  blip(f * 2.01, 0.12, 'triangle', 0.05);
}

export function sfxGold() { blip(988, 0.1, 'square', 0.06); setTimeout(() => blip(1319, 0.2, 'square', 0.06), 70); }
export function sfxOre() { blip(1760, 0.08, 'sine', 0.06, 1.3); }
export function sfxBuy() { blip(660, 0.08, 'triangle', 0.12); setTimeout(() => blip(990, 0.14, 'triangle', 0.12), 60); }
export function sfxAbility() { blip(300, 0.25, 'sawtooth', 0.08, 2.5); }
export function sfxFizzle() { blip(200, 0.08, 'square', 0.04, 0.5); }
export function sfxBoom() { blip(120, 0.35, 'sawtooth', 0.18, 0.3); }
export function sfxGenerator() { blip(220, 0.5, 'sawtooth', 0.15, 0.25); setTimeout(() => blip(880, 0.3, 'sine', 0.1, 0.5), 120); }
export function sfxKeystone() {
  blip(80, 1.2, 'sine', 0.3, 0.5);
  [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => blip(f, 0.6, 'triangle', 0.1), 300 + i * 110));
}
