/**
 * Versão editável do relatório em Word (`npm run report`, depois do PDF):
 *   report/relatorio.html (gráficos já desenhados) + results/bench.json → report/Relatorio-Cripta-Heuristica.docx
 *
 * Os gráficos e o mapa de calor são exportados como imagem a partir do HTML do relatório;
 * as tabelas são tabelas nativas do Word, montadas com os mesmos dados do benchmark.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IRunOptions,
} from 'docx';
import { chromium } from 'playwright-core';
import { seriesColor } from '../src/bench/charts';
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
const htmlPath = join(here, 'relatorio.html');
if (!existsSync(htmlPath)) throw new Error('Gere o relatório HTML/PDF antes: npx tsx report/build.ts');
const bench = JSON.parse(readFileSync(join(root, 'results/bench.json'), 'utf8')) as BenchFile;

// ── Medidas (DXA: 1 cm = 567) ────────────────────────────────────────
const MARGIN = { top: 1701, left: 1701, bottom: 1134, right: 1134 }; // 3/3/2/2 cm (ABNT)
const CONTENT_WIDTH = 11906 - MARGIN.left - MARGIN.right; // A4
const IMAGE_WIDTH_PX = 600;
const BODY_FONT = 'Cambria';
const HEAD_FONT = 'Calibri';

// ── Imagens exportadas do HTML do relatório ──────────────────────────
interface Capture {
  data: Buffer;
  width: number;
  height: number;
}

async function captureImages(): Promise<{ charts: Capture[]; heatmaps: Capture }> {
  const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch({ channel: 'msedge' }));
  const page = await browser.newPage({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 3 });
  await page.goto(pathToFileURL(htmlPath).href);
  await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true);
  const grab = async (selector: string, index: number): Promise<Capture> => {
    const element = page.locator(selector).nth(index);
    const box = (await element.boundingBox())!;
    return { data: await element.screenshot(), width: box.width, height: box.height };
  };
  const charts = [await grab('.charts', 0), await grab('.charts', 1), await grab('.charts', 2)];
  const heatmaps = await grab('.pair', 0);
  await browser.close();
  return { charts, heatmaps };
}

function pngSize(data: Buffer): { width: number; height: number } {
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

// ── Texto com marcação mínima: ⟦negrito⟧, ⟨itálico⟩, `código` ───────
function runs(text: string, base: IRunOptions = {}): TextRun[] {
  const out: TextRun[] = [];
  const pattern = /⟦([^⟧]+)⟧|⟨([^⟩]+)⟩|`([^`]+)`/g;
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    if (m.index! > last) out.push(new TextRun({ ...base, text: text.slice(last, m.index) }));
    if (m[1] !== undefined) out.push(new TextRun({ ...base, text: m[1], bold: true }));
    else if (m[2] !== undefined) out.push(new TextRun({ ...base, text: m[2], italics: true }));
    else out.push(new TextRun({ ...base, text: m[3], font: 'Consolas', size: 19 }));
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(new TextRun({ ...base, text: text.slice(last) }));
  return out;
}

const p = (text: string) =>
  new Paragraph({ children: runs(text), alignment: AlignmentType.JUSTIFIED, spacing: { after: 100 } });

const h1 = (text: string, pageBreak = false) =>
  new Paragraph({ text, heading: HeadingLevel.HEADING_1, pageBreakBefore: pageBreak });

const h2 = (text: string) => new Paragraph({ text, heading: HeadingLevel.HEADING_2 });

const bullet = (text: string) =>
  new Paragraph({
    children: runs(text),
    numbering: { reference: 'bullets', level: 0 },
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: 60 },
  });

const tableCaption = (text: string) =>
  new Paragraph({ children: runs(text, { bold: true, font: HEAD_FONT, size: 18 }), spacing: { before: 160, after: 60 }, keepNext: true });

const source = (text: string) =>
  new Paragraph({ children: runs(text, { font: HEAD_FONT, size: 16, color: '666666' }), spacing: { before: 40, after: 160 } });

function figure(capture: Capture, caption: string): Paragraph[] {
  const height = Math.round((IMAGE_WIDTH_PX * capture.height) / capture.width);
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 120, after: 60 },
      keepNext: true,
      children: [new ImageRun({ type: 'png', data: capture.data, transformation: { width: IMAGE_WIDTH_PX, height } })],
    }),
    new Paragraph({
      children: runs(caption, { font: HEAD_FONT, size: 17, color: '555555' }),
      spacing: { after: 200 },
    }),
  ];
}

// ── Tabelas ──────────────────────────────────────────────────────────
const BORDER = { style: BorderStyle.SINGLE, size: 4, color: 'C9C6D1' };
const BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };

interface Cell {
  text: string;
  color?: string; // quadradinho colorido antes do texto (identifica o algoritmo)
}

function table(headers: string[], rows: (string | Cell)[][], widths: number[], numeric: Set<number>, size = 18): Table {
  const scale = CONTENT_WIDTH / widths.reduce((a, b) => a + b, 0);
  const cols = widths.map((w) => Math.floor(w * scale));
  cols[cols.length - 1] += CONTENT_WIDTH - cols.reduce((a, b) => a + b, 0);
  const cell = (value: string | Cell, col: number, header: boolean) => {
    const c = typeof value === 'string' ? { text: value } : value;
    const base: IRunOptions = { font: HEAD_FONT, size, bold: header };
    const children = c.color ? [new TextRun({ ...base, text: '■ ', color: c.color }), ...runs(c.text, base)] : runs(c.text, base);
    return new TableCell({
      width: { size: cols[col], type: WidthType.DXA },
      borders: BORDERS,
      shading: header ? { type: ShadingType.CLEAR, color: 'auto', fill: 'ECEAF2' } : undefined,
      margins: { top: 40, bottom: 40, left: 80, right: 80 },
      children: [
        new Paragraph({ alignment: numeric.has(col) ? AlignmentType.RIGHT : AlignmentType.LEFT, children }),
      ],
    });
  };
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: cols,
    rows: [
      new TableRow({ tableHeader: true, children: headers.map((h, i) => cell(h, i, true)) }),
      ...rows.map((row) => new TableRow({ cantSplit: true, children: row.map((v, i) => cell(v, i, false)) })),
    ],
  });
}

const fmt = (n: number, digits: number) =>
  n.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

function benchTable(id: ScenarioId): (Table | Paragraph)[] {
  const scenario = SCENARIOS.find((s) => s.id === id)!;
  const withVariant = scenario.variants.length > 1;
  const headers = [
    ...(withVariant ? [scenario.parameter.replace('Densidade de lama', 'Lama').replace('Tamanho do mapa', 'Mapa')] : []),
    'Algoritmo',
    'Tempo (ms)',
    'p95 (ms)',
    'Nós exp.',
    'Aberta máx.',
    'Custo',
    'Custo ÷ ótimo',
    'Pior razão',
    'Ótimos',
  ];
  const rows = bench.rows
    .filter((r) => r.scenario === id)
    .map((r) => [
      ...(withVariant ? [r.variant] : []),
      { text: ALGOS[r.algo].label, color: seriesColor(r.algo, 'light').slice(1) },
      fmt(r.meanTimeMs, 3),
      fmt(r.p95TimeMs, 3),
      fmt(r.meanExpanded, 0),
      fmt(r.meanMaxOpen, 0),
      fmt(r.meanCost, 1),
      fmt(r.meanRatio, 3),
      fmt(r.maxRatio, 2),
      `${fmt(r.pctOptimal, 1)}%`,
    ]);
  const widths = [...(withVariant ? [9] : []), 26, 9, 9, 9, 9, 8, 10, 9, 9];
  const offset = withVariant ? 2 : 1;
  const numeric = new Set(Array.from({ length: 8 }, (_, k) => k + offset));
  return [
    table(headers, rows, widths, numeric, 16),
    source(`Média de ${bench.options.seeds * bench.options.pairsPerSeed} consultas por linha. Fonte: os autores.`),
  ];
}

// ── Pseudocódigo ─────────────────────────────────────────────────────
const PSEUDOCODE = [
  'função BUSCA_PELA_MELHOR_ESCOLHA(grid, início, objetivo, h, f, relaxar):',
  '    g[início] ← 0;  ABERTA ← heap com {início}',
  '    enquanto ABERTA não estiver vazia:',
  '        n ← retira de ABERTA o nó de menor f   ▹ desempate: menor h, depois ordem de chegada',
  '        se n ∈ FECHADA: continue               ▹ entrada obsoleta ("remoção preguiçosa")',
  '        FECHADA ← FECHADA ∪ {n}',
  '        se n = objetivo: retorne CAMINHO(pai, n), g[n]',
  '        para cada vizinho v de n (N, L, S, O) que não é parede e v ∉ FECHADA:',
  "            g' ← g[n] + custo(v)",
  "            se v nunca foi visto  OU  (relaxar E g' < g[v]):",
  "                g[v] ← g';  pai[v] ← n;  insere v em ABERTA com prioridade f(g', h(v))",
  '    retorne FALHA',
  '',
  'A*     : f = g + h,  relaxar = verdadeiro',
  'Gulosa : f = h,      relaxar = falso      (fica com o primeiro caminho que descobriu)',
];

const codeBlock = () =>
  PSEUDOCODE.map(
    (line, k) =>
      new Paragraph({
        children: [new TextRun({ text: line || ' ', font: 'Consolas', size: 16 })],
        shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F4F3F7' },
        border: { left: { style: BorderStyle.SINGLE, size: 18, color: '2A78D6', space: 6 } },
        spacing: { before: k === 0 ? 120 : 0, after: k === PSEUDOCODE.length - 1 ? 160 : 0, line: 240 },
        indent: { left: 120 },
        keepNext: k < PSEUDOCODE.length - 1,
      }),
  );

const callout = (text: string) =>
  new Paragraph({
    children: runs(text),
    alignment: AlignmentType.JUSTIFIED,
    shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'FDF1EA' },
    border: { left: { style: BorderStyle.SINGLE, size: 18, color: 'EB6834', space: 6 } },
    indent: { left: 120 },
    spacing: { before: 120, after: 160 },
  });

const reference = (text: string) => new Paragraph({ children: runs(text), spacing: { after: 160 } });

// ── Documento ────────────────────────────────────────────────────────
const { charts, heatmaps } = await captureImages();
const comparisonPng = readFileSync(join(here, 'img/fig-comparacao.png'));
const comparison: Capture = { data: comparisonPng, ...pngSize(comparisonPng) };

const { options, environment } = bench;
const queries = options.seeds * options.pairsPerSeed;
const tasks = SCENARIOS.reduce((n, s) => n + s.variants.length * options.seeds, 0);
const date = new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

const center = (text: string, opts: { before?: number; size?: number; bold?: boolean; caps?: boolean; color?: string } = {}) =>
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: opts.before ?? 0, after: 0, line: 360 },
    children: [
      new TextRun({ text, font: HEAD_FONT, size: opts.size ?? 24, bold: opts.bold, allCaps: opts.caps, color: opts.color }),
    ],
  });

const cover = [
  center('Instituto Federal de Educação, Ciência e Tecnologia de Pernambuco', { bold: true, caps: true }),
  center('Campus Garanhuns', { bold: true, caps: true }),
  center('[CURSO]', { bold: true, caps: true }),
  center('Sistemas Inteligentes', { bold: true, caps: true }),
  center('Dynylson Júnior', { before: 2000, caps: true }),
  center('Gabriel de Carvalho', { caps: true }),
  center('Cripta Heurística', { before: 2400, size: 36, bold: true, caps: true }),
  center('Busca Gulosa e A* no planejamento de caminhos de inimigos em um jogo roguelike', { before: 120, size: 26, color: '555555' }),
  new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    indent: { left: Math.round(CONTENT_WIDTH / 2) },
    spacing: { before: 1400, line: 300 },
    children: [
      new TextRun({
        text: 'Relatório técnico do Projeto Prático “Aplicação de Algoritmos de Busca e Otimização”, apresentado à disciplina de Sistemas Inteligentes, sob orientação da Profa. Alessandra.',
        font: HEAD_FONT,
        size: 21,
      }),
    ],
  }),
  center('Garanhuns', { before: 2200 }),
  center(date),
];

const body = [
  h1('1 Introdução e justificativa'),
  p('Encontrar caminhos (⟨pathfinding⟩) é um dos problemas mais clássicos de Inteligência Artificial aplicada a jogos: um personagem controlado pelo computador precisa decidir, a cada momento, por onde andar para alcançar um alvo sem atravessar obstáculos. Em jogos do gênero ⟨roguelike⟩ (exploração de masmorras geradas proceduralmente, em turnos, com morte permanente) o problema é especialmente interessante: o mapa muda a cada partida, não pode ser pré-processado à mão, e vários inimigos replanejam ao mesmo tempo em todo turno, o que torna o custo computacional da busca relevante.'),
  p('Desenvolvemos a ⟦Cripta Heurística⟧, um roguelike para navegador em que dois tipos de inimigos perseguem o jogador usando algoritmos diferentes: o ⟦Zumbi⟧ usa a ⟦Busca Gulosa pela melhor escolha⟧ (⟨Greedy Best-First Search⟩) e o ⟦Caçador⟧ usa o ⟦A*⟧. O terreno tem custo variável (a lama custa 3 vezes mais que o chão), de modo que a diferença entre um caminho que ⟨parece⟩ curto e um caminho que ⟨é⟩ barato aparece na própria jogabilidade: o Zumbi atravessa a lama e se atrasa, enquanto o Caçador contorna. Um modo de depuração mostra, sobre o mapa, os nós expandidos, a fronteira de busca e os valores ⟨g⟩, ⟨h⟩ e ⟨f⟩ de cada célula, e um módulo de benchmark mede o desempenho dos algoritmos em cenários controlados.'),
  p('⟦Fundamentação.⟧ Algoritmos de busca informada escolhem o próximo nó a expandir por uma função de avaliação ⟨f⟩(⟨n⟩) (RUSSELL; NORVIG, 2022). O A* (HART; NILSSON; RAPHAEL, 1968) usa ⟨f⟩ = ⟨g⟩ + ⟨h⟩, em que ⟨g⟩(⟨n⟩) é o custo já percorrido e ⟨h⟩(⟨n⟩) uma estimativa do custo restante. Se ⟨h⟩ nunca superestima (é ⟨admissível⟩), o A* encontra o caminho de custo mínimo; se, além disso, é ⟨consistente⟩, nenhum nó precisa ser reaberto. A Busca Gulosa usa apenas ⟨f⟩ = ⟨h⟩: tende a expandir menos nós, mas não garante otimalidade. Grids 2D são o banco de testes padrão para comparar esses algoritmos (STURTEVANT, 2012), e o material de Patel (2014) foi a principal referência técnica sobre heurísticas em grids e critérios de desempate.'),

  h1('2 Modelagem técnica'),
  h2('2.1 Formulação do problema de busca'),
  bullet('⟦Estado:⟧ uma célula (⟨x⟩, ⟨y⟩) transitável de um grid ⟨L⟩×⟨A⟩, representada pelo índice ⟨i⟩ = ⟨y⟩·⟨L⟩ + ⟨x⟩ (permite usar vetores tipados nos algoritmos).'),
  bullet('⟦Estado inicial:⟧ a posição do monstro. ⟦Teste de objetivo:⟧ ⟨n⟩ é a posição atual do jogador.'),
  bullet('⟦Ações:⟧ mover para Norte, Leste, Sul ou Oeste (4-vizinhança), desde que o destino não seja parede.'),
  bullet("⟦Custo do passo:⟧ ⟨c⟩(⟨n⟩, ⟨n'⟩) é o custo de ⟨entrar⟩ em ⟨n'⟩: chão = 1, lama = 3 (parede = ação inválida). O custo de um caminho é a soma dos passos. No jogo, custo também é tempo: entrar na lama consome 3 turnos."),
  bullet('⟦Replanejamento:⟧ a cada turno, cada monstro acordado executa uma busca completa a partir da sua posição e dá apenas o primeiro passo do caminho, pois o jogador se moveu.'),

  h2('2.2 Heurísticas h(n)'),
  p("Como só existem movimentos ortogonais e o menor custo de passo é 1, qualquer caminho de ⟨n⟩ ao objetivo tem pelo menos |Δ⟨x⟩| + |Δ⟨y⟩| passos de custo ≥ 1; logo a distância de Manhattan nunca superestima o custo real (⟦admissível⟧). Um passo altera a Manhattan em no máximo 1 e custa pelo menos 1, então ⟨h⟩(⟨n⟩) ≤ ⟨c⟩(⟨n⟩, ⟨n'⟩) + ⟨h⟩(⟨n'⟩) (⟦consistente⟧). A Euclidiana é sempre ≤ Manhattan, herda as duas propriedades, mas é ⟨dominada⟩ por ela: é menos informada."),
  tableCaption('Tabela 1 – Heurísticas implementadas'),
  table(
    ['Heurística', 'Fórmula', 'Admissível', 'Consistente', 'Papel no trabalho'],
    [
      ['Manhattan', '|Δx| + |Δy|', 'sim', 'sim', 'Padrão do jogo; exata em sala vazia sem lama'],
      ['Euclidiana', '√(Δx² + Δy²)', 'sim', 'sim', 'Menos informada; mostra o efeito da qualidade de h'],
    ],
    [14, 16, 11, 12, 47],
    new Set(),
  ),
  source('Fonte: os autores.'),
  p('Uma limitação importante: nenhuma dessas heurísticas enxerga a lama. Quanto mais lama existe entre ⟨n⟩ e o objetivo, mais ⟨h⟩ subestima o custo real e menos ela ajuda o A*, efeito medido no Cenário 3.'),

  h2('2.3 Busca Gulosa × A*'),
  p('Os dois algoritmos seguem ⟦o mesmo esquema⟧ de busca pela melhor escolha e diferem em duas escolhas: a prioridade usada na lista aberta e se nós já abertos podem ter ⟨g⟩ melhorado (relaxamento). No código, cada um é uma função própria em `src/core/search.ts` (`greedyBestFirst` e `aStar`):'),
  ...codeBlock(),
  tableCaption('Tabela 2 – Comparação teórica entre os algoritmos'),
  table(
    ['Propriedade', 'Busca Gulosa', 'A*'],
    [
      ['Função de avaliação', 'f(n) = h(n)', 'f(n) = g(n) + h(n)'],
      ['Considera o custo já percorrido / o terreno', 'não', 'sim'],
      ['Completa (grafo finito, com lista fechada)', 'sim', 'sim'],
      ['Ótima', 'não', 'sim, com h consistente (nosso caso)'],
      ['Pior caso (grid com N células, heap binário)', 'O(N log N) tempo, O(N) memória', 'O(N log N) tempo, O(N) memória'],
      ['Comportamento típico', 'poucos nós; "vai reto" na direção do alvo', 'mais nós; caminho de custo mínimo'],
    ],
    [40, 30, 30],
    new Set(),
  ),
  source('Fonte: os autores, com base em Russell e Norvig (2022).'),
  p('A lista aberta é um heap binário mínimo; o desempate pelo menor ⟨h⟩ faz o A* preferir, entre nós com o mesmo ⟨f⟩, os mais próximos do objetivo, o que reduz muito as expansões em grids (PATEL, 2014), e a ordem de inserção torna todo resultado determinístico. Em vez de "diminuir a chave" de um nó, uma nova entrada é inserida e a antiga é descartada ao sair do heap. ⟨g⟩, pai e lista fechada são vetores tipados indexados pela célula.'),

  h2('2.4 Arquitetura e verificação'),
  tableCaption('Tabela 3 – Organização do código (TypeScript, Vite, Canvas 2D, Chart.js, Vitest)'),
  table(
    ['Módulo', 'Responsabilidade'],
    [
      ['`src/core`', 'Espaço de estados (`grid.ts`), heurísticas, heap, Gulosa/A* (`search.ts`), gerador de dungeons e mapa de demonstração. Não depende de interface: o mesmo código roda no jogo, nos testes e no benchmark.'],
      ['`src/game`', 'Regras por turnos, campo de visão, renderização em pixel art (sprites CC0 do pacote Tiny Dungeon, de Kenney) ou em glifos neon, névoa de guerra, modo debug (mapa de calor, replay passo a passo, comparação Gulosa × A* até o cursor) e painel lateral.'],
      ['`src/bench`', 'Cenários, execução e agregação, compartilhados pelo script Node e pela página `/bench`.'],
      ['`tests`', '14 testes automatizados (descritos abaixo).'],
    ],
    [16, 84],
    new Set(),
  ),
  source('Fonte: os autores.'),
  p('O ⟦gerador de dungeons⟧ sorteia salas sem sobreposição, liga todas por uma árvore geradora mínima (Prim), adiciona corredores extras formando ⟦ciclos⟧ e espalha manchas de lama. Os ciclos são essenciais: numa dungeon em árvore só existe uma rota entre dois pontos e A* e Gulosa achariam sempre o mesmo caminho. Tudo usa um gerador pseudoaleatório com ⟨seed⟩ (mulberry32), logo qualquer mapa é reproduzível.'),
  p('A ⟦correção⟧ é verificada com testes de propriedade: em 500 grids aleatórios com paredes e lama, o A* com Manhattan e com Euclidiana encontra ⟦exatamente⟧ o mesmo custo que uma busca exaustiva (que relaxa todas as arestas até nada mudar); a Gulosa sempre encontra caminho quando ele existe, nunca abaixo do ótimo; todo caminho devolvido é válido e tem o custo declarado; e, no total de 300 consultas, a Manhattan expande menos nós que a Euclidiana. Também são testados casos de borda (início = objetivo, objetivo isolado), o heap, a conectividade e o determinismo do gerador, e o mapa de demonstração.'),
  ...figure(
    comparison,
    '⟦Figura 1⟧ – Modo de comparação no mapa de demonstração, do herói (@) até a câmara à esquerda. A Gulosa (amarelo) atravessa o lago de lama: custo 65 com 80 nós expandidos. O A* (ciano) contorna: custo 51 com 158 nós. Os pontos indicam os nós expandidos por cada algoritmo. Fonte: os autores.',
  ),
  ...figure(
    heatmaps,
    '⟦Figura 2⟧ – Mapa de calor da última busca de cada monstro (cor = ordem de expansão, azul → magenta; quadrados laranja = lista aberta). À esquerda, o Zumbi (Gulosa) expande uma faixa estreita e aceita o caminho pela lama; à direita, o Caçador (A*) explora em volta do lago e encontra o caminho de custo mínimo. Fonte: os autores.',
  ),

  h1('3 Resultados e métricas'),
  h2('3.1 Metodologia'),
  p(`Cada configuração (cenário × variante × algoritmo) foi avaliada em ⟦${queries} consultas⟧: ${options.seeds} dungeons com ⟨seeds⟩ fixas × ${options.pairsPerSeed} pares início/objetivo sorteados (distância de Manhattan ≥ (⟨L⟩ + ⟨A⟩)/4). Todos os algoritmos rodam sobre os ⟦mesmos⟧ pares. O custo ótimo de referência é o do A* com Manhattan: como a heurística é admissível, ele sempre encontra o caminho de custo mínimo (seção 2.2), o que os testes conferem contra uma busca exaustiva; por isso a razão do A* com Manhattan é 1,0 por construção. Como uma busca leva microssegundos, cada uma é repetida até somar pelo menos 1 ms e o tempo registrado é a média das repetições, após uma fase de aquecimento do compilador JIT. Métricas: tempo (média e percentil 95), nós expandidos, tamanho máximo da lista aberta (memória), custo do caminho, razão de subotimalidade (custo encontrado ÷ custo ótimo; 1,0 = ótimo) e porcentagem de caminhos ótimos. Ambiente: ${environment.cpu}, Windows 11, Node.js ${environment.node}. O benchmark completo (${tasks} tarefas) levou ${fmt(bench.elapsedS, 0)} s (\`npm run bench\`); as tabelas abaixo são geradas automaticamente a partir de \`results/bench.json\`.`),

  h2('3.2 Cenário 1 – Tamanho do mapa'),
  ...figure(charts[0], '⟦Figura 3⟧ – Cenário 1: Tamanho do mapa. Fonte: os autores.'),
  tableCaption('Tabela 4 – Cenário 1: dungeons de 20×20 a 160×160, 15% de lama'),
  ...benchTable('s1'),
  p('O número de nós expandidos cresce com a área para os dois algoritmos, mas em ritmos diferentes: de 20×20 para 160×160 (64× mais células), o A* passa de 31 para 2.781 nós (≈90×) e a Gulosa de 20 para 513 (≈26×). No maior mapa, a Gulosa expande 5,4× menos nós que o A*, e o tempo acompanha (0,21 ms contra 1,03 ms). Em compensação, a qualidade da Gulosa ⟦piora com o tamanho⟧: a razão média vai de 1,12 para 1,40 e os caminhos ótimos caem de 55% para 0%, porque mapas maiores oferecem mais rotas alternativas e mais chances de a busca se comprometer cedo com uma rota ruim. O pior caso observado chegou a 3,19× o custo ótimo.'),

  h2('3.3 Cenário 2 – Heurísticas'),
  ...figure(charts[1], '⟦Figura 4⟧ – Cenário 2: Heurísticas. Fonte: os autores.'),
  tableCaption('Tabela 5 – Cenário 2: mapa 80×80, 15% de lama'),
  ...benchTable('s2'),
  p('No A*, a heurística muda só o esforço: com a Euclidiana ele expande 947 nós e com a Manhattan 687 (27% menos), os dois com custo ótimo. Como a Manhattan domina a Euclidiana (é sempre maior ou igual e continua admissível), ela descarta mais nós sem perder a otimalidade, o que mostra por que se deve escolher a heurística admissível mais "apertada". Na Gulosa, a heurística muda o próprio caminho, mas nenhuma das duas garante qualidade: com a Euclidiana ela expande 195 nós e fica 29,2% acima do ótimo, com a Manhattan 225 nós e 32,5%, e as duas acertam o ótimo em só 3% das consultas (pior caso de 3,6×). A diferença entre as heurísticas é pequena perto da diferença entre os algoritmos: o que separa a Gulosa do A* é ignorar ⟨g⟩(⟨n⟩). Um detalhe de memória: a Gulosa tem as maiores listas abertas (77 e 78 nós) apesar de expandir menos, porque, guiada só por ⟨h⟩, abre ramos em várias salas sem concluí-los.'),

  h2('3.4 Cenário 3 – Densidade de lama'),
  ...figure(charts[2], '⟦Figura 5⟧ – Cenário 3: Densidade de lama. Fonte: os autores.'),
  tableCaption('Tabela 6 – Cenário 3: mapa 80×80, mesmo layout de salas, 0% a 40% do piso em lama'),
  ...benchTable('s3'),
  callout('⟦A Gulosa é cega ao terreno.⟧ Ela expande exatamente os mesmos 225 nós com 0% ou 40% de lama: como ⟨f⟩ = ⟨h⟩ e ⟨h⟩ ignora a lama, a ordem de expansão não muda em nada. Só o caminho devolvido fica mais caro (razão 1,22 → 1,36; ótimos 9,2% → 1,4%).'),
  p('O A*, ao contrário, reage ao terreno: expande de 481 para 978 nós (≈2×), porque com mais lama a Manhattan subestima mais o custo real e se torna menos informada; em troca, continua devolvendo o caminho ótimo.'),

  h2('3.5 Resultados dentro do jogo'),
  tableCaption('Tabela 7 – Mapa de demonstração: busca do Zumbi, do ponto inicial até o herói'),
  table(
    ['Algoritmo', 'Custo', 'Passos', 'Nós expandidos', 'Lista aberta máx.'],
    [
      ['A* (Manhattan)', '52', '52', '273', '80'],
      ['A* (Euclidiana)', '52', '52', '520', '89'],
      ['Gulosa (Manhattan)', '68', '54', '135', '90'],
      ['Gulosa (Euclidiana)', '76', '62', '110', '81'],
    ],
    [36, 14, 14, 18, 18],
    new Set([1, 2, 3, 4]),
  ),
  source('Fonte: os autores.'),
  p('No mapa de demonstração, a Gulosa expande metade dos nós do A*, mas escolhe um caminho de custo 68 contra 52: ela atravessa 7 células de lama, o que custa ao Zumbi cerca de 16 turnos a mais que o caminho ótimo. Com a Euclidiana ela fica ainda pior aqui (custo 76), embora seja um pouco melhor na média do Cenário 2: na Gulosa, a heurística muda o caminho, mas não há garantia de qualidade. Um teste automatizado garante que essa cena se repete na apresentação. Dentro do jogo, cada busca leva da ordem de décimos de milissegundo no navegador (0,2 ms na Figura 1); mesmo com 8 monstros replanejando a cada turno, o custo da IA fica em poucos milissegundos por turno, imperceptível para o jogador.'),

  h1('4 Conclusão'),
  p('Os experimentos confirmaram a teoria. O A* com heurística consistente sempre encontrou o caminho de custo mínimo (conferido contra uma busca exaustiva nos testes), e a qualidade da heurística determina quantos nós ele expande. A Gulosa expandiu até 5,4 vezes menos nós que o A* (3× no mapa 80×80), mas devolveu caminhos em média 12% a 40% mais caros (até 3,6× no pior caso), e é insensível ao custo do terreno. A escolha depende do objetivo de design: para inimigos "burros", baratos e numerosos, a Gulosa é adequada e até desejável, pois o jogador pode explorar seus erros; para inimigos competentes, o A*.'),
  p('⟦Limitações.⟧'),
  bullet('Movimento só em 4 direções (sem diagonais).'),
  bullet('As heurísticas ignoram a lama, e o A* perde eficiência em terrenos muito heterogêneos.'),
  bullet('Cada monstro refaz a busca inteira a cada turno, sem reaproveitar buscas anteriores.'),
  bullet('Na busca, um monstro não considera os outros; o bloqueio só é tratado na hora de mover.'),
  bullet('O relógio do navegador tem precisão de ~0,1 ms, o que obrigou a repetir as medições.'),
  bullet('Os resultados valem para um único estilo de gerador (salas + corredores).'),
  p('⟦Possíveis melhorias.⟧'),
  bullet('Busca incremental (D* Lite, LPA*), ou um único mapa de distâncias calculado a partir do jogador e compartilhado por todos os monstros: uma busca por turno em vez de uma por monstro.'),
  bullet('A* ponderado (⟨f⟩ = ⟨g⟩ + ⟨w⟩·⟨h⟩, com ⟨w⟩ > 1) como meio-termo ajustável entre a Gulosa e o A*: menos nós, com custo no máximo ⟨w⟩ vezes o ótimo (POHL, 1970).'),
  bullet('⟨Jump Point Search⟩ para trechos de custo uniforme.'),
  bullet('Movimento em 8 direções com heurística octile.'),
  bullet('Heurísticas sensíveis ao terreno, como ⟨landmarks⟩ (ALT).'),
  bullet('Planejamento cooperativo para evitar congestionamento de monstros nos corredores.'),

  h1('Referências'),
  reference('HART, P. E.; NILSSON, N. J.; RAPHAEL, B. A formal basis for the heuristic determination of minimum cost paths. ⟦IEEE Transactions on Systems Science and Cybernetics⟧, v. 4, n. 2, p. 100–107, 1968.'),
  reference('PATEL, A. ⟦Introduction to the A* Algorithm⟧. Red Blob Games, 2014. Disponível em: https://www.redblobgames.com/pathfinding/a-star/introduction.html. Acesso em: out. 2026.'),
  reference('POHL, I. Heuristic search viewed as path finding in a graph. ⟦Artificial Intelligence⟧, v. 1, n. 3–4, p. 193–204, 1970.'),
  reference('RUSSELL, S.; NORVIG, P. ⟦Inteligência Artificial⟧: uma abordagem moderna. 4. ed. Rio de Janeiro: GEN LTC, 2022.'),
  reference('STURTEVANT, N. R. Benchmarks for grid-based pathfinding. ⟦IEEE Transactions on Computational Intelligence and AI in Games⟧, v. 4, n. 2, p. 144–148, 2012.'),
];

const page = { size: { width: 11906, height: 16838 }, margin: MARGIN };

const doc = new Document({
  creator: 'Dynylson Júnior; Gabriel de Carvalho',
  title: 'Cripta Heurística — Relatório Técnico',
  styles: {
    default: { document: { run: { font: BODY_FONT, size: 22 }, paragraph: { spacing: { line: 264 } } } },
    paragraphStyles: [
      {
        id: 'Heading1',
        name: 'Heading 1',
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: { font: HEAD_FONT, size: 28, bold: true, allCaps: true, color: '16151A' },
        paragraph: { spacing: { before: 360, after: 140 }, keepNext: true, outlineLevel: 0 },
      },
      {
        id: 'Heading2',
        name: 'Heading 2',
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: { font: HEAD_FONT, size: 24, bold: true, color: '16151A' },
        paragraph: { spacing: { before: 240, after: 100 }, keepNext: true, outlineLevel: 1 },
      },
    ],
  },
  numbering: {
    config: [
      {
        reference: 'bullets',
        levels: [
          {
            level: 0,
            format: LevelFormat.BULLET,
            text: '•',
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 400, hanging: 260 } } },
          },
        ],
      },
    ],
  },
  sections: [
    { properties: { page }, children: cover },
    {
      properties: { page },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [new TextRun({ children: [PageNumber.CURRENT], font: HEAD_FONT, size: 18, color: '888888' })],
            }),
          ],
        }),
      },
      children: body,
    },
  ],
});

const outPath = join(here, 'Relatorio-Cripta-Heuristica.docx');
writeFileSync(outPath, await Packer.toBuffer(doc));
console.log(`Relatório editável gerado: ${outPath}`);
