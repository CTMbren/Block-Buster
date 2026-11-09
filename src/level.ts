// Procedural level generator. The same level number always builds the same map.
import { DIRS, hexDist, hexToPixel } from './hex';
import { Rng, hash2 } from './rng';
import { generateRegionLevel } from './regions';
import { generatorCount, levelBaseHp, levelRadius } from './economy';

/** Gems take this many times more hits than the base HP suggests; Shards pay back 1/HP_SCALE per HP. */
export const HP_SCALE = 3.0;
/** Levels 1-2 are lighter while you learn: 60% and 80% of full toughness. */
export const hpScale = (L: number) => HP_SCALE * Math.min(1, 0.6 + 0.2 * (L - 1));

export enum Kind { Floor = 1, Gem = 2, Bedrock = 3, Keystone = 4, Generator = 5, Seal = 6 }

export interface Entity {
  hp: number; maxHp: number; x: number; y: number; cells: Cell[]; broken: boolean;
  /** Linked generator: both must break within LINK_WINDOW seconds or the first one re-forms. */
  link?: Entity;
  relinkT?: number;
  paid?: boolean;
}
export const LINK_WINDOW = 8;

export interface Cell {
  q: number; r: number; x: number; y: number;
  idx: number;
  kind: Kind;
  hp: number; maxHp: number;
  gold: boolean; ore: boolean; armor: boolean; boom: boolean;
  /** Ore paid when broken, in units of the level's base HP (veins 1.5, deposits 5, geodes 25). */
  oreAmt: number;
  geode: boolean;
  regen: boolean; idleT: number;
  border: boolean;
  shade: number; // 0..1 cosmetic variation
  flash: number;
  poisonDps: number; poisonT: number;
  entity: Entity | null;
  /** Region index on region levels (-1 = none / disc level). */
  region: number;
  /** The hidden gem: only indirect damage (bounces, pierces, blasts, poison) cracks it. */
  hidden: boolean;
  /** Last stragglers of a region crumble on their own. */
  collapsing: boolean;
  /** Poison that arrived by Lucky Spread can't spread again. */
  poisonChild: boolean;
  spreadT: number;
}

export interface Region {
  id: number;
  vault: boolean;
  x: number; y: number;
  /** Gems that must be broken to clear this region (excludes the hidden gem). */
  gems: Cell[];
  gemTotal: number;
  /** Seal cells this region's clear opens (vault: opened by the golds instead). */
  seal: Cell[];
  next: number;
  cleared: boolean;
}

export interface Level {
  L: number;
  radius: number;
  base: number;
  size: number;
  grid: (Cell | null)[];
  cells: Cell[];
  keystone: Entity;
  generators: Entity[];
  goldTotal: number;
  gemTotal: number;
  boomTotal: number;
  shell: boolean;
  armorValue: number;
  /** HP that maps to the middle of the colour ladder for this level. */
  hpUnit: number;
  spawn: { x: number; y: number };
  /** Region levels only (from REGION_LEVEL). */
  regions: Region[];
  vault: Region | null;
  hiddenGem: Cell | null;
}

export const REGION_LEVEL = 6;
export const HIDDEN_GEM_LEVEL = 8;

export function makeCell(q: number, r: number, idx: number, kind: Kind, L: number, border = false): Cell {
  const [x, y] = hexToPixel(q, r);
  return {
    q, r, x, y, idx, kind, hp: 0, maxHp: 0,
    gold: false, ore: false, armor: false, boom: false, oreAmt: 0, geode: false, regen: false, idleT: 0, border,
    shade: hash2(q, r, L), flash: 0, poisonDps: 0, poisonT: 0, entity: null,
    region: -1, hidden: false, collapsing: false, poisonChild: false, spreadT: 0,
  };
}

export function generateLevel(L: number): Level {
  return L >= REGION_LEVEL ? generateRegionLevel(L) : generateDiscLevel(L);
}

