// In-level simulation: movement, shooting, damage, rewards and level end.
import { HEX_INNER, HEX_W, DIRS, pixelToHex } from './hex';
import { Kind, LINK_WINDOW, generateLevel, type Cell, type Entity, type Level, type Region } from './level';
import type { Checkpoint } from './save';
import { CHALLENGE_BIT, pickChallenge, type Challenge } from './challenge';
import {
  BOOSTS, BOOST_BASE, CLEAR_TARGET, COLLAPSE_SECONDS, SHOTS, SHOT_LEVEL_BASE, SHOT_UNLOCK_BASE,
  abilitySlots, availableShots, blasterStats, inLevelCost, oreGainMult, shardGainMult, shotStats,
  blastCore, blastFalloff, blastReach, headStartShards, lv, LUCK_INFO, luckChance, parSeconds,
  type BoostId, type Perm, type ShotId,
} from './economy';
import * as sfx from './audio';

export interface Projectile {
  x: number; y: number; vx: number; vy: number;
  dmg: number; dist: number; pierce: number; bounce: number;
  poison: { frac: number; time: number } | null;
  special: boolean; crit: boolean; last: number; color: string;
  piercing: boolean; bounced: boolean; breaks: number;
  /** gems hit so far; child = spawned by a Lucky effect (can't trigger Lucky itself) */
  hits: number; child: boolean; fromMulti: boolean; fromRic: boolean; over: number;
}
export interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number; rot: number; vr: number; kind: 0 | 1 }
export interface Floater { x: number; y: number; text: string; life: number; color: string; big: boolean }
export interface ShotState { lvl: number; active: number; cd: number }

export type EndReason = 'exit' | 'collapse' | 'abandon';
export interface LevelResult {
  L: number; reason: EndReason; stars: number; time: number;
  clearPct: number; golds: number; goldTotal: number; generators: number;
  ore: number; salvage: number; shardsCollected: number;
  challenge: Challenge;
  regionLevel: boolean; vaultCleared: boolean; par: number; keystoneTime: number;
  hiddenFound: boolean; procs: Record<ShotId, number>;
}

const PLAYER_R = 11;
const PLAYER_SPEED = 150;
const SOLID = (k: Kind) => k === Kind.Gem || k === Kind.Bedrock || k === Kind.Generator || k === Kind.Keystone || k === Kind.Seal;
/** A region's last few gems crumble on their own. */
const collapseAt = (total: number) => Math.max(3, Math.ceil(total * 0.04));

export class Game {
  level: Level;
  L: number;
  player = { x: 0, y: 0, angle: -Math.PI / 2 };
  shards = 0;
  shardsCollected = 0;
  oreEarned = 0;
  boosts: Record<BoostId, number> = { damage: 0, fireRate: 0, speed: 0, range: 0 };
  shots: Record<ShotId, ShotState> = {
    multishot: { lvl: 0, active: 0, cd: 0 }, ricochet: { lvl: 0, active: 0, cd: 0 },
    piercing: { lvl: 0, active: 0, cd: 0 }, poison: { lvl: 0, active: 0, cd: 0 },
  };
  freeShotAvailable: boolean;
  projectiles: Projectile[] = [];
  particles: Particle[] = [];
  blasts: { x: number; y: number; r: number; t: number }[] = [];
  floaters: Floater[] = [];
  poisoned = new Set<Cell>();
  gemsBroken = 0;
  goldsBroken = 0;
  combo = 0;
  comboT = 0;
  fireT = 0;
  time = 0;
  shake = 0;
  gateOpen = false;
  collapseT = 0;
  result: LevelResult | null = null;
  slowMo = 0;
  /** Smart Aim (a skill-point unlock): the turret picks targets while you aren't aiming. */
  smartAimOn = true;
  autoAiming = false;
  autoTarget: Cell | null = null;
  private retargetT = 0;
  challenge: Challenge;
  purchases = 0;
  private curProj: Projectile | null = null;
  private regenCells: Cell[];
  // regions
  regionLeft: number[] = [];
  vaultCleared = false;
  vaultOpen = false;
  hiddenFound = false;
  private hiddenChimed = false;
  keystoneTime = -1;
  /** Called when a region seal breaks so the game can save a checkpoint. */
  onCheckpoint: (() => void) | null = null;
  // Lucky
  procs: Record<ShotId, number> = { multishot: 0, ricochet: 0, piercing: 0, poison: 0 };
  activeProcs: Record<ShotId, number> = { multishot: 0, ricochet: 0, piercing: 0, poison: 0 };
  private procWindow: Record<ShotId, { t: number; n: number }> = { multishot: { t: 0, n: 0 }, ricochet: { t: 0, n: 0 }, piercing: { t: 0, n: 0 }, poison: { t: 0, n: 0 } };
  private indirectHintT = 0;

  constructor(L: number, public perm: Perm, checkpoint: Checkpoint | null = null) {
    this.L = L;
    this.level = generateLevel(L);
    this.challenge = pickChallenge(this.level);
    this.regenCells = this.level.cells.filter(c => c.regen);
    this.shards = headStartShards(perm.sp.headStart ?? 0, L);
    this.freeShotAvailable = !!perm.sp.freeShot;
    this.player.x = this.level.spawn.x; this.player.y = this.level.spawn.y;
    this.regionLeft = this.level.regions.map(r => r.gemTotal);
    if (checkpoint && checkpoint.L === L) this.restore(checkpoint);
  }

