import './style.css';
import { Game } from './game';
import { Input } from './input';
import { Renderer } from './render';
import { Ui } from './ui';
import { loadSave, writeSave, resetSave, freshSave, gemsFoundCount, type Checkpoint } from './save';
import { ORE_LINES, SP_ITEMS, oreCost, type OreLine, type SpId } from './economy';
import { setMuted, unlockAudio } from './audio';
import { Tutorial } from './tutorial';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = new Renderer(canvas);
const input = new Input(canvas);
let save = loadSave();
setMuted(save.muted);
input.followMove = save.aimFollow;

let game: Game | null = null;
let tutorial: Tutorial | null = null;
let paused = false;
const STAR_SP: Record<number, number> = { 1: 2, 2: 1, 4: 1, 8: 1 };

function startGame(L: number, cp: Checkpoint | null) {
  unlockAudio();
  save.perm.gemsFound = gemsFoundCount(save);
  if (!cp && save.checkpoint) { save.checkpoint = null; writeSave(save); } // starting fresh drops any saved run
  const g = new Game(L, save.perm, cp);
  g.smartAimOn = save.smartAimOn;
  g.onCheckpoint = () => { save.checkpoint = g.snapshot(); writeSave(save); ui.toast('Progress saved'); };
  game = g;
  paused = false;
  input.reset();
  ui.showLevel(g);
  tutorial = !save.tutorialDone ? new Tutorial(g, input) : null;
}

const ui = new Ui(document.getElementById('ui')!, {
  play(L) { startGame(L, null); },
  resumeCheckpoint() { if (save.checkpoint) startGame(save.checkpoint.L, save.checkpoint); },
  pause() { if (game && !game.result) { paused = true; ui.showPause(save); } },
  resume() { paused = false; input.reset(); },
  abandon() { if (game) { game.finish('abandon'); paused = false; } },
  toggleMute() { save.muted = !save.muted; setMuted(save.muted); writeSave(save); },
  toggleAimFollow() { save.aimFollow = !save.aimFollow; input.followMove = save.aimFollow; writeSave(save); return save.aimFollow; },
  toggleSmartAim() { if (game) { game.smartAimOn = !game.smartAimOn; save.smartAimOn = game.smartAimOn; writeSave(save); } },
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
  for (const bit of [1, 2, 4, 8]) if (newStars & bit) spGained += STAR_SP[bit];
  save.stars[r.L] = prev | r.stars;
  save.checkpoint = null;
  if (r.hiddenFound) save.gems[r.L] = true;
  save.sp += spGained;
  save.ore += r.ore;
  if (r.stars & 1 && r.L > save.highest) save.highest = r.L;
  writeSave(save);
  game = null;
  ui.showResults({ ...r, newStars, spGained }, save);
}

window.addEventListener('resize', () => renderer.resize());
document.addEventListener('visibilitychange', () => { if (document.hidden) ui.root && game && !paused && (paused = true, ui.showPause(save)); });
canvas.addEventListener('pointerdown', () => unlockAudio());

let last = performance.now();
function frame(now: number) {
  const dt = Math.min(1 / 30, (now - last) / 1000);
  last = now;
  input.setCenter(renderer.w / 2, renderer.h / 2);
  if (game) {
    input.update();
    const frozen = paused || ui.shopOpen; // the game stops while the shop is open
    if (!frozen) {
      game.update(dt, input.moveX, input.moveY, input.aim, input.aimHeld);
      if (game.autoAiming) input.aim = game.player.angle; // manual aim picks up where Smart Aim left off
    } else input.reset();
    renderer.draw(game, input, frozen ? 0 : dt);
    ui.updateHud(game);
    if (tutorial) {
      ui.setTip(tutorial.update(game, input, ui.shopOpen, frozen ? 0 : dt));
      if (tutorial.finished) { tutorial = null; save.tutorialDone = true; writeSave(save); }
    }
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
(window as unknown as { __bb: unknown }).__bb = { get game() { return game; }, get save() { return save; }, input, ui, Game };

// Offline support for the installed home screen app.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => { /* offline support is optional */ }); });
}
