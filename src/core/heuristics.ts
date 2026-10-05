/**
 * Funções heurísticas h(n): estimativa do custo de n até o objetivo.
 *
 * Como o menor custo de um passo é 1 (chão) e só existem movimentos
 * ortogonais, nenhum caminho real é mais curto que a distância de Manhattan.
 * Por isso Manhattan, Euclidiana e Zero são ADMISSÍVEIS (nunca superestimam)
 * e também CONSISTENTES (h varia no máximo 1 por passo, e todo passo custa ≥ 1).
 * "2×Manhattan" superestima de propósito: é o A* ponderado (w = 2), que troca
 * a garantia de caminho ótimo por menos nós expandidos.
 */
export type HeuristicFn = (ax: number, ay: number, bx: number, by: number) => number;

export type HeuristicId = 'manhattan' | 'euclidean' | 'zero' | 'manhattan2';

export interface HeuristicInfo {
  id: HeuristicId;
  label: string;
  admissible: boolean;
  fn: HeuristicFn;
}

const manhattan: HeuristicFn = (ax, ay, bx, by) => Math.abs(ax - bx) + Math.abs(ay - by);

export const HEURISTICS: Readonly<Record<HeuristicId, HeuristicInfo>> = {
  manhattan: {
    id: 'manhattan',
    label: 'Manhattan',
    admissible: true,
    fn: manhattan,
  },
  euclidean: {
    id: 'euclidean',
    label: 'Euclidiana',
    admissible: true,
    fn: (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by),
  },
  zero: {
    id: 'zero',
    label: 'Zero (Dijkstra)',
    admissible: true,
    fn: () => 0,
  },
  manhattan2: {
    id: 'manhattan2',
    label: '2×Manhattan (ponderada)',
    admissible: false,
    fn: (ax, ay, bx, by) => 2 * manhattan(ax, ay, bx, by),
  },
};

export const HEURISTIC_IDS = Object.keys(HEURISTICS) as HeuristicId[];