  get regionLevel() { return this.level.regions.length > 0; }
  get par() { return parSeconds(this.L); }
  /** Region the player is standing in (-1 on disc levels). */
  get currentRegion(): Region | null {
    const c = this.cellAtPixel(this.player.x, this.player.y);
    return c && c.region >= 0 ? this.level.regions[c.region] : null;
  }

  get blaster() { return blasterStats(this.boosts, this.perm); }
  get shielded() { return this.level.generators.some(g => !g.broken); }
  get clearPct() { return this.gemsBroken / this.level.gemTotal; }
  get shotsOwned() { return SHOTS.filter(s => this.shots[s].lvl > 0).length; }
  get generatorsLeft() { return this.level.generators.filter(g => !g.broken).length; }

  // ---------------- shop ----------------
  boostCost(id: BoostId) { return inLevelCost(BOOST_BASE[id], this.boosts[id], this.L); }
  shotCost(id: ShotId) {
    const s = this.shots[id];
    if (s.lvl === 0 && this.freeShotAvailable) return 0;
    return s.lvl === 0 ? inLevelCost(SHOT_UNLOCK_BASE, 0, this.L) : inLevelCost(SHOT_LEVEL_BASE, s.lvl, this.L);
  }
  canBuyShot(id: ShotId) {
    if (!availableShots(this.perm).includes(id)) return false;
    if (this.shots[id].lvl === 0 && this.shotsOwned >= abilitySlots(this.perm)) return false;
    return this.shards >= this.shotCost(id);
  }
  buyBoost(id: BoostId) {
    const c = this.boostCost(id);
    if (this.shards < c) return false;
    this.shards -= c; this.boosts[id]++;
    this.purchases++; this.trackThrifty();
    sfx.sfxBuy();
    return true;
  }
  buyShot(id: ShotId) {
    if (!this.canBuyShot(id)) return false;
    const c = this.shotCost(id);
    if (this.shots[id].lvl === 0 && c === 0) this.freeShotAvailable = false;
    this.shards -= c; this.shots[id].lvl++;
    this.purchases++; this.trackThrifty();
    sfx.sfxBuy();
    return true;
  }
  /** Cheapest thing the player could buy right now (for the shop button glow). */
  anythingAffordable() {
    return BOOSTS.some(b => this.shards >= this.boostCost(b)) || SHOTS.some(s => this.canBuyShot(s));
  }

  // ---------------- abilities ----------------
  shotStats(id: ShotId) { return shotStats(id, Math.max(1, this.shots[id].lvl), this.perm); }
  triggerShot(id: ShotId) {
    const s = this.shots[id];
    if (s.lvl === 0 || s.active > 0 || s.cd > 0) return false;
    s.active = this.shotStats(id).active;
    this.activeProcs[id] = 0;
    sfx.sfxAbility();
    return true;
  }
  private isActive(id: ShotId) { return this.shots[id].active > 0; }

  // ---------------- main update ----------------
  get hasSmartAim() { return !!this.perm.sp.smartAim; }

  update(dt: number, moveX: number, moveY: number, aim: number, aimHeld = true) {
    if (this.result) return;
    if (this.slowMo > 0) { this.slowMo -= dt; dt *= 0.3; }
    this.time += dt;
    this.autoAiming = this.hasSmartAim && this.smartAimOn && !aimHeld;
    if (this.autoAiming) {
      this.retargetT -= dt;
      if (this.retargetT <= 0 || !this.validTarget(this.autoTarget)) { this.retargetT = 0.12; this.pickTarget(moveX, moveY); }
      if (this.autoTarget) {
        const want = Math.atan2(this.autoTarget.y - this.player.y, this.autoTarget.x - this.player.x);
        let d = want - this.player.angle;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        const maxTurn = 12.5 * dt; // about 720 degrees per second
        this.player.angle += Math.max(-maxTurn, Math.min(maxTurn, d));
      }
    } else {
      this.autoTarget = null;
      this.player.angle = aim;
    }
    this.movePlayer(dt, moveX, moveY);

    for (const id of SHOTS) {
      const s = this.shots[id];
      if (s.active > 0) { s.active -= dt; if (s.active <= 0) { s.active = 0; s.cd = this.shotStats(id).cooldown; } }
      else if (s.cd > 0) s.cd = Math.max(0, s.cd - dt);
    }

    const b = this.blaster;
    this.fireT -= dt;
    while (this.fireT <= 0) { this.fire(b); this.fireT += 1 / b.fireRate; }

    this.updateProjectiles(dt);
    this.updatePoison(dt);
    this.updateRegen(dt);
    this.updateLinks(dt);
    this.updateCollapse(dt);
    this.updateHiddenChime();
    for (const id of SHOTS) { const w = this.procWindow[id]; w.t += dt; if (w.t >= 1) { w.t = 0; w.n = 0; } }
    if (this.indirectHintT > 0) this.indirectHintT -= dt;

    if (this.comboT > 0) { this.comboT -= dt; if (this.comboT <= 0) this.combo = 0; }
    for (const c of this.level.cells) if (c.flash > 0) c.flash = Math.max(0, c.flash - dt * 6);
    this.updateParticles(dt);
    this.shake = Math.max(0, this.shake - dt * 30);

    if (this.gateOpen) {
      this.collapseT -= dt;
      const k = this.level.keystone;
      if (Math.hypot(this.player.x - k.x, this.player.y - k.y) < HEX_W * 0.8) this.finish('exit');
      else if (this.collapseT <= 0) this.finish('collapse');
    }
  }

