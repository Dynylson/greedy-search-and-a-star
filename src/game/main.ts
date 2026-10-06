import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import '@fontsource/jetbrains-mono/800.css';
import '@fontsource/press-start-2p/400.css';
import '../styles/base.css';
import '../styles/game.css';

import { TILE } from '../core/grid';
import { HEURISTICS, HEURISTIC_IDS, type HeuristicId } from '../core/heuristics';
import { randomSeed, seedFromText } from '../core/rng';
import { NEVER, type AlgorithmId } from '../core/search';
import { DebugState } from './debug';
import { Effects } from './effects';
import { Game, type GameEvent, type GameMode, type GameStatus } from './game';
import { Panel, type PanelIcons } from './panel';
import { Renderer, type VisualTheme } from './renderer';
import { loadSpriteSheet, SPRITES, type SpriteSheet } from './sprites';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const menu = document.getElementById('menu')!;
const endScreen = document.getElementById('end')!;
const seedInput = document.getElementById('seed-input') as HTMLInputElement;
const themeButton = document.getElementById('btn-theme') as HTMLButtonElement;
const THEME_KEY = 'cripta-heuristica:visual';

const DIRECTIONS: Record<string, [number, number]> = {
  arrowup: [0, -1],
  w: [0, -1],
  arrowdown: [0, 1],
  s: [0, 1],
  arrowleft: [-1, 0],
  a: [-1, 0],
  arrowright: [1, 0],
  d: [1, 0],
};

const renderer = new Renderer(canvas);
const effects = new Effects();
let debug = new DebugState();
let game: Game | null = null;
let mouse: { x: number; y: number } | null = null;
let hover: { x: number; y: number } | null = null;
let walkQueue: number[] = [];
let walkTimer = 0;
let walkPreview: number[] | null = null;
let previewKey = '';
let dirty = true;
let sprites: SpriteSheet | null = null;
let icons: PanelIcons | null = null;

const panel = new Panel({
  selectMonster: (id) => selectMonster(id),
  setHeuristic: (id) => setHeuristic(id),
  toggleReplay: () => toggleReplayPlayback(),
  restartReplay: () => restartReplay(),
  closeReplay: () => {
    debug.stopReplay();
    dirty = true;
  },
  setSpeed: (value) => {
    debug.speed = value;
    dirty = true;
  },
  setGodMode: (enabled) => {
    if (game) game.godMode = enabled;
    dirty = true;
  },
  replayComparison: (algorithm) => startReplay(algorithm),
});

// ── Partida ───────────────────────────────────────────────────────────

function startGame(mode: GameMode, seed: number): void {
  game = new Game(mode, seed);
  debug = new DebugState();
  debug.enabled = mode === 'demo'; // na demonstração o "cérebro" dos monstros já aparece
  effects.clear();
  panel.clearLog();
  cancelWalk();
  game.on(handleEvent);
  game.start();
  menu.hidden = true;
  endScreen.hidden = true;
  dirty = true;
}

function handleEvent(event: GameEvent): void {
  if (!game) return;
  switch (event.type) {
    case 'log':
      panel.addLog(event.text, event.tone);
      break;
    case 'hit': {
      const pos = renderer.visualOf(event.target);
      const isPlayer = event.target === game.player;
      renderer.flash(event.target.id);
      effects.burst(pos.x, pos.y, isPlayer ? '#ff4f86' : event.target.color, 12, 5);
      effects.floatText(pos.x, pos.y, event.amount ? `-${event.amount}` : '0', isPlayer ? '#ff7aa2' : '#ffffff');
      if (isPlayer && event.amount > 0) effects.addShake(9);
      break;
    }
    case 'death': {
      const pos = renderer.visualOf(event.entity);
      effects.burst(pos.x, pos.y, event.entity.color, 40, 8);
      effects.addShake(5);
      if (debug.selectedMonsterId === event.entity.id) debug.selectedMonsterId = null;
      break;
    }
    case 'level':
      renderer.resetLevel();
      effects.clear();
      debug.selectedMonsterId = null;
      debug.stopReplay();
      cancelWalk();
      panel.showBanner(game.mode === 'demo' ? 'DEMONSTRAÇÃO' : `ANDAR ${game.floorIndex + 1}`);
      break;
    case 'end':
      cancelWalk();
      window.setTimeout(() => showEnd(event.status), 1100);
      break;
  }
  dirty = true;
}

