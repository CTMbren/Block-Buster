// All the numbers live here: formulas for costs, stats and level scaling.
// Upgrades have no level cap; each level costs more than the last.

export type ShotId = 'multishot' | 'ricochet' | 'piercing' | 'poison';
export const SHOTS: ShotId[] = ['multishot', 'ricochet', 'piercing', 'poison'];

export const SHOT_INFO: Record<ShotId, { name: string; icon: string; color: string; desc: string }> = {
  multishot: { name: 'Multishot', icon: '⁂', color: '#b9a2ff', desc: 'Fires extra shots in a fan' },
  ricochet: { name: 'Ricochet', icon: '↯', color: '#7fe6ff', desc: 'Shots bounce off gems and walls' },
  piercing: { name: 'Piercing', icon: '➶', color: '#ffd27c', desc: 'Shots pass through gems' },
  poison: { name: 'Poison', icon: '☣', color: '#8fe0a0', desc: 'Hit gems keep cracking' },
};

export type BoostId = 'damage' | 'fireRate' | 'speed' | 'range';
export const BOOSTS: BoostId[] = ['damage', 'fireRate', 'speed', 'range'];
export const BOOST_INFO: Record<BoostId, { name: string; icon: string }> = {
  damage: { name: 'Damage', icon: '✦' },
  fireRate: { name: 'Fire rate', icon: '≋' },
  speed: { name: 'Shot speed', icon: '➤' },
  range: { name: 'Range', icon: '◎' },
};

// ---------- level scaling ----------

/** Base hex HP for a level. Every hex's HP is a multiple of this. */
export const levelBaseHp = (L: number) => 2 * Math.pow(1.12, L - 1);
/** Map radius in hexes. Grows for the first levels, then holds. */
export const levelRadius = (L: number) => Math.round(16 + Math.min(L - 1, 10) * 0.5);
export const generatorCount = (L: number) => (L < 3 ? 0 : L < 6 ? 1 : Math.min(5, 2 + Math.floor((L - 6) / 5)));
export const COLLAPSE_SECONDS = 90;
export const CLEAR_TARGET = 0.7;

// ---------- in-level (Shards) ----------

/** Cost of the next in-level purchase. Scales with the level so prices track Shard income. */
export function inLevelCost(base: number, owned: number, L: number) {
  return Math.ceil(base * Math.pow(IN_LEVEL_GROWTH, owned) * (levelBaseHp(L) / levelBaseHp(1)));
}
export const IN_LEVEL_GROWTH = 1.6;
export const BOOST_BASE: Record<BoostId, number> = { damage: 40, fireRate: 45, speed: 30, range: 30 };
export const SHOT_UNLOCK_BASE = 90;
export const SHOT_LEVEL_BASE = 70;

// ---------- permanent (Ore and skill points) ----------

export type OreLine =
  | 'damage' | 'fireRate' | 'speed' | 'crit' | 'shardGain' | 'oreGain' | 'bombRange' | 'bombDmg'
  | `${ShotId}Str` | `${ShotId}Dur` | `${ShotId}Cd`;

export interface OreLineInfo { id: OreLine; group: string; name: string; base: number; growth: number; effect: (n: number) => string }

const pct = (v: number) => `${Math.round(v * 100)}%`;

export const ORE_LINES: OreLineInfo[] = [
  { id: 'damage', group: 'Blaster', name: 'Damage', base: 160, growth: 1.25, effect: n => `×${blasterPermMult(n).toFixed(2)}` },
  { id: 'fireRate', group: 'Blaster', name: 'Fire rate', base: 160, growth: 1.2, effect: n => `+${pct(n * 0.05)}` },
  { id: 'speed', group: 'Blaster', name: 'Shot speed', base: 100, growth: 1.18, effect: n => `+${pct(n * 0.06)}` },
  { id: 'crit', group: 'Blaster', name: 'Crit chance', base: 200, growth: 1.22, effect: n => pct(critChance(n)) },
  ...(['multishot', 'ricochet', 'piercing', 'poison'] as ShotId[]).flatMap(s => [
    { id: `${s}Str` as OreLine, group: SHOT_INFO[s].name, name: 'Strength', base: 240, growth: 1.18, effect: (n: number) => `+${n}` },
    { id: `${s}Dur` as OreLine, group: SHOT_INFO[s].name, name: 'Active time', base: 200, growth: 1.18, effect: (n: number) => `+${n}` },
    { id: `${s}Cd` as OreLine, group: SHOT_INFO[s].name, name: 'Cooldown', base: 200, growth: 1.18, effect: (n: number) => `+${n}` },
  ]),
  { id: 'bombRange', group: 'Explosives', name: 'Blast radius', base: 300, growth: 1.4, effect: n => `${bombRings(n)} ring${bombRings(n) > 1 ? 's' : ''}` },
  { id: 'bombDmg', group: 'Explosives', name: 'Blast damage', base: 200, growth: 1.22, effect: n => `×${bombDmgMult(n).toFixed(2)}` },
  { id: 'shardGain', group: 'Economy', name: 'Shard gain', base: 320, growth: 1.3, effect: n => `+${pct(Math.min(1, n * 0.05))}` },
  { id: 'oreGain', group: 'Economy', name: 'Ore gain', base: 320, growth: 1.3, effect: n => `+${pct(Math.min(1, n * 0.05))}` },
];

