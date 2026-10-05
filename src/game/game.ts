import { DEMO_MAP, findMarkers } from '../core/demoMap';
import { generateDungeon, roomCenter, type Room } from '../core/dungeon';
import { Grid, TILE, type Point } from '../core/grid';
import { HEURISTICS, type HeuristicId } from '../core/heuristics';
import { hashSeed, mulberry32, randInt, shuffle, type Rng } from '../core/rng';
import { aStar, search, type AlgorithmId, type SearchResult } from '../core/search';
import {
  FLOORS,
  MIN_SPAWN_DISTANCE,
  MONSTERS,
  PLAYER,
  STAIRS_HEAL,
  VIEW_RADIUS,
  type FloorConfig,
  type MonsterKind,
} from './config';
import { computeFov } from './fov';

/**
 * Regras do jogo (sem nenhuma dependência de tela).
 *
 * O jogo é por turnos: cada ação do herói custa o custo do tile em que ele entra
 * (chão = 1 turno, lama = 3 turnos). Em cada turno, todo monstro acordado
 * recalcula o caminho até o herói com o SEU algoritmo e dá um passo.
 */

export interface Entity {
  id: number;
  name: string;
  glyph: string;
  color: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  damage: [number, number];
}

/** Uma busca feita no jogo, com o contexto necessário para desenhá-la no modo debug. */
export interface SearchSnapshot {
  result: SearchResult;
  start: number;
  goal: number;
  algorithm: AlgorithmId;
  heuristic: HeuristicId;
  ms: number;
}

export interface Monster extends Entity {
  kind: MonsterKind;
  algorithm: AlgorithmId;
  awake: boolean;
  /** Turnos que ainda vai passar atolado na lama. */
  stuck: number;
  lastSearch: SearchSnapshot | null;
}

export interface Level {
  grid: Grid;
  rooms: Room[];
  stairs: Point | null;
  monsters: Monster[];
  visible: Uint8Array;
  explored: Uint8Array;
}

export type GameMode = 'run' | 'demo';
export type GameStatus = 'playing' | 'dead' | 'won';
export type LogTone = 'info' | 'danger' | 'good' | 'warn';

export type GameEvent =
  | { type: 'log'; text: string; tone: LogTone }
  | { type: 'hit'; target: Entity; amount: number }
  | { type: 'death'; entity: Entity }
  | { type: 'level' }
  | { type: 'end'; status: GameStatus };

export class Game {
  floorIndex = 0;
  level!: Level;
  status: GameStatus = 'playing';
  heuristic: HeuristicId = 'manhattan';
  godMode = false;
  readonly player: Entity;
  readonly stats = { turns: 0, kills: 0, searches: 0, nodesExpanded: 0 };

  private readonly rng: Rng;
  private nextId = 1;
  private readonly listeners = new Set<(event: GameEvent) => void>();

  constructor(
    readonly mode: GameMode,
    readonly seed: number,
  ) {
    this.rng = mulberry32(hashSeed(seed, 0xc0ffee));
    this.player = {
      id: 0,
      name: PLAYER.name,
      glyph: PLAYER.glyph,
      color: PLAYER.color,
      x: 0,
      y: 0,
      hp: PLAYER.hp,
      maxHp: PLAYER.hp,
      damage: PLAYER.damage,
    };
  }

  /** Separado do construtor para que a interface possa ouvir os eventos do primeiro andar. */
  start(): void {
    this.buildLevel();
    this.log(
      this.mode === 'demo'
        ? 'Mapa de demonstração: o Zumbi pensa com a Busca Gulosa, o Caçador com A*.'
        : 'Você desperta na cripta. Encontre a escada (>) e desça 3 andares.',
      'info',
    );
  }

