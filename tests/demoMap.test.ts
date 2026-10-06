import { describe, expect, it } from 'vitest';
import { DEMO_MAP, findMarkers } from '../src/core/demoMap';
import { Grid } from '../src/core/grid';
import { HEURISTICS } from '../src/core/heuristics';
import { aStar, greedyBestFirst } from '../src/core/search';
import { bruteForceCost } from './helpers';

describe('mapa de demonstração', () => {
  const grid = Grid.fromRows(DEMO_MAP);
  const [hero] = findMarkers(DEMO_MAP, '@');
  const monsters = findMarkers(DEMO_MAP, 'zH');
  const goal = grid.index(hero.x, hero.y);

  it('tem herói, Zumbi e Caçador', () => {
    expect(hero).toBeDefined();
    expect(monsters.map((m) => m.char).sort()).toEqual(['H', 'z']);
  });

  it('garante a cena da apresentação: Gulosa mais cara, A* ótimo, Euclidiana expande mais', () => {
    for (const m of monsters) {
      const start = grid.index(m.x, m.y);
      const optimal = bruteForceCost(grid, start, goal);
      const astar = aStar(grid, start, goal, { heuristic: HEURISTICS.manhattan.fn });
      const astarEuclid = aStar(grid, start, goal, { heuristic: HEURISTICS.euclidean.fn });
      const greedy = greedyBestFirst(grid, start, goal, { heuristic: HEURISTICS.manhattan.fn });

      expect(astar.cost).toBe(optimal);
      expect(greedy.cost).toBeGreaterThan(astar.cost * 1.15);
      expect(greedy.expanded).toBeLessThan(astar.expanded);
      expect(astarEuclid.expanded).toBeGreaterThan(astar.expanded);
    }
  });
});
