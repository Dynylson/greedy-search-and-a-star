import type { HeuristicId } from '../core/heuristics';
import type { AlgorithmId } from '../core/search';

/**
 * Cenários de teste do benchmark.
 *
 * Cada cenário varia UM parâmetro e mantém o resto fixo:
 *   1. tamanho do mapa      (20×20 → 160×160)
 *   2. heurística/algoritmo (mapa 80×80)
 *   3. densidade de lama    (0% → 40%, mesmo layout de salas)
 */

export type AlgoId = 'astar' | 'greedy' | 'dijkstra' | 'astar-w2' | 'astar-euclid';

export interface AlgoConfig {
  id: AlgoId;
  label: string;
  /** Rótulo curto para eixos de gráfico. */
  short: string;
  algorithm: AlgorithmId;
  heuristic: HeuristicId;
}

/** A ordem aqui define a cor de cada algoritmo nos gráficos (a cor segue a entidade). */
export const ALGOS: Readonly<Record<AlgoId, AlgoConfig>> = {
  astar: { id: 'astar', label: 'A* (Manhattan)', short: 'A*', algorithm: 'astar', heuristic: 'manhattan' },
  greedy: { id: 'greedy', label: 'Gulosa (Manhattan)', short: 'Gulosa', algorithm: 'greedy', heuristic: 'manhattan' },
  dijkstra: { id: 'dijkstra', label: 'Dijkstra (A*, h = 0)', short: 'Dijkstra', algorithm: 'astar', heuristic: 'zero' },
  'astar-w2': { id: 'astar-w2', label: 'A* ponderado (2×Manhattan)', short: 'A* w=2', algorithm: 'astar', heuristic: 'manhattan2' },
  'astar-euclid': { id: 'astar-euclid', label: 'A* (Euclidiana)', short: 'A* Eucl.', algorithm: 'astar', heuristic: 'euclidean' },
};

export const ALGO_ORDER: readonly AlgoId[] = ['astar', 'greedy', 'dijkstra', 'astar-w2', 'astar-euclid'];

export type ScenarioId = 's1' | 's2' | 's3';

export interface Variant {
  label: string;
  width: number;
  height: number;
  mudDensity: number;
}

export interface Scenario {
  id: ScenarioId;
  title: string;
  description: string;
  /** Nome do parâmetro variado (eixo X dos gráficos). */
  parameter: string;
  variants: Variant[];
  algos: AlgoId[];
}

export const SCENARIOS: readonly Scenario[] = [
  {
    id: 's1',
    title: 'Cenário 1 · Tamanho do mapa',
    description: 'Dungeons quadradas de 20×20 a 160×160, 15% de lama. Mede como o custo da busca cresce com o espaço de estados.',
    parameter: 'Tamanho do mapa',
    variants: [20, 40, 80, 160].map((n) => ({ label: `${n}×${n}`, width: n, height: n, mudDensity: 0.15 })),
    algos: ['astar', 'greedy', 'dijkstra'],
  },
  {
    id: 's2',
    title: 'Cenário 2 · Heurísticas',
    description: 'Mapa 80×80 com 15% de lama. Compara a qualidade da heurística (mais informada → menos nós) e o efeito de ignorar g(n).',
    parameter: 'Algoritmo',
    variants: [{ label: '80×80', width: 80, height: 80, mudDensity: 0.15 }],
    algos: ['astar', 'greedy', 'dijkstra', 'astar-w2', 'astar-euclid'],
  },
  {
    id: 's3',
    title: 'Cenário 3 · Densidade de lama',
    description:
      'Mapa 80×80 com 0% a 40% do piso virando lama (custo 3). As salas e os pares início/objetivo são os mesmos; só o terreno muda.',
    parameter: 'Densidade de lama',
    variants: [0, 0.1, 0.25, 0.4].map((m) => ({ label: `${Math.round(m * 100)}%`, width: 80, height: 80, mudDensity: m })),
    algos: ['astar', 'greedy', 'astar-w2'],
  },
];