  private validTarget(c: Cell | null): c is Cell {
    if (!c) return false;
    if (c.kind === Kind.Gem || c.kind === Kind.Generator) return true;
    return c.kind === Kind.Keystone && !this.shielded;
  }

  /** Is there a clear shot from the turret to this cell? */
  private canHit(c: Cell) {
    const p = this.player;
    const dx = c.x - p.x, dy = c.y - p.y, L = Math.hypot(dx, dy);
    for (let t = 12; t < L - HEX_INNER * 0.8; t += 7) {
      const cc = this.cellAtPixel(p.x + (dx * t) / L, p.y + (dy * t) / L);
      if (cc && cc !== c && SOLID(cc.kind) && !(c.entity && cc.entity === c.entity)) return false;
    }
    return true;
  }

  /** Smart Aim target choice: objectives, then gold, then cracked gems, then the nearest. */
  private pickTarget(mx: number, my: number) {
    const p = this.player;
    const range = this.blaster.range * HEX_W;
    const moving = mx * mx + my * my > 0.04;
    const heading = Math.atan2(my, mx);
    const cone = (40 * Math.PI) / 180;
    let best: Cell | null = null, bestScore = Infinity;
    for (const c of this.level.cells) {
      if (!this.validTarget(c)) continue;
      const dx = c.x - p.x, dy = c.y - p.y;
      if (Math.abs(dx) > range || Math.abs(dy) > range) continue;
      const dist = Math.hypot(dx, dy);
      if (dist > range) continue;
      if (moving) {
        let da = Math.atan2(dy, dx) - heading;
        da = Math.abs(Math.atan2(Math.sin(da), Math.cos(da)));
        if (da > cone) continue;
      }
      let score = dist / HEX_W;
      if (c.kind === Kind.Generator || c.kind === Kind.Keystone) score -= 6;
      if (c.gold) score -= 4;
      if (c.kind === Kind.Gem && c.hp < c.maxHp) score -= 2;
      if (c.ore) score -= 1;
      if (c === this.autoTarget) score -= 2.5; // stick with the current target
      if (score >= bestScore) continue;
      if (!this.canHit(c)) continue;
      best = c; bestScore = score;
    }
    this.autoTarget = best;
  }

  private movePlayer(dt: number, mx: number, my: number) {
    const p = this.player;
    p.x += mx * PLAYER_SPEED * dt;
    p.y += my * PLAYER_SPEED * dt;
    const minD = HEX_INNER * 1.06 + PLAYER_R;
    for (let pass = 0; pass < 3; pass++) {
      const [pq, pr] = pixelToHex(p.x, p.y);
      for (let dq = -2; dq <= 2; dq++) for (let dr = -2; dr <= 2; dr++) {
        const c = this.cellAt(pq + dq, pr + dr);
        if (!c || !SOLID(c.kind)) continue;
        const dx = p.x - c.x, dy = p.y - c.y;
        const d = Math.hypot(dx, dy);
        if (d < minD && d > 0.001) {
          p.x = c.x + (dx / d) * minD;
          p.y = c.y + (dy / d) * minD;
        }
      }
    }
  }

  cellAt(q: number, r: number): Cell | null {
    const N = this.level.radius;
    if (Math.abs(q) > N || Math.abs(r) > N) return null;
    return this.level.grid[(q + N) * this.level.size + (r + N)];
  }
  cellAtPixel(x: number, y: number) { const [q, r] = pixelToHex(x, y); return this.cellAt(q, r); }

  private fire(b: ReturnType<typeof blasterStats>) {
    if (this.projectiles.length > 400) return;
    let bonus = 1;
    for (const id of ['multishot', 'ricochet', 'piercing'] as ShotId[]) if (this.isActive(id)) bonus *= this.shotStats(id).dmgBonus;
    const multi = this.isActive('multishot') ? this.shotStats('multishot').extraShots : 0;
    const pier = this.isActive('piercing') ? this.shotStats('piercing').pierces : 0;
    const bounce = this.isActive('ricochet') ? this.shotStats('ricochet').bounces : 0;
    const pz = this.isActive('poison') ? this.shotStats('poison') : null;
    const special = multi > 0 || pier > 0 || bounce > 0 || !!pz;
    const n = 1 + multi;
    const spread = 0.13;
    const color = pz ? '#9dffb0' : bounce ? '#9ff0ff' : pier ? '#ffe39a' : multi ? '#d4c4ff' : '#ffd9a0';
    for (let i = 0; i < n; i++) {
      const a = this.player.angle + (i - (n - 1) / 2) * spread;
      const crit = Math.random() < b.crit;
      this.projectiles.push({
        x: this.player.x + Math.cos(a) * 14, y: this.player.y + Math.sin(a) * 14,
        vx: Math.cos(a) * b.speed, vy: Math.sin(a) * b.speed,
        dmg: b.damage * bonus * (crit ? 2 : 1), dist: b.range * HEX_W, pierce: pier, bounce,
        poison: pz ? { frac: pz.poisonFrac, time: pz.poisonTime } : null,
        special, crit, last: -1, color, piercing: pier > 0, bounced: false, breaks: 0,
        hits: 0, child: false, fromMulti: multi > 0, fromRic: bounce > 0, over: 0,
      });
    }
  }

