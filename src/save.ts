import type { Perm } from './economy';

export interface SaveData {
  version: 1;
  ore: number;
  sp: number;
  highest: number; // highest level cleared
  stars: Record<number, number>; // level -> bitmask of stars earned (1 keystone, 2 clear, 4 golds)
  perm: Perm;
  muted: boolean;
}

const KEY = 'blockbuster.save.v1';

export function freshSave(): SaveData {
  return { version: 1, ore: 0, sp: 0, highest: 0, stars: {}, perm: { ore: {}, sp: {} }, muted: false };
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return freshSave();
    const d = JSON.parse(raw) as SaveData;
    if (d.version !== 1) return freshSave();
    return { ...freshSave(), ...d, perm: { ore: d.perm?.ore ?? {}, sp: d.perm?.sp ?? {} } };
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
