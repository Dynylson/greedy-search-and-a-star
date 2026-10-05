import { describe, expect, it } from 'vitest';
import { generateDungeon } from '../src/core/dungeon';
import { TILE, type Grid } from '../src/core/grid';

function floodFillCount(grid: Grid, start: number): number {
  const seen = new Uint8Array(grid.size);
  const stack = [start];
  const out = [0, 0, 0, 0];
  seen[start] = 1;
  let count = 0;
  while (stack.length) {
    const cur = stack.pop()!;
    count++;
    const n = grid.neighbors(cur, out);
    for (let k = 0; k < n; k++) {
      if (!seen[out[k]]) {
        seen[out[k]] = 1;
        stack.push(out[k]);
      }
    }
  }
  return count;
}

describe('gerador de dungeon', () => {
  it('é determinístico: mesma seed → mesmo mapa', () => {
    const a = generateDungeon({ width: 50, height: 30, seed: 123 });
    const b = generateDungeon({ width: 50, height: 30, seed: 123 });
    const c = generateDungeon({ width: 50, height: 30, seed: 124 });
    expect(a.grid.tiles).toEqual(b.grid.tiles);
    expect(a.grid.tiles).not.toEqual(c.grid.tiles);
  });

  it('todo piso é alcançável (mapa conectado) e a borda é parede', () => {
    for (const size of [20, 40, 80, 160]) {
      for (let seed = 1; seed <= 10; seed++) {
        const { grid } = generateDungeon({ width: size, height: size, seed });
        let passable = 0;
        let first = -1;
        for (let i = 0; i < grid.size; i++) {
          if (grid.isPassable(i)) {
            passable++;
            if (first < 0) first = i;
          }
        }
        expect(floodFillCount(grid, first)).toBe(passable);
        for (let x = 0; x < size; x++) {
          expect(grid.get(x, 0)).toBe(TILE.WALL);
          expect(grid.get(x, size - 1)).toBe(TILE.WALL);
        }
      }
    }
  });

  it('respeita aproximadamente a densidade de lama pedida', () => {
    for (const density of [0, 0.1, 0.25, 0.4]) {
      const { grid } = generateDungeon({ width: 80, height: 80, seed: 9, mudDensity: density });
      let mud = 0;
      let passable = 0;
      for (let i = 0; i < grid.size; i++) {
        if (grid.tiles[i] === TILE.MUD) mud++;
        if (grid.isPassable(i)) passable++;
      }
      expect(mud / passable).toBeCloseTo(density, 1);
    }
  });
});
