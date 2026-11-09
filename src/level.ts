// Procedural level generator. The same level number always builds the same map.
import { DIRS, hexDist, hexToPixel } from './hex';
import { Rng, hash2 } from './rng';
import { generatorCount, levelBaseHp, levelRadius } from './economy';

/** Gems take this many times more hits than the base HP suggests; Shards pay back 1/HP_SCALE per HP. */
export const HP_SCALE = 2.5;

export enum Kind { Floor = 1, Gem = 2, Bedrock = 3, Keystone = 4, Generator = 5 }

export interface Entity { hp: number; maxHp: number; x: number; y: number; cells: Cell[]; broken: boolean }

export interface Cell {
  q: number; r: number; x: number; y: number;
  idx: number;
  kind: Kind;
  hp: number; maxHp: number;
  gold: boolean; ore: boolean; armor: boolean; boom: boolean;
  border: boolean;
  shade: number; // 0..1 cosmetic variation
  flash: number;
  poisonDps: number; poisonT: number;
  entity: Entity | null;
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
  armorValue: number;
  /** HP that maps to the middle of the colour ladder for this level. */
  hpUnit: number;
}

export function generateLevel(L: number): Level {
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
    const [x, y] = hexToPixel(q, r);
    const c: Cell = {
      q, r, x, y, idx: key(q, r), kind: d === N ? Kind.Bedrock : Kind.Gem, hp: 0, maxHp: 0,
      gold: false, ore: false, armor: false, boom: false, border: d === N,
      shade: hash2(q, r, L), flash: 0, poisonDps: 0, poisonT: 0, entity: null,
    };
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
  const isPlainGem = (c: Cell) => c.kind === Kind.Gem && !c.gold && !c.ore && !c.border;

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
  for (let i = 0; i < gN; i++) {
    const ang = kAng + Math.PI * (0.45 + (1.1 * (i + 0.5)) / gN) * (i % 2 ? -1 : 1) + rng.range(-0.25, 0.25);
    const dist = N * rng.range(0.45, 0.8) * Math.sqrt(3) * 22;
    const gc = nearestTo(Math.cos(ang) * dist, Math.sin(ang) * dist, c => c.kind === Kind.Gem && hexDist(c.q, c.r) <= N - 2);
    const g: Entity = { hp: base * 18, maxHp: base * 18, x: gc.x, y: gc.y, cells: [gc], broken: false };
    gc.kind = Kind.Generator; gc.entity = g;
    generators.push(g);
  }

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
      if (isPlainGem(c)) c.ore = true;
      const opts: Cell[] = nbrs(c).filter(isPlainGem);
      c = opts.length ? rng.pick(opts) : null;
    }
  }

  // ---- armored and explosive gems ----
  const armorP = L < 3 ? 0 : Math.min(0.12, 0.03 + 0.003 * L);
  for (const c of cells) {
    if (!isPlainGem(c) || hexDist(c.q, c.r) < 4) continue;
    const roll = rng.next();
    if (roll < armorP) c.armor = true;
    else if (roll < armorP + 0.025) c.boom = true;
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
    let hp = base * HP_SCALE * (0.6 + 2.6 * d) * (0.7 + 0.6 * noise);
    if (c.armor) hp *= 1.8;
    if (c.ore) hp *= 1.4;
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
    armorValue: base * HP_SCALE * 0.45,
    hpUnit: base * HP_SCALE,
  };
}

/** Shortest route that prefers not to cross walls; any inner walls on it become gems. */
function carvePath(from: Cell, to: Cell, nbrs: (c: Cell) => Cell[]) {
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
