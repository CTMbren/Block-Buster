// Region levels (from REGION_LEVEL): several sealed rooms joined by seal bridges.
// Clearing every gem in a room opens the seal to the next. The Keystone is in the last room;
// a small Vault hangs off one room behind a gold seal that opens when the 3 golds are broken.
import { DIRS, HEX_R, HEX_W, hexDist, hexRound } from './hex';
import { Rng, hash2 } from './rng';
import { generatorCount, levelBaseHp } from './economy';
import {
  HIDDEN_GEM_LEVEL, HP_SCALE, Kind, generateDiscLevel, makeCell,
  type Cell, type Entity, type Level, type Region,
} from './level';

interface RoomSpec { x: number; y: number; rad: number; vault: boolean }

/** Room layout for a level: twin chambers until 10, then a chain of three. Positions in pixels. */
function layout(L: number, rng: Rng): { rooms: RoomSpec[]; links: [number, number][]; vaultParent: number } {
  const hexR = (n: number) => n * HEX_W;
  if (L <= 10) {
    const r = hexR(12.5), gap = hexR(3);
    const tilt = rng.range(-0.5, 0.5);
    const dx = Math.cos(tilt) * (r * 2 + gap) / 2, dy = Math.sin(tilt) * (r * 2 + gap) / 2;
    const rooms: RoomSpec[] = [{ x: -dx, y: -dy, rad: r, vault: false }, { x: dx, y: dy, rad: r, vault: false }];
    const parent = rng.int(0, 1), side = rng.pick([-1, 1]);
    const p = rooms[parent], vr = hexR(5.5);
    const nx = -Math.sin(tilt) * side, ny = Math.cos(tilt) * side;
    rooms.push({ x: p.x + nx * (r + vr + gap), y: p.y + ny * (r + vr + gap), rad: vr, vault: true });
    return { rooms, links: [[0, 1]], vaultParent: parent };
  }
  const r = hexR(11), gap = hexR(3), step = r * 2 + gap;
  const a0 = rng.range(0, Math.PI * 2);
  const bend = rng.pick([-1, 1]) * rng.range(0.6, 1.0);
  const rooms: RoomSpec[] = [{ x: 0, y: 0, rad: r, vault: false }];
  rooms.push({ x: Math.cos(a0) * step, y: Math.sin(a0) * step, rad: r, vault: false });
  rooms.push({ x: rooms[1].x + Math.cos(a0 + bend) * step, y: rooms[1].y + Math.sin(a0 + bend) * step, rad: r, vault: false });
  const va = a0 + bend / 2 + Math.PI / 2 * (bend > 0 ? -1 : 1), vr = hexR(5.5);
  rooms.push({ x: rooms[1].x + Math.cos(va) * (r + vr + gap), y: rooms[1].y + Math.sin(va) * (r + vr + gap), rad: vr, vault: true });
  return { rooms, links: [[0, 1], [1, 2]], vaultParent: 1 };
}

