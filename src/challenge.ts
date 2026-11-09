// One bonus challenge per level, chosen from the level's seed. Completing it pays +1 skill point once.
import { Rng } from './rng';
import type { Level } from './level';

export type ChallengeId = 'chain' | 'oreGems' | 'speed' | 'thrifty' | 'pierce' | 'bounce' | 'boom';

export interface Challenge {
  id: ChallengeId;
  target: number;
  progress: number;
  done: boolean;
}

export const CHALLENGE_BIT = 8; // stars bitmask: 1 keystone, 2 clear, 4 golds, 8 bonus

export function pickChallenge(level: Level): Challenge {
  const L = level.L;
  const rng = new Rng(L * 31 + 7);
  const pool: ChallengeId[] = ['chain', 'oreGems', 'speed'];
  if (L >= 2) pool.push('thrifty');
  if (L >= 3) pool.push('pierce', 'bounce');
  if (level.boomTotal >= 5) pool.push('boom');
  const id = rng.pick(pool);
  const oreCells = level.cells.filter(c => c.ore || c.geode).length;
  const target = {
    chain: 10 + Math.min(20, L),
    oreGems: Math.max(5, Math.round(oreCells * 0.6)),
    speed: 7 * 60,
    thrifty: 4,
    pierce: 3,
    bounce: 15,
    boom: 4,
  }[id];
  return { id, target, progress: 0, done: false };
}

/** Short HUD label with live progress. */
export function challengeLabel(c: Challenge, time = 0): string {
  switch (c.id) {
    case 'chain': return `Chain ×${c.target} (best ×${c.progress})`;
    case 'oreGems': return `Mine ${c.target} Ore gems (${c.progress})`;
    case 'speed': {
      const left = Math.max(0, c.target - time);
      return `Keystone in ${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
    }
    case 'thrifty': return `Keystone with ≤${c.target} buys (${c.progress})`;
    case 'pierce': return `${c.target} gems, one Piercing shot (${c.progress})`;
    case 'bounce': return `${c.target} gems with bounces (${c.progress})`;
    case 'boom': return `Detonate ${c.target} explosives (${c.progress})`;
  }
}

/** Full sentence for the results screen. */
export function challengeTitle(c: Challenge): string {
  switch (c.id) {
    case 'chain': return `Reach a ×${c.target} break chain`;
    case 'oreGems': return `Mine ${c.target} Ore gems`;
    case 'speed': return `Break the Keystone within ${c.target / 60} minutes`;
    case 'thrifty': return `Break the Keystone with ${c.target} or fewer purchases`;
    case 'pierce': return `Break ${c.target} gems with one Piercing shot`;
    case 'bounce': return `Break ${c.target} gems with bounced shots`;
    case 'boom': return `Detonate ${c.target} explosive gems`;
  }
}