  on(listener: (event: GameEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get floorCount(): number {
    return this.mode === 'demo' ? 1 : FLOORS.length;
  }

  // ── Ações do herói ────────────────────────────────────────────────

  /** Move (ou ataca, se houver monstro) na direção dada. Devolve true se gastou turno. */
  move(dx: number, dy: number): boolean {
    if (this.status !== 'playing') return false;
    const { grid } = this.level;
    const nx = this.player.x + dx;
    const ny = this.player.y + dy;
    if (!grid.inBounds(nx, ny) || grid.get(nx, ny) === TILE.WALL) return false;

    const target = this.monsterAt(nx, ny);
    if (target) {
      this.attack(this.player, target);
      this.endTurn(1);
      return true;
    }

    this.player.x = nx;
    this.player.y = ny;
    if (this.isStairs(nx, ny)) {
      this.descend();
      return true;
    }
    const cost = grid.costOf(grid.index(nx, ny));
    if (cost > 1) this.log(`Você atola na lama... (+${cost - 1} turnos)`, 'warn');
    this.endTurn(cost);
    return true;
  }

  wait(): void {
    if (this.status === 'playing') this.endTurn(1);
  }

  /** Caminho A* do herói até um tile já explorado (clique-para-andar). */
  planPlayerPath(x: number, y: number): SearchResult | null {
    const { grid, explored } = this.level;
    if (!grid.inBounds(x, y)) return null;
    const goal = grid.index(x, y);
    if (!explored[goal] || !grid.isPassable(goal)) return null;
    const start = grid.index(this.player.x, this.player.y);
    const result = aStar(grid, start, goal, { heuristic: HEURISTICS[this.heuristic].fn });
    return result.found ? result : null;
  }

  // ── Consultas ─────────────────────────────────────────────────────

  monsterAt(x: number, y: number): Monster | undefined {
    return this.level.monsters.find((m) => m.x === x && m.y === y);
  }

  isStairs(x: number, y: number): boolean {
    const { stairs } = this.level;
    return stairs !== null && stairs.x === x && stairs.y === y;
  }

  isVisible(x: number, y: number): boolean {
    return this.level.visible[this.level.grid.index(x, y)] === 1;
  }

  // ── Turno dos monstros ────────────────────────────────────────────

  private endTurn(timeCost: number): void {
    this.updateFov();
    for (let t = 0; t < timeCost && this.status === 'playing'; t++) {
      this.stats.turns++;
      for (const monster of [...this.level.monsters]) {
        if (this.status !== 'playing') break;
        this.monsterAct(monster);
      }
    }
  }

  private monsterAct(m: Monster): void {
    const { grid } = this.level;
    if (!m.awake) {
      if (!this.isVisible(m.x, m.y)) return;
      m.awake = true;
      this.log(`${m.name} percebeu você!`, 'danger');
      return;
    }
    if (m.stuck > 0) {
      m.stuck--;
      return;
    }

    const p = this.player;
    if (Math.abs(m.x - p.x) + Math.abs(m.y - p.y) === 1) {
      this.attack(m, p);
      return;
    }

    // A "mente" do monstro: replaneja o caminho inteiro a cada turno.
    const start = grid.index(m.x, m.y);
    const goal = grid.index(p.x, p.y);
    const t0 = performance.now();
    const result = search(m.algorithm, grid, start, goal, {
      heuristic: HEURISTICS[this.heuristic].fn,
      trace: true,
    });
    const ms = performance.now() - t0;
    m.lastSearch = { result, start, goal, algorithm: m.algorithm, heuristic: this.heuristic, ms };
    this.stats.searches++;
    this.stats.nodesExpanded += result.expanded;

    if (!result.found || result.path.length < 2) return;
    const next = result.path[1];
    const nx = grid.xOf(next);
    const ny = grid.yOf(next);
    if (this.monsterAt(nx, ny)) return; // outro monstro bloqueando: espera a vez
    m.x = nx;
    m.y = ny;
    m.stuck = grid.costOf(next) - 1;
  }

  private attack(attacker: Entity, defender: Entity): void {
    const amount = randInt(this.rng, attacker.damage[0], attacker.damage[1]);
    const shielded = defender === this.player && this.godMode;
    if (!shielded) defender.hp -= amount;
    this.emit({ type: 'hit', target: defender, amount: shielded ? 0 : amount });

    if (attacker === this.player) this.log(`Você acerta o ${defender.name} (−${amount}).`, 'info');
    else this.log(`O ${attacker.name} te acerta (−${shielded ? 0 : amount}).`, 'danger');

    if (defender.hp > 0) return;
    this.emit({ type: 'death', entity: defender });
    if (defender === this.player) {
      this.status = 'dead';
      this.log('Você morreu na cripta.', 'danger');
      this.emit({ type: 'end', status: 'dead' });
    } else {
      this.stats.kills++;
      this.level.monsters = this.level.monsters.filter((m) => m !== defender);
      this.log(`O ${defender.name} virou pó.`, 'good');
    }
  }

  private descend(): void {
    if (this.floorIndex >= FLOORS.length - 1) {
      this.status = 'won';
      this.log('Você escapou da Cripta Heurística!', 'good');
      this.emit({ type: 'end', status: 'won' });
      return;
    }
    this.floorIndex++;
    const heal = Math.round(this.player.maxHp * STAIRS_HEAL);
    this.player.hp = Math.min(this.player.maxHp, this.player.hp + heal);
    this.buildLevel();
    this.log(`Você desce para o andar ${this.floorIndex + 1} (+${heal} PV).`, 'good');
  }

  private updateFov(): void {
    const { grid, visible, explored } = this.level;
    computeFov(grid, this.player.x, this.player.y, VIEW_RADIUS, visible, explored);
  }

  // ── Construção dos andares ────────────────────────────────────────

  private buildLevel(): void {
    this.level = this.mode === 'demo' ? this.buildDemoLevel() : this.buildRunLevel(FLOORS[this.floorIndex]);
    this.updateFov();
    this.emit({ type: 'level' });
  }

  private buildRunLevel(config: FloorConfig): Level {
    const levelSeed = hashSeed(this.seed, this.floorIndex + 1);
    const { grid, rooms } = generateDungeon({
      width: config.width,
      height: config.height,
      seed: levelSeed,
      mudDensity: config.mudDensity,
    });
    const rng = mulberry32(hashSeed(levelSeed, 7));

    const start = roomCenter(rooms[0]);
    grid.set(start.x, start.y, TILE.FLOOR);

    // Escada no centro da sala mais cara de alcançar a partir do início.
    const startIndex = grid.index(start.x, start.y);
    let stairs = start;
    let farthest = -1;
    for (const room of rooms.slice(1)) {
      const c = roomCenter(room);
      const r = aStar(grid, startIndex, grid.index(c.x, c.y), { heuristic: HEURISTICS.manhattan.fn });
      if (r.found && r.cost > farthest) {
        farthest = r.cost;
        stairs = c;
      }
    }
    grid.set(stairs.x, stairs.y, TILE.FLOOR);

    this.player.x = start.x;
    this.player.y = start.y;
    const monsters = this.spawnMonsters(grid, rooms, start, stairs, config, rng);
    return {
      grid,
      rooms,
      stairs,
      monsters,
      visible: new Uint8Array(grid.size),
      explored: new Uint8Array(grid.size),
    };
  }

  private spawnMonsters(
    grid: Grid,
    rooms: Room[],
    start: Point,
    stairs: Point,
    config: FloorConfig,
    rng: Rng,
  ): Monster[] {
    const candidates: Point[] = [];
    for (const room of rooms.slice(1)) {
      for (let y = room.y; y < room.y + room.h; y++) {
        for (let x = room.x; x < room.x + room.w; x++) {
          const far = Math.abs(x - start.x) + Math.abs(y - start.y) >= MIN_SPAWN_DISTANCE;
          if (far && grid.get(x, y) === TILE.FLOOR && (x !== stairs.x || y !== stairs.y)) candidates.push({ x, y });
        }
      }
    }
    shuffle(rng, candidates);

    const kinds: MonsterKind[] = [
      ...Array<MonsterKind>(config.hunters).fill('hunter'),
      ...Array<MonsterKind>(config.zombies).fill('zombie'),
    ];
    const monsters: Monster[] = [];
    for (const kind of kinds) {
      // Espalha os monstros: no mínimo 4 tiles de distância entre eles.
      const spot = candidates.find((c) => monsters.every((m) => Math.abs(m.x - c.x) + Math.abs(m.y - c.y) >= 4));
      if (!spot) break;
      monsters.push(this.createMonster(kind, spot.x, spot.y, false));
    }
    return monsters;
  }

  private buildDemoLevel(): Level {
    const grid = Grid.fromRows(DEMO_MAP);
    const [hero] = findMarkers(DEMO_MAP, '@');
    this.player.x = hero.x;
    this.player.y = hero.y;
    const monsters = findMarkers(DEMO_MAP, 'zH').map((m) =>
      this.createMonster(m.char === 'z' ? 'zombie' : 'hunter', m.x, m.y, true),
    );
    return {
      grid,
      rooms: [],
      stairs: null,
      monsters,
      visible: new Uint8Array(grid.size),
      explored: new Uint8Array(grid.size).fill(1),
    };
  }

  private createMonster(kind: MonsterKind, x: number, y: number, awake: boolean): Monster {
    const stats = MONSTERS[kind];
    return {
      id: this.nextId++,
      kind,
      name: stats.name,
      glyph: stats.glyph,
      color: stats.color,
      algorithm: stats.algorithm,
      x,
      y,
      hp: stats.hp,
      maxHp: stats.hp,
      damage: stats.damage,
      awake,
      stuck: 0,
      lastSearch: null,
    };
  }

  private log(text: string, tone: LogTone): void {
    this.emit({ type: 'log', text, tone });
  }

  private emit(event: GameEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