export function generateRegionLevel(L: number): Level {
  const rng = new Rng(L * 7919 + 13);
  const base = levelBaseHp(L);
  const { rooms, links, vaultParent } = layout(L, rng);
  // centre the whole layout on the origin
  const cx = rooms.reduce((a, r) => a + r.x, 0) / rooms.length, cy = rooms.reduce((a, r) => a + r.y, 0) / rooms.length;
  for (const r of rooms) { r.x -= cx; r.y -= cy; }

  const ext = Math.max(...rooms.map(r => Math.max(Math.abs(r.x), Math.abs(r.y)) + r.rad));
  const N = Math.ceil(ext / (HEX_R * 1.5)) + 4;
  const size = 2 * N + 1;
  const grid: (Cell | null)[] = new Array(size * size).fill(null);
  const cells: Cell[] = [];
  const key = (q: number, r: number) => (q + N) * size + (r + N);
  const get = (q: number, r: number) => (Math.abs(q) > N || Math.abs(r) > N ? null : grid[key(q, r)]);
  const put = (q: number, r: number, kind: Kind) => {
    if (Math.abs(q) > N || Math.abs(r) > N) return null;
    const c = makeCell(q, r, key(q, r), kind, L);
    grid[c.idx] = c; cells.push(c); return c;
  };
  const toHex = (x: number, y: number) => hexRound(((Math.sqrt(3) / 3) * x - y / 3) / HEX_R, ((2 / 3) * y) / HEX_R);

  // ---- rooms: cells closest to a room centre (with a little wobble) ----
  for (let q = -N; q <= N; q++) for (let r = -N; r <= N; r++) {
    const c0 = makeCell(q, r, 0, Kind.Gem, L);
    let best = -1, bd = Infinity;
    rooms.forEach((rm, i) => {
      const wob = 1 + 0.1 * (hash2(q >> 1, r >> 1, L * 7 + i) - 0.5) * 2;
      const d = Math.hypot(c0.x - rm.x, c0.y - rm.y) / (rm.rad * wob);
      if (d < bd) { bd = d; best = i; }
    });
    if (bd > 1) continue;
    const c = put(q, r, Kind.Gem)!;
    c.region = best;
  }
  const nbrs = (c: Cell) => DIRS.map(([a, b]) => get(c.q + a, c.r + b)).filter((n): n is Cell => !!n);
  // room edges become bedrock
  for (const c of cells) {
    const around = DIRS.map(([a, b]) => get(c.q + a, c.r + b));
    if (around.some(n => !n || n.region !== c.region)) { c.kind = Kind.Bedrock; c.border = true; }
  }

  // ---- seal bridges between linked rooms (and the gold seal to the vault) ----
  const regions: Region[] = rooms.map((rm, i) => ({ id: i, vault: rm.vault, x: rm.x, y: rm.y, gems: [], gemTotal: 0, seal: [], next: -1, cleared: false }));
  const vaultIdx = rooms.findIndex(r => r.vault);
  const bridge = (a: number, b: number, owner: number) => {
    const A = rooms[a], B = rooms[b];
    const dx = B.x - A.x, dy = B.y - A.y, Ld = Math.hypot(dx, dy), ux = dx / Ld, uy = dy / Ld;
    const t0 = A.rad * 0.8, t1 = Ld - B.rad * 0.8;
    const seal: Cell[] = [];
    for (let t = t0; t <= t1; t += HEX_R * 0.5) {
      const [qc, rc] = toHex(A.x + ux * t, A.y + uy * t);
      for (let dq = -3; dq <= 3; dq++) for (let dr = -3; dr <= 3; dr++) {
        const q = qc + dq, r = rc + dr;
        const probe = makeCell(q, r, 0, Kind.Gem, L);
        const off = Math.abs((probe.x - A.x) * uy - (probe.y - A.y) * ux);
        const along = (probe.x - A.x) * ux + (probe.y - A.y) * uy;
        if (along < t0 - HEX_R || along > t1 + HEX_R) continue;
        let c = get(q, r);
        if (off < HEX_W * 1.05) {
          if (!c) { c = put(q, r, Kind.Seal); if (!c) continue; c.region = owner; c.border = true; }
          if (c.kind === Kind.Bedrock || c.kind === Kind.Seal) { c.kind = Kind.Seal; c.border = true; if (!seal.includes(c)) seal.push(c); }
        } else if (off < HEX_W * 2.1 && !c) {
          const w = put(q, r, Kind.Bedrock); if (w) { w.border = true; w.region = owner; }
        }
      }
    }
    return seal;
  };
  for (const [a, b] of links) { regions[a].seal = bridge(a, b, a); regions[a].next = b; }
  regions[vaultIdx].seal = bridge(vaultParent, vaultIdx, vaultIdx);
  const main = regions.filter(r => !r.vault);
  const finalIdx = main[main.length - 1].id;

  const nearestTo = (px: number, py: number, pred: (c: Cell) => boolean) => {
    let best: Cell | null = null, bd = Infinity;
    for (const c of cells) {
      if (!pred(c)) continue;
      const d = (c.x - px) ** 2 + (c.y - py) ** 2;
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  };
  const inRoom = (i: number) => (c: Cell) => c.region === i && !c.border;
  const isPlainGem = (c: Cell) => c.kind === Kind.Gem && !c.border && !c.gold && !c.ore && !c.geode && !c.hidden && !c.entity;
  const sealCentre = (i: number) => { const s = regions[i].seal; return s.length ? { x: s.reduce((a, c) => a + c.x, 0) / s.length, y: s.reduce((a, c) => a + c.y, 0) / s.length } : { x: rooms[i].x, y: rooms[i].y }; };

  // ---- spawn: in room 0, on the far side from its seal ----
  const exit0 = sealCentre(0);
  const sdx = rooms[0].x - exit0.x, sdy = rooms[0].y - exit0.y, sl = Math.hypot(sdx, sdy) || 1;
  const spawnCell = nearestTo(rooms[0].x + (sdx / sl) * rooms[0].rad * 0.45, rooms[0].y + (sdy / sl) * rooms[0].rad * 0.45, inRoom(0))!;
  for (const c of cells) if (c.region === 0 && !c.border && hexDist(c.q, c.r, spawnCell.q, spawnCell.r) <= 2) c.kind = Kind.Floor;

  // ---- inner wall segments in each room ----
  for (const rg of regions) {
    const pool = cells.filter(c => inRoom(rg.id)(c) && c.kind === Kind.Gem && Math.hypot(c.x - rg.x, c.y - rg.y) > rooms[rg.id].rad * 0.25);
    const segs = rg.vault ? 0 : rng.int(2, 3) + Math.min(2, Math.floor((L - 6) / 6));
    for (let s = 0; s < segs && pool.length; s++) {
      let c: Cell | null = rng.pick(pool);
      const dir = rng.int(0, 5), len = rng.int(3, 6);
      for (let i = 0; i < len && c; i++) {
        if (c.border || c.kind !== Kind.Gem || hexDist(c.q, c.r, spawnCell.q, spawnCell.r) <= 3) break;
        c.kind = Kind.Bedrock;
        const d = DIRS[(dir + (rng.next() < 0.3 ? rng.pick([-1, 1]) : 0) + 6) % 6];
        c = get(c.q + d[0], c.r + d[1]);
      }
    }
  }

  // ---- keystone in the final room ----
  const kc = nearestTo(rooms[finalIdx].x + rng.range(-1, 1) * HEX_W * 2, rooms[finalIdx].y + rng.range(-1, 1) * HEX_W * 2, c => inRoom(finalIdx)(c) && nbrs(c).every(n => !n.border))!;
  const keystone: Entity = { hp: 1, maxHp: 1, x: kc.x, y: kc.y, cells: [], broken: false };
  for (const c of [kc, ...nbrs(kc)]) { c.kind = Kind.Keystone; c.entity = keystone; keystone.cells.push(c); }
  for (const c of keystone.cells) for (const n of nbrs(c)) if (n.kind === Kind.Bedrock && !n.border) n.kind = Kind.Gem;

  // ---- generators in the earlier rooms; linked twins share a room ----
  const generators: Entity[] = [];
  const gN = generatorCount(L);
  const linked = L >= 10;
  const early = main.filter(r => r.id !== finalIdx);
  for (let i = 0; i < gN; i++) {
    let gc: Cell | null;
    if (linked && i % 2 === 1) {
      const prev = generators[i - 1], pc = prev.cells[0];
      const a = rng.range(0, Math.PI * 2), d = rng.range(5, 7) * HEX_W;
      gc = nearestTo(prev.x + Math.cos(a) * d, prev.y + Math.sin(a) * d, c => inRoom(pc.region)(c) && c.kind === Kind.Gem && hexDist(c.q, c.r, pc.q, pc.r) >= 4);
    } else {
      const slot = linked ? Math.floor(i / 2) : i;
      const rm = early[slot % early.length];
      const a = rng.range(0, Math.PI * 2), d = rooms[rm.id].rad * rng.range(0.35, 0.7);
      gc = nearestTo(rm.x + Math.cos(a) * d, rm.y + Math.sin(a) * d, c => inRoom(rm.id)(c) && c.kind === Kind.Gem && hexDist(c.q, c.r, spawnCell.q, spawnCell.r) > 4);
    }
    if (!gc) continue;
    const g: Entity = { hp: 1, maxHp: 1, x: gc.x, y: gc.y, cells: [gc], broken: false };
    gc.kind = Kind.Generator; gc.entity = g;
    generators.push(g);
  }
  if (linked) for (let i = 0; i + 1 < generators.length; i += 2) { generators[i].link = generators[i + 1]; generators[i + 1].link = generators[i]; }

  // ---- hidden gem: in a bedrock pocket in an earlier room, with an explosive gem in the one gap ----
  let hiddenGem: Cell | null = null;
  if (L >= HIDDEN_GEM_LEVEL) {
    const rm = rng.pick(early);
    const cand = cells.filter(c => inRoom(rm.id)(c) && c.kind === Kind.Gem && !c.entity
      && Math.hypot(c.x - rm.x, c.y - rm.y) > rooms[rm.id].rad * 0.35 && Math.hypot(c.x - rm.x, c.y - rm.y) < rooms[rm.id].rad * 0.7
      && hexDist(c.q, c.r, spawnCell.q, spawnCell.r) > 5 && nbrs(c).every(n => !n.border && n.kind === Kind.Gem));
    if (cand.length) {
      const h = rng.pick(cand);
      h.hidden = true;
      const ring = nbrs(h);
      const gapIdx = rng.int(0, ring.length - 1);
      ring.forEach((n, i) => { if (i === gapIdx) n.boom = true; else n.kind = Kind.Bedrock; });
      hiddenGem = h;
    }
  }

  // ---- golds: spread across the main rooms (they unlock the vault) ----
  for (let i = 0; i < 3; i++) {
    const rm = main[i % main.length];
    const a = rng.range(0, Math.PI * 2), d = rooms[rm.id].rad * rng.range(0.4, 0.8);
    const c = nearestTo(rm.x + Math.cos(a) * d, rm.y + Math.sin(a) * d, c => inRoom(rm.id)(c) && isPlainGem(c));
    if (c) c.gold = true;
  }

  // ---- ore veins, deposits, geodes ----
  for (const rm of main) for (let v = 0; v < 2 + (L >= 16 ? 1 : 0); v++) {
    const pool = cells.filter(c => inRoom(rm.id)(c) && isPlainGem(c));
    if (!pool.length) continue;
    let c: Cell | null = rng.pick(pool);
    const len = rng.int(4, 7);
    for (let i = 0; i < len && c; i++) {
      if (isPlainGem(c)) { c.ore = true; c.oreAmt = 1.5; }
      const opts: Cell[] = nbrs(c).filter(n => n.region === rm.id && isPlainGem(n));
      c = opts.length ? rng.pick(opts) : null;
    }
  }
  for (const rm of main) {
    const nooks = cells.filter(c => inRoom(rm.id)(c) && isPlainGem(c) && nbrs(c).filter(n => n.kind === Kind.Bedrock).length >= 3);
    if (!nooks.length) continue;
    const c0 = rng.pick(nooks);
    for (const c of [c0, ...nbrs(c0).filter(n => n.region === rm.id && isPlainGem(n)).slice(0, 2)]) { c.ore = true; c.oreAmt = 5; }
  }
  for (let i = 0; i < 2; i++) {
    const g = generators[i];
    const near = g ? nbrs(g.cells[0]).flatMap(nbrs).filter(isPlainGem) : [];
    const pool = near.length ? near : cells.filter(c => isPlainGem(c) && c.region !== finalIdx && !regions[c.region]?.vault);
    if (!pool.length) continue;
    const c = rng.pick(pool);
    c.geode = true; c.armor = true; c.oreAmt = 25;
  }
  // vault: rich in ore and gold-coloured treasure
  for (const c of cells) if (c.region === vaultIdx && isPlainGem(c) && rng.next() < 0.3) { c.ore = true; c.oreAmt = 5; }

  // ---- keystone shell ----
  const shell = L % 2 === 0;
  if (shell) for (const c of keystone.cells) for (const n of nbrs(c)) if (n.kind !== Kind.Keystone && !n.border) { n.kind = Kind.Gem; n.armor = true; }

  // ---- armored, explosive and regenerating gems ----
  const regenP = L < 9 ? 0 : Math.min(0.08, 0.012 * (L - 8));
  const armorP = Math.min(0.12, 0.03 + 0.003 * L);
  for (const c of cells) {
    if (!isPlainGem(c) || hexDist(c.q, c.r, spawnCell.q, spawnCell.r) < 4) continue;
    const roll = rng.next();
    if (roll < armorP) c.armor = true;
    else if (roll < armorP + 0.025) c.boom = true;
    else if (roll < armorP + 0.025 + regenP) c.regen = true;
  }

  // ---- every room must be fully clearable: carve paths to the exits and targets,
  //      then turn any gems walled off from the room's entrance into bedrock ----
  const entry = (i: number) => {
    if (i === 0) return spawnCell;
    const from = links.find(([, b]) => b === i)?.[0] ?? vaultParent;
    const s = regions[from === undefined ? 0 : (rooms[i].vault ? i : from)].seal;
    return nearestTo(s.length ? s[0].x : rooms[i].x, s.length ? s[0].y : rooms[i].y, c => inRoom(i)(c) && c.kind !== Kind.Bedrock) ?? spawnCell;
  };
  const carve = (from: Cell, to: Cell, room: number) => {
    const dist = new Map<Cell, number>([[from, 0]]), prev = new Map<Cell, Cell>(), dq: Cell[] = [from];
    while (dq.length) {
      const c = dq.shift()!;
      if (c === to) break;
      for (const n of nbrs(c)) {
        if (n.region !== room || n.border) continue;
        const w = n.kind === Kind.Bedrock ? 1 : 0, nd = dist.get(c)! + w;
        if (nd < (dist.get(n) ?? Infinity)) { dist.set(n, nd); prev.set(n, c); if (w) dq.push(n); else dq.unshift(n); }
      }
    }
    let c: Cell | undefined = to;
    while (c && c !== from) { if (c.kind === Kind.Bedrock && !c.hidden && !(hiddenGem && nbrs(hiddenGem).includes(c))) c.kind = Kind.Gem; c = prev.get(c); }
  };
  for (const rg of regions) {
    const e = entry(rg.id);
    const targets: Cell[] = [];
    if (rg.next >= 0 && rg.seal.length) { const t = nearestTo(rg.seal[0].x, rg.seal[0].y, c => inRoom(rg.id)(c)); if (t) targets.push(t); }
    if (rg.id === vaultParent) { const vs = regions[vaultIdx].seal; const t = vs.length ? nearestTo(vs[0].x, vs[0].y, c => inRoom(rg.id)(c)) : null; if (t) targets.push(t); }
    if (rg.id === finalIdx) targets.push(kc);
    for (const g of generators) if (g.cells[0].region === rg.id) targets.push(g.cells[0]);
    for (const t of targets) carve(e, t, rg.id);
    // flood from the entrance; unreachable gems become bedrock
    const seen = new Set<Cell>([e]), q: Cell[] = [e];
    while (q.length) { const c = q.pop()!; for (const n of nbrs(c)) if (n.region === rg.id && !n.border && n.kind !== Kind.Bedrock && !seen.has(n)) { seen.add(n); q.push(n); } }
    for (const c of cells) if (c.region === rg.id && !c.border && (c.kind === Kind.Gem) && !seen.has(c) && !c.hidden) c.kind = Kind.Bedrock;
  }

  // ---- hit points: deeper rooms are tougher; total matches a disc level of the same number ----
  const raw = new Map<Cell, number>();
  for (const c of cells) raw.set(c, hash2(c.q >> 1, c.r >> 1, L + 99));
  const depth = (c: Cell) => {
    const rg = regions[c.region];
    if (!rg) return 0.5;
    if (rg.vault) return 0.8;
    const idx = main.indexOf(rg);
    const e = entry(rg.id);
    const within = Math.min(1, Math.hypot(c.x - e.x, c.y - e.y) / (rooms[rg.id].rad * 2));
    return (idx + within) / main.length;
  };
  for (const c of cells) {
    if (c.kind !== Kind.Gem) continue;
    const ns = nbrs(c);
    const noise = (raw.get(c)! * 2 + ns.reduce((a, n) => a + (raw.get(n) ?? 0.5), 0)) / (2 + ns.length);
    // each room is ~3.2x tougher than the one before, to match how much stronger you get as you buy upgrades
    const rg = regions[c.region];
    const roomMult = !rg ? 1 : rg.vault ? 2.5 : Math.pow(3.2, main.indexOf(rg));
    let hp = base * HP_SCALE * (0.6 + 1.6 * depth(c)) * roomMult * (0.7 + 0.6 * noise);
    if (c.armor) hp *= 1.8;
    if (c.ore) hp *= c.oreAmt > 2 ? 1.8 : 1.4;
    if (c.geode) hp *= 2.2;
    if (c.gold) hp *= 2.5;
    if (c.hidden) hp = base * HP_SCALE * 4;
    c.hp = c.maxHp = hp;
  }
  const ref = generateDiscLevel(L).cells.reduce((a, c) => a + (c.kind === Kind.Gem ? c.maxHp : 0), 0);
  const total = cells.reduce((a, c) => a + (c.kind === Kind.Gem && !c.hidden ? c.maxHp : 0), 0);
  const k = total > 0 ? ref / total : 1;
  for (const c of cells) if (c.kind === Kind.Gem && !c.hidden) { c.hp *= k; c.maxHp *= k; }
  keystone.hp = keystone.maxHp = ref * 0.3;
  // generators scale with the room they guard, so an early-room generator isn't a wall of HP
  const roomHp = new Map<number, number>();
  for (const c of cells) if (c.kind === Kind.Gem && !c.hidden) roomHp.set(c.region, (roomHp.get(c.region) ?? 0) + c.maxHp);
  for (const g of generators) {
    g.hp = g.maxHp = Math.max(ref * 0.008, (roomHp.get(g.cells[0].region) ?? ref * 0.5) * 0.1);
    g.cells[0].hp = g.cells[0].maxHp = g.maxHp;
  }

  // ---- region bookkeeping ----
  for (const rg of regions) {
    rg.gems = cells.filter(c => c.region === rg.id && c.kind === Kind.Gem && !c.hidden && !c.border);
    rg.gemTotal = rg.gems.length;
  }

  return {
    L, radius: N, base, size, grid, cells, keystone, generators,
    goldTotal: cells.filter(c => c.gold).length,
    gemTotal: cells.filter(c => c.kind === Kind.Gem && !c.hidden).length,
    boomTotal: cells.filter(c => c.kind === Kind.Gem && c.boom).length,
    shell,
    armorValue: base * HP_SCALE * 0.45,
    hpUnit: base * HP_SCALE,
    spawn: { x: spawnCell.x, y: spawnCell.y },
    regions,
    vault: regions[vaultIdx],
    hiddenGem,
  };
}
