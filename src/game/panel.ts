import { HEURISTICS, HEURISTIC_IDS, type HeuristicId } from '../core/heuristics';
import { ALGORITHM_LABELS, type AlgorithmId } from '../core/search';
import type { DebugState } from './debug';
import type { Game, LogTone, Monster } from './game';

/** Painel lateral (DOM): vida, "mentes" dos monstros, controles de debug e registro. */

export type PanelIcons = Record<'player' | 'zombie' | 'hunter' | 'mud' | 'stairs', string>;

export interface PanelHandlers {
  selectMonster(id: number): void;
  setHeuristic(id: HeuristicId): void;
  toggleReplay(): void;
  restartReplay(): void;
  closeReplay(): void;
  setSpeed(nodesPerSecond: number): void;
  setGodMode(enabled: boolean): void;
  replayComparison(algorithm: AlgorithmId): void;
}

const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export class Panel {
  private readonly runInfo = byId('run-info');
  private readonly hpFill = byId('hp-fill');
  private readonly hpText = byId('hp-text');
  private readonly minds = byId('minds');
  private readonly debugCard = byId('debug-card');
  private readonly heuristic = byId<HTMLSelectElement>('heuristic');
  private readonly focusInfo = byId('focus-info');
  private readonly replay = byId('replay');
  private readonly replayToggle = byId('replay-toggle');
  private readonly replayProgress = byId('replay-progress');
  private readonly replaySpeed = byId<HTMLInputElement>('replay-speed');
  private readonly replaySpeedText = byId('replay-speed-text');
  private readonly compareInfo = byId('compare-info');
  private readonly god = byId<HTMLInputElement>('god');
  private readonly log = byId('log');
  private readonly tooltip = byId('tooltip');
  private readonly banner = byId('banner');
  /** Ícones de sprite (data URLs) quando o visual é pixel art; null no visual neon. */
  private icons: PanelIcons | null = null;

  constructor(handlers: PanelHandlers) {
    HEURISTIC_IDS.forEach((id, k) => {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = `${k + 1} · ${HEURISTICS[id].label}`;
      this.heuristic.append(option);
    });
    this.heuristic.addEventListener('change', () => {
      handlers.setHeuristic(this.heuristic.value as HeuristicId);
      this.heuristic.blur();
    });
    this.replayToggle.addEventListener('click', () => handlers.toggleReplay());
    byId('replay-restart').addEventListener('click', () => handlers.restartReplay());
    byId('replay-close').addEventListener('click', () => handlers.closeReplay());
    this.replaySpeed.addEventListener('input', () => handlers.setSpeed(Number(this.replaySpeed.value)));
    this.god.addEventListener('change', () => {
      handlers.setGodMode(this.god.checked);
      this.god.blur();
    });
    this.minds.addEventListener('click', (e) => {
      const item = (e.target as HTMLElement).closest<HTMLElement>('li[data-id]');
      if (item) handlers.selectMonster(Number(item.dataset.id));
    });
    this.compareInfo.addEventListener('click', (e) => {
      const button = (e.target as HTMLElement).closest<HTMLElement>('button[data-replay]');
      if (button) handlers.replayComparison(button.dataset.replay as AlgorithmId);
    });
  }

  /** Troca os glifos da legenda e da lista de monstros por ícones de sprite (ou volta aos glifos). */
  setIcons(icons: PanelIcons | null): void {
    this.icons = icons;
    document.querySelectorAll<HTMLElement>('.legend b[data-icon]').forEach((el) => {
      el.dataset.glyph ??= el.textContent ?? '';
      const src = icons?.[el.dataset.icon as keyof PanelIcons];
      if (src) el.innerHTML = `<img class="sprite" src="${src}" alt="" />`;
      else el.textContent = el.dataset.glyph;
    });
  }

  addLog(text: string, tone: LogTone): void {
    const item = document.createElement('li');
    item.className = tone;
    item.textContent = text;
    this.log.prepend(item);
    while (this.log.children.length > 40) this.log.lastElementChild!.remove();
  }

  clearLog(): void {
    this.log.replaceChildren();
  }

  showBanner(text: string): void {
    this.banner.textContent = text;
    this.banner.classList.remove('show');
    void this.banner.offsetWidth; // reinicia a animação CSS
    this.banner.classList.add('show');
  }

  showTooltip(x: number, y: number, html: string): void {
    this.tooltip.innerHTML = html;
    this.tooltip.hidden = false;
    this.tooltip.style.left = `${x + 16}px`;
    this.tooltip.style.top = `${y + 16}px`;
  }

  hideTooltip(): void {
    this.tooltip.hidden = true;
  }

  update(game: Game, debug: DebugState): void {
    const { player, stats } = game;
    this.runInfo.textContent =
      game.mode === 'demo'
        ? `Mapa de demonstração · Turno ${stats.turns}`
        : `Andar ${game.floorIndex + 1}/${game.floorCount} · Turno ${stats.turns} · Seed ${game.seed}`;
    const hp = Math.max(0, player.hp);
    this.hpFill.style.width = `${(100 * hp) / player.maxHp}%`;
    this.hpText.textContent = `${hp}/${player.maxHp}${game.godMode ? ' ∞' : ''}`;

    this.renderMinds(game, debug);

    this.debugCard.hidden = !debug.enabled;
    if (!debug.enabled) return;
    this.heuristic.value = game.heuristic;
    this.god.checked = game.godMode;
    this.renderFocus(game, debug);
    this.renderComparison(debug);
    this.updateReplay(debug);
  }

  /** Atualização leve, chamada a cada quadro durante o replay. */
  updateReplay(debug: DebugState): void {
    const replay = debug.replay;
    this.replay.hidden = !replay;
    this.replaySpeedText.textContent = `${debug.speed} nós/s`;
    if (Number(this.replaySpeed.value) !== debug.speed) this.replaySpeed.value = String(debug.speed);
    if (!replay) return;
    const total = replay.snapshot.result.expanded;
    this.replayProgress.textContent = `passo ${Math.floor(replay.step)}/${total}`;
    this.replayToggle.textContent = replay.playing ? '⏸' : '▶';
  }

  private renderMinds(game: Game, debug: DebugState): void {
    const { player } = game;
    const watched = game.level.monsters
      .filter((m) => m.awake && (debug.enabled || game.isVisible(m.x, m.y)))
      .sort((a, b) => distance(a, player) - distance(b, player));

    if (watched.length === 0) {
      this.minds.innerHTML = '<li class="empty">Nenhum monstro te viu ainda.</li>';
      return;
    }
    this.minds.innerHTML = watched
      .map((m) => {
        const search = m.lastSearch?.result;
        const stats = m.stuck
          ? `atolado na lama (${m.stuck})`
          : search
            ? `${search.expanded} nós · custo ${format(search.cost)} · ${search.path.length - 1} passos`
            : 'acabou de te ver…';
        const selected = debug.enabled && debug.selectedMonsterId === m.id ? ' selected' : '';
        return `<li data-id="${m.id}" class="${selected}" style="color:${m.color}">
          <span class="glyph">${this.icons ? `<img class="sprite" src="${this.icons[m.kind]}" alt="" />` : m.glyph}</span>
          <span class="who">${m.name} #${m.id}</span>
          <span class="algo">${ALGORITHM_LABELS[m.algorithm]}</span>
          <span class="stats">${stats}</span>
        </li>`;
      })
      .join('');
  }

  private renderFocus(game: Game, debug: DebugState): void {
    const focus = debug.focus(game);
    if (!focus) {
      this.focusInfo.innerHTML = `<p class="hint">Clique em um monstro (no mapa ou na lista) para ver a busca dele.
        <kbd>R</kbd> reproduz a busca passo a passo.</p>`;
      return;
    }
    const { result, ms } = focus.snapshot;
    this.focusInfo.innerHTML = `
      <p class="label" style="color:${focus.color}">${focus.label}</p>
      <dl class="stat-grid">
        <dt>Nós expandidos</dt><dd>${result.expanded}</dd>
        <dt>Lista aberta (máx.)</dt><dd>${result.maxOpen}</dd>
        <dt>Custo do caminho</dt><dd>${format(result.cost)}</dd>
        <dt>Passos</dt><dd>${Math.max(0, result.path.length - 1)}</dd>
        <dt>Tempo</dt><dd>${formatMs(ms)}</dd>
      </dl>`;
  }

  private renderComparison(debug: DebugState): void {
    if (!debug.compareMode) {
      this.compareInfo.innerHTML = `<p class="hint"><kbd>C</kbd> compara <span class="c-greedy">Gulosa</span> ×
        <span class="c-astar">A*</span> do herói até o cursor.</p>`;
      return;
    }
    const cmp = debug.comparison;
    if (!cmp) {
      this.compareInfo.innerHTML = '<p class="hint">Comparação ligada: passe o mouse sobre um tile do mapa.</p>';
      return;
    }
    const g = cmp.greedy;
    const a = cmp.astar;
    const row = (label: string, cls: string, s: typeof g) =>
      `<tr><td class="${cls}">${label}</td><td>${format(s.result.cost)}</td><td>${Math.max(0, s.result.path.length - 1)}</td><td>${s.result.expanded}</td><td>${formatMs(s.ms, false)}</td></tr>`;
    let verdict: string;
    if (!a.result.found) verdict = 'Sem caminho até esse tile.';
    else if (g.result.cost > a.result.cost) {
      const pct = Math.round((100 * (g.result.cost - a.result.cost)) / a.result.cost);
      verdict = `A <span class="c-greedy">Gulosa</span> achou um caminho <b>${pct}% mais caro</b>.`;
    } else verdict = 'Aqui a Gulosa acertou o caminho ótimo.';
    this.compareInfo.innerHTML = `
      <table>
        <thead><tr><th></th><th>custo</th><th>passos</th><th>nós</th><th>tempo</th></tr></thead>
        <tbody>${row('Gulosa', 'c-greedy', g)}${row('A*', 'c-astar', a)}</tbody>
      </table>
      <p class="verdict">${verdict}</p>
      <div class="actions">
        <button type="button" data-replay="astar">Replay A*</button>
        <button type="button" data-replay="greedy">Replay Gulosa</button>
      </div>`;
  }
}

function distance(a: Monster, b: { x: number; y: number }): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/** O relógio do navegador tem resolução de ~0,1 ms; abaixo disso mostramos só o limite. */
function formatMs(ms: number, unit = true): string {
  const text = ms < 0.1 ? '<0,1' : ms.toFixed(2).replace('.', ',');
  return unit ? `${text} ms` : text;
}

function format(n: number): string {
  return Number.isFinite(n) ? String(n) : '∞';
}
