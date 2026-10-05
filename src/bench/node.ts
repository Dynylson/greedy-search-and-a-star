/**
 * Benchmark completo em Node (`npm run bench`): gera os números usados no relatório.
 * Saída: results/bench.json e um CSV por cenário.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, platform, release } from 'node:os';
import { performance } from 'node:perf_hooks';
import { aggregate, NODE_OPTIONS, planTasks, runTask, toCsv, warmUp, type Sample } from './runner';
import { ALGOS, SCENARIOS } from './scenarios';

const clock = () => performance.now();
const options = { ...NODE_OPTIONS, seeds: Number(process.env.SEEDS ?? NODE_OPTIONS.seeds) };

console.log(`Aquecendo o JIT...`);
warmUp(SCENARIOS, clock);

const tasks = planTasks(SCENARIOS, options);
console.log(`Rodando ${tasks.length} tarefas (${options.seeds} seeds × ${options.pairsPerSeed} pares por variante)...`);
const started = clock();
const samples: Sample[] = [];
tasks.forEach((task, k) => {
  samples.push(...runTask(task, options, clock));
  if ((k + 1) % 100 === 0) process.stdout.write(`  ${k + 1}/${tasks.length}\n`);
});
const elapsedS = (clock() - started) / 1000;
const rows = aggregate(samples, SCENARIOS);

mkdirSync('results', { recursive: true });
const environment = {
  node: process.version,
  cpu: cpus()[0]?.model.trim() ?? 'desconhecido',
  platform: `${platform()} ${release()}`,
};
writeFileSync(
  'results/bench.json',
  JSON.stringify({ generatedAt: new Date().toISOString(), elapsedS, options, environment, scenarios: SCENARIOS, rows }, null, 2),
);
for (const scenario of SCENARIOS) {
  writeFileSync(`results/${scenario.id}.csv`, toCsv(rows.filter((r) => r.scenario === scenario.id)));
}

for (const scenario of SCENARIOS) {
  console.log(`\n${scenario.title}`);
  console.table(
    rows
      .filter((r) => r.scenario === scenario.id)
      .map((r) => ({
        variante: r.variant,
        algoritmo: ALGOS[r.algo].label,
        'tempo (ms)': r.meanTimeMs.toFixed(4),
        'p95 (ms)': r.p95TimeMs.toFixed(4),
        nós: Math.round(r.meanExpanded),
        'aberta máx': Math.round(r.meanMaxOpen),
        custo: r.meanCost.toFixed(1),
        razão: r.meanRatio.toFixed(3),
        'razão máx': r.maxRatio.toFixed(3),
        '% ótimo': r.pctOptimal.toFixed(1),
      })),
  );
}
console.log(`\nConcluído em ${elapsedS.toFixed(1)} s. Resultados em results/.`);
