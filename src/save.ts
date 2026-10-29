import type { Inventory } from './economy';
import type { Stats } from './game';
import type { SavedNode } from './nodes';

export type SavedPlaced = { id: string; x: number; y: number; z: number; ry: number };

export type SaveData = {
  v: number;
  mats: Inventory;
  props: Record<string, number>;
  placed: SavedPlaced[];
  unlocked: string[];
  stats: Stats;
  goals: string[];
  tod: number;
  player: [number, number, number];
  cam: [number, number, number];
  nodes: SavedNode[];
};

const KEY = 'forgeworld.save.v1';

export function writeSave(data: SaveData) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* quota / private mode — the game simply runs unsaved */
  }
}

export function loadSave(): SaveData | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SaveData;
    if (!parsed || parsed.v !== 1 || !parsed.mats || !Array.isArray(parsed.placed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function hasSave(): boolean {
  return loadSave() !== null;
}
