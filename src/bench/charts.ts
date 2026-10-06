import type { ChartConfiguration } from 'chart.js';
import type { Row } from './runner';
import { ALGOS, type AlgoId, type Scenario } from './scenarios';

/**
 * Configurações dos gráficos (dados puros, sem funções): servem tanto para a página
 * /bench (tema escuro) quanto para o relatório em PDF (tema claro).
 *
 * Paleta categórica validada para daltonismo (ordem fixa; a cor segue o algoritmo).
 */

export type Theme = 'light' | 'dark';

const SERIES: Record<Theme, Record<AlgoId, string>> = {
  light: { astar: '#2a78d6', greedy: '#eb6834', 'astar-euclid': '#1baf7a', 'greedy-euclid': '#eda100' },
  dark: { astar: '#3987e5', greedy: '#d95926', 'astar-euclid': '#199e70', 'greedy-euclid': '#c98500' },
};

const INK: Record<Theme, { text: string; muted: string; grid: string; surface: string }> = {
  light: { text: '#0b0b0b', muted: '#52514e', grid: '#e7e5e0', surface: '#fcfcfb' },
  dark: { text: '#ddd8ff', muted: '#8a84b0', grid: '#231d3d', surface: '#110e1e' },
};

export function seriesColor(algo: AlgoId, theme: Theme): string {
  return SERIES[theme][algo];
}

export interface ChartSpec {
  id: string;
  title: string;
  config: ChartConfiguration;
}

type Metric = 'meanExpanded' | 'meanTimeMs' | 'meanRatio';

const METRICS: Record<Metric, { title: string; axis: string; log: boolean }> = {
  meanExpanded: { title: 'Nós expandidos (média)', axis: 'nós', log: true },
  meanTimeMs: { title: 'Tempo por busca (média, ms)', axis: 'ms', log: true },
  meanRatio: { title: 'Custo encontrado ÷ custo ótimo', axis: '1 = ótimo', log: false },
};

export function buildCharts(scenario: Scenario, rows: readonly Row[], theme: Theme): ChartSpec[] {
  const scenarioRows = rows.filter((r) => r.scenario === scenario.id);
  const metrics: Metric[] = ['meanExpanded', 'meanTimeMs', 'meanRatio'];
  return metrics.map((metric) =>
    scenario.variants.length > 1
      ? lineChart(scenario, scenarioRows, metric, theme)
      : barChart(scenario, scenarioRows, metric, theme),
  );
}

/** Uma linha por algoritmo, eixo X = parâmetro variado (cenários 1 e 3). */
function lineChart(scenario: Scenario, rows: readonly Row[], metric: Metric, theme: Theme): ChartSpec {
  const info = METRICS[metric];
  const labels = scenario.variants.map((v) => v.label);
  const datasets = scenario.algos.map((algo) => {
    const color = SERIES[theme][algo];
    return {
      label: ALGOS[algo].label,
      data: labels.map((label) => rows.find((r) => r.variant === label && r.algo === algo)?.[metric] ?? null),
      borderColor: color,
      backgroundColor: color,
      borderWidth: 2,
      pointRadius: 4,
      pointHoverRadius: 6,
      pointBorderColor: INK[theme].surface,
      pointBorderWidth: 2,
      tension: 0,
    };
  });
  return {
    id: `${scenario.id}-${metric}`,
    title: info.log ? `${info.title} · escala log` : info.title,
    config: {
      type: 'line',
      data: { labels, datasets },
      options: baseOptions(theme, scenario.parameter, info.axis, info.log, true, false),
    },
  };
}

/** Uma barra por algoritmo (cenário 2, que tem uma única variante). */
function barChart(scenario: Scenario, rows: readonly Row[], metric: Metric, theme: Theme): ChartSpec {
  const info = METRICS[metric];
  const algos = scenario.algos;
  const colors = algos.map((algo) => SERIES[theme][algo]);
  const options = baseOptions(theme, '', info.axis, false, false, true);
  // Todos os rótulos visíveis e retos (um por barra, uma palavra por linha).
  Object.assign(options.scales.x.ticks, { autoSkip: false, maxRotation: 0 });
  return {
    id: `${scenario.id}-${metric}`,
    title: info.title,
    config: {
      type: 'bar',
      data: {
        // Uma palavra por linha ("Gulosa" / "Eucl."), para o rótulo não ficar inclinado.
        labels: algos.map((a) => ALGOS[a].short.split(' ')),
        datasets: [
          {
            label: info.title,
            data: algos.map((algo) => rows.find((r) => r.algo === algo)?.[metric] ?? null),
            backgroundColor: colors,
            borderColor: INK[theme].surface,
            borderWidth: 2,
            borderRadius: 4,
            borderSkipped: 'bottom',
            maxBarThickness: 46,
          },
        ],
      },
      options,
    },
  };
}

function baseOptions(theme: Theme, xTitle: string, yTitle: string, log: boolean, legend: boolean, zeroBased: boolean) {
  const ink = INK[theme];
  const font = { family: "'JetBrains Mono', ui-monospace, monospace", size: 11 };
  return {
    locale: 'pt-BR',
    responsive: true,
    maintainAspectRatio: false,
    animation: false as const,
    interaction: { mode: 'index' as const, intersect: false },
    plugins: {
      legend: {
        display: legend,
        position: 'bottom' as const,
        labels: { color: ink.text, font, boxWidth: 12, boxHeight: 12, usePointStyle: true },
      },
      tooltip: { titleFont: font, bodyFont: font },
    },
    scales: {
      x: {
        title: { display: xTitle !== '', text: xTitle, color: ink.muted, font },
        ticks: { color: ink.muted, font },
        grid: { display: false },
        border: { color: ink.grid },
      },
      y: {
        type: log ? ('logarithmic' as const) : ('linear' as const),
        // Barras sempre partem do zero; linhas podem focar na faixa dos dados.
        beginAtZero: zeroBased,
        title: { display: true, text: yTitle, color: ink.muted, font },
        ticks: { color: ink.muted, font },
        grid: { color: ink.grid },
        border: { display: false },
      },
    },
  };
}
