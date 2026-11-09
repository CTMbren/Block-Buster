import type { Perm } from './economy';

export interface SaveData {
  version: 1;
  ore: number;
  sp: number;
  highest: number; // highest level cleared
  stars: Record<number, number>; // level -> bitmask of stars earned (1 keystone, 2 clear, 4 golds)
  perm: Perm;
  muted: boolean;
  /** When not aiming, turn the turret toward the direction of travel. */
  aimFollow: boolean;
  smartAimOn: boolean;
  tutorialDone: boolean;
  /** Mid-level save, written each time a region seal breaks. */
  checkpoint: Checkpoint | null;
  /** Levels whose hidden gem has been found. */
  gems: Record<number, true>;
}

export interface Checkpoint {
  L: number;
  cleared: number[];
  shards: number; shardsCollected: number; oreEarned: number;
  boosts: Record<string, number>;
  shots: Record<string, number>;
  purchases: number; time: number; gemsBroken: number;
  gensBroken: number[];
  vaultCleared: boolean; hiddenFound: boolean;
  challenge: { progress: number; done: boolean };
  procs: Record<string, number>;
}

export const gemsFoundCount = (d: SaveData) => Object.keys(d.gems).length;

const KEY = 'blockbuster.save.v1';

export function freshSave(): SaveData {
  return { version: 1, ore: 0, sp: 0, highest: 0, stars: {}, perm: { ore: {}, sp: {} }, muted: false, aimFollow: false, smartAimOn: true, tutorialDone: false, checkpoint: null, gems: {} };
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return freshSave();
    const d = JSON.parse(raw) as SaveData;
    if (d.version !== 1) return freshSave();
    return { ...freshSave(), ...d, perm: { ore: d.perm?.ore ?? {}, sp: d.perm?.sp ?? {} }, gems: d.gems ?? {} };
  } catch {
    return freshSave();
  }
}

export function writeSave(d: SaveData) {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    /* storage may be unavailable (private mode); the game still runs */
  }
}

export function resetSave() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
