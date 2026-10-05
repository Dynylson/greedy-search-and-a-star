import type { AlgorithmId } from '../core/search';

export type MonsterKind = 'zombie' | 'hunter';

export interface MonsterStats {
  name: string;
  glyph: string;
  color: string;
  hp: number;
  damage: [number, number];
  algorithm: AlgorithmId;
}

/** Cada tipo de monstro "pensa" com um algoritmo diferente. */
export const MONSTERS: Readonly<Record<MonsterKind, MonsterStats>> = {
  zombie: { name: 'Zumbi', glyph: 'z', color: '#9dff6e', hp: 6, damage: [1, 3], algorithm: 'greedy' },
  hunter: { name: 'Caçador', glyph: 'H', color: '#ff4f86', hp: 9, damage: [2, 4], algorithm: 'astar' },
};

export const PLAYER = {
  name: 'Você',
  glyph: '@',
  color: '#62f3ff',
  hp: 30,
  damage: [2, 4] as [number, number],
};

export interface FloorConfig {
  width: number;
  height: number;
  mudDensity: number;
  zombies: number;
  hunters: number;
}

export const FLOORS: readonly FloorConfig[] = [
  { width: 44, height: 30, mudDensity: 0.1, zombies: 3, hunters: 1 },
  { width: 52, height: 34, mudDensity: 0.15, zombies: 3, hunters: 3 },
  { width: 60, height: 38, mudDensity: 0.2, zombies: 4, hunters: 4 },
];

/** Raio do campo de visão do herói (em tiles). */
export const VIEW_RADIUS = 9;
/** Fração da vida máxima recuperada ao descer uma escada. */
export const STAIRS_HEAL = 0.3;
/** Distância mínima (Manhattan) entre o herói e um monstro no início do andar. */
export const MIN_SPAWN_DISTANCE = 12;

export const COLORS = {
  stairs: '#ffd166',
  mud: '#c08a3e',
  wall: '#7a5cff',
  floor: '#3a3358',
  greedy: '#ffd166',
  astar: '#62f3ff',
};
