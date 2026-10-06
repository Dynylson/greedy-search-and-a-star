import { generateDungeon } from '../core/dungeon';
import type { Grid } from '../core/grid';
import { HEURISTICS } from '../core/heuristics';
import { hashSeed, mulberry32, type Rng } from '../core/rng';
import { aStar, search, type SearchResult } from '../core/search';
import { ALGOS, type AlgoId, type Scenario, type ScenarioId, type Variant } from './scenarios';

/**
 * Execução do benchmark — código puro, sem DOM nem Node,
 * usado tanto pela página /bench quanto pelo script `npm run bench`.
 */

export interface BenchOptions {
  /** Quantas dungeons diferentes por variante. */
  seeds: number;
  /** Pares (início, objetivo) sorteados por dungeon. */
  pairsPerSeed: number;
  /** Cada busca é repetida até somar pelo menos este tempo (o relógio tem resolução limitada). */
  minTimeMs: number;
  baseSeed: number;
}

export const NODE_OPTIONS: BenchOptions = { seeds: 100, pairsPerSeed: 5, minTimeMs: 1, baseSeed: 2024 };
export const BROWSER_OPTIONS: BenchOptions = { seeds: 10, pairsPerSeed: 5, minTimeMs: 3, baseSeed: 2024 };

export interface Sample {
  scenario: ScenarioId;
  variant: string;
  algo: AlgoId;
  seed: number;
  timeMs: number;
  expanded: number;
  maxOpen: number;
  cost: number;
  optimalCost: number;
  steps: number;
}

export interface Task {
  scenario: Scenario;
  variant: Variant;
  seedIndex: number;
}

export type Clock = () => number;

export function planTasks(scenarios: readonly Scenario[], options: BenchOptions): Task[] {
  const tasks: Task[] = [];
  for (const scenario of scenarios) {
    for (const variant of scenario.variants) {
      for (let seedIndex = 0; seedIndex < options.seeds; seedIndex++) tasks.push({ scenario, variant, seedIndex });
    }
  }
  return tasks;
}

/** Gera a dungeon da tarefa, sorteia os pares e mede cada algoritmo do cenário em cada par. */
export function runTask(task: Task, options: BenchOptions, clock: Clock): Sample[] {
  const { scenario, variant } = task;
  // A seed depende só do tamanho: no cenário 3 o layout de salas é o mesmo em todas
  // as densidades de lama (a lama é o último passo do gerador).
  const seed = hashSeed(options.baseSeed, task.seedIndex, variant.width, variant.height);
  const { grid } = generateDungeon({ width: variant.width, height: variant.height, seed, mudDensity: variant.mudDensity });
  const pairs = pickPairs(grid, mulberry32(hashSeed(seed, 99)), options.pairsPerSeed);

  const samples: Sample[] = [];
  for (const [start, goal] of pairs) {
    // Custo ótimo de referência: A* com Manhattan, que é admissível e por isso sempre acha
    // o caminho mais barato (os testes conferem isso contra uma busca exaustiva).
    const optimalCost = aStar(grid, start, goal, { heuristic: HEURISTICS.manhattan.fn }).cost;
    for (const algoId of scenario.algos) {
      const algo = ALGOS[algoId];
      const options_ = { heuristic: HEURISTICS[algo.heuristic].fn };
      const run = () => search(algo.algorithm, grid, start, goal, options_);
      const { result, timeMs } = measure(run, options.minTimeMs, clock);
      samples.push({
        scenario: scenario.id,
        variant: variant.label,
        algo: algoId,
        seed,
        timeMs,
        expanded: result.expanded,
        maxOpen: result.maxOpen,
        cost: result.cost,
        optimalCost,
        steps: result.path.length - 1,
      });
    }
  }
  return samples;
}

/** Roda algumas buscas descartáveis para o JIT do JavaScript "aquecer" antes de medir. */
export function warmUp(scenarios: readonly Scenario[], clock: Clock): void {
  const options = { ...NODE_OPTIONS, seeds: 2, minTimeMs: 0.2 };
  for (const task of planTasks(scenarios, options)) runTask(task, options, clock);
}

function measure(run: () => SearchResult, minTimeMs: number, clock: Clock) {
  const result = run();
  let reps = 0;
  const t0 = clock();
  let elapsed = 0;
  do {
    run();
    reps++;
    elapsed = clock() - t0;
  } while (elapsed < minTimeMs && reps < 10_000);
  return { result, timeMs: elapsed / reps };
}