  private updateProjectiles(dt: number) {
    const keep: Projectile[] = [];
    for (const p of this.projectiles) {
      let travel = Math.hypot(p.vx, p.vy) * dt;
      let alive = true;
      while (travel > 0 && alive) {
        const step = Math.min(7, travel);
        travel -= step;
        const sp = Math.hypot(p.vx, p.vy);
        p.x += (p.vx / sp) * step; p.y += (p.vy / sp) * step;
        p.dist -= step;
        if (p.dist <= 0) { alive = false; break; }
        const c = this.cellAtPixel(p.x, p.y);
        if (!c) { alive = false; break; }
        if (!SOLID(c.kind) || c.idx === p.last) { if (c.idx !== p.last) p.last = -1; continue; }
        alive = this.hitCell(p, c);
      }
      if (alive) keep.push(p);
    }
    this.projectiles = keep;
  }

  /** Returns whether the projectile survives. */
  private hitCell(p: Projectile, c: Cell): boolean {
    const shieldedKeystone = c.kind === Kind.Keystone && this.shielded;
    if (c.kind === Kind.Bedrock || c.kind === Kind.Seal || shieldedKeystone) {
      if (shieldedKeystone || c.kind === Kind.Seal) { this.spark(p.x, p.y, '#7fe6ff', 3); if (Math.random() < 0.3) sfx.sfxFizzle(); }
      if (p.bounce > 0) { this.reflect(p, c); this.bounceUsed(p); return true; }
      if (!shieldedKeystone && c.kind !== Kind.Seal) this.spark(p.x, p.y, '#8a8090', 2);
      return false;
    }
    const indirect = p.bounced || p.hits > 0 || p.child;
    this.curProj = p;
    this.damageCell(c, p.dmg, p.special, p.crit, indirect);
    this.curProj = null;
    p.hits++;
    if (p.poison && c.kind !== Kind.Floor) {
      c.poisonDps = Math.max(c.poisonDps, p.dmg * p.poison.frac);
      c.poisonT = Math.max(c.poisonT, p.poison.time);
      c.poisonChild = false;
      this.poisoned.add(c);
    }
    // Lucky Split: the shot splits into two more
    if (p.fromMulti && !p.child && this.lucky('multishot', p.x, p.y)) {
      for (const da of [-0.44, 0.44]) {
        const a = Math.atan2(p.vy, p.vx) + da, sp = Math.hypot(p.vx, p.vy);
        this.projectiles.push({
          x: p.x, y: p.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, dmg: p.dmg * 0.4, dist: 3 * HEX_W, pierce: 0, bounce: 0,
          poison: null, special: true, crit: p.crit, last: c.idx, color: '#ffe27a', piercing: false, bounced: false, breaks: 0,
          hits: 0, child: true, fromMulti: false, fromRic: false, over: 0,
        });
      }
    }
    if (p.pierce > 0) {
      // Lucky Rupture: the pierced gem bursts onto its neighbours
      if (p.piercing && !p.child && this.lucky('piercing', c.x, c.y)) {
        this.blasts.push({ x: c.x, y: c.y, r: HEX_W, t: 0.15 });
        for (const [a, b] of DIRS) { const n = this.cellAt(c.q + a, c.r + b); if (n && n !== c) this.damageCell(n, p.dmg * 0.5, true, false, true); }
      }
      p.pierce--; p.dmg *= 0.8; p.last = c.idx; return true;
    }
    if (p.bounce > 0) {
      if (c.kind === Kind.Floor) { p.last = c.idx; this.bounceUsed(p); p.dmg *= 0.75; return true; }
      this.reflect(p, c); this.bounceUsed(p); p.dmg *= 0.75; return true;
    }
    return false;
  }

  /** Spend a bounce, unless Lucky Bounce overcharges it (2x damage, bounce kept). */
  private bounceUsed(p: Projectile) {
    if (p.fromRic && !p.child && p.over < 2 && this.lucky('ricochet', p.x, p.y)) { p.over++; p.dmg *= 2; p.color = '#ffe27a'; return; }
    p.bounce--;
  }

  /** Roll a Lucky effect for a shot (only while it's active, at most 12 a second). */
  private lucky(id: ShotId, x: number, y: number): boolean {
    const n = lv(this.perm, `${id}Luck`);
    if (!n || this.shots[id].active <= 0) return false;
    const w = this.procWindow[id];
    if (w.n >= 12 || Math.random() >= luckChance(id, n)) return false;
    w.n++;
    this.procs[id]++; this.activeProcs[id]++;
    this.floater(x, y - 8, LUCK_INFO[id].word, '#ffe27a');
    this.spark(x, y, '#ffe27a', 6);
    sfx.sfxProc(this.activeProcs[id]);
    return true;
  }

  private reflect(p: Projectile, c: Cell) {
    // Normal of the hex edge the shot entered through (nearest of the 6 edge directions).
    const ang = Math.atan2(p.y - c.y, p.x - c.x);
    const edge = Math.round(ang / (Math.PI / 3)) * (Math.PI / 3);
    const nx = Math.cos(edge), ny = Math.sin(edge);
    const dot = p.vx * nx + p.vy * ny;
    if (dot < 0) { p.vx -= 2 * dot * nx; p.vy -= 2 * dot * ny; }
    p.x = c.x + nx * (HEX_INNER + 1.5); p.y = c.y + ny * (HEX_INNER + 1.5);
    p.last = -1;
    p.bounced = true;
  }

