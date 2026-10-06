import { describe, expect, it } from 'vitest';
import { Grid } from '../src/core/grid';
import { HEURISTICS } from '../src/core/heuristics';
import { aStar, greedyBestFirst, NEVER } from '../src/core/search';
import { bruteForceCost, pathCost, randomQueries } from './helpers';

const manhattan = HEURISTICS.manhattan.fn;

describe('A*', () => {
  it('encontra o caminho de menor custo, igual à força bruta (500 grids aleatórios)', () => {
    for (const { grid, start, goal } of randomQueries(500)) {
      const optimal = bruteForceCost(grid, start, goal);
      for (const h of [HEURISTICS.manhattan, HEURISTICS.euclidean]) {
        const result = aStar(grid, start, goal, { heuristic: h.fn });
        expect(result.found).toBe(optimal !== Infinity);
        if (!result.found) continue;
        expect(result.cost).toBeCloseTo(optimal, 9);
        expect(pathCost(grid, result.path)).toBeCloseTo(result.cost, 9);
      }
    }
  });

  it('expande menos nós com Manhattan do que com Euclidiana (heurística mais informada)', () => {
    // A Manhattan domina a Euclidiana; em buscas isoladas um empate pode inverter
    // a ordem por poucos nós, por isso a comparação é no total.
    let manhattanTotal = 0;
    let euclideanTotal = 0;
    for (const { grid, start, goal } of randomQueries(300, 7)) {
      manhattanTotal += aStar(grid, start, goal, { heuristic: manhattan }).expanded;
      euclideanTotal += aStar(grid, start, goal, { heuristic: HEURISTICS.euclidean.fn }).expanded;
    }
    expect(manhattanTotal).toBeLessThan(euclideanTotal);
  });

  it('prefere contornar a lama quando o desvio é mais barato', () => {
    const grid = Grid.fromRows([
      '#######',
      '#.....#',
      '#S~~~G#',
      '#######',
    ]);
    const start = grid.index(1, 2);
    const goal = grid.index(5, 2);
    // Reto pela lama: 3 + 3 + 3 + 1 = 10. Por cima: 6 passos de chão = 6.
    expect(aStar(grid, start, goal, { heuristic: manhattan }).cost).toBe(6);
    // A Gulosa só olha h(n): vai direto pela lama.
    expect(greedyBestFirst(grid, start, goal, { heuristic: manhattan }).cost).toBe(10);
  });
});

describe('Busca Gulosa', () => {
  it('é completa: sempre acha um caminho quando ele existe, mas pode não ser ótimo', () => {
    let suboptimal = 0;
    for (const { grid, start, goal } of randomQueries(500, 11)) {
      const optimal = bruteForceCost(grid, start, goal);
      const greedy = greedyBestFirst(grid, start, goal, { heuristic: manhattan });
      expect(greedy.found).toBe(optimal !== Infinity);
      if (!greedy.found) continue;
      expect(pathCost(grid, greedy.path)).toBeCloseTo(greedy.cost, 9);
      expect(greedy.cost).toBeGreaterThanOrEqual(optimal);
      if (greedy.cost > optimal) suboptimal++;
    }
    expect(suboptimal).toBeGreaterThan(0);
  });
});

describe('casos de borda', () => {
  const open = Grid.fromRows(['.....', '.....', '.....']);

  it('início igual ao objetivo devolve caminho de um nó e custo 0', () => {
    for (const run of [aStar, greedyBestFirst]) {
      const r = run(open, 7, 7, { heuristic: manhattan });
      expect(r).toMatchObject({ found: true, path: [7], cost: 0, expanded: 1 });
    }
  });

  it('objetivo isolado por paredes → não encontrado', () => {
    const grid = Grid.fromRows(['.....', '.###.', '.#.#.', '.###.']);
    for (const run of [aStar, greedyBestFirst]) {
      const r = run(grid, 0, grid.index(2, 2), { heuristic: manhattan });
      expect(r.found).toBe(false);
      expect(r.cost).toBe(Infinity);
      expect(r.path).toEqual([]);
    }
  });

  it('objetivo em parede → não encontrado sem expandir nada', () => {
    const grid = Grid.fromRows(['..#']);
    expect(aStar(grid, 0, 2, { heuristic: manhattan })).toMatchObject({ found: false, expanded: 0 });
  });
});

describe('trace (modo debug)', () => {
  it('registra ordem de expansão coerente com os contadores', () => {
    for (const { grid, start, goal } of randomQueries(50, 5)) {
      const r = aStar(grid, start, goal, { heuristic: manhattan, trace: true });
      const trace = r.trace!;
      expect(trace.order.length).toBe(r.expanded);
      trace.order.forEach((node, step) => expect(trace.expandedAt[node]).toBe(step));
      // Todo nó expandido foi descoberto antes de ser expandido.
      for (const node of trace.order) expect(trace.discoveredAt[node]).toBeLessThan(trace.expandedAt[node]);
      expect(trace.discoveredAt[start]).toBe(-1);
      if (!r.found) continue;
      expect(trace.expandedAt[goal]).not.toBe(NEVER);
    }
  });
});
