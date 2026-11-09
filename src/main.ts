import './style.css';
import { Game } from './game';
import { Input } from './input';
import { Renderer } from './render';
import { Ui } from './ui';
import { loadSave, writeSave, resetSave, freshSave } from './save';
import { ORE_LINES, SP_ITEMS, oreCost, type OreLine, type SpId } from './economy';
import { setMuted, unlockAudio } from './audio';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = new Renderer(canvas);
const input = new Input(canvas);
let save = loadSave();
setMuted(save.muted);

let game: Game | null = null;
let paused = false;
const STAR_SP: Record<number, number> = { 1: 2, 2: 1, 4: 1 };

const ui = new Ui(document.getElementById('ui')!, {
  play(L) {
    unlockAudio();
    game = new Game(L, save.perm);
    paused = false;
    input.reset();
    ui.showLevel(game);
  },
  pause() { if (game && !game.result) { paused = true; ui.showPause(save.muted); } },
  resume() { paused = false; input.reset(); },
  abandon() { if (game) { game.finish('abandon'); paused = false; } },
  toggleMute() { save.muted = !save.muted; setMuted(save.muted); writeSave(save); },
  buyOre(id: OreLine) {
    const line = ORE_LINES.find(l => l.id === id)!;
    const n = save.perm.ore[id] ?? 0;
    const c = oreCost(line, n);
    if (save.ore < c) return;
    save.ore -= c; save.perm.ore[id] = n + 1;
    writeSave(save);
  },
  buySp(id: string) {
    const it = SP_ITEMS.find(i => i.id === id)!;
    const owned = save.perm.sp[it.id as SpId] ?? 0;
    const c = it.cost(owned);
    if (owned >= it.max || save.sp < c) return;
    if (it.requires && !save.perm.sp[it.requires]) return;
    save.sp -= c; save.perm.sp[it.id as SpId] = owned + 1;
    writeSave(save);
  },
  resetSave() { resetSave(); save = freshSave(); ui.showTitle(save); },
});

function endLevel(g: Game) {
  const r = g.result!;
  const prev = save.stars[r.L] ?? 0;
  const newStars = r.stars & ~prev;
  let spGained = 0;
  for (const bit of [1, 2, 4]) if (newStars & bit) spGained += STAR_SP[bit];
  save.stars[r.L] = prev | r.stars;
  save.sp += spGained;
  save.ore += r.ore;
  if (r.stars & 1 && r.L > save.highest) save.highest = r.L;
  writeSave(save);
  game = null;
  ui.showResults({ ...r, newStars, spGained }, save);
}

window.addEventListener('resize', () => renderer.resize());
document.addEventListener('visibilitychange', () => { if (document.hidden) ui.root && game && !paused && (paused = true, ui.showPause(save.muted)); });
canvas.addEventListener('pointerdown', () => unlockAudio());

let last = performance.now();
function frame(now: number) {
  const dt = Math.min(1 / 30, (now - last) / 1000);
  last = now;
  input.setCenter(renderer.w / 2, renderer.h / 2);
  if (game) {
    input.update();
    if (!paused) game.update(dt, input.moveX, input.moveY, input.aim);
    renderer.draw(game, input, paused ? 0 : dt);
    ui.updateHud(game);
    if (game.result) endLevel(game);
  } else {
    drawIdle(dt);
  }
  requestAnimationFrame(frame);
}

// A slowly drifting mine behind the menus.
const backdrop = new Game(1, { ore: {}, sp: {} });
let drift = 0;
function drawIdle(dt: number) {
  drift += dt * 0.15;
  backdrop.player.x = Math.cos(drift) * 60;
  backdrop.player.y = Math.sin(drift * 0.7) * 60;
  backdrop.projectiles.length = 0;
  renderer.draw(backdrop, input, dt, true);
}

ui.showTitle(save);
requestAnimationFrame(frame);

// Handy for debugging from the browser console.
(window as unknown as { __bb: unknown }).__bb = { get game() { return game; }, get save() { return save; }, input, ui };