  damageCell(c: Cell, dmg: number, special: boolean, crit = false, indirect = true) {
    if (c.kind === Kind.Gem && c.hidden && !indirect) {
      // the hidden gem shrugs off direct shots
      this.spark(c.x, c.y, '#ecd7ff', 3);
      if (this.indirectHintT <= 0) { this.indirectHintT = 3; this.floater(c.x, c.y - 12, 'Needs a bounce, pierce or blast', '#ecd7ff'); }
      return;
    }
    if (c.kind === Kind.Gem) {
      const d = c.armor ? Math.max(dmg * 0.15, dmg - this.level.armorValue) : dmg;
      c.hp -= d; c.flash = 1; c.idleT = 0;
      if (c.hp <= 0) this.breakGem(c, special);
      else sfx.sfxHit(Math.min(6, Math.ceil(c.hp / this.level.hpUnit)));
      if (crit && Math.random() < 0.25) this.floater(c.x, c.y - 10, 'crit', '#ffd27c');
    } else if ((c.kind === Kind.Generator || c.kind === Kind.Keystone) && c.entity && !c.entity.broken) {
      if (c.kind === Kind.Keystone && this.shielded) return;
      const e = c.entity;
      e.hp -= dmg;
      for (const ec of e.cells) ec.flash = 1;
      sfx.sfxHit(3);
      if (e.hp <= 0) c.kind === Kind.Keystone ? this.breakKeystone(e, special) : this.breakGenerator(e, special);
    }
  }

  private comboMult() { return Math.min(2, 1 + this.combo / 20); }
  private bumpCombo() {
    this.combo = this.comboT > 0 ? this.combo + 1 : 1;
    this.comboT = 0.6;
    if (this.challenge.id === 'chain') this.progress(Math.max(this.challenge.progress, this.combo));
  }

  // ---------------- bonus challenge ----------------
  private progress(v: number) {
    const ch = this.challenge;
    if (ch.done) return;
    ch.progress = v;
    if (ch.id !== 'thrifty' && ch.id !== 'speed' && v >= ch.target) this.completeChallenge();
  }
  private completeChallenge() {
    const ch = this.challenge;
    if (ch.done) return;
    ch.done = true;
    this.floater(this.player.x, this.player.y - 40, 'BONUS COMPLETE', '#b9a2ff', true);
    sfx.sfxGold();
  }
  private trackThrifty() { if (this.challenge.id === 'thrifty') this.challenge.progress = this.purchases; }
  private addOre(amount: number, special: boolean, x: number, y: number) {
    const v = amount * oreGainMult(this.perm) * (special ? 1.5 : 1) * this.comboMult();
    this.oreEarned += v;
    this.floater(x, y - 14, `+${Math.max(1, Math.round(v))} ore`, '#e9c6ff');
  }

  private breakGem(c: Cell, special: boolean) {
    c.kind = Kind.Floor;
    c.hp = 0;
    c.collapsing = false;
    this.poisoned.delete(c);
    if (c.hidden) { this.breakHidden(c); return; }
    this.gemsBroken++;
    if (c.region >= 0) this.regionGemBroken(c.region);
    this.bumpCombo();
    const sh = (c.maxHp / (this.level.hpUnit / this.level.base)) * shardGainMult(this.perm);
    this.shards += sh; this.shardsCollected += sh;
    this.shatter(c, 9);
    this.shake = Math.min(6, this.shake + 1.2);
    sfx.sfxBreak(this.combo);
    if (c.gold) {
      this.goldsBroken++;
      const burst = this.level.base * 60 * shardGainMult(this.perm);
      this.shards += burst; this.shardsCollected += burst;
      this.floater(c.x, c.y, `GOLD ${this.goldsBroken}/${this.level.goldTotal}`, '#ffe27a', true);
      sfx.sfxGold();
      if (this.goldsBroken >= this.level.goldTotal) this.openVault();
    }
    if (c.oreAmt > 0) {
      // Ore veins pay double while the mine is collapsing.
      const surge = this.gateOpen ? 2 : 1;
      this.addOre(this.level.base * c.oreAmt * surge, special, c.x, c.y);
      if (c.geode) { this.floater(c.x, c.y - 30, 'GEODE', '#e9c6ff', true); sfx.sfxGold(); } else sfx.sfxOre();
      if (this.challenge.id === 'oreGems') this.progress(this.challenge.progress + 1);
    }
    const proj = this.curProj;
    if (proj) {
      proj.breaks++;
      if (this.challenge.id === 'pierce' && proj.piercing) this.progress(Math.max(this.challenge.progress, proj.breaks));
      if (this.challenge.id === 'bounce' && proj.bounced) this.progress(this.challenge.progress + 1);
    }
    if (c.boom) {
      if (this.challenge.id === 'boom') this.progress(this.challenge.progress + 1);
      sfx.sfxBoom();
      this.shake = Math.min(10, this.shake + 5);
      this.spark(c.x, c.y, '#ff9a3a', 18);
      this.explode(c, special);
    }
  }