function showEnd(status: GameStatus): void {
  if (!game) return;
  const title = document.getElementById('end-title')!;
  title.textContent = status === 'won' ? 'Você escapou!' : 'Você morreu';
  title.style.color = status === 'won' ? 'var(--gold)' : 'var(--pink)';
  const s = game.stats;
  const rows: [string, string | number][] = [
    ['Andar', `${game.floorIndex + 1}/${game.floorCount}`],
    ['Turnos', s.turns],
    ['Monstros destruídos', s.kills],
    ['Buscas feitas pelos monstros', s.searches],
    ['Nós expandidos (total)', s.nodesExpanded.toLocaleString('pt-BR')],
    ['Seed', game.mode === 'demo' ? 'demonstração' : game.seed],
  ];
  document.getElementById('end-stats')!.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  endScreen.hidden = false;
  (document.getElementById('btn-same') as HTMLButtonElement).focus();
}

function showMenu(): void {
  cancelWalk();
  menu.hidden = false;
  endScreen.hidden = true;
  (document.getElementById('btn-run') as HTMLButtonElement).focus();
}

// ── Visual (pixel art × neon) ─────────────────────────────────────────

function applyTheme(theme: VisualTheme): void {
  renderer.setTheme(theme, sprites);
  const active = renderer.visualTheme;
  panel.setIcons(active === 'pixel' ? icons : null);
  themeButton.textContent = `Visual: ${active === 'pixel' ? 'pixel art' : 'neon'}`;
  try {
    localStorage.setItem(THEME_KEY, active);
  } catch {
    // Armazenamento indisponível (aba anônima etc.): só não lembra a escolha.
  }
  dirty = true;
}

function toggleTheme(): void {
  applyTheme(renderer.visualTheme === 'pixel' ? 'neon' : 'pixel');
}

function savedTheme(): VisualTheme {
  try {
    return localStorage.getItem(THEME_KEY) === 'neon' ? 'neon' : 'pixel';
  } catch {
    return 'pixel';
  }
}

// ── Ações ─────────────────────────────────────────────────────────────

function act(action: () => unknown): void {
  action();
  previewKey = '';
  dirty = true;
}

function selectMonster(id: number): void {
  debug.enabled = true;
  debug.selectedMonsterId = id;
  debug.stopReplay();
  dirty = true;
}

function setHeuristic(id: HeuristicId): void {
  if (!game) return;
  game.heuristic = id;
  panel.addLog(`Heurística dos monstros: ${HEURISTICS[id].label}.`, 'info');
  previewKey = '';
  dirty = true;
}

function toggleDebug(): void {
  debug.enabled = !debug.enabled;
  if (!debug.enabled) {
    debug.compareMode = false;
    debug.selectedMonsterId = null;
    debug.stopReplay();
  }
  dirty = true;
}

function toggleCompare(): void {
  debug.compareMode = !debug.compareMode;
  if (debug.compareMode) debug.enabled = true;
  dirty = true;
}

function startReplay(fromComparison?: AlgorithmId): void {
  if (!game) return;
  debug.enabled = true;
  if (!debug.startReplay(game, fromComparison)) {
    panel.addLog('Para o replay, selecione um monstro (clique nele) ou ligue a comparação (C).', 'warn');
  }
  dirty = true;
}

function restartReplay(): void {
  if (debug.replay) {
    debug.replay.step = 0;
    debug.replay.playing = true;
  } else {
    startReplay();
  }
  dirty = true;
}

function toggleReplayPlayback(): void {
  const replay = debug.replay;
  if (!replay) return;
  if (!replay.playing && replay.step >= replay.snapshot.result.expanded) replay.step = 0;
  replay.playing = !replay.playing;
  dirty = true;
}

// ── Clique-para-andar ─────────────────────────────────────────────────

function cancelWalk(): void {
  walkQueue = [];
}

function visibleThreats(g: Game): number {
  return g.level.monsters.filter((m) => m.awake && g.isVisible(m.x, m.y)).length;
}