/** Pares de células transitáveis razoavelmente distantes (Manhattan ≥ (L + A) / 4). */
function pickPairs(grid: Grid, rng: Rng, count: number): [number, number][] {
  const passable: number[] = [];
  for (let i = 0; i < grid.size; i++) if (grid.isPassable(i)) passable.push(i);
  const minDistance = Math.floor((grid.width + grid.height) / 4);
  const pick = () => passable[Math.floor(rng() * passable.length)];

  const pairs: [number, number][] = [];
  for (let p = 0; p < count; p++) {
    let a = pick();
    let b = pick();
    for (let attempt = 0; attempt < 500; attempt++) {
      const d = Math.abs(grid.xOf(a) - grid.xOf(b)) + Math.abs(grid.yOf(a) - grid.yOf(b));
      if (d >= minDistance) break;
      a = pick();
      b = pick();
    }
    pairs.push([a, b]);
  }
  return pairs;
}

// ── Agregação ─────────────────────────────────────────────────────────

export interface Row {
  scenario: ScenarioId;
  variant: string;
  algo: AlgoId;
  queries: number;
  meanTimeMs: number;
  p95TimeMs: number;
  meanExpanded: number;
  meanMaxOpen: number;
  meanCost: number;
  /** Média de custo encontrado ÷ custo ótimo (1,0 = sempre ótimo). */
  meanRatio: number;
  maxRatio: number;
  /** % das consultas em que o caminho encontrado tinha custo ótimo. */
  pctOptimal: number;
  meanSteps: number;
}

export function aggregate(samples: readonly Sample[], scenarios: readonly Scenario[]): Row[] {
  const groups = new Map<string, Sample[]>();
  for (const s of samples) {
    const key = `${s.scenario}|${s.variant}|${s.algo}`;
    let group = groups.get(key);
    if (!group) groups.set(key, (group = []));
    group.push(s);
  }

  const rows: Row[] = [];
  // Percorre na ordem dos cenários/variantes/algoritmos para as tabelas saírem ordenadas.
  for (const scenario of scenarios) {
    for (const variant of scenario.variants) {
      for (const algo of scenario.algos) {
        const group = groups.get(`${scenario.id}|${variant.label}|${algo}`);
        if (!group?.length) continue;
        const valid = group.filter((s) => Number.isFinite(s.cost));
        const ratios = valid.map((s) => s.cost / s.optimalCost);
        const times = group.map((s) => s.timeMs).sort((a, b) => a - b);
        rows.push({
          scenario: scenario.id,
          variant: variant.label,
          algo,
          queries: group.length,
          meanTimeMs: mean(times),
          p95TimeMs: times[Math.min(times.length - 1, Math.ceil(times.length * 0.95) - 1)],
          meanExpanded: mean(group.map((s) => s.expanded)),
          meanMaxOpen: mean(group.map((s) => s.maxOpen)),
          meanCost: mean(valid.map((s) => s.cost)),
          meanRatio: mean(ratios),
          maxRatio: Math.max(...ratios),
          pctOptimal: (100 * valid.filter((s) => s.cost <= s.optimalCost + 1e-9).length) / Math.max(1, valid.length),
          meanSteps: mean(valid.map((s) => s.steps)),
        });
      }
    }
  }
  return rows;
}

function mean(values: readonly number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN;
}

export function toCsv(rows: readonly Row[]): string {
  const header = [
    'cenario',
    'variante',
    'algoritmo',
    'consultas',
    'tempo_medio_ms',
    'tempo_p95_ms',
    'nos_expandidos_medio',
    'lista_aberta_max_media',
    'custo_medio',
    'razao_subotimalidade_media',
    'razao_subotimalidade_max',
    'pct_otimo',
    'passos_medio',
  ];
  const lines = rows.map((r) =>
    [
      r.scenario,
      r.variant,
      ALGOS[r.algo].label,
      r.queries,
      r.meanTimeMs.toFixed(5),
      r.p95TimeMs.toFixed(5),
      r.meanExpanded.toFixed(1),
      r.meanMaxOpen.toFixed(1),
      r.meanCost.toFixed(2),
      r.meanRatio.toFixed(4),
      r.maxRatio.toFixed(4),
      r.pctOptimal.toFixed(1),
      r.meanSteps.toFixed(1),
    ]
      .map((v) => (/[,"]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v))
      .join(','),
  );
  return [header.join(','), ...lines].join('\n');
}