  /** Explosive gem: damage every hex within reach, strongest next to the bomb and fading outward. */
  private explode(c: Cell, special: boolean) {
    const nR = lv(this.perm, 'bombRange'), nD = lv(this.perm, 'bombDmg');
    const reach = blastReach(nR), rings = Math.floor(reach);
    const dmg = c.maxHp * blastCore(nD);
    this.blasts.push({ x: c.x, y: c.y, r: reach * HEX_W, t: 0 });
    for (let ring = 1; ring <= rings; ring++) {
      const f = blastFalloff(ring, reach, nD);
      if (f <= 0.01) break;
      // walk the hex ring at distance `ring`
      let q = c.q + DIRS[4][0] * ring, r = c.r + DIRS[4][1] * ring;
      for (let side = 0; side < 6; side++) for (let k = 0; k < ring; k++) {
        const n = this.cellAt(q, r);
        if (n && n.kind !== Kind.Bedrock && n.kind !== Kind.Floor) this.damageCell(n, dmg * f, special);
        q += DIRS[side][0]; r += DIRS[side][1];
      }
    }
  }

  private breakGenerator(e: Entity, special: boolean) {
    e.broken = true;
    const c = e.cells[0];
    c.kind = Kind.Floor;
    this.shatter(c, 22);
    this.shake = 10;
    if (!e.paid) {
      e.paid = true;
      const sh = this.level.base * 30 * shardGainMult(this.perm);
      this.shards += sh; this.shardsCollected += sh;
      this.addOre(this.level.base * 8, special, c.x, c.y);
    }
    sfx.sfxGenerator();
    if (e.link && !e.link.broken) {
      e.relinkT = LINK_WINDOW;
      this.floater(c.x, c.y, `Break its twin within ${LINK_WINDOW}s!`, '#ff9ae6', true);
      return;
    }
    if (e.link) e.link.relinkT = 0;
    this.floater(c.x, c.y, this.shielded ? `Generator down · ${this.generatorsLeft} left` : 'Force field down!', '#7fe6ff', true);
  }

  /** A linked generator re-forms if its twin isn't broken in time. */
  private updateLinks(dt: number) {
    for (const g of this.level.generators) {
      if (!g.relinkT || g.relinkT <= 0) continue;
      g.relinkT -= dt;
      if (g.link?.broken) { g.relinkT = 0; continue; }
      if (g.relinkT <= 0) {
        g.relinkT = 0;
        g.broken = false;
        g.hp = g.maxHp * 0.4; // re-forms weakened, so softening both twins first is the way through
        const c = g.cells[0];
        c.kind = Kind.Generator; c.hp = g.hp; c.flash = 1;
        this.spark(c.x, c.y, '#ff9ae6', 16);
        this.floater(c.x, c.y, 'Generator re-formed', '#ff9ae6', true);
        sfx.sfxFizzle();
      }
    }
  }

  /** Regenerating gems heal after 2s untouched, unless poisoned. */
  private updateRegen(dt: number) {
    for (const c of this.regenCells) {
      if (c.kind !== Kind.Gem || c.hp >= c.maxHp) continue;
      c.idleT += dt;
      if (c.idleT < 2 || c.poisonT > 0) continue;
      c.hp = Math.min(c.maxHp, c.hp + c.maxHp * 0.2 * dt);
    }
  }

  private breakKeystone(e: Entity, special: boolean) {
    e.broken = true;
    for (const c of e.cells) { c.kind = Kind.Floor; this.shatter(c, 14); }
    this.shake = 16;
    this.slowMo = 0.5;
    this.addOre(this.level.base * 30, special, e.x, e.y);
    this.gateOpen = true;
    this.collapseT = COLLAPSE_SECONDS;
    this.keystoneTime = this.time;
    const ch = this.challenge;
    if (ch.id === 'speed') { ch.progress = Math.round(this.time); if (this.time <= ch.target) this.completeChallenge(); }
    if (ch.id === 'thrifty' && this.purchases <= ch.target) this.completeChallenge();
    this.floater(e.x, e.y - 30, 'KEYSTONE BROKEN', '#ffe9a8', true);
    sfx.sfxKeystone();
  }

  private updatePoison(dt: number) {
    for (const c of this.poisoned) {
      if (c.kind === Kind.Floor) { this.poisoned.delete(c); continue; }
      c.poisonT -= dt;
      if (c.poisonT <= 0) { c.poisonT = 0; c.poisonDps = 0; this.poisoned.delete(c); continue; }
      const before = c.flash;
      const dps = c.poisonDps;
      this.damageCell(c, dps * dt, true);
      c.flash = Math.max(before, 0.25);
      // Lucky Spread: 4 rolls a second while Poison is active
      if (!c.poisonChild && (c.kind as Kind) !== Kind.Floor) {
        c.spreadT += dt;
        while (c.spreadT >= 0.25) {
          c.spreadT -= 0.25;
          if (!this.lucky('poison', c.x, c.y)) continue;
          const opts = DIRS.map(([a, b]) => this.cellAt(c.q + a, c.r + b)).filter((n): n is Cell => !!n && n.kind === Kind.Gem && n.poisonT <= 0);
          if (!opts.length) continue;
          const n = opts[Math.floor(Math.random() * opts.length)];
          n.poisonDps = dps; n.poisonT = Math.max(n.poisonT, 3); n.poisonChild = true;
          this.poisoned.add(n);
          this.spark(n.x, n.y, '#9dffb0', 6);
        }
      }
    }
  }

