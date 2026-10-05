import type { Grid } from './grid';
import type { HeuristicFn } from './heuristics';
import { MinHeap } from './priorityQueue';

/**
 * Busca Gulosa (Greedy Best-First Search) e A*.
 *
 * Os dois são o MESMO algoritmo de busca pela melhor escolha; a única diferença
 * é a função de avaliação f(n) usada para ordenar a lista aberta:
 *
 *   A*      → f(n) = g(n) + h(n)   (custo real até aqui + estimativa até o fim)
 *   Gulosa  → f(n) = h(n)          (só a estimativa: "vá para o que parece mais perto")
 *
 * Além disso, o A* RELAXA arestas: se achar um caminho mais barato para um nó
 * que já está na lista aberta, atualiza g(n) e o pai. A Gulosa fica com o
 * primeiro caminho que descobriu, porque ignora g(n) na hora de decidir.
 */

export type AlgorithmId = 'astar' | 'greedy';

export const ALGORITHM_LABELS: Readonly<Record<AlgorithmId, string>> = {
  astar: 'A*',
  greedy: 'Gulosa',
};

/** Valor usado em `expandedAt`/`discoveredAt` para "nunca aconteceu". */
export const NEVER = 0x7fffffff;

/** Registro passo a passo da busca — usado pelo modo debug e pelo replay. */
export interface SearchTrace {
  /** Nós na ordem em que foram expandidos (retirados da lista aberta). */
  order: number[];
  /** Índice da expansão em que cada nó foi expandido (NEVER = nunca). */
  expandedAt: Int32Array;
  /** Índice da expansão em que cada nó entrou na lista aberta (-1 = nó inicial, NEVER = nunca). */
  discoveredAt: Int32Array;
  /** g(n) final de cada nó (Infinity = não alcançado). */
  g: Float64Array;
}

export interface SearchResult {
  found: boolean;
  /** Índices das células, do início ao objetivo (vazio se não achou). */
  path: number[];
  /** Soma dos custos das ações do caminho (Infinity se não achou). */
  cost: number;
  /** Nós retirados da lista aberta e expandidos. */
  expanded: number;
  /** Maior tamanho que a lista aberta atingiu (medida indireta de memória). */
  maxOpen: number;
  trace?: SearchTrace;
}

export interface SearchOptions {
  heuristic: HeuristicFn;
  /** Grava o passo a passo (custa memória; desligado no benchmark). */
  trace?: boolean;
}

type PriorityFn = (g: number, h: number) => number;

const astarPriority: PriorityFn = (g, h) => g + h;
const greedyPriority: PriorityFn = (_g, h) => h;

export function aStar(grid: Grid, start: number, goal: number, options: SearchOptions): SearchResult {
  return bestFirstSearch(grid, start, goal, options, astarPriority, true);
}

export function greedyBestFirst(grid: Grid, start: number, goal: number, options: SearchOptions): SearchResult {
  return bestFirstSearch(grid, start, goal, options, greedyPriority, false);
}

export function search(
  algorithm: AlgorithmId,
  grid: Grid,
  start: number,
  goal: number,
  options: SearchOptions,
): SearchResult {
  return algorithm === 'astar' ? aStar(grid, start, goal, options) : greedyBestFirst(grid, start, goal, options);
}

function bestFirstSearch(
  grid: Grid,
  start: number,
  goal: number,
  options: SearchOptions,
  priority: PriorityFn,
  relaxOpenNodes: boolean,
): SearchResult {
  const size = grid.size;
  const width = grid.width;
  const goalX = goal % width;
  const goalY = (goal / width) | 0;
  const heuristic = options.heuristic;
  const h = (i: number) => heuristic(i % width, (i / width) | 0, goalX, goalY);

  const g = new Float64Array(size).fill(Infinity);
  const parent = new Int32Array(size).fill(-1);
  const closed = new Uint8Array(size);
  const trace: SearchTrace | undefined = options.trace
    ? {
        order: [],
        expandedAt: new Int32Array(size).fill(NEVER),
        discoveredAt: new Int32Array(size).fill(NEVER),
        g,
      }
    : undefined;

  if (!grid.isPassable(start) || !grid.isPassable(goal)) {
    return { found: false, path: [], cost: Infinity, expanded: 0, maxOpen: 0, trace };
  }

  const open = new MinHeap();
  const hStart = h(start);
  g[start] = 0;
  open.push(start, priority(0, hStart), hStart);
  if (trace) trace.discoveredAt[start] = -1;

  let openCount = 1; // nós distintos na lista aberta
  let maxOpen = 1;
  let expanded = 0;
  const neighbors = [0, 0, 0, 0];

  while (open.size > 0) {
    const current = open.pop();
    // O heap pode conter entradas antigas de um nó que já teve g melhorado
    // e foi expandido ("remoção preguiçosa"); essas são simplesmente ignoradas.
    if (closed[current]) continue;
    closed[current] = 1;
    openCount--;

    if (trace) {
      trace.expandedAt[current] = expanded;
      trace.order.push(current);
    }
    const step = expanded++;

    if (current === goal) {
      return { found: true, path: buildPath(parent, goal), cost: g[goal], expanded, maxOpen, trace };
    }

    const count = grid.neighbors(current, neighbors);
    for (let k = 0; k < count; k++) {
      const next = neighbors[k];
      if (closed[next]) continue;

      const tentativeG = g[current] + grid.costOf(next);
      const discovered = g[next] !== Infinity;
      if (discovered && (!relaxOpenNodes || tentativeG >= g[next])) continue;

      g[next] = tentativeG;
      parent[next] = current;
      const hNext = h(next);
      open.push(next, priority(tentativeG, hNext), hNext);

      if (!discovered) {
        openCount++;
        if (openCount > maxOpen) maxOpen = openCount;
        if (trace) trace.discoveredAt[next] = step;
      }
    }
  }

  return { found: false, path: [], cost: Infinity, expanded, maxOpen, trace };
}

function buildPath(parent: Int32Array, goal: number): number[] {
  const path: number[] = [];
  for (let node = goal; node !== -1; node = parent[node]) path.push(node);
  return path.reverse();
}