export const oreCost = (line: OreLineInfo, n: number) => Math.ceil(line.base * Math.pow(line.growth, n));
export const blasterPermMult = (n: number) => Math.pow(1.09, n);
export const critChance = (n: number) => Math.min(0.5, n * 0.02);
/** Explosive gems: how many rings of hexes the blast reaches, and its damage multiplier. */
export const bombRings = (n: number) => 1 + n;
export const bombDmgMult = (n: number) => Math.pow(1.25, n);
/** Damage falls off with distance: full on ring 1, down to 1/rings on the outermost ring. */
export const bombFalloff = (ring: number, rings: number) => Math.max(0, 1 - (ring - 1) / rings);

export type SpId = 'unlockPoison' | 'slot3' | 'slot4' | 'headStart' | 'freeShot' | 'smartAim' | 'mastery';
export interface SpInfo { id: SpId; name: string; desc: string; cost: (owned: number) => number; max: number; requires?: SpId }
export const SP_ITEMS: SpInfo[] = [
  { id: 'unlockPoison', name: 'Unlock Poison', desc: 'Adds Poison to the in-level shop.', cost: () => 2, max: 1 },
  { id: 'slot3', name: 'Third ability slot', desc: 'Buy up to 3 specialty shots per level.', cost: () => 3, max: 1 },
  { id: 'slot4', name: 'Fourth ability slot', desc: 'Buy up to 4 specialty shots per level.', cost: () => 6, max: 1, requires: 'slot3' },
  { id: 'headStart', name: 'Head start', desc: 'Begin every level with enough Shards for a first upgrade.', cost: () => 2, max: 1 },
  { id: 'freeShot', name: 'Ready loadout', desc: 'Your first specialty shot each level is free.', cost: () => 4, max: 1 },
  { id: 'smartAim', name: 'Smart Aim', desc: 'When you are not aiming, the turret picks targets itself: generators, gold and cracked gems first. Toggle it during a level.', cost: () => 3, max: 1 },
  { id: 'mastery', name: 'Mastery', desc: '×1.05 damage to everything. Repeatable forever.', cost: n => Math.ceil(5 * Math.pow(1.3, n)), max: Infinity },
];

// ---------- derived stats ----------

export interface Perm {
  ore: Partial<Record<OreLine, number>>;
  sp: Partial<Record<SpId, number>>;
}

export const lv = (p: Perm, id: OreLine) => p.ore[id] ?? 0;

export function abilitySlots(p: Perm) {
  return 2 + (p.sp.slot3 ? 1 : 0) + (p.sp.slot4 ? 1 : 0);
}

export function availableShots(p: Perm): ShotId[] {
  return SHOTS.filter(s => s !== 'poison' || p.sp.unlockPoison);
}

/** Stats for one specialty shot given its in-level level (>=1) and permanent bonuses. */
export function shotStats(id: ShotId, inLevel: number, p: Perm) {
  const s = inLevel - 1 + lv(p, `${id}Str`);
  const durN = inLevel - 1 + lv(p, `${id}Dur`);
  const cdN = inLevel - 1 + lv(p, `${id}Cd`);
  return {
    strength: s,
    active: 3 + 5 * (1 - Math.pow(0.88, durN)),
    cooldown: Math.max(3, 15 * Math.pow(0.92, cdN)),
    extraShots: 1 + Math.floor(s / 2),
    bounces: 1 + Math.floor(s / 1.5),
    pierces: 1 + Math.floor(s / 1.5),
    poisonFrac: 0.5 + 0.1 * s, // poison damage per second as a fraction of shot damage
    poisonTime: 3 + 0.5 * s,
  };
}

export function blasterStats(boosts: Record<BoostId, number>, p: Perm) {
  const mastery = Math.pow(1.05, p.sp.mastery ?? 0);
  return {
    damage: blasterPermMult(lv(p, 'damage')) * mastery * Math.pow(1.35, boosts.damage),
    fireRate: Math.min(22, 4 * (1 + 0.05 * lv(p, 'fireRate')) * (1 + 0.15 * boosts.fireRate)),
    speed: 520 * (1 + 0.06 * lv(p, 'speed')) * (1 + 0.1 * boosts.speed),
    range: 7.5 * (1 + 0.1 * boosts.range), // in hexes
    crit: critChance(lv(p, 'crit')),
  };
}

export const shardGainMult = (p: Perm) => 1 + Math.min(1, lv(p, 'shardGain') * 0.05);
export const oreGainMult = (p: Perm) => 1 + Math.min(1, lv(p, 'oreGain') * 0.05);

// ---------- formatting ----------

const SUFFIX = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi'];
export function fmt(n: number): string {
  if (!isFinite(n)) return '∞';
  if (n < 1000) return n < 10 && n % 1 ? n.toFixed(1) : String(Math.floor(n));
  const e = Math.floor(Math.log10(n) / 3);
  if (e < SUFFIX.length) {
    const v = n / Math.pow(1000, e);
    return (v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : Math.floor(v)) + SUFFIX[e];
  }
  return n.toExponential(2).replace('+', '');
}