  // ---------------- regions ----------------
  private regionGemBroken(id: number) {
    const rg = this.level.regions[id];
    if (!rg || rg.cleared) return;
    this.regionLeft[id]--;
    const left = this.regionLeft[id];
    if (left <= 0) { this.clearRegion(rg); return; }
    if (left <= collapseAt(rg.gemTotal)) for (const g of rg.gems) if (g.kind === Kind.Gem) g.collapsing = true;
  }

  /** Stragglers lose 15% of their HP a second until they crumble. */
  private updateCollapse(dt: number) {
    if (!this.regionLevel) return;
    for (const rg of this.level.regions) {
      if (rg.cleared || this.regionLeft[rg.id] > collapseAt(rg.gemTotal)) continue;
      for (const g of rg.gems) if (g.kind === Kind.Gem && g.collapsing) this.damageCell(g, g.maxHp * 0.15 * dt, false);
    }
  }

  private clearRegion(rg: Region) {
    rg.cleared = true;
    if (rg.vault) {
      this.vaultCleared = true;
      this.floater(this.player.x, this.player.y - 40, 'VAULT CLEARED', '#ffe27a', true);
      sfx.sfxGold();
      return;
    }
    if (rg.next < 0) { this.floater(this.player.x, this.player.y - 40, 'ROOM CLEARED', '#bff4ff', true); return; }
    this.breach(rg);
  }

  /** Breaking a seal: shockwave into the next room, a Shard burst, every cooldown refilled, and a checkpoint. */
  private breach(rg: Region, silent = false) {
    const seal = rg.seal;
    for (const c of seal) { c.kind = Kind.Floor; if (!silent) this.shatter(c, 4); }
    if (silent) return;
    const next = this.level.regions[rg.next];
    const sx = seal.reduce((a, c) => a + c.x, 0) / seal.length, sy = seal.reduce((a, c) => a + c.y, 0) / seal.length;
    this.blasts.push({ x: sx, y: sy, r: 4 * HEX_W, t: 0 });
    for (const g of next.gems) {
      if (g.kind !== Kind.Gem) continue;
      if (seal.some(s => Math.hypot(s.x - g.x, s.y - g.y) < HEX_W * 2.6)) this.damageCell(g, g.maxHp * 0.5, false);
    }
    const burst = next.gems.reduce((a, g) => a + g.maxHp, 0) / (this.level.hpUnit / this.level.base) * 0.1 * shardGainMult(this.perm);
    this.shards += burst; this.shardsCollected += burst;
    for (const id of SHOTS) if (this.shots[id].lvl > 0 && this.shots[id].active <= 0) this.shots[id].cd = 0;
    this.shake = 14; this.slowMo = 0.35;
    this.floater(sx, sy - 30, 'SEAL BROKEN', '#bff4ff', true);
    this.floater(sx, sy, `+${Math.round(burst)} Shards · abilities ready`, '#d8ccff');
    sfx.sfxGenerator();
    this.onCheckpoint?.();
  }

  private openVault() {
    const v = this.level.vault;
    if (!v || this.vaultOpen) return;
    this.vaultOpen = true;
    for (const c of v.seal) { c.kind = Kind.Floor; this.shatter(c, 3); }
    const sx = v.seal.reduce((a, c) => a + c.x, 0) / Math.max(1, v.seal.length), sy = v.seal.reduce((a, c) => a + c.y, 0) / Math.max(1, v.seal.length);
    this.floater(sx, sy - 20, 'VAULT OPEN', '#ffe27a', true);
  }

  private breakHidden(c: Cell) {
    this.hiddenFound = true;
    this.shatter(c, 26);
    this.blasts.push({ x: c.x, y: c.y, r: 2.5 * HEX_W, t: 0 });
    this.addOre(this.level.base * 20, true, c.x, c.y);
    this.floater(c.x, c.y - 34, 'HIDDEN GEM FOUND', '#ecd7ff', true);
    this.slowMo = 0.4;
    sfx.sfxKeystone();
  }

  /** A soft chime when you pass near the hidden gem. */
  private updateHiddenChime() {
    const h = this.level.hiddenGem;
    if (!h || this.hiddenFound) return;
    const d = Math.hypot(h.x - this.player.x, h.y - this.player.y) / HEX_W;
    if (d < 5 && !this.hiddenChimed) { this.hiddenChimed = true; sfx.sfxChime(); }
    else if (d > 7) this.hiddenChimed = false;
  }

  // ---------------- checkpoints ----------------
  snapshot(): Checkpoint {
    return {
      L: this.L,
      cleared: this.level.regions.filter(r => r.cleared && !r.vault).map(r => r.id),
      shards: this.shards, shardsCollected: this.shardsCollected, oreEarned: this.oreEarned,
      boosts: { ...this.boosts }, shots: Object.fromEntries(SHOTS.map(s => [s, this.shots[s].lvl])),
      purchases: this.purchases, time: this.time, gemsBroken: this.gemsBroken,
      gensBroken: this.level.generators.map((g, i) => (g.broken && !g.relinkT ? i : -1)).filter(i => i >= 0),
      vaultCleared: this.vaultCleared, hiddenFound: this.hiddenFound,
      challenge: { progress: this.challenge.progress, done: this.challenge.done },
      procs: { ...this.procs },
    };
  }

