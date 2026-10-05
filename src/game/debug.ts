import { HEURISTICS } from '../core/heuristics';
import { ALGORITHM_LABELS, search, type AlgorithmId } from '../core/search';
import { COLORS } from './config';
import type { Game, Monster, SearchSnapshot } from './game';

/**
 * Estado do modo debug (tecla D): qual busca está sendo inspecionada,
 * o replay passo a passo e a comparação Gulosa × A* até o cursor.
 */

export interface FocusedSearch {
  snapshot: SearchSnapshot;
  color: string;
  label: string;
  /** Quantas expansões mostrar (Infinity = a busca inteira). */
  step: number;
}

export interface Replay {
  snapshot: SearchSnapshot;
  color: string;
  label: string;
  step: number;
  playing: boolean;
}

export interface Comparison {
  goal: number;
  greedy: SearchSnapshot;
  astar: SearchSnapshot;
}

export class DebugState {
  enabled = false;
  compareMode = false;
  selectedMonsterId: number | null = null;
  replay: Replay | null = null;
  comparison: Comparison | null = null;
  /** Velocidade do replay, em nós expandidos por segundo. */
  speed = 40;
  private comparisonKey = '';

  selectedMonster(game: Game): Monster | undefined {
    return game.level.monsters.find((m) => m.id === this.selectedMonsterId);
  }

  /** A busca cujo mapa de calor deve ser desenhado agora. */
  focus(game: Game): FocusedSearch | null {
    if (this.replay) {
      const { snapshot, color, label, step } = this.replay;
      return { snapshot, color, label, step: Math.floor(step) };
    }
    const monster = this.selectedMonster(game);
    if (monster?.lastSearch) {
      return { snapshot: monster.lastSearch, color: monster.color, label: describe(monster.name, monster.lastSearch), step: Infinity };
    }
    return null;
  }

  /**
   * Recalcula Gulosa e A* do herói até o tile sob o cursor.
   * Só refaz as buscas quando algo muda; devolve true nesse caso.
   */
  updateComparison(game: Game, tileX: number | null, tileY: number | null): boolean {
    const { grid } = game.level;
    if (!this.compareMode || tileX === null || tileY === null || !grid.inBounds(tileX, tileY)) {
      const changed = this.comparison !== null;
      this.comparison = null;
      this.comparisonKey = '';
      return changed;
    }
    const goal = grid.index(tileX, tileY);
    const start = grid.index(game.player.x, game.player.y);
    const key = `${start}:${goal}:${game.heuristic}:${game.floorIndex}`;
    if (key === this.comparisonKey) return false;
    this.comparisonKey = key;
    if (!grid.isPassable(goal)) {
      this.comparison = null;
      return true;
    }
    const run = (algorithm: AlgorithmId): SearchSnapshot => {
      const t0 = performance.now();
      const result = search(algorithm, grid, start, goal, { heuristic: HEURISTICS[game.heuristic].fn, trace: true });
      return { result, start, goal, algorithm, heuristic: game.heuristic, ms: performance.now() - t0 };
    };
    this.comparison = { goal, greedy: run('greedy'), astar: run('astar') };
    return true;
  }

  /** Inicia o replay da busca em foco (monstro selecionado) ou, na comparação, do algoritmo pedido. */
  startReplay(game: Game, fromComparison?: AlgorithmId): boolean {
    let source: Replay | null = null;
    if (fromComparison && this.comparison) {
      const snapshot = this.comparison[fromComparison];
      source = {
        snapshot,
        color: fromComparison === 'astar' ? COLORS.astar : COLORS.greedy,
        label: describe('Herói → cursor', snapshot),
        step: 0,
        playing: true,
      };
    } else {
      const monster = this.selectedMonster(game);
      if (monster?.lastSearch) {
        source = {
          snapshot: monster.lastSearch,
          color: monster.color,
          label: describe(monster.name, monster.lastSearch),
          step: 0,
          playing: true,
        };
      } else if (this.comparison) {
        return this.startReplay(game, 'astar');
      }
    }
    this.replay = source;
    return source !== null;
  }

  stopReplay(): void {
    this.replay = null;
  }

  update(dt: number): void {
    const replay = this.replay;
    if (!replay || !replay.playing) return;
    replay.step += this.speed * dt;
    const total = replay.snapshot.result.expanded;
    if (replay.step >= total) {
      replay.step = total;
      replay.playing = false;
    }
  }
}

export function describe(who: string, snapshot: SearchSnapshot): string {
  return `${who} · ${ALGORITHM_LABELS[snapshot.algorithm]} (${HEURISTICS[snapshot.heuristic].label})`;
}