export function generateDiscLevel(L: number): Level {
  const rng = new Rng(L * 7919 + 13);
  const N = levelRadius(L);
  const base = levelBaseHp(L);
  const size = 2 * N + 1;
  const grid: (Cell | null)[] = new Array(size * size).fill(null);
  const cells: Cell[] = [];
  const key = (q: number, r: number) => (q + N) * size + (r + N);
  const get = (q: number, r: number) => (Math.abs(q) > N || Math.abs(r) > N ? null : grid[key(q, r)]);

  for (let q = -N; q <= N; q++) for (let r = -N; r <= N; r++) {
    const d = hexDist(q, r);
    if (d > N) continue;
    const c = makeCell(q, r, key(q, r), d === N ? Kind.Bedrock : Kind.Gem, L, d === N);
    grid[c.idx] = c;
    cells.push(c);
  }
  const nbrs = (c: Cell) => DIRS.map(([a, b]) => get(c.q + a, c.r + b)).filter((n): n is Cell => !!n);
  const nearestTo = (px: number, py: number, pred: (c: Cell) => boolean) => {
    let best: Cell | null = null, bd = Infinity;
    for (const c of cells) {
      if (!pred(c)) continue;
      const d = (c.x - px) ** 2 + (c.y - py) ** 2;
      if (d < bd) { bd = d; best = c; }
    }
    return best!;
  };
  const isPlainGem = (c: Cell) => c.kind === Kind.Gem && !c.gold && !c.ore && !c.geode && !c.border;

  // ---- inner boundary ring with gaps ----
  const ringR = Math.round(N * 0.55);
  if (ringR >= 4) {
    const ring: Cell[] = [];
    let q = DIRS[4][0] * ringR, r = DIRS[4][1] * ringR;
    for (let side = 0; side < 6; side++) for (let s = 0; s < ringR; s++) {
      const c = get(q, r); if (c) ring.push(c);
      q += DIRS[side][0]; r += DIRS[side][1];
    }
    const gaps = rng.int(2, 3);
    const gapStarts = Array.from({ length: gaps }, (_, i) => Math.floor(((i + rng.range(0.1, 0.6)) / gaps) * ring.length));
    ring.forEach((c, i) => {
      const inGap = gapStarts.some(g => ((i - g + ring.length) % ring.length) < 3);
      if (!inGap) c.kind = Kind.Bedrock;
    });
  }
  // ---- scattered wall segments ----
  const segs = rng.int(3, 5) + Math.min(4, Math.floor(L / 4));
  for (let s = 0; s < segs; s++) {
    let c = rng.pick(cells.filter(c => { const d = hexDist(c.q, c.r); return d >= 4 && d <= N - 2; }));
    const len = rng.int(3, 7);
    const dir = rng.int(0, 5);
    for (let i = 0; i < len && c; i++) {
      c.kind = Kind.Bedrock;
      const turn = rng.next() < 0.3 ? rng.pick([-1, 1]) : 0;
      const d = DIRS[(dir + turn + 6) % 6];
      c = get(c.q + d[0], c.r + d[1]) as Cell;
      if (c && c.border) break;
    }
  }

  // ---- spawn clearing ----
  for (const c of cells) if (hexDist(c.q, c.r) <= 2) c.kind = Kind.Floor;

  // ---- keystone: a 7-hex cluster far from spawn ----
  const kAng = rng.range(0, Math.PI * 2);
  const kDist = N * rng.range(0.75, 0.85) * Math.sqrt(3) * 22;
  const kc = nearestTo(Math.cos(kAng) * kDist, Math.sin(kAng) * kDist, c => hexDist(c.q, c.r) <= N - 3);
  const keystone: Entity = { hp: base * 80, maxHp: base * 80, x: kc.x, y: kc.y, cells: [], broken: false };
  for (const c of [kc, ...nbrs(kc)]) { c.kind = Kind.Keystone; c.entity = keystone; keystone.cells.push(c); }
  for (const c of keystone.cells) for (const n of nbrs(c)) if (n.kind === Kind.Bedrock && !n.border) n.kind = Kind.Gem;

  // ---- force field generators, spread around the map away from the keystone ----
  const generators: Entity[] = [];
  const gN = generatorCount(L);
  const linked = L >= 10;
  for (let i = 0; i < gN; i++) {
    let gc: Cell;
    if (linked && i % 2 === 1) {
      // the twin of a linked pair sits a short walk from its partner
      const prev = generators[i - 1];
      const a = rng.range(0, Math.PI * 2), d = rng.range(5, 7) * Math.sqrt(3) * 22;
      gc = nearestTo(prev.x + Math.cos(a) * d, prev.y + Math.sin(a) * d, c => c.kind === Kind.Gem && hexDist(c.q, c.r) <= N - 2 && hexDist(c.q, c.r, prev.cells[0].q, prev.cells[0].r) >= 4);
    } else {
      const slot = linked ? Math.floor(i / 2) : i, slots = linked ? Math.ceil(gN / 2) : gN;
      const ang = kAng + Math.PI * (0.45 + (1.1 * (slot + 0.5)) / slots) * (slot % 2 ? -1 : 1) + rng.range(-0.25, 0.25);
      const dist = N * rng.range(0.45, 0.8) * Math.sqrt(3) * 22;
      gc = nearestTo(Math.cos(ang) * dist, Math.sin(ang) * dist, c => c.kind === Kind.Gem && hexDist(c.q, c.r) <= N - 2);
    }
    const g: Entity = { hp: base * 18, maxHp: base * 18, x: gc.x, y: gc.y, cells: [gc], broken: false };
    gc.kind = Kind.Generator; gc.entity = g;
    generators.push(g);
  }
  // From level 10, generators come in linked pairs that must break within a few seconds of each other.
  if (linked) for (let i = 0; i + 1 < generators.length; i += 2) { generators[i].link = generators[i + 1]; generators[i + 1].link = generators[i]; }

  // ---- golden hexes ----
  const gOff = rng.range(0, Math.PI * 2);
  for (let i = 0; i < 3; i++) {
    const ang = gOff + (i * Math.PI * 2) / 3 + rng.range(-0.4, 0.4);
    const dist = N * rng.range(0.35, 0.85) * Math.sqrt(3) * 22;
    nearestTo(Math.cos(ang) * dist, Math.sin(ang) * dist, isPlainGem).gold = true;
  }

  // ---- ore veins ----
  const veins = Math.min(7, 4 + Math.floor(L / 8));
  for (let v = 0; v < veins; v++) {
    let c: Cell | null = rng.pick(cells.filter(c => isPlainGem(c) && hexDist(c.q, c.r) >= 3));
    const len = rng.int(4, 7);
    for (let i = 0; i < len && c; i++) {
      if (isPlainGem(c)) { c.ore = true; c.oreAmt = 1.5; }
      const opts: Cell[] = nbrs(c).filter(isPlainGem);
      c = opts.length ? rng.pick(opts) : null;
    }
  }

  // ---- ore deposits: 3-gem clusters tucked into nooks against the walls ----
  const nooks = rng.int(2, 3);
  const nookCells = cells.filter(c => isPlainGem(c) && hexDist(c.q, c.r) >= 4 && nbrs(c).filter(n => n.kind === Kind.Bedrock).length >= 3);
  for (let i = 0; i < nooks && nookCells.length; i++) {
    const c0 = nookCells.splice(rng.int(0, nookCells.length - 1), 1)[0];
    const cluster = [c0, ...nbrs(c0).filter(isPlainGem).slice(0, 2)];
    for (const c of cluster) { c.ore = true; c.oreAmt = 5; }
  }
  // ---- geodes: armored single gems worth a lot of Ore, often beside a generator ----
  const geodes = L < 4 ? 1 : 2;
  for (let i = 0; i < geodes; i++) {
    const g = generators[i];
    const near = g ? nbrs(g.cells[0]).flatMap(nbrs).filter(c => isPlainGem(c) && c !== g.cells[0]) : [];
    const pool = near.length ? near : cells.filter(c => isPlainGem(c) && hexDist(c.q, c.r) >= N * 0.5);
    if (!pool.length) continue;
    const c = rng.pick(pool);
    c.geode = true; c.armor = true; c.oreAmt = 25;
  }
  // ---- Keystone shell: a ring of armored gems around it on some levels from 6 ----
  const shell = L >= 6 && (L % 2 === 0 || generators.length === 0);
  if (shell) for (const c of keystone.cells) for (const n of nbrs(c)) if (n.kind !== Kind.Keystone && !n.border) { n.kind = Kind.Gem; n.armor = true; }

  // ---- armored, explosive and regenerating gems ----
  const regenP = L < 9 ? 0 : Math.min(0.08, 0.012 * (L - 8));
  const armorP = L < 3 ? 0 : Math.min(0.12, 0.03 + 0.003 * L);
  for (const c of cells) {
    if (!isPlainGem(c) || hexDist(c.q, c.r) < 4) continue;
    const roll = rng.next();
    if (roll < armorP) c.armor = true;
    else if (roll < armorP + 0.025) c.boom = true;
    else if (roll < armorP + 0.025 + regenP) c.regen = true;
  }

  // ---- make sure the keystone and every generator can be reached ----
  for (const target of [kc, ...generators.map(g => g.cells[0])]) carvePath(get(0, 0)!, target, nbrs);

  // ---- hit points: tougher further out, smoothed noise so tough "veins" form ----
  const raw = new Map<Cell, number>();
  for (const c of cells) raw.set(c, hash2(c.q >> 1, c.r >> 1, L + 99));
  for (const c of cells) {
    if (c.kind !== Kind.Gem) continue;
    const ns = nbrs(c);
    const noise = (raw.get(c)! * 2 + ns.reduce((a, n) => a + raw.get(n)!, 0)) / (2 + ns.length);
    const d = hexDist(c.q, c.r) / N;
    let hp = base * hpScale(L) * (0.6 + 2.6 * d) * (0.7 + 0.6 * noise);
    if (c.armor) hp *= 1.8;
    if (c.ore) hp *= c.oreAmt > 2 ? 1.8 : 1.4;
    if (c.geode) hp *= 2.2;
    if (c.gold) hp *= 2.5;
    c.hp = c.maxHp = hp;
  }
  // Keystone and generators scale with the level's total gem HP so they stay a real objective.
  const totalHp = cells.reduce((a, c) => a + (c.kind === Kind.Gem ? c.maxHp : 0), 0);
  keystone.hp = keystone.maxHp = totalHp * 0.3;
  for (const g of generators) { g.hp = g.maxHp = totalHp * 0.05; g.cells[0].hp = g.cells[0].maxHp = g.maxHp; }

  return {
    L, radius: N, base, size, grid, cells, keystone, generators,
    goldTotal: cells.filter(c => c.gold).length,
    gemTotal: cells.filter(c => c.kind === Kind.Gem).length,
    boomTotal: cells.filter(c => c.kind === Kind.Gem && c.boom).length,
    shell,
    armorValue: base * hpScale(L) * 0.45,
    hpUnit: base * hpScale(L),
    spawn: { x: 0, y: 0 }, regions: [], vault: null, hiddenGem: null,
  };
}

/** Shortest route that prefers not to cross walls; any inner walls on it become gems. */
export function carvePath(from: Cell, to: Cell, nbrs: (c: Cell) => Cell[]) {
  const dist = new Map<Cell, number>([[from, 0]]);
  const prev = new Map<Cell, Cell>();
  const dq: Cell[] = [from];
  while (dq.length) {
    const c = dq.shift()!;
    if (c === to) break;
    for (const n of nbrs(c)) {
      if (n.border) continue;
      const w = n.kind === Kind.Bedrock ? 1 : 0;
      const nd = dist.get(c)! + w;
      if (nd < (dist.get(n) ?? Infinity)) {
        dist.set(n, nd); prev.set(n, c);
        if (w) dq.push(n); else dq.unshift(n);
      }
    }
  }
  let c: Cell | undefined = to;
  while (c && c !== from) {
    if (c.kind === Kind.Bedrock) c.kind = Kind.Gem;
    c = prev.get(c);
  }
}
