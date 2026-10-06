import { Grid, TILE } from '../src/core/grid';
import { mulberry32, type Rng } from '../src/core/rng';

/** Grid aleatório "sujo" (paredes e lama espalhadas), bom para pegar casos de borda. */
export function randomGrid(rng: Rng, width: number, height: number, wallP = 0.25, mudP = 0.2): Grid {
  const grid = new Grid(width, height);
  for (let i = 0; i < grid.size; i++) {
    const r = rng();
    grid.tiles[i] = r < wallP ? TILE.WALL : r < wallP + mudP ? TILE.MUD : TILE.FLOOR;
  }
  return grid;
}

export function randomPassable(rng: Rng, grid: Grid): number {
  for (;;) {
    const i = Math.floor(rng() * grid.size);
    if (grid.isPassable(i)) return i;
  }
}

/** Gera N consultas (grid, início, objetivo) reproduzíveis. */
export function* randomQueries(count: number, seed = 1) {
  const rng = mulberry32(seed);
  for (let q = 0; q < count; q++) {
    const grid = randomGrid(rng, 8 + Math.floor(rng() * 25), 8 + Math.floor(rng() * 25));
    yield { grid, start: randomPassable(rng, grid), goal: randomPassable(rng, grid) };
  }
}

/**
 * Custo mínimo por força bruta (Bellman-Ford): relaxa todas as arestas até nada mudar.
 * Bem mais lento que o A*, mas simples o bastante para servir de gabarito nos testes.
 */
export function bruteForceCost(grid: Grid, start: number, goal: number): number {
  if (!grid.isPassable(start) || !grid.isPassable(goal)) return Infinity;
  const dist = new Float64Array(grid.size).fill(Infinity);
  dist[start] = 0;
  const neighbors = [0, 0, 0, 0];
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i < grid.size; i++) {
      if (dist[i] === Infinity) continue;
      const count = grid.neighbors(i, neighbors);
      for (let k = 0; k < count; k++) {
        const next = neighbors[k];
        const d = dist[i] + grid.costOf(next);
        if (d < dist[next]) {
          dist[next] = d;
          changed = true;
        }
      }
    }
  }
  return dist[goal];
}

/** Confere se o caminho é válido e devolve seu custo somando as ações. */
export function pathCost(grid: Grid, path: number[]): number {
  let cost = 0;
  for (let k = 1; k < path.length; k++) {
    const a = path[k - 1];
    const b = path[k];
    const manhattan = Math.abs(grid.xOf(a) - grid.xOf(b)) + Math.abs(grid.yOf(a) - grid.yOf(b));
    if (manhattan !== 1) throw new Error(`passo inválido ${a} → ${b}`);
    if (!grid.isPassable(b)) throw new Error(`caminho atravessa parede em ${b}`);
    cost += grid.costOf(b);
  }
  return cost;
}
