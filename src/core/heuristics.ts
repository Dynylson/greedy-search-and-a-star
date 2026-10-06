/**
 * Funções heurísticas h(n): estimativa do custo de n até o objetivo.
 *
 * Como o menor custo de um passo é 1 (chão) e só existem movimentos
 * ortogonais, nenhum caminho real é mais curto que a distância de Manhattan.
 * Por isso Manhattan e Euclidiana são ADMISSÍVEIS (nunca superestimam)
 * e também CONSISTENTES (h varia no máximo 1 por passo, e todo passo custa ≥ 1).
 * A Manhattan DOMINA a Euclidiana (é sempre ≥ ela), ou seja, é mais informada:
 * fica mais perto do custo real sem nunca passar dele.
 */
export type HeuristicFn = (ax: number, ay: number, bx: number, by: number) => number;

export type HeuristicId = 'manhattan' | 'euclidean';

export interface HeuristicInfo {
  id: HeuristicId;
  label: string;
  fn: HeuristicFn;
}

export const HEURISTICS: Readonly<Record<HeuristicId, HeuristicInfo>> = {
  manhattan: {
    id: 'manhattan',
    label: 'Manhattan',
    fn: (ax, ay, bx, by) => Math.abs(ax - bx) + Math.abs(ay - by),
  },
  euclidean: {
    id: 'euclidean',
    label: 'Euclidiana',
    fn: (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by),
  },
};

export const HEURISTIC_IDS = Object.keys(HEURISTICS) as HeuristicId[];