function tickWalk(dt: number): void {
  if (!game || walkQueue.length === 0) return;
  walkTimer -= dt;
  if (walkTimer > 0) return;
  walkTimer = 0.085;

  const { grid } = game.level;
  const next = walkQueue.shift()!;
  const dx = grid.xOf(next) - game.player.x;
  const dy = grid.yOf(next) - game.player.y;
  if (Math.abs(dx) + Math.abs(dy) !== 1 || game.monsterAt(grid.xOf(next), grid.yOf(next))) {
    cancelWalk();
    return;
  }
  const before = { hp: game.player.hp, threats: visibleThreats(game), floor: game.floorIndex };
  act(() => game!.move(dx, dy));
  const interrupted =
    game.player.hp < before.hp ||
    visibleThreats(game) > before.threats ||
    game.floorIndex !== before.floor ||
    game.status !== 'playing';
  if (interrupted) cancelWalk();
}

function updateWalkPreview(): void {
  if (!game || !hover || debug.enabled) {
    walkPreview = null;
    previewKey = '';
    return;
  }
  const key = `${hover.x},${hover.y},${game.player.x},${game.player.y},${game.floorIndex},${game.heuristic}`;
  if (key === previewKey) return;
  previewKey = key;
  walkPreview = game.planPlayerPath(hover.x, hover.y)?.path ?? null;
}

// ── Tooltip g/h/f do modo debug ───────────────────────────────────────

function updateTooltip(): void {
  if (!game || !hover || !mouse || !debug.enabled || !game.level.grid.inBounds(hover.x, hover.y)) {
    panel.hideTooltip();
    return;
  }
  const { grid } = game.level;
  const i = grid.index(hover.x, hover.y);
  const tile = grid.tiles[i];
  const terrain = tile === TILE.WALL ? 'parede' : tile === TILE.MUD ? 'lama · custo 3' : 'chão · custo 1';
  let html = `(${hover.x}, ${hover.y}) · ${terrain}`;

  const focus = debug.focus(game);
  const trace = focus?.snapshot.result.trace;
  if (focus && trace && tile !== TILE.WALL) {
    const { snapshot } = focus;
    const goalX = grid.xOf(snapshot.goal);
    const goalY = grid.yOf(snapshot.goal);
    const h = HEURISTICS[snapshot.heuristic].fn(hover.x, hover.y, goalX, goalY);
    const g = trace.g[i];
    const limit = Math.min(focus.step, snapshot.result.expanded);
    const expandedAt = trace.expandedAt[i];
    const discoveredAt = trace.discoveredAt[i];
    const seen = discoveredAt !== NEVER && discoveredAt < limit;
    if (seen && Number.isFinite(g)) {
      const f = snapshot.algorithm === 'astar' ? g + h : h;
      html += `<br><b>g</b> = ${round(g)} · <b>h</b> = ${round(h)} · <b>f</b> = ${round(f)}`;
      html +=
        expandedAt < limit
          ? `<br>expandido no passo ${expandedAt + 1}`
          : '<br><span style="color:#ffb347">na lista aberta (fronteira)</span>';
    } else {
      html += `<br><b>h</b> = ${round(h)} · não visitado`;
    }
  }
  panel.showTooltip(mouse.x, mouse.y, html);
}

function round(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

// ── Entrada ───────────────────────────────────────────────────────────

window.addEventListener('keydown', (e) => {
  if (!menu.hidden || !endScreen.hidden || !game) return;
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const g = game;
  const dir = DIRECTIONS[e.key.toLowerCase()];
  if (dir) {
    e.preventDefault();
    cancelWalk();
    act(() => g.move(dir[0], dir[1]));
    return;
  }
  switch (e.key) {
    case ' ':
    case '.':
      e.preventDefault();
      cancelWalk();
      act(() => g.wait());
      break;
    case 'm':
    case 'M':
    case 'Tab':
      e.preventDefault();
      toggleDebug();
      break;
    case 'c':
    case 'C':
      toggleCompare();
      break;
    case 'r':
      if (debug.replay) restartReplay();
      else startReplay();
      break;
    case 'R':
      startReplay('greedy');
      break;
    case 'p':
    case 'P':
      toggleReplayPlayback();
      break;
    case 'v':
    case 'V':
      toggleTheme();
      break;
    case 'i':
    case 'I':
      g.godMode = !g.godMode;
      panel.addLog(g.godMode ? 'Invulnerabilidade ligada.' : 'Invulnerabilidade desligada.', 'warn');
      dirty = true;
      break;
    case '1':
    case '2':
      setHeuristic(HEURISTIC_IDS[Number(e.key) - 1]);
      break;
    case 'Escape':
      if (debug.replay) debug.stopReplay();
      else if (debug.compareMode) debug.compareMode = false;
      else showMenu();
      dirty = true;
      break;
  }
});

canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  mouse = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  dirty = true;
});