  private restore(cp: Checkpoint) {
    const lv = this.level;
    const clearCells = (rg: Region) => { for (const g of rg.gems) { if (g.gold && g.kind === Kind.Gem) this.goldsBroken++; g.kind = Kind.Floor; g.hp = 0; } rg.cleared = true; this.regionLeft[rg.id] = 0; };
    let last: Region | null = null;
    for (const id of cp.cleared) { const rg = lv.regions[id]; if (!rg) continue; clearCells(rg); this.breach(rg, true); last = rg; }
    if (cp.vaultCleared && lv.vault) { clearCells(lv.vault); this.vaultCleared = true; }
    if (this.goldsBroken >= lv.goldTotal) this.openVault();
    for (const i of cp.gensBroken) { const g = lv.generators[i]; if (g) { g.broken = true; g.paid = true; g.cells[0].kind = Kind.Floor; } }
    if (cp.hiddenFound && lv.hiddenGem) { this.hiddenFound = true; lv.hiddenGem.kind = Kind.Floor; }
    this.shards = cp.shards; this.shardsCollected = cp.shardsCollected; this.oreEarned = cp.oreEarned;
    Object.assign(this.boosts, cp.boosts);
    for (const s of SHOTS) this.shots[s].lvl = cp.shots[s] ?? 0;
    this.purchases = cp.purchases; this.time = cp.time; this.gemsBroken = cp.gemsBroken;
    this.challenge.progress = cp.challenge.progress; this.challenge.done = cp.challenge.done;
    Object.assign(this.procs, cp.procs);
    if (last) {
      const s = last.seal;
      this.player.x = s.reduce((a, c) => a + c.x, 0) / s.length;
      this.player.y = s.reduce((a, c) => a + c.y, 0) / s.length;
    }
  }

  // ---------------- effects ----------------
  private shatter(c: Cell, n: number) {
    const color = c.gold ? '#ffd65a' : c.entity ? '#ffe2a0' : gemColor(c, this.level.hpUnit);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 60 + Math.random() * 170;
      this.particles.push({
        x: c.x + Math.cos(a) * 6, y: c.y + Math.sin(a) * 6, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 0.5 + Math.random() * 0.4, max: 0.9, color, size: 3 + Math.random() * 5,
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * 14, kind: 0,
      });
    }
    if (this.particles.length > 700) this.particles.splice(0, this.particles.length - 700);
  }
  spark(x: number, y: number, color: string, n: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 40 + Math.random() * 120;
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.25, max: 0.25, color, size: 2, rot: 0, vr: 0, kind: 1 });
    }
  }
  floater(x: number, y: number, text: string, color: string, big = false) {
    this.floaters.push({ x, y, text, life: big ? 1.6 : 0.9, color, big });
    if (this.floaters.length > 40) this.floaters.shift();
  }
  private updateParticles(dt: number) {
    for (const b of this.blasts) b.t += dt;
    this.blasts = this.blasts.filter(b => b.t < 0.45);
    for (const p of this.particles) {
      p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 1 - 3 * dt; p.vy *= 1 - 3 * dt;
      p.rot += p.vr * dt; p.life -= dt;
    }
    this.particles = this.particles.filter(p => p.life > 0);
    for (const f of this.floaters) { f.y -= 26 * dt; f.life -= dt; }
    this.floaters = this.floaters.filter(f => f.life > 0);
  }

  // ---------------- end of level ----------------
  finish(reason: EndReason) {
    if (this.result) return;
    const lv = this.level;
    let stars = 0;
    if (lv.keystone.broken) stars |= 1;
    if (this.regionLevel) {
      // region levels: Par time and the Vault replace the clear and gold stars
      if (lv.keystone.broken && this.keystoneTime <= this.par) stars |= 2;
      if (this.vaultCleared) stars |= 4;
    } else {
      if (this.clearPct >= CLEAR_TARGET) stars |= 2;
      if (this.goldsBroken >= lv.goldTotal) stars |= 4;
    }
    if (this.challenge.done) stars |= CHALLENGE_BIT;
    if (reason === 'abandon') stars = 0;
    const salvage = this.shardsCollected * 0.1 * oreGainMult(this.perm);
    this.result = {
      L: this.L, reason, stars, time: this.time, clearPct: this.clearPct,
      golds: this.goldsBroken, goldTotal: lv.goldTotal, generators: lv.generators.length,
      ore: this.oreEarned + salvage, salvage, shardsCollected: this.shardsCollected,
      challenge: this.challenge,
      regionLevel: this.regionLevel, vaultCleared: this.vaultCleared, par: this.par, keystoneTime: this.keystoneTime,
      hiddenFound: this.hiddenFound, procs: { ...this.procs },
    };
  }
}

const GEM_HUES = ['#8c837c', '#d63a55', '#f08a2b', '#f2c23a', '#2fae6e', '#3a78e8', '#9a5ce0'];
/** Tier 0 (grey, one hit left) .. 6 (amethyst, toughest). */
export function gemTier(c: Cell, base: number, damage: number) {
  if (c.hp <= damage) return 0;
  const r = c.hp / base;
  return r < 0.6 ? 1 : r < 1.0 ? 2 : r < 1.5 ? 3 : r < 2.2 ? 4 : r < 3.2 ? 5 : 6;
}
function gemColor(c: Cell, base: number) {
  const r = c.maxHp / base;
  return GEM_HUES[r < 0.6 ? 1 : r < 1.0 ? 2 : r < 1.5 ? 3 : r < 2.2 ? 4 : r < 3.2 ? 5 : 6];
}
export { GEM_HUES };
