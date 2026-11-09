// In-level simulation: movement, shooting, damage, rewards and level end.
import { HEX_INNER, HEX_W, DIRS, pixelToHex } from './hex';
import { HP_SCALE, Kind, LINK_WINDOW, generateLevel, type Cell, type Entity, type Level } from './level';
import { CHALLENGE_BIT, pickChallenge, type Challenge } from './challenge';
import {
  BOOSTS, BOOST_BASE, CLEAR_TARGET, COLLAPSE_SECONDS, SHOTS, SHOT_LEVEL_BASE, SHOT_UNLOCK_BASE,
  abilitySlots, availableShots, blasterStats, inLevelCost, oreGainMult, shardGainMult, shotStats,
  type BoostId, type Perm, type ShotId,
} from './economy';
import * as sfx from './audio';

export interface Projectile {
  x: number; y: number; vx: number; vy: number;
  dmg: number; dist: number; pierce: number; bounce: number;
  poison: { frac: number; time: number } | null;
  special: boolean; crit: boolean; last: number; color: string;
  piercing: boolean; bounced: boolean; breaks: number;
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
}

const PLAYER_R = 11;
const PLAYER_SPEED = 150;
const SOLID = (k: Kind) => k === Kind.Gem || k === Kind.Bedrock || k === Kind.Generator || k === Kind.Keystone;

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

  constructor(L: number, public perm: Perm) {
    this.L = L;
    this.level = generateLevel(L);
    this.challenge = pickChallenge(this.level);
    this.regenCells = this.level.cells.filter(c => c.regen);
    if (perm.sp.headStart) this.shards = inLevelCost(BOOST_BASE.damage, 0, L);
    this.freeShotAvailable = !!perm.sp.freeShot;
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
        dmg: b.damage * (crit ? 2 : 1), dist: b.range * HEX_W, pierce: pier, bounce,
        poison: pz ? { frac: pz.poisonFrac, time: pz.poisonTime } : null,
        special, crit, last: -1, color, piercing: pier > 0, bounced: false, breaks: 0,
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
    if (c.kind === Kind.Bedrock || shieldedKeystone) {
      if (shieldedKeystone) { this.spark(p.x, p.y, '#7fe6ff', 3); if (Math.random() < 0.3) sfx.sfxFizzle(); }
      if (p.bounce > 0) { this.reflect(p, c); p.bounce--; return true; }
      if (!shieldedKeystone) this.spark(p.x, p.y, '#8a8090', 2);
      return false;
    }
    this.curProj = p;
    this.damageCell(c, p.dmg, p.special, p.crit);
    this.curProj = null;
    if (p.poison && c.kind !== Kind.Floor) {
      c.poisonDps = Math.max(c.poisonDps, p.dmg * p.poison.frac);
      c.poisonT = Math.max(c.poisonT, p.poison.time);
      this.poisoned.add(c);
    }
    if (p.pierce > 0) { p.pierce--; p.dmg *= 0.8; p.last = c.idx; return true; }
    if (p.bounce > 0) {
      if (c.kind === Kind.Floor) { p.last = c.idx; p.bounce--; p.dmg *= 0.75; return true; }
      this.reflect(p, c); p.bounce--; p.dmg *= 0.75; return true;
    }
    return false;
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

  damageCell(c: Cell, dmg: number, special: boolean, crit = false) {
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
    this.poisoned.delete(c);
    this.gemsBroken++;
    this.bumpCombo();
    const sh = (c.maxHp / HP_SCALE) * shardGainMult(this.perm);
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
      for (const [a, b] of DIRS) {
        const n = this.cellAt(c.q + a, c.r + b);
        if (n && n.kind !== Kind.Bedrock) this.damageCell(n, this.level.hpUnit * 5, special);
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
      this.damageCell(c, c.poisonDps * dt, true);
      c.flash = Math.max(before, 0.25);
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
    if (this.clearPct >= CLEAR_TARGET) stars |= 2;
    if (this.goldsBroken >= lv.goldTotal) stars |= 4;
    if (this.challenge.done) stars |= CHALLENGE_BIT;
    if (reason === 'abandon') stars = 0;
    const salvage = this.shardsCollected * 0.1 * oreGainMult(this.perm);
    this.result = {
      L: this.L, reason, stars, time: this.time, clearPct: this.clearPct,
      golds: this.goldsBroken, goldTotal: lv.goldTotal, generators: lv.generators.length,
      ore: this.oreEarned + salvage, salvage, shardsCollected: this.shardsCollected,
      challenge: this.challenge,
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