canvas.addEventListener('mouseleave', () => {
  mouse = null;
  hover = null;
  dirty = true;
});

canvas.addEventListener('click', () => {
  if (!game || !hover || !menu.hidden || !endScreen.hidden) return;
  const monster = game.monsterAt(hover.x, hover.y);
  if (monster && (debug.enabled || game.isVisible(monster.x, monster.y))) {
    selectMonster(monster.id);
    return;
  }
  const plan = game.planPlayerPath(hover.x, hover.y);
  if (plan && plan.path.length > 1) {
    walkQueue = plan.path.slice(1);
    walkTimer = 0;
  }
});

document.getElementById('btn-run')!.addEventListener('click', () => {
  const text = seedInput.value.trim();
  startGame('run', text ? seedFromText(text) : randomSeed());
});
document.getElementById('btn-demo')!.addEventListener('click', () => startGame('demo', 0));
document.getElementById('btn-same')!.addEventListener('click', () => game && startGame(game.mode, game.seed));
document.getElementById('btn-new')!.addEventListener('click', () => startGame('run', randomSeed()));
document.getElementById('btn-menu')!.addEventListener('click', () => showMenu());
themeButton.addEventListener('click', () => toggleTheme());
seedInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-run')!.click();
});
window.addEventListener('resize', () => renderer.resize());

// ── Laço principal ────────────────────────────────────────────────────

let last = performance.now();

function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (game) {
    if (mouse) {
      const tile = renderer.screenToTile(mouse.x, mouse.y);
      if (!hover || tile.x !== hover.x || tile.y !== hover.y) {
        hover = tile;
        dirty = true;
      }
    }
    tickWalk(dt);
    effects.update(dt);
    debug.update(dt);
    if (debug.updateComparison(game, hover?.x ?? null, hover?.y ?? null)) dirty = true;
    updateWalkPreview();
    renderer.render({ game, debug, effects, hover, walkPreview, time: now / 1000, dt });
    if (dirty) {
      panel.update(game, debug);
      updateTooltip();
      dirty = false;
    } else if (debug.replay) {
      panel.updateReplay(debug);
      updateTooltip();
    }
  }
  requestAnimationFrame(frame);
}

async function boot(): Promise<void> {
  // O canvas não dispara o carregamento das fontes sozinho: carregamos antes de desenhar.
  await Promise.all(
    ['400 16px "JetBrains Mono"', '600 16px "JetBrains Mono"', '800 16px "JetBrains Mono"', '16px "Press Start 2P"'].map(
      (font) => document.fonts.load(font).catch(() => undefined),
    ),
  );
  sprites = await loadSpriteSheet().catch(() => null);
  if (sprites) {
    icons = {
      player: sprites.icon(SPRITES.hero),
      zombie: sprites.icon(SPRITES.zombie),
      hunter: sprites.icon(SPRITES.hunter),
      mud: sprites.icon(SPRITES.mud[0]),
      stairs: sprites.icon(SPRITES.stairs),
    };
  }
  applyTheme(savedTheme());
  // Atrás do menu fica o mapa de demonstração, só como cenário.
  game = new Game('demo', 0);
  game.start();
  panel.clearLog();
  renderer.resize();
  requestAnimationFrame(frame);
  showMenu();
  // Gancho só de desenvolvimento: usado pelos scripts que tiram as capturas de tela do relatório.
  if (import.meta.env.DEV) Object.assign(window, { __cripta: { renderer, game: () => game } });
}

void boot();
