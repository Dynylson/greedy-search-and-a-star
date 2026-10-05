/**
 * Gera o relatório técnico (`npm run report`):
 *   report/template.html + results/bench.json  →  report/relatorio.html  →  report/Relatorio-Cripta-Heuristica.pdf
 *
 * As tabelas e os gráficos saem direto dos resultados do benchmark; o PDF é impresso pelo
 * Chrome (ou Edge) instalado na máquina, via playwright-core.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { buildCharts, seriesColor } from '../src/bench/charts';
import type { BenchOptions, Row } from '../src/bench/runner';
import { ALGOS, SCENARIOS, type ScenarioId } from '../src/bench/scenarios';

interface BenchFile {
  elapsedS: number;
  options: BenchOptions;
  environment: { node: string; cpu: string; platform: string };
  rows: Row[];
}

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const bench = JSON.parse(readFileSync(join(root, 'results/bench.json'), 'utf8')) as BenchFile;

const fmt = (n: number, digits: number) =>
  n.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

function table(id: ScenarioId): string {
  const scenario = SCENARIOS.find((s) => s.id === id)!;
  const showVariant = scenario.variants.length > 1;
  const body = bench.rows
    .filter((r) => r.scenario === id)
    .map(
      (r) => `<tr>
        ${showVariant ? `<td>${r.variant}</td>` : ''}
        <td class="nowrap"><span class="swatch" style="background:${seriesColor(r.algo, 'light')}"></span>${ALGOS[r.algo].label}</td>
        <td class="num">${fmt(r.meanTimeMs, 3)}</td>
        <td class="num">${fmt(r.p95TimeMs, 3)}</td>
        <td class="num">${fmt(r.meanExpanded, 0)}</td>
        <td class="num">${fmt(r.meanMaxOpen, 0)}</td>
        <td class="num">${fmt(r.meanCost, 1)}</td>
        <td class="num">${fmt(r.meanRatio, 3)}</td>
        <td class="num">${fmt(r.maxRatio, 2)}</td>
        <td class="num">${fmt(r.pctOptimal, 1)}%</td>
      </tr>`,
    )
    .join('');
  return `<table>
    <thead><tr>
      ${showVariant ? `<th>${scenario.parameter}</th>` : ''}
      <th>Algoritmo</th><th class="num">Tempo (ms)</th><th class="num">p95 (ms)</th><th class="num">Nós exp.</th>
      <th class="num">Aberta máx.</th><th class="num">Custo</th><th class="num">Custo ÷ ótimo</th>
      <th class="num">Pior razão</th><th class="num">Ótimos</th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table>
  <p class="source">Média de ${bench.options.seeds * bench.options.pairsPerSeed} consultas por linha. Fonte: os autores.</p>`;
}

let html = readFileSync(join(here, 'template.html'), 'utf8');
const specs: { id: string; config: unknown }[] = [];
let figure = 2;

html = html.replace(/<!--CHARTS:(s\d):([\w,]+)-->/g, (_, id: ScenarioId, metrics: string) => {
  const scenario = SCENARIOS.find((s) => s.id === id)!;
  const all = buildCharts(scenario, bench.rows, 'light');
  const chosen = metrics.split(',').map((m) => all.find((c) => c.id === `${id}-${m}`)!);
  for (const chart of chosen) {
    (chart.config.options as { devicePixelRatio?: number }).devicePixelRatio = 3;
    specs.push({ id: chart.id, config: chart.config });
  }
  figure++;
  return `<figure>
    <div class="charts" style="--cols:${chosen.length}">
      ${chosen.map((c) => `<div class="chart"><h4>${c.title}</h4><div class="box"><canvas id="${c.id}"></canvas></div></div>`).join('')}
    </div>
    <figcaption><b>Figura ${figure}</b> – ${scenario.title.replace(' · ', ': ')}. Fonte: os autores.</figcaption>
  </figure>`;
});
html = html.replace(/<!--TABLE:(s\d)-->/g, (_, id: ScenarioId) => table(id));

const { options, environment } = bench;
const date = new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
html = html
  .replaceAll('{{DATE}}', date)
  .replaceAll('{{QUERIES}}', String(options.seeds * options.pairsPerSeed))
  .replaceAll('{{SEEDS}}', String(options.seeds))
  .replaceAll('{{PAIRS}}', String(options.pairsPerSeed))
  .replaceAll('{{TASKS}}', String(SCENARIOS.reduce((n, s) => n + s.variants.length * options.seeds, 0)))
  .replaceAll('{{ELAPSED}}', fmt(bench.elapsedS, 0))
  .replaceAll('{{ENV}}', `${environment.cpu}, Windows 11, Node.js ${environment.node}`);

const chartJs = readFileSync(join(root, 'node_modules/chart.js/dist/chart.umd.min.js'), 'utf8');
html = html.replace(
  '<!--CHART_DATA-->',
  `<script>${chartJs}</script>
  <script>
    for (const spec of ${JSON.stringify(specs)}) new Chart(document.getElementById(spec.id), spec.config);
    window.__ready = true;
  </script>`,
);

const htmlPath = join(here, 'relatorio.html');
const pdfPath = join(here, 'Relatorio-Cripta-Heuristica.pdf');
writeFileSync(htmlPath, html);

const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch({ channel: 'msedge' }));
const page = await browser.newPage({ viewport: { width: 794, height: 1123 } });
await page.goto(pathToFileURL(htmlPath).href);
await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true);
await page.evaluate(() => document.fonts.ready);
const pdf = await page.pdf({
  preferCSSPageSize: true,
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: '<span></span>',
  footerTemplate:
    '<div style="width:100%;padding-right:20mm;text-align:right;font:8px Segoe UI,Arial,sans-serif;color:#888"><span class="pageNumber"></span></div>',
});
await browser.close();
try {
  writeFileSync(pdfPath, pdf);
  console.log(`Relatório gerado: ${pdfPath}`);
} catch (error) {
  // No Windows, um PDF aberto num leitor fica bloqueado para escrita.
  if ((error as NodeJS.ErrnoException).code !== 'EBUSY') throw error;
  console.warn('⚠ O PDF está aberto em outro programa: feche-o e rode `npm run report` de novo.');
}
