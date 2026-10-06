import type { Grid } from './grid';
import type { HeuristicFn } from './heuristics';
import { MinHeap } from './priorityQueue';

/**
 * Busca Gulosa (Greedy Best-First Search) e A*.
 *
 * Os dois seguem o mesmo esquema — tirar da lista aberta o nó de menor f(n),
 * expandi-lo e colocar os vizinhos na lista — e diferem em DUAS escolhas:
 *
 *             f(n) usada na lista aberta          reencontrou um nó por um caminho mais barato?
 *   Gulosa →  h(n)          (só a estimativa)     ignora: fica com o primeiro caminho
 *   A*     →  g(n) + h(n)   (gasto + estimativa)  atualiza g(n) e o pai (relaxamento)
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

/** Busca Gulosa: f(n) = h(n). Vai sempre para o nó que PARECE mais perto do objetivo. */
export function greedyBestFirst(grid: Grid, start: number, goal: number, options: SearchOptions): SearchResult {
  const s = new SearchContext(grid, options);
  if (!grid.isPassable(start) || !grid.isPassable(goal)) return s.notFound();
  const h = heuristicTo(grid, goal, options.heuristic);

  s.open(start, 0, -1, h(start), h(start));
  while (s.openCount > 0) {
    const current = s.expandBest();
    if (current === goal) return s.found(goal);

    const count = grid.neighbors(current, s.neighbors);
    for (let k = 0; k < count; k++) {
      const next = s.neighbors[k];
      // Nó já descoberto (aberto ou fechado) é ignorado: a Gulosa fica com o
      // primeiro caminho que achou, porque o custo gasto não entra na decisão.
      if (s.g[next] !== Infinity) continue;
      const hNext = h(next);
      s.open(next, s.g[current] + grid.costOf(next), current, hNext, hNext);
    }
  }
  return s.notFound();
}

/** A*: f(n) = g(n) + h(n). Com h admissível, o primeiro caminho até o objetivo é o de menor custo. */
export function aStar(grid: Grid, start: number, goal: number, options: SearchOptions): SearchResult {
  const s = new SearchContext(grid, options);
  if (!grid.isPassable(start) || !grid.isPassable(goal)) return s.notFound();
  const h = heuristicTo(grid, goal, options.heuristic);

  s.open(start, 0, -1, h(start), h(start));
  while (s.openCount > 0) {
    const current = s.expandBest();
    if (current === goal) return s.found(goal);

    const count = grid.neighbors(current, s.neighbors);
    for (let k = 0; k < count; k++) {
      const next = s.neighbors[k];
      if (s.closed[next]) continue;
      const newG = s.g[current] + grid.costOf(next);
      // Relaxamento: só (re)coloca na lista aberta se achou um caminho MAIS BARATO até `next`.
      if (newG >= s.g[next]) continue;
      const hNext = h(next);
      s.open(next, newG, current, newG + hNext, hNext);
    }
  }
  return s.notFound();
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

/** h(n) até o objetivo, a partir do índice linear da célula. */
function heuristicTo(grid: Grid, goal: number, heuristic: HeuristicFn): (i: number) => number {
  const width = grid.width;
  const goalX = goal % width;
  const goalY = (goal / width) | 0;
  return (i) => heuristic(i % width, (i / width) | 0, goalX, goalY);
}

/**
 * Estruturas comuns às duas buscas: lista aberta, lista fechada, g(n), pai de cada nó,
 * as métricas do benchmark e o registro do passo a passo. Cada algoritmo acima só
 * decide a prioridade de cada nó e o que fazer ao reencontrá-lo.
 */
class SearchContext {
  /** Custo do melhor caminho conhecido até cada nó (Infinity = ainda não descoberto). */
  readonly g: Float64Array;
  /** De qual nó viemos (para remontar o caminho no fim). */
  readonly parent: Int32Array;
  /** Lista fechada: nós já expandidos. */
  readonly closed: Uint8Array;
  /** Buffer reaproveitado por `grid.neighbors` (evita alocar dentro do laço). */
  readonly neighbors = [0, 0, 0, 0];
  /** Nós distintos na lista aberta. */
  openCount = 0;

  private readonly heap = new MinHeap();
  private readonly trace?: SearchTrace;
  private expanded = 0;
  private maxOpen = 0;

  constructor(grid: Grid, options: SearchOptions) {
    const size = grid.size;
    this.g = new Float64Array(size).fill(Infinity);
    this.parent = new Int32Array(size).fill(-1);
    this.closed = new Uint8Array(size);
    if (options.trace) {
      this.trace = {
        order: [],
        expandedAt: new Int32Array(size).fill(NEVER),
        discoveredAt: new Int32Array(size).fill(NEVER),
        g: this.g,
      };
    }
  }

  /** Coloca `node` na lista aberta com custo `g`, vindo de `from` (-1 = nó inicial). */
  open(node: number, g: number, from: number, priority: number, h: number): void {
    const isNew = this.g[node] === Infinity;
    this.g[node] = g;
    this.parent[node] = from;
    this.heap.push(node, priority, h);
    if (!isNew) return;
    this.openCount++;
    if (this.openCount > this.maxOpen) this.maxOpen = this.openCount;
    if (this.trace) this.trace.discoveredAt[node] = from === -1 ? -1 : this.expanded - 1;
  }

  /** Tira da lista aberta o nó de menor prioridade e o move para a lista fechada. */
  expandBest(): number {
    let node = this.heap.pop();
    // O heap pode conter entradas antigas de um nó que já teve g melhorado e foi
    // expandido ("remoção preguiçosa"); essas são simplesmente ignoradas.
    while (this.closed[node]) node = this.heap.pop();
    this.closed[node] = 1;
    this.openCount--;
    if (this.trace) {
      this.trace.expandedAt[node] = this.expanded;
      this.trace.order.push(node);
    }
    this.expanded++;
    return node;
  }

  found(goal: number): SearchResult {
    const path: number[] = [];
    for (let node = goal; node !== -1; node = this.parent[node]) path.push(node);
    path.reverse();
    return { found: true, path, cost: this.g[goal], expanded: this.expanded, maxOpen: this.maxOpen, trace: this.trace };
  }

  notFound(): SearchResult {
    return { found: false, path: [], cost: Infinity, expanded: this.expanded, maxOpen: this.maxOpen, trace: this.trace };
  }
}
