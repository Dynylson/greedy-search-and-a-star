import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import '@fontsource/press-start-2p/400.css';
import '../styles/base.css';
import '../styles/bench.css';

import { Chart, registerables } from 'chart.js';
import { buildCharts, seriesColor } from './charts';
import { aggregate, BROWSER_OPTIONS, planTasks, runTask, toCsv, type Row, type Sample } from './runner';
import { ALGOS, SCENARIOS, type Scenario } from './scenarios';

/** Página /bench: roda os mesmos cenários do relatório, em escala menor, ao vivo no navegador. */

Chart.register(...registerables);

const picks = document.getElementById('scenario-picks')!;
const seedsInput = document.getElementById('seeds') as HTMLInputElement;
const pairsInput = document.getElementById('pairs') as HTMLInputElement;
const runButton = document.getElementById('run') as HTMLButtonElement;
const progressFill = document.getElementById('progress-fill')!;
const progressText = document.getElementById('progress-text')!;
const results = document.getElementById('results')!;
const charts: Chart[] = [];

seedsInput.value = String(BROWSER_OPTIONS.seeds);
pairsInput.value = String(BROWSER_OPTIONS.pairsPerSeed);
for (const scenario of SCENARIOS) {
  const label = document.createElement('label');
  label.innerHTML = `<input type="checkbox" value="${scenario.id}" checked /> ${scenario.title}`;
  picks.append(label);
}
results.innerHTML = '<p class="empty-state">Escolha os cenários e clique em <b>Rodar benchmark</b>.</p>';

runButton.addEventListener('click', () => void run());

async function run(): Promise<void> {
  const selected = SCENARIOS.filter((s) =>
    picks.querySelector<HTMLInputElement>(`input[value="${s.id}"]`)!.checked,
  );
  if (selected.length === 0) return;
  const options = {
    ...BROWSER_OPTIONS,
    seeds: clampInt(seedsInput.value, 1, 200),
    pairsPerSeed: clampInt(pairsInput.value, 1, 20),
  };
  const tasks = planTasks(selected, options);
  const clock = () => performance.now();
  const samples: Sample[] = [];

  runButton.disabled = true;
  charts.splice(0).forEach((c) => c.destroy());
  results.innerHTML = '';
  const started = clock();
  let lastYield = clock();

  for (let k = 0; k < tasks.length; k++) {
    samples.push(...runTask(tasks[k], options, clock));
    if (clock() - lastYield > 40 || k === tasks.length - 1) {
      const pct = ((k + 1) / tasks.length) * 100;
      progressFill.style.width = `${pct}%`;
      progressText.textContent = `${k + 1}/${tasks.length} tarefas`;
      await new Promise((resolve) => setTimeout(resolve, 0)); // devolve o controle para a tela atualizar
      lastYield = clock();
    }
  }

  const rows = aggregate(samples, selected);
  const seconds = ((clock() - started) / 1000).toFixed(1);
  progressText.textContent = `${samples.length.toLocaleString('pt-BR')} buscas medidas em ${seconds} s`;
  for (const scenario of selected) renderScenario(scenario, rows.filter((r) => r.scenario === scenario.id));
  runButton.disabled = false;
}

function renderScenario(scenario: Scenario, rows: Row[]): void {
  const section = document.createElement('section');
  section.className = 'scenario';
  section.innerHTML = `
    <div class="scenario-head">
      <h2>${scenario.title}</h2>
      <button class="link-btn" type="button" data-csv>Baixar CSV</button>
    </div>
    <p class="desc">${scenario.description}</p>
    <div class="card table-wrap">${table(rows)}</div>
    <div class="charts"></div>`;
  results.append(section);

  section.querySelector('[data-csv]')!.addEventListener('click', () =>
    download(`${scenario.id}.csv`, new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' })),
  );

  const grid = section.querySelector('.charts')!;
  for (const spec of buildCharts(scenario, rows, 'dark')) {
    const card = document.createElement('div');
    card.className = 'card chart-card';
    card.innerHTML = `
      <header><h3>${spec.title}</h3><button class="link-btn" type="button">PNG</button></header>
      <div class="chart-box"><canvas aria-label="${spec.title}"></canvas></div>`;
    grid.append(card);
    const chart = new Chart(card.querySelector('canvas')!, spec.config);
    charts.push(chart);
    card.querySelector('button')!.addEventListener('click', () => {
      const a = document.createElement('a');
      a.href = chart.toBase64Image('image/png', 1);
      a.download = `${spec.id}.png`;
      a.click();
    });
  }
}

function table(rows: Row[]): string {
  const body = rows
    .map(
      (r) => `<tr>
        <td>${r.variant}</td>
        <td><span class="swatch" style="background:${seriesColor(r.algo, 'dark')}"></span>${ALGOS[r.algo].label}</td>
        <td>${fmt(r.meanTimeMs, 3)}</td>
        <td>${fmt(r.p95TimeMs, 3)}</td>
        <td>${fmt(r.meanExpanded, 0)}</td>
        <td>${fmt(r.meanMaxOpen, 0)}</td>
        <td>${fmt(r.meanCost, 1)}</td>
        <td>${fmt(r.meanRatio, 3)}</td>
        <td>${fmt(r.pctOptimal, 1)}%</td>
      </tr>`,
    )
    .join('');
  return `<table class="results">
    <thead><tr>
      <th>Variante</th><th>Algoritmo</th><th>Tempo médio (ms)</th><th>p95 (ms)</th><th>Nós expandidos</th>
      <th>Lista aberta máx.</th><th>Custo médio</th><th>Custo ÷ ótimo</th><th>Caminhos ótimos</th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

function fmt(n: number, digits: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function clampInt(text: string, min: number, max: number): number {
  const n = Math.round(Number(text));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : min;
}

function download(name: string, blob: Blob): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
